import type { FastifyInstance } from "fastify";
import type { Brand, OrderStatus, Prisma, TempRequirement } from "@prisma/client";
import { prisma } from "../lib/db.js";
import { recordDecisions } from "../lib/audit.js";
import type { SessionUser } from "../lib/auth.js";
import { maxUnitsPerOrder, type FleetVehicle } from "@katapatha/core/domain/orderSize";
import { nextOperatingDate, unitSizeFor } from "../services/store.js";

/**
 * Owner: BE2
 *
 * Reads and writes live. The write path keeps every rule the brief sets
 * down: units-only on the body (brand, outlet, depot, district all come
 * from the session), idempotent on clientRequestId, and the receipt is
 * an upsert because a store manager fixing a wrong number should correct
 * it, not open a second record.
 */

const ERROR_RESPONSE = {
  type: "object",
  required: ["error"],
  properties: {
    error: {
      type: "object",
      required: ["code", "message"],
      properties: {
        code: { type: "string" },
        message: { type: "string" },
        details: { type: "object", additionalProperties: true },
      },
    },
  },
} as const;

const ORDER_RESPONSE_ITEM = {
  type: "object",
  additionalProperties: false,
  required: [
    "id",
    "ref",
    "outletId",
    "brand",
    "districtName",
    "tempRequirement",
    "units",
    "weightKg",
    "volumeM3",
    "windowOpen",
    "windowClose",
    "requestedDate",
    "status",
    "storeState",
  ],
  properties: {
    id: { type: "string" },
    ref: { type: "string" },
    outletId: { type: "string" },
    brand: { type: "string", enum: ["Fresh", "Style", "Tech"] },
    districtName: { type: "string" },
    tempRequirement: { type: "string", enum: ["chilled", "ambient"] },
    units: { type: "integer" },
    weightKg: { type: "number" },
    volumeM3: { type: "number" },
    windowOpen: { type: "string", pattern: "^([01]\\d|2[0-3]):[0-5]\\d$" },
    windowClose: { type: "string", pattern: "^([01]\\d|2[0-3]):[0-5]\\d$" },
    requestedDate: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
    status: {
      type: "string",
      enum: [
        "DRAFT",
        "PLACED",
        "QUEUED",
        "PLANNED",
        "LOADED",
        "IN_TRANSIT",
        "DELIVERED",
        "PART_DELIVERED",
        "FAILED",
        "DEFERRED",
        "CANCELLED",
      ],
    },
    storeState: {
      type: "string",
      enum: ["queued", "planned", "on_the_way", "delivered", "deferred", "cancelled"],
    },
    // Additive: the published deferral's reason and moves-to day, so the
    // store sees what the dispatcher told them (Figma D-05 store preview).
    deferral: {
      oneOf: [
        { type: "null" },
        {
          type: "object",
          additionalProperties: false,
          required: ["reasonCode", "rolledToDate"],
          properties: {
            reasonCode: { type: "string" },
            rolledToDate: {
              oneOf: [{ type: "null" }, { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" }],
            },
          },
        },
      ],
    },
  },
} as const;

type StoreState = "queued" | "planned" | "on_the_way" | "delivered" | "deferred" | "cancelled";

// Mirrors services/store.ts' own stateOf() so a dispatcher querying this
// endpoint sees the same value a store manager would see on their phone —
// one truth per order, not two.
function storeStateOf(
  status: OrderStatus,
  hasPublishedTrip: boolean,
  departed: boolean,
): StoreState {
  if (status === "DEFERRED") return "deferred";
  if (status === "CANCELLED") return "cancelled";
  if (status === "DELIVERED" || status === "PART_DELIVERED") return "delivered";
  if (departed) return "on_the_way";
  if (hasPublishedTrip) return "planned";
  return "queued";
}

/**
 * What every order read needs: the trip linkage for `storeState`, and the
 * latest published deferral for the additive `deferral` field.
 */
const ORDER_INCLUDE = {
  assignments: {
    select: {
      plan: { select: { status: true } },
      tripStop: { select: { trip: { select: { status: true } } } },
    },
  },
  deferrals: {
    where: { plan: { status: "PUBLISHED" } },
    orderBy: { decidedAt: "desc" },
    take: 1,
    select: { reasonCode: true, rolledToDate: true },
  },
} satisfies Prisma.OrderInclude;

type OrderWithTripLinkage = Prisma.OrderGetPayload<{ include: typeof ORDER_INCLUDE }>;

async function fetchOrdersFor(user: SessionUser, args: { date?: Date }) {
  const where: Record<string, unknown> = {};
  if (user.role === "STORE_MANAGER") {
    if (!user.outletId) return [];
    where.outletId = user.outletId;
  } else {
    if (!user.depotCode) return [];
    where.depotCode = user.depotCode;
  }
  if (args.date) where.requestedDate = args.date;

  return prisma.order.findMany({
    where,
    orderBy: [{ requestedDate: "desc" }, { ref: "asc" }],
    take: 100,
    include: ORDER_INCLUDE,
  });
}

function toOrderResponse(order: OrderWithTripLinkage) {
  const published = order.assignments.find((a) => a.plan.status === "PUBLISHED");
  const tripStatus = published?.tripStop?.trip?.status ?? null;
  const departed = tripStatus === "DEPARTED" || tripStatus === "COMPLETED";
  return {
    id: order.id,
    ref: order.ref,
    outletId: order.outletId,
    brand: order.brand,
    districtName: order.districtName,
    tempRequirement: order.tempRequirement,
    units: order.units,
    weightKg: order.weightKg,
    volumeM3: order.volumeM3,
    windowOpen: order.windowOpen,
    windowClose: order.windowClose,
    requestedDate: order.requestedDate.toISOString().slice(0, 10),
    status: order.status,
    storeState: storeStateOf(order.status, Boolean(published), departed),
    deferral: deferralOf(order),
  };
}

function deferralOf(order: OrderWithTripLinkage) {
  // Only while the order is actually deferred — a later plan that serves it
  // supersedes the old decision.
  const latest = order.status === "DEFERRED" ? order.deferrals[0] : undefined;
  if (!latest) return null;
  return {
    reasonCode: latest.reasonCode,
    rolledToDate: latest.rolledToDate?.toISOString().slice(0, 10) ?? null,
  };
}

/**
 * Prisma's unique-constraint error. Matched on the code rather than with
 * `instanceof PrismaClientKnownRequestError`, because that class is a runtime
 * import and this only needs the one discriminator.
 */
function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === "P2002"
  );
}

function parseDate(value: unknown): Date | undefined {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  return new Date(`${value}T00:00:00.000Z`);
}

/**
 * How big one order can be for this outlet, per temperature: the outlet's own
 * unit-size estimate against the roomiest vehicle allowed to carry it (Rule 5:
 * an order travels whole). The whole depot fleet counts, workshop or not —
 * this is about whether any day could ever plan it.
 */
async function orderLimitsFor(outlet: { id: string; depotCode: string; parkingConstraint: string }) {
  const vehicles: FleetVehicle[] = await prisma.vehicle.findMany({
    where: { depotCode: outlet.depotCode },
    select: { type: true, temp: true, volumeCapM3: true, weightCapKg: true },
  });
  const vanOnly = outlet.parkingConstraint === "van_only";
  const limits = {} as Record<
    TempRequirement,
    { m3PerUnit: number; kgPerUnit: number; maxUnitsPerOrder: number }
  >;
  for (const temp of ["chilled", "ambient"] as const) {
    const size = await unitSizeFor(outlet.id, temp);
    limits[temp as TempRequirement] = {
      m3PerUnit: size.m3PerUnit,
      kgPerUnit: size.kgPerUnit,
      maxUnitsPerOrder: maxUnitsPerOrder(vehicles, { tempRequirement: temp, vanOnly }, size),
    };
  }
  return limits;
}

const LIMIT = {
  type: "object",
  additionalProperties: false,
  required: ["m3PerUnit", "kgPerUnit", "maxUnitsPerOrder"],
  properties: {
    m3PerUnit: { type: "number" },
    kgPerUnit: { type: "number" },
    maxUnitsPerOrder: { type: "integer" },
  },
} as const;

export default async function (fastify: FastifyInstance) {
  fastify.get(
    "/orders/limits",
    {
      schema: {
        response: {
          200: {
            type: "object",
            additionalProperties: false,
            required: ["chilled", "ambient"],
            properties: { chilled: LIMIT, ambient: LIMIT },
          },
          403: ERROR_RESPONSE,
        },
      },
    },
    async (request, reply) => {
      const user = request.requireRole("STORE_MANAGER");
      const outlet = user.outletId
        ? await prisma.outlet.findUnique({ where: { id: user.outletId } })
        : null;
      if (!outlet) {
        return reply
          .status(403)
          .send({ error: { code: "FORBIDDEN", message: "This account is not bound to an outlet." } });
      }
      return orderLimitsFor(outlet);
    },
  );

  fastify.get(
    "/orders",
    {
      schema: {
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: {
            date: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
          },
        },
        response: {
          200: { type: "array", items: ORDER_RESPONSE_ITEM },
        },
      },
    },
    async (request) => {
      const user = request.requireRole("STORE_MANAGER", "DISPATCHER");
      const query = request.query as { date?: string };
      const date = parseDate(query.date);
      const orders = await fetchOrdersFor(user, { date });
      return orders.map(toOrderResponse);
    },
  );

  fastify.get(
    "/orders/:orderId",
    {
      schema: {
        params: {
          type: "object",
          required: ["orderId"],
          properties: { orderId: { type: "string", minLength: 1 } },
        },
        response: {
          200: ORDER_RESPONSE_ITEM,
          404: ERROR_RESPONSE,
        },
      },
    },
    async (request, reply) => {
      const user = request.requireRole("STORE_MANAGER", "DISPATCHER");
      const { orderId } = request.params as { orderId: string };

      const where: Record<string, unknown> = { id: orderId };
      if (user.role === "STORE_MANAGER") {
        if (!user.outletId) return reply.status(404).send({ error: { code: "NOT_FOUND", message: "Order not found." } });
        where.outletId = user.outletId;
      } else {
        if (!user.depotCode) return reply.status(404).send({ error: { code: "NOT_FOUND", message: "Order not found." } });
        where.depotCode = user.depotCode;
      }

      const order = await prisma.order.findFirst({
        where,
        include: ORDER_INCLUDE,
      });
      if (!order) {
        return reply.status(404).send({ error: { code: "NOT_FOUND", message: "Order not found." } });
      }
      return toOrderResponse(order);
    },
  );

  fastify.post(
    "/orders",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["requestId", "forDate", "lines"],
          properties: {
            requestId: { type: "string", format: "uuid" },
            forDate: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
            lines: {
              type: "array",
              minItems: 1,
              items: {
                type: "object",
                additionalProperties: false,
                required: ["tempRequirement", "units"],
                properties: {
                  tempRequirement: { type: "string", enum: ["chilled", "ambient"] },
                  units: { type: "integer", minimum: 1, maximum: 10000 },
                },
              },
            },
          },
        },
        response: {
          200: { type: "array", items: ORDER_RESPONSE_ITEM },
          201: { type: "array", items: ORDER_RESPONSE_ITEM },
          403: ERROR_RESPONSE,
          422: ERROR_RESPONSE,
        },
      },
    },
    async (request, reply) => {
      const user = request.requireRole("STORE_MANAGER");
      if (!user.outletId) {
        return reply.status(403).send({
          error: {
            code: "FORBIDDEN",
            message: "This account is not bound to an outlet.",
          },
        });
      }
      const body = request.body as {
        requestId: string;
        forDate: string;
        lines: Array<{ tempRequirement: "chilled" | "ambient"; units: number }>;
      };

      // Idempotency: a retry with the same requestId returns the first result
      // without creating duplicates. Prisma's clientRequestId is @unique, so a
      // multi-line order can't store the raw requestId on every row — we
      // append the line index and look up by prefix on retry.
      //
      // The prefix match is safe because `requestId` is constrained to
      // `format: uuid` in the schema above: a UUID cannot contain a colon, so
      // "<uuid>:" cannot be a prefix of a different request's key. That
      // constraint is load-bearing — loosening it to a free string would make
      // one request able to recover another's orders.
      const requestKeyPrefix = `${body.requestId}:`;
      // Captured after the guard above, so the closures below keep the narrowing.
      const outletId = user.outletId;

      // Sorted on the numeric line index, NOT on clientRequestId. Lexicographic
      // order over "<uuid>:0" … "<uuid>:10" gives :0, :1, :10, :11, :2 … so a
      // ten-line order came back from a retry in a different order than the
      // original POST returned it. `lines` has no maxItems, so that is reachable.
      const lineIndexOf = (clientRequestId: string | null) =>
        Number(clientRequestId?.slice(requestKeyPrefix.length) ?? 0);

      async function findPrior() {
        const rows = await prisma.order.findMany({
          where: {
            outletId,
            clientRequestId: { startsWith: requestKeyPrefix },
          },
          include: ORDER_INCLUDE,
        });
        return rows.sort((a, b) => lineIndexOf(a.clientRequestId) - lineIndexOf(b.clientRequestId));
      }

      const prior = await findPrior();
      if (prior.length > 0) {
        return reply.status(200).send(prior.map(toOrderResponse));
      }

      const outlet = await prisma.outlet.findUnique({ where: { id: user.outletId } });
      if (!outlet) {
        return reply.status(422).send({
          error: {
            code: "VALIDATION_FAILED",
            message: "This outlet is no longer in the directory.",
          },
        });
      }

      const requestedDate = new Date(`${body.forDate}T00:00:00.000Z`);
      // Store managers can order for today, tomorrow, or any later operating
      // day, never for a past date.
      const minimum = await nextOperatingDate(new Date(Date.now() - 24 * 60 * 60 * 1000));
      if (minimum && requestedDate < minimum) {
        return reply.status(422).send({
          error: {
            code: "VALIDATION_FAILED",
            message: `Earliest operating day is ${minimum.toISOString().slice(0, 10)}.`,
          },
        });
      }

      // Per-unit size estimates double as the Rule 5 check: an order travels
      // whole, so a line no vehicle could ever carry would be deferred every
      // morning. Refuse it here and say how big an order can be — the store
      // raises it as several lines instead.
      const limits = await orderLimitsFor(outlet);
      const sizeByTemp = new Map<TempRequirement, { kgPerUnit: number; m3PerUnit: number }>(
        (["chilled", "ambient"] as const).map((temp) => [temp as TempRequirement, limits[temp as TempRequirement]]),
      );
      const tooLarge = body.lines.find(
        (line) => line.units > limits[line.tempRequirement as TempRequirement].maxUnitsPerOrder,
      );
      if (tooLarge) {
        const max = limits[tooLarge.tempRequirement as TempRequirement].maxUnitsPerOrder;
        return reply.status(422).send({
          error: {
            code: "ORDER_TOO_LARGE",
            message:
              max > 0
                ? `${tooLarge.units} ${tooLarge.tempRequirement} units won't fit on any vehicle that can reach this outlet. One order can hold at most ${max} units — place it as several orders.`
                : `No vehicle at this depot can carry ${tooLarge.tempRequirement} goods to this outlet.`,
            details: { tempRequirement: tooLarge.tempRequirement, units: tooLarge.units, maxUnitsPerOrder: max },
          },
        });
      }

      // Wrapped so the double-submit this idempotency key exists for cannot
      // surface as a 500. The prior-lookup above and this create are not one
      // transaction, so two simultaneous identical POSTs can both see no prior
      // rows and both try to create; the loser hits the clientRequestId @unique
      // index (P2002). That is the index doing its job, but the caller should get
      // the first result, not a server error -- so on P2002 we re-read and return
      // 200, which is the same answer a sequential retry would have received.
      let created;
      try {
        created = await prisma.$transaction(async (tx) => {
          // Allocate per-line sequential refs under the same requestedDate to
          // keep the (ref, requestedDate) unique index happy, and to leave an
          // operations-readable number on the dock card.
          const latest = await tx.order.findFirst({
            where: { ref: { startsWith: "ORD-" } },
            orderBy: { ref: "desc" },
            select: { ref: true },
          });
          const start = latest ? Number.parseInt(latest.ref.slice(4), 10) : 4000;
          const first = Number.isFinite(start) ? start + 1 : 4001;

          const rows = [];
          for (let index = 0; index < body.lines.length; index++) {
            const line = body.lines[index]!;
            const size = sizeByTemp.get(line.tempRequirement as TempRequirement)!;
            const ref = `ORD-${String(first + index).padStart(6, "0")}`;
            const row = await tx.order.create({
              data: {
                ref,
                outletId: outlet.id,
                brand: outlet.brand as Brand,
                districtName: outlet.districtName,
                depotCode: outlet.depotCode,
                tempRequirement: line.tempRequirement as TempRequirement,
                units: line.units,
                weightKg: Number((size.kgPerUnit * line.units).toFixed(1)),
                volumeM3: Number((size.m3PerUnit * line.units).toFixed(2)),
                windowOpen: outlet.windowOpen,
                windowClose: outlet.windowClose,
                requestedDate,
                placedByUserId: user.id,
                status: "QUEUED",
                // Index-tagged so a multi-line retry recovers every row.
                clientRequestId: `${requestKeyPrefix}${index}`,
              },
            });
            rows.push(row);
          }
          return rows;
        });
      } catch (error) {
        if (isUniqueViolation(error)) {
          const raced = await findPrior();
          if (raced.length > 0) {
            return reply.status(200).send(raced.map(toOrderResponse));
          }
        }
        throw error;
      }

      const withLinkage = await prisma.order.findMany({
        where: { id: { in: created.map((o) => o.id) } },
        include: ORDER_INCLUDE,
      });

      await recordDecisions(
        created.map((row) => ({
          actor: user,
          action: "order.place",
          entityType: "Order",
          entityId: row.id,
          after: { ref: row.ref, units: row.units, forDate: body.forDate },
        })),
      );

      return reply.status(201).send(withLinkage.map(toOrderResponse));
    },
  );

  fastify.put(
    "/orders/:orderId/receipt",
    {
      schema: {
        params: {
          type: "object",
          required: ["orderId"],
          properties: { orderId: { type: "string", minLength: 1 } },
        },
        body: {
          type: "object",
          additionalProperties: false,
          required: ["unitsReceived", "matches"],
          properties: {
            unitsReceived: { type: "integer", minimum: 0 },
            matches: { type: "boolean" },
            issueKind: {
              oneOf: [
                {
                  type: "string",
                  enum: ["ITEMS_MISSING", "ITEMS_DAMAGED", "ARRIVED_WARM", "WRONG_ITEMS"],
                },
                { type: "null" },
              ],
            },
            note: { oneOf: [{ type: "string" }, { type: "null" }] },
          },
        },
        response: {
          200: {
            type: "object",
            additionalProperties: false,
            required: ["orderId", "confirmedAt", "unitsReceived", "matches"],
            properties: {
              orderId: { type: "string" },
              confirmedAt: { type: "string", format: "date-time" },
              unitsReceived: { type: "integer" },
              matches: { type: "boolean" },
              issueKind: { oneOf: [{ type: "string" }, { type: "null" }] },
              note: { oneOf: [{ type: "string" }, { type: "null" }] },
            },
          },
          403: ERROR_RESPONSE,
          404: ERROR_RESPONSE,
          422: ERROR_RESPONSE,
        },
      },
    },
    async (request, reply) => {
      const user = request.requireRole("STORE_MANAGER");
      if (!user.outletId) {
        return reply
          .status(403)
          .send({ error: { code: "FORBIDDEN", message: "This account is not bound to an outlet." } });
      }
      const { orderId } = request.params as { orderId: string };
      const body = request.body as {
        unitsReceived: number;
        matches: boolean;
        issueKind?: string | null;
        note?: string | null;
      };

      // A mismatch without a reason is unactionable for the dispatcher — the
      // UI collects one, the server enforces it.
      if (!body.matches && !body.issueKind) {
        return reply.status(422).send({
          error: {
            code: "VALIDATION_FAILED",
            message: "A mismatched receipt needs an issue kind so the dispatcher can respond.",
          },
        });
      }

      const order = await prisma.order.findFirst({
        where: { id: orderId, outletId: user.outletId },
        select: { id: true, status: true },
      });
      if (!order) {
        return reply
          .status(404)
          .send({ error: { code: "NOT_FOUND", message: "Order not found." } });
      }
      if (order.status !== "DELIVERED" && order.status !== "PART_DELIVERED") {
        return reply.status(422).send({
          error: {
            code: "NOT_DELIVERED",
            message:
              "The driver hasn't recorded this delivery yet. Receipt is only for orders the driver has marked delivered.",
          },
        });
      }

      const receipt = await prisma.receiptConfirmation.upsert({
        where: { orderId: order.id },
        create: {
          orderId: order.id,
          confirmedByUserId: user.id,
          unitsReceived: body.unitsReceived,
          matches: body.matches,
          issueKind: body.issueKind ?? null,
          note: body.note ?? null,
        },
        update: {
          confirmedByUserId: user.id,
          unitsReceived: body.unitsReceived,
          matches: body.matches,
          issueKind: body.issueKind ?? null,
          note: body.note ?? null,
          confirmedAt: new Date(),
        },
      });

      await recordDecisions([
        {
          actor: user,
          action: "order.receive",
          entityType: "Order",
          entityId: order.id,
          reasonCode: body.issueKind ?? undefined,
          note: body.note ?? undefined,
          after: { unitsReceived: receipt.unitsReceived, matches: receipt.matches },
        },
      ]);

      return {
        orderId: receipt.orderId,
        confirmedAt: receipt.confirmedAt.toISOString(),
        unitsReceived: receipt.unitsReceived,
        matches: receipt.matches,
        issueKind: receipt.issueKind,
        note: receipt.note,
      };
    },
  );
}
