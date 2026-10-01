import type { FastifyInstance } from "fastify";
import type { Brand, OrderStatus, TempRequirement } from "@prisma/client";
import { prisma } from "../lib/db.js";
import type { SessionUser } from "../lib/auth.js";
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

type OrderWithTripLinkage = Awaited<ReturnType<typeof fetchOrdersFor>>[number];

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
    include: {
      assignments: {
        select: {
          plan: { select: { status: true } },
          tripStop: { select: { trip: { select: { status: true } } } },
        },
      },
    },
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
  };
}

function parseDate(value: unknown): Date | undefined {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  return new Date(`${value}T00:00:00.000Z`);
}

export default async function (fastify: FastifyInstance) {
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
        include: {
          assignments: {
            select: {
              plan: { select: { status: true } },
              tripStop: { select: { trip: { select: { status: true } } } },
            },
          },
        },
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
      const requestKeyPrefix = `${body.requestId}:`;
      const prior = await prisma.order.findMany({
        where: {
          outletId: user.outletId,
          clientRequestId: { startsWith: requestKeyPrefix },
        },
        orderBy: { clientRequestId: "asc" },
        include: {
          assignments: {
            select: {
              plan: { select: { status: true } },
              tripStop: { select: { trip: { select: { status: true } } } },
            },
          },
        },
      });
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

      const sizeByTemp = new Map<TempRequirement, { kgPerUnit: number; m3PerUnit: number }>();
      for (const temp of ["chilled", "ambient"] as const) {
        sizeByTemp.set(temp as TempRequirement, await unitSizeFor(user.outletId, temp));
      }

      const created = await prisma.$transaction(async (tx) => {
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

      const withLinkage = await prisma.order.findMany({
        where: { id: { in: created.map((o) => o.id) } },
        include: {
          assignments: {
            select: {
              plan: { select: { status: true } },
              tripStop: { select: { trip: { select: { status: true } } } },
            },
          },
        },
      });

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
