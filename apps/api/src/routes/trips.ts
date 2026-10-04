import type { FastifyInstance } from "fastify";
import type { LoadCondition, TripStatus } from "@prisma/client";
import { prisma } from "../lib/db.js";
import { requireLoaderTrip, requireOrderOnTrip } from "../lib/authorization.js";
import { recordDecisions } from "../lib/audit.js";
import { ORDER_ITEMS_SCHEMA, ORDER_LINES_INCLUDE, itemsOf } from "../services/products.js";
import { chillerView } from "../services/vehicles.js";
import {
  cleanItemCounts,
  ensureBaysForDate,
  itemCountsJson,
  latestSwaps,
  loadedUnitsByTrip,
  type SwapView,
} from "../services/dock.js";
import { SwapError, createSwap, recordSwapStep, swapCandidates, type SwapStep } from "../services/vehicleSwap.js";

/**
 * Owner: BE3
 *
 * The loader's dock surface. Trips are published PLANNED, each line is
 * recorded with a LoadCheck (and a Shortfall when non-OK), and marking
 * ready is gated: every line must be checked AND no shortfall may still
 * block departure. DOMAIN.md calls the gate out explicitly, so the 409
 * on the readiness endpoint carries the exact blocking reason.
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

const SWAP = {
  type: "object",
  additionalProperties: false,
  required: [
    "id", "fromVehicleId", "toVehicleId", "reason", "previousDepartAt", "newDepartAt", "unloadedUnits",
    "createdAt", "unloadedAt", "unloadedByName", "arrivedAt", "arrivedByName", "acknowledgedAt",
  ],
  properties: {
    id: { type: "string" },
    fromVehicleId: { type: "string" },
    toVehicleId: { type: "string" },
    reason: { type: "string" },
    previousDepartAt: { type: "string" },
    newDepartAt: { type: "string" },
    unloadedUnits: { type: "integer" },
    createdAt: { type: "string" },
    unloadedAt: { oneOf: [{ type: "string" }, { type: "null" }] },
    unloadedByName: { oneOf: [{ type: "string" }, { type: "null" }] },
    arrivedAt: { oneOf: [{ type: "string" }, { type: "null" }] },
    arrivedByName: { oneOf: [{ type: "string" }, { type: "null" }] },
    acknowledgedAt: { oneOf: [{ type: "string" }, { type: "null" }] },
    storesNotified: { type: "integer" },
  },
} as const;

const ITEM_COUNTS = {
  type: "object",
  additionalProperties: { type: "integer", minimum: 0 },
  maxProperties: 200,
} as const;

const NULLABLE_DATE_TIME = { oneOf: [{ type: "string" }, { type: "null" }] } as const;

const TRIP = {
  type: "object",
  additionalProperties: false,
  required: ["id", "vehicleId", "tripNo", "brand", "districtName", "wave", "status"],
  properties: {
    id: { type: "string" },
    vehicleId: { type: "string" },
    tripNo: { type: "integer", enum: [1, 2] },
    brand: { type: "string", enum: ["Fresh", "Style", "Tech"] },
    districtName: { type: "string" },
    wave: { type: "string", enum: ["PREDAWN", "DAYTIME"] },
    status: {
      type: "string",
      enum: ["PLANNED", "LOADING", "READY", "DEPARTED", "COMPLETED", "CANCELLED"],
    },
    plannedDepartAt: { type: "string", pattern: "^([01]\\d|2[0-3]):[0-5]\\d$" },
    plannedMinutes: { type: "integer" },
    sumWeightKg: { type: "number" },
    sumVolumeM3: { type: "number" },
    // Additive. Whether an open shortfall is holding this trip at the dock, and
    // the latest chiller reading for a refrigerated vehicle. Both were only
    // readable by a dispatcher, so the loader could not tell a line the
    // dispatcher had cleared from one still waiting.
    blocked: { type: "boolean" },
    chiller: {
      oneOf: [
        { type: "null" },
        {
          type: "object",
          additionalProperties: false,
          required: ["tempC", "targetMinC", "targetMaxC", "inRange", "source", "recordedAt", "ageSeconds"],
          properties: {
            tempC: { type: "number" },
            targetMinC: { type: "number" },
            targetMaxC: { type: "number" },
            inRange: { type: "boolean" },
            source: { type: "string", enum: ["LOADER_AT_BAY", "DRIVER_ON_ARRIVAL"] },
            recordedByName: { oneOf: [{ type: "string" }, { type: "null" }] },
            recordedAt: { type: "string" },
            ageSeconds: { type: "integer" },
          },
        },
      ],
    },
    date: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
    depotCode: { type: "string" },
    // Additive (dock). The bay the trip loads at, when loading started, when
    // it was sealed, the units on board so far, and the latest vehicle swap.
    dockBay: { oneOf: [{ type: "integer" }, { type: "null" }] },
    loadStartedAt: NULLABLE_DATE_TIME,
    sealedAt: NULLABLE_DATE_TIME,
    loadedUnits: { type: "integer" },
    swap: { oneOf: [{ type: "null" }, SWAP] },
  },
} as const;

const LOAD_LIST = {
  type: "object",
  additionalProperties: false,
  required: ["tripId", "status", "lines"],
  properties: {
    tripId: { type: "string" },
    status: {
      type: "string",
      enum: ["PLANNED", "LOADING", "READY", "DEPARTED", "COMPLETED", "CANCELLED"],
    },
    lines: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["orderId", "orderRef", "outletId", "seq", "expectedUnits"],
        properties: {
          orderId: { type: "string" },
          orderRef: { type: "string" },
          outletId: { type: "string" },
          seq: { type: "integer" },
          expectedUnits: { type: "integer" },
          // Additive: what the order contains, so the dock sees what it is loading.
          items: ORDER_ITEMS_SCHEMA,
          loadedUnits: { oneOf: [{ type: "integer" }, { type: "null" }] },
          condition: {
            oneOf: [
              { type: "string", enum: ["OK", "SHORT", "DAMAGED", "MISSING"] },
              { type: "null" },
            ],
          },
          // Additive (dock). When the check landed, the per-item counts it
          // carried, and a count in progress on a line not yet checked.
          checkedAt: NULLABLE_DATE_TIME,
          itemCounts: { oneOf: [{ type: "null" }, ITEM_COUNTS] },
          progress: {
            oneOf: [
              { type: "null" },
              {
                type: "object",
                additionalProperties: false,
                required: ["loadedUnits", "itemCounts", "updatedByName", "updatedAt"],
                properties: {
                  loadedUnits: { type: "integer" },
                  itemCounts: { oneOf: [{ type: "null" }, ITEM_COUNTS] },
                  updatedByName: { type: "string" },
                  updatedAt: { type: "string" },
                },
              },
            ],
          },
          // Additive. The shortfall raised for this line, if any, and what became
          // of it. A line the dispatcher sent short keeps condition SHORT
          // forever; this is what says the dock is no longer waiting on it.
          shortfall: {
            oneOf: [
              { type: "null" },
              {
                type: "object",
                additionalProperties: false,
                required: ["id", "status", "blocksDeparture"],
                properties: {
                  id: { type: "string" },
                  status: { type: "string", enum: ["OPEN", "RESOLVED"] },
                  blocksDeparture: { type: "boolean" },
                  reasonCode: { oneOf: [{ type: "string" }, { type: "null" }] },
                  productSku: { oneOf: [{ type: "string" }, { type: "null" }] },
                  hasPhoto: { type: "boolean" },
                  resolution: {
                    oneOf: [
                      { type: "string", enum: ["SEND_SHORT", "HOLD_ORDER", "MOVE_TO_TRIP_2", "CANCEL_LINE"] },
                      { type: "null" },
                    ],
                  },
                },
              },
            ],
          },
        },
      },
    },
  },
} as const;

const LOAD_CHECK_RESPONSE = {
  type: "object",
  additionalProperties: false,
  required: ["tripId", "orderId", "expectedUnits", "loadedUnits", "condition"],
  properties: {
    tripId: { type: "string" },
    orderId: { type: "string" },
    expectedUnits: { type: "integer" },
    loadedUnits: { type: "integer" },
    condition: { type: "string", enum: ["OK", "SHORT", "DAMAGED", "MISSING"] },
    shortfallId: { oneOf: [{ type: "string" }, { type: "null" }] },
  },
} as const;

function parseDate(value: unknown): Date | undefined {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  return new Date(`${value}T00:00:00.000Z`);
}

type TripRow = Awaited<ReturnType<typeof prisma.trip.findMany>>[number];
type TripExtras = Awaited<ReturnType<typeof tripExtras>>;

/** The trip as the loader sees it, with what is holding it at the dock. */
function tripView(trip: TripRow, extras: TripExtras, more: { date?: string; depotCode?: string } = {}) {
  const swap = extras.swaps.get(trip.id) ?? null;
  return {
    id: trip.id,
    vehicleId: trip.vehicleId,
    tripNo: trip.tripNo as 1 | 2,
    brand: trip.brand,
    districtName: trip.districtName,
    wave: trip.wave,
    status: trip.status,
    plannedDepartAt: trip.plannedDepartAt,
    plannedMinutes: Math.round(trip.plannedMinutes),
    sumWeightKg: trip.sumWeightKg,
    sumVolumeM3: trip.sumVolumeM3,
    blocked: extras.blocked.has(trip.id),
    chiller: extras.chiller.get(trip.id) ?? null,
    dockBay: trip.dockBay,
    loadStartedAt: trip.loadStartedAt?.toISOString() ?? null,
    sealedAt: trip.loadConfirmedAt?.toISOString() ?? null,
    loadedUnits: extras.loaded.get(trip.id) ?? 0,
    swap,
    ...more,
  };
}

/**
 * Two lookups for a set of trips, each one query: which are held by an open
 * shortfall, and the latest chiller reading on each.
 */
async function tripExtras(tripIds: string[]) {
  if (tripIds.length === 0) {
    return {
      blocked: new Set<string>(),
      chiller: new Map<string, ReturnType<typeof chillerView>>(),
      loaded: new Map<string, number>(),
      swaps: new Map<string, SwapView>(),
    };
  }
  const [open, readings, loaded, swaps] = await Promise.all([
    prisma.shortfall.findMany({
      where: { tripId: { in: tripIds }, status: "OPEN", blocksDeparture: true },
      select: { tripId: true },
    }),
    prisma.chillerReading.findMany({
      where: { tripId: { in: tripIds } },
      orderBy: [{ tripId: "asc" }, { recordedAt: "desc" }],
      distinct: ["tripId"],
    }),
    loadedUnitsByTrip(tripIds),
    latestSwaps(tripIds),
  ]);
  const now = new Date();
  return {
    loaded,
    swaps,
    blocked: new Set(open.map((s) => s.tripId)),
    chiller: new Map(
      readings.flatMap((r) => (r.tripId ? [[r.tripId, chillerView(r, now)] as const] : [])),
    ),
  };
}

export default async function (fastify: FastifyInstance) {
  fastify.get(
    "/trips",
    {
      schema: {
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: {
            date: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
            status: {
              type: "string",
              enum: ["PLANNED", "LOADING", "READY", "DEPARTED", "COMPLETED", "CANCELLED"],
            },
          },
        },
        response: {
          200: { type: "array", items: TRIP },
        },
      },
    },
    async (request) => {
      const user = request.requireRole("LOADER", "DISPATCHER");
      if (!user.depotCode) return [];
      const query = request.query as { date?: string; status?: TripStatus };
      const date = parseDate(query.date);
      // Every trip read by the dock carries its bay, so give the day's trips
      // one first. Idempotent: a bay, once given, never moves.
      await ensureBaysForDate(user.depotCode, query.date);

      const trips = await prisma.trip.findMany({
        where: {
          plan: {
            status: "PUBLISHED",
            planningDay: {
              depotCode: user.depotCode,
              ...(date ? { date } : {}),
            },
          },
          ...(query.status ? { status: query.status } : {}),
        },
        orderBy: [{ wave: "asc" }, { plannedDepartAt: "asc" }, { vehicleId: "asc" }],
        take: 100,
      });

      const extras = await tripExtras(trips.map((t) => t.id));
      return trips.map((trip) => tripView(trip, extras));
    },
  );

  fastify.get(
    "/trips/:tripId",
    {
      schema: {
        params: {
          type: "object",
          required: ["tripId"],
          properties: { tripId: { type: "string", minLength: 1 } },
        },
        response: { 200: TRIP, 403: ERROR_RESPONSE, 404: ERROR_RESPONSE },
      },
    },
    async (request, reply) => {
      const user = request.requireRole("LOADER", "DISPATCHER");
      const { tripId } = request.params as { tripId: string };

      let found;
      try {
        found = await requireLoaderTrip(user, tripId);
      } catch {
        return reply
          .status(404)
          .send({ error: { code: "NOT_FOUND", message: "Trip not found at this depot." } });
      }
      const extras = await tripExtras([found.id]);
      return tripView(found, extras, {
        date: found.plan.planningDay.date.toISOString().slice(0, 10),
        depotCode: found.plan.planningDay.depotCode,
      });
    },
  );

  fastify.get(
    "/trips/:tripId/load-list",
    {
      schema: {
        params: {
          type: "object",
          required: ["tripId"],
          properties: { tripId: { type: "string", minLength: 1 } },
        },
        response: {
          200: LOAD_LIST,
          403: ERROR_RESPONSE,
          404: ERROR_RESPONSE,
        },
      },
    },
    async (request, reply) => {
      const user = request.requireRole("LOADER", "DISPATCHER");
      const { tripId } = request.params as { tripId: string };

      try {
        await requireLoaderTrip(user, tripId);
      } catch {
        return reply
          .status(404)
          .send({ error: { code: "NOT_FOUND", message: "Trip not found at this depot." } });
      }

      const trip = await prisma.trip.findUnique({
        where: { id: tripId },
        select: {
          id: true,
          status: true,
          stops: {
            // The brief: lines come back in REVERSE delivery order because the
            // driver unloads from the back. The dock loads the last stop first.
            orderBy: { seq: "desc" },
            select: {
              seq: true,
              outletId: true,
              orders: {
                select: {
                  order: { select: { id: true, ref: true, units: true, lines: ORDER_LINES_INCLUDE } },
                },
              },
            },
          },
          loadChecks: {
            select: {
              orderId: true,
              loadedUnits: true,
              condition: true,
              checkedAt: true,
              itemCounts: true,
            },
          },
          loadProgress: {
            select: { orderId: true, loadedUnits: true, itemCounts: true, updatedByName: true, updatedAt: true },
          },
          // Newest first, so the first one per order is the one that counts.
          shortfalls: {
            orderBy: { raisedAt: "desc" },
            select: {
              id: true,
              orderId: true,
              status: true,
              blocksDeparture: true,
              resolution: true,
              reasonCode: true,
              productSku: true,
              photoData: true,
            },
          },
        },
      });
      if (!trip) {
        return reply
          .status(404)
          .send({ error: { code: "NOT_FOUND", message: "Trip not found." } });
      }

      const checkByOrderId = new Map(trip.loadChecks.map((c) => [c.orderId, c]));
      const progressByOrderId = new Map(trip.loadProgress.map((p) => [p.orderId, p]));
      const shortfallByOrderId = new Map<string, (typeof trip.shortfalls)[number]>();
      for (const s of trip.shortfalls) if (!shortfallByOrderId.has(s.orderId)) shortfallByOrderId.set(s.orderId, s);
      const lines = trip.stops.flatMap((stop) =>
        stop.orders.map(({ order }) => {
          const check = checkByOrderId.get(order.id);
          const progress = check ? undefined : progressByOrderId.get(order.id);
          const shortfall = shortfallByOrderId.get(order.id);
          return {
            orderId: order.id,
            orderRef: order.ref,
            outletId: stop.outletId,
            seq: stop.seq,
            expectedUnits: order.units,
            // Context only: the check below still counts the order's units.
            items: itemsOf(order.lines),
            loadedUnits: check?.loadedUnits ?? null,
            condition: check?.condition ?? null,
            checkedAt: check?.checkedAt.toISOString() ?? null,
            itemCounts: cleanItemCounts(check?.itemCounts),
            progress: progress
              ? {
                  loadedUnits: progress.loadedUnits,
                  itemCounts: cleanItemCounts(progress.itemCounts),
                  updatedByName: progress.updatedByName,
                  updatedAt: progress.updatedAt.toISOString(),
                }
              : null,
            shortfall: shortfall
              ? {
                  id: shortfall.id,
                  status: shortfall.status,
                  blocksDeparture: shortfall.blocksDeparture,
                  resolution: shortfall.resolution,
                  reasonCode: shortfall.reasonCode,
                  productSku: shortfall.productSku,
                  hasPhoto: Boolean(shortfall.photoData),
                }
              : null,
          };
        }),
      );

      return { tripId: trip.id, status: trip.status, lines };
    },
  );

  fastify.put(
    "/trips/:tripId/load-checks/:orderId",
    {
      schema: {
        params: {
          type: "object",
          required: ["tripId", "orderId"],
          properties: {
            tripId: { type: "string", minLength: 1 },
            orderId: { type: "string", minLength: 1 },
          },
        },
        body: {
          type: "object",
          additionalProperties: false,
          required: ["loadedUnits", "condition", "checkedByName"],
          properties: {
            loadedUnits: { type: "integer", minimum: 0 },
            condition: { type: "string", enum: ["OK", "SHORT", "DAMAGED", "MISSING"] },
            checkedByName: { type: "string", minLength: 2 },
            reasonCode: { oneOf: [{ type: "string" }, { type: "null" }] },
            clientRequestId: {
              oneOf: [{ type: "string", format: "uuid" }, { type: "null" }],
            },
            // Additive (dock). Per-item counts that sum to loadedUnits; the one
            // product a report is about; a photo of it; and whether the
            // vehicle may still be sealed before the dispatcher decides
            // (false = keep loading and sealing; default true = hold).
            itemCounts: ITEM_COUNTS,
            productSku: { oneOf: [{ type: "string", maxLength: 32 }, { type: "null" }] },
            photoData: {
              oneOf: [{ type: "string", maxLength: 3_000_000, pattern: "^data:image/(jpeg|png|webp);base64," }, { type: "null" }],
            },
            holdSealing: { type: "boolean" },
          },
        },
        response: {
          200: LOAD_CHECK_RESPONSE,
          403: ERROR_RESPONSE,
          404: ERROR_RESPONSE,
          422: ERROR_RESPONSE,
        },
      },
    },
    async (request, reply) => {
      const user = request.requireRole("LOADER", "DISPATCHER");
      const { tripId, orderId } = request.params as { tripId: string; orderId: string };
      const body = request.body as {
        loadedUnits: number;
        condition: LoadCondition;
        checkedByName: string;
        reasonCode?: string | null;
        clientRequestId?: string | null;
        itemCounts?: Record<string, number>;
        productSku?: string | null;
        photoData?: string | null;
        holdSealing?: boolean;
      };
      const itemCounts = cleanItemCounts(body.itemCounts);

      try {
        await requireLoaderTrip(user, tripId);
      } catch {
        return reply
          .status(404)
          .send({ error: { code: "NOT_FOUND", message: "Trip not found at this depot." } });
      }
      const order = await requireOrderOnTrip(user, tripId, orderId).catch(() => null);
      if (!order) {
        return reply
          .status(404)
          .send({ error: { code: "NOT_FOUND", message: "Order not on this trip." } });
      }

      if (body.condition !== "OK" && !body.reasonCode) {
        return reply.status(422).send({
          error: {
            code: "REASON_REQUIRED",
            message: "A non-OK condition opens a shortfall and must carry a reason code.",
          },
        });
      }

      const missing = Math.max(order.units - body.loadedUnits, 0);

      if (itemCounts && Object.values(itemCounts).reduce((a, b) => a + b, 0) !== body.loadedUnits) {
        return reply.status(422).send({
          error: { code: "ITEM_COUNTS_MISMATCH", message: "The per-item counts must add up to the loaded units." },
        });
      }
      const holds = body.holdSealing ?? true;

      const result = await prisma.$transaction(async (tx) => {
        // Upsert the LoadCheck so a correction replaces the earlier line
        // rather than opening a second one.
        const loadCheck = await tx.loadCheck.upsert({
          where: { tripId_orderId: { tripId, orderId } },
          create: {
            tripId,
            orderId,
            expectedUnits: order.units,
            loadedUnits: body.loadedUnits,
            condition: body.condition,
            checkedByName: body.checkedByName.trim(),
            checkedByUserId: user.id,
            clientRequestId: body.clientRequestId ?? null,
            itemCounts: itemCountsJson(itemCounts),
          },
          update: {
            loadedUnits: body.loadedUnits,
            condition: body.condition,
            checkedByName: body.checkedByName.trim(),
            checkedByUserId: user.id,
            checkedAt: new Date(),
            itemCounts: itemCountsJson(itemCounts),
          },
        });
        // A check supersedes any count in progress on the line.
        await tx.loadProgress.deleteMany({ where: { tripId, orderId } });

        // Shortfalls follow the LoadCheck: close any open ones when the line
        // is now OK, create or update one when it isn't.
        let shortfallId: string | null = null;
        if (body.condition === "OK") {
          await tx.shortfall.updateMany({
            where: { tripId, orderId, status: "OPEN" },
            data: {
              status: "RESOLVED",
              resolvedAt: new Date(),
              resolvedByUserId: user.id,
              resolution: "SEND_SHORT",
              blocksDeparture: false,
            },
          });
        } else {
          const existing = await tx.shortfall.findFirst({
            where: { tripId, orderId, status: "OPEN" },
            select: { id: true },
          });
          if (existing) {
            const updated = await tx.shortfall.update({
              where: { id: existing.id },
              data: {
                kind: body.condition,
                missingUnits: missing,
                reasonCode: body.reasonCode ?? null,
                loadCheckId: loadCheck.id,
                raisedByUserId: user.id,
                raisedByName: body.checkedByName.trim(),
                blocksDeparture: holds,
                productSku: body.productSku ?? null,
                ...(body.photoData ? { photoData: body.photoData } : {}),
              },
            });
            shortfallId = updated.id;
          } else {
            const created = await tx.shortfall.create({
              data: {
                tripId,
                orderId,
                loadCheckId: loadCheck.id,
                kind: body.condition,
                missingUnits: missing,
                raisedByUserId: user.id,
                raisedByName: body.checkedByName.trim(),
                reasonCode: body.reasonCode ?? null,
                blocksDeparture: holds,
                productSku: body.productSku ?? null,
                photoData: body.photoData ?? null,
              },
            });
            shortfallId = created.id;
          }
        }

        // Trip is officially loading as soon as the first check lands.
        await tx.trip.updateMany({
          where: { id: tripId, status: "PLANNED" },
          data: { status: "LOADING" },
        });
        await tx.trip.updateMany({ where: { id: tripId, loadStartedAt: null }, data: { loadStartedAt: new Date() } });

        return { loadCheck, shortfallId };
      });

      await recordDecisions([
        {
          actor: user,
          action: "load.check",
          entityType: "Order",
          entityId: orderId,
          reasonCode: body.reasonCode ?? undefined,
          after: {
            tripId,
            expectedUnits: order.units,
            loadedUnits: result.loadCheck.loadedUnits,
            condition: result.loadCheck.condition,
          },
        },
        ...(result.shortfallId
          ? [
              {
                actor: user,
                action: "shortfall.raise",
                entityType: "Shortfall",
                entityId: result.shortfallId,
                reasonCode: body.reasonCode ?? undefined,
                after: { tripId, orderId, kind: body.condition, missingUnits: missing },
              },
            ]
          : []),
      ]);

      return {
        tripId,
        orderId,
        expectedUnits: order.units,
        loadedUnits: result.loadCheck.loadedUnits,
        condition: result.loadCheck.condition,
        shortfallId: result.shortfallId,
      };
    },
  );

  fastify.post(
    "/trips/:tripId/readiness",
    {
      schema: {
        params: {
          type: "object",
          required: ["tripId"],
          properties: { tripId: { type: "string", minLength: 1 } },
        },
        response: {
          200: {
            type: "object",
            additionalProperties: false,
            required: ["tripId", "status"],
            properties: {
              tripId: { type: "string" },
              status: {
                type: "string",
                enum: ["PLANNED", "LOADING", "READY", "DEPARTED", "COMPLETED", "CANCELLED"],
              },
              releasedAt: { type: "string", format: "date-time" },
            },
          },
          403: ERROR_RESPONSE,
          404: ERROR_RESPONSE,
          409: ERROR_RESPONSE,
        },
      },
    },
    async (request, reply) => {
      const user = request.requireRole("LOADER", "DISPATCHER");
      const { tripId } = request.params as { tripId: string };

      try {
        await requireLoaderTrip(user, tripId);
      } catch {
        return reply
          .status(404)
          .send({ error: { code: "NOT_FOUND", message: "Trip not found at this depot." } });
      }

      const trip = await prisma.trip.findUnique({
        where: { id: tripId },
        select: {
          id: true,
          status: true,
          stops: { select: { orders: { select: { orderId: true } } } },
          loadChecks: { select: { orderId: true } },
          shortfalls: {
            where: { status: "OPEN", blocksDeparture: true },
            select: { id: true, kind: true, orderId: true },
          },
        },
      });
      if (!trip) {
        return reply
          .status(404)
          .send({ error: { code: "NOT_FOUND", message: "Trip not found." } });
      }
      if (trip.status === "READY" || trip.status === "DEPARTED" || trip.status === "COMPLETED") {
        return reply.status(409).send({
          error: {
            code: "ALREADY_READY",
            message: `Trip is already ${trip.status.toLowerCase()}.`,
          },
        });
      }

      const expectedOrderIds = new Set(trip.stops.flatMap((s) => s.orders.map((o) => o.orderId)));
      const checkedOrderIds = new Set(trip.loadChecks.map((c) => c.orderId));
      const unchecked = [...expectedOrderIds].filter((id) => !checkedOrderIds.has(id));

      if (unchecked.length > 0) {
        return reply.status(409).send({
          error: {
            code: "LOAD_INCOMPLETE",
            message: `${unchecked.length} of ${expectedOrderIds.size} lines are still unchecked.`,
            details: { checked: checkedOrderIds.size, expected: expectedOrderIds.size },
          },
        });
      }
      if (trip.shortfalls.length > 0) {
        return reply.status(409).send({
          error: {
            code: "SHORTFALL_BLOCKING",
            message: `${trip.shortfalls.length} open shortfall${trip.shortfalls.length === 1 ? "" : "s"} still blocks departure.`,
            details: { shortfallIds: trip.shortfalls.map((s) => s.id) },
          },
        });
      }

      // Atomic one-time claim: PLANNED/LOADING -> READY. A second attempt
      // updates zero rows and we return 409 instead of silently flipping.
      const now = new Date();
      const claimed = await prisma.trip.updateMany({
        where: { id: tripId, status: { in: ["PLANNED", "LOADING"] } },
        data: { status: "READY", loadConfirmedAt: now },
      });
      if (claimed.count === 0) {
        return reply.status(409).send({
          error: {
            code: "RACE_LOST",
            message: "Another dock terminal released this trip just now.",
          },
        });
      }

      await recordDecisions([
        {
          actor: user,
          action: "trip.ready",
          entityType: "Trip",
          entityId: tripId,
          before: { status: trip.status },
          after: { status: "READY" },
        },
      ]);

      return { tripId, status: "READY" as const, releasedAt: now.toISOString() };
    },
  );

  // ---- Dock additions ----------------------------------------------------

  /**
   * A count in progress: the steppers on an order the dock is still loading.
   * It shows on every dock screen (progress bars, the 15-minute pace) but is
   * never a check — the ready gate still wants every order checked.
   */
  fastify.put(
    "/trips/:tripId/load-progress/:orderId",
    {
      schema: {
        params: {
          type: "object",
          required: ["tripId", "orderId"],
          properties: { tripId: { type: "string", minLength: 1 }, orderId: { type: "string", minLength: 1 } },
        },
        body: {
          type: "object",
          additionalProperties: false,
          required: ["loadedUnits", "updatedByName"],
          properties: {
            loadedUnits: { type: "integer", minimum: 0 },
            itemCounts: ITEM_COUNTS,
            updatedByName: { type: "string", minLength: 2 },
          },
        },
        response: {
          200: {
            type: "object",
            additionalProperties: false,
            required: ["tripId", "orderId", "loadedUnits", "itemCounts", "updatedByName", "updatedAt"],
            properties: {
              tripId: { type: "string" },
              orderId: { type: "string" },
              loadedUnits: { type: "integer" },
              itemCounts: { oneOf: [{ type: "null" }, ITEM_COUNTS] },
              updatedByName: { type: "string" },
              updatedAt: { type: "string" },
            },
          },
          404: ERROR_RESPONSE,
          409: ERROR_RESPONSE,
          422: ERROR_RESPONSE,
        },
      },
    },
    async (request, reply) => {
      const user = request.requireRole("LOADER", "DISPATCHER");
      const { tripId, orderId } = request.params as { tripId: string; orderId: string };
      const body = request.body as { loadedUnits: number; itemCounts?: Record<string, number>; updatedByName: string };

      let trip;
      try {
        trip = await requireLoaderTrip(user, tripId);
      } catch {
        return reply.status(404).send({ error: { code: "NOT_FOUND", message: "Trip not found at this depot." } });
      }
      const order = await requireOrderOnTrip(user, tripId, orderId).catch(() => null);
      if (!order) return reply.status(404).send({ error: { code: "NOT_FOUND", message: "Order not on this trip." } });
      if (trip.status !== "PLANNED" && trip.status !== "LOADING") {
        return reply.status(409).send({ error: { code: "TRIP_SEALED", message: `The trip is already ${trip.status.toLowerCase()}.` } });
      }
      if (body.loadedUnits > order.units) {
        return reply.status(422).send({ error: { code: "TOO_MANY_UNITS", message: `This order has ${order.units} units.` } });
      }
      const itemCounts = cleanItemCounts(body.itemCounts);
      if (itemCounts && Object.values(itemCounts).reduce((a, b) => a + b, 0) !== body.loadedUnits) {
        return reply.status(422).send({ error: { code: "ITEM_COUNTS_MISMATCH", message: "The per-item counts must add up to the loaded units." } });
      }
      const checked = await prisma.loadCheck.findUnique({ where: { tripId_orderId: { tripId, orderId } }, select: { orderId: true } });
      if (checked) {
        return reply.status(409).send({ error: { code: "LINE_CHECKED", message: "This order is already checked. Change the check instead." } });
      }

      const row = await prisma.$transaction(async (tx) => {
        const saved = await tx.loadProgress.upsert({
          where: { tripId_orderId: { tripId, orderId } },
          create: { tripId, orderId, loadedUnits: body.loadedUnits, itemCounts: itemCountsJson(itemCounts), updatedByName: body.updatedByName.trim() },
          update: { loadedUnits: body.loadedUnits, itemCounts: itemCountsJson(itemCounts), updatedByName: body.updatedByName.trim() },
        });
        if (body.loadedUnits > 0) {
          await tx.trip.updateMany({ where: { id: tripId, status: "PLANNED" }, data: { status: "LOADING" } });
          await tx.trip.updateMany({ where: { id: tripId, loadStartedAt: null }, data: { loadStartedAt: new Date() } });
        }
        return saved;
      });
      return {
        tripId,
        orderId,
        loadedUnits: row.loadedUnits,
        itemCounts: cleanItemCounts(row.itemCounts),
        updatedByName: row.updatedByName,
        updatedAt: row.updatedAt.toISOString(),
      };
    },
  );

  const swapError = (reply: import("fastify").FastifyReply, error: unknown) => {
    if (error instanceof SwapError) return reply.status(error.status).send({ error: { code: error.code, message: error.message } });
    throw error;
  };

  /** Dispatcher: the depot's vehicles, and whether each could take this trip. */
  fastify.get(
    "/trips/:tripId/vehicle-swap/candidates",
    {
      schema: {
        params: { type: "object", required: ["tripId"], properties: { tripId: { type: "string", minLength: 1 } } },
        response: {
          200: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["vehicleId", "type", "temp", "weightCapKg", "volumeCapM3", "available", "reason"],
              properties: {
                vehicleId: { type: "string" },
                type: { type: "string", enum: ["truck", "van"] },
                temp: { type: "string", enum: ["reefer", "ambient"] },
                weightCapKg: { type: "number" },
                volumeCapM3: { type: "number" },
                available: { type: "boolean" },
                reason: { oneOf: [{ type: "string" }, { type: "null" }] },
              },
            },
          },
          404: ERROR_RESPONSE,
        },
      },
    },
    async (request, reply) => {
      const user = request.requireRole("DISPATCHER");
      const { tripId } = request.params as { tripId: string };
      try {
        return await swapCandidates(user, tripId);
      } catch (error) {
        return swapError(reply, error);
      }
    },
  );

  /** Dispatcher: move a trip still at the dock onto another vehicle. */
  fastify.post(
    "/trips/:tripId/vehicle-swap",
    {
      schema: {
        params: { type: "object", required: ["tripId"], properties: { tripId: { type: "string", minLength: 1 } } },
        body: {
          type: "object",
          additionalProperties: false,
          required: ["toVehicleId", "reason"],
          properties: {
            toVehicleId: { type: "string", minLength: 1 },
            reason: { type: "string", minLength: 3, maxLength: 200 },
            newDepartAt: { oneOf: [{ type: "string", pattern: "^([01]\\d|2[0-3]):[0-5]\\d$" }, { type: "null" }] },
            outOfService: { type: "boolean" },
          },
        },
        response: { 201: SWAP, 404: ERROR_RESPONSE, 409: ERROR_RESPONSE, 422: ERROR_RESPONSE },
      },
    },
    async (request, reply) => {
      const user = request.requireRole("DISPATCHER");
      const { tripId } = request.params as { tripId: string };
      try {
        const swap = await createSwap(user, tripId, request.body as Parameters<typeof createSwap>[2]);
        return reply.status(201).send(swap);
      } catch (error) {
        return swapError(reply, error);
      }
    },
  );

  /** The dock working a swap: unloaded, the new vehicle is here, read. */
  fastify.post(
    "/trips/:tripId/vehicle-swap/:swapId/steps",
    {
      schema: {
        params: {
          type: "object",
          required: ["tripId", "swapId"],
          properties: { tripId: { type: "string", minLength: 1 }, swapId: { type: "string", minLength: 1 } },
        },
        body: {
          type: "object",
          additionalProperties: false,
          required: ["step", "byName"],
          properties: {
            step: { type: "string", enum: ["UNLOADED", "ARRIVED", "ACKNOWLEDGED"] },
            byName: { type: "string", minLength: 2 },
          },
        },
        response: { 200: SWAP, 404: ERROR_RESPONSE },
      },
    },
    async (request, reply) => {
      const user = request.requireRole("LOADER", "DISPATCHER");
      const { tripId, swapId } = request.params as { tripId: string; swapId: string };
      const body = request.body as { step: SwapStep; byName: string };
      try {
        return await recordSwapStep(user, tripId, swapId, body.step, body.byName);
      } catch (error) {
        return swapError(reply, error);
      }
    },
  );
}
