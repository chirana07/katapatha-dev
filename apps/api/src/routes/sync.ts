import type { FastifyInstance } from "fastify";
import {
  DEFERRAL_REASONS,
  PROBLEM_REASONS,
  SHORTFALL_REASONS,
} from "@katapatha/core/domain/reasons";
import { prisma } from "../lib/db.js";
import { accessNoteFor } from "../services/store.js";
import { loadRun } from "../services/delivery.js";

/**
 * Owner: BE3
 *
 * Two of three sync endpoints are live:
 *
 * - GET /sync/bootstrap?date=YYYY-MM-DD → the fresh-install payload: today's
 *   run for the driver's claimed vehicle plus the server-owned reason
 *   vocabularies and a serverSeq cursor to anchor subsequent pulls.
 * - GET /sync/stop-events?sinceSeq=N → the server-tail pull a reconnecting
 *   device uses to learn about events it missed (a stop reassigned to another
 *   vehicle while the phone was offline).
 *
 * POST /sync/stop-events (the batched outbox drain) stays 501 on this slice:
 * the contract's StopEvent schema has no tripStopId field, so a flat batch
 * spanning several stops cannot route individual events to the right stop
 * server-side. The mobile transport already handles this cleanly by falling
 * back to one POST /stops/{stopId}/events request per stop — the applier is
 * the same, the batching is just regrouped. Wiring the batched endpoint
 * properly needs a contract change (per-event stopId, or a stops-grouped
 * array shape), owned by LEAD.
 *
 * The sequence number here is `StopEvent.recordedAt.getTime()` — server
 * receipt time in epoch ms. The schema has no auto-incrementing sequence
 * column; this gives millisecond ordering which is more than enough for the
 * cross-device catchup use case the pull endpoint serves.
 */

const NOT_IMPLEMENTED_POST = {
  error: {
    code: "NOT_IMPLEMENTED",
    message:
      "Batched POST /sync/stop-events needs a contract change (per-event stopId). The mobile outbox already falls back to POST /stops/:stopId/events, which carries the same applier.",
  },
} as const;

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

const STOP_EVENT_ITEM = {
  type: "object",
  additionalProperties: false,
  required: ["id", "type", "occurredAt"],
  properties: {
    id: { type: "string" },
    type: {
      type: "string",
      enum: [
        "ARRIVED",
        "UNLOAD_START",
        "DELIVERED",
        "PART_DELIVERED",
        "FAILED",
        "SKIPPED",
        "POD_CAPTURED",
      ],
    },
    occurredAt: { type: "string", format: "date-time" },
    orderId: { oneOf: [{ type: "string" }, { type: "null" }] },
    deliveredUnits: { oneOf: [{ type: "integer" }, { type: "null" }] },
    recipientName: { oneOf: [{ type: "string" }, { type: "null" }] },
    signatureData: { oneOf: [{ type: "string" }, { type: "null" }] },
    photoData: { oneOf: [{ type: "string" }, { type: "null" }] },
    reasonCode: { oneOf: [{ type: "string" }, { type: "null" }] },
  },
} as const;

const STOP_ITEM = {
  type: "object",
  additionalProperties: false,
  required: ["id", "seq", "outletId", "status"],
  properties: {
    id: { type: "string" },
    seq: { type: "integer" },
    outletId: { type: "string" },
    outletName: { type: "string" },
    status: {
      type: "string",
      enum: ["PENDING", "ARRIVED", "UNLOADING", "DONE", "SKIPPED", "FAILED"],
    },
    plannedArrivalAt: { type: "string", pattern: "^([01]\\d|2[0-3]):[0-5]\\d$" },
    windowOpen: { type: "string", pattern: "^([01]\\d|2[0-3]):[0-5]\\d$" },
    windowClose: { type: "string", pattern: "^([01]\\d|2[0-3]):[0-5]\\d$" },
    accessNote: { oneOf: [{ type: "string" }, { type: "null" }] },
    orders: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["orderId", "orderRef", "expectedUnits"],
        properties: {
          orderId: { type: "string" },
          orderRef: { type: "string" },
          expectedUnits: { type: "integer" },
        },
      },
    },
  },
} as const;

const RUN_SHAPE = {
  type: "object",
  additionalProperties: false,
  required: ["date", "vehicleId", "trips"],
  properties: {
    date: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
    vehicleId: { type: "string" },
    trips: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["tripId", "tripNo", "wave", "stops"],
        properties: {
          tripId: { type: "string" },
          tripNo: { type: "integer" },
          wave: { type: "string", enum: ["PREDAWN", "DAYTIME"] },
          stops: { type: "array", items: STOP_ITEM },
        },
      },
    },
  },
} as const;

function parseDate(value: unknown): Date | undefined {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  return new Date(`${value}T00:00:00.000Z`);
}

// StopEvent has no auto-increment seq column; use the server receipt time in
// epoch ms as the cursor. Monotonic enough for cross-device catchup and
// cheap to compute without a schema change.
function latestServerSeq(): Promise<number> {
  return prisma.stopEvent
    .findFirst({ orderBy: { recordedAt: "desc" }, select: { recordedAt: true } })
    .then((row) => (row ? row.recordedAt.getTime() : 0));
}

export default async function (fastify: FastifyInstance) {
  fastify.post(
    "/sync/stop-events",
    async (_request, reply) => reply.status(501).send(NOT_IMPLEMENTED_POST),
  );

  fastify.get(
    "/sync/stop-events",
    {
      schema: {
        querystring: {
          type: "object",
          additionalProperties: false,
          required: ["sinceSeq"],
          properties: {
            // Query strings arrive as strings; Fastify's default AJV config
            // does not coerce them. Validate as a numeric string and parse.
            sinceSeq: { type: "string", pattern: "^\\d+$" },
          },
        },
        response: {
          200: {
            type: "object",
            additionalProperties: false,
            required: ["serverSeq", "events"],
            properties: {
              serverSeq: { type: "integer" },
              events: { type: "array", items: STOP_EVENT_ITEM },
            },
          },
          403: ERROR_RESPONSE,
        },
      },
    },
    async (request, reply) => {
      const user = request.requireRole("DRIVER", "DISPATCHER");
      const query = request.query as { sinceSeq: string };
      const since = new Date(Number(query.sinceSeq));

      // Drivers only pull events for stops on their claimed vehicle's run so
      // the catchup payload never leaks another vehicle's deliveries.
      const vehicleId = user.role === "DRIVER" ? user.defaultVehicleId : null;
      if (user.role === "DRIVER" && !vehicleId) {
        return reply.status(403).send({
          error: {
            code: "NO_VEHICLE_CLAIMED",
            message: "Claim a vehicle before pulling the server tail.",
          },
        });
      }

      const whereStop = vehicleId
        ? { tripStop: { trip: { vehicleId } } }
        : { tripStop: { trip: { plan: { planningDay: { depotCode: user.depotCode ?? "" } } } } };

      const rows = await prisma.stopEvent.findMany({
        where: {
          recordedAt: { gt: since },
          ...whereStop,
        },
        orderBy: { recordedAt: "asc" },
        take: 500,
      });

      const serverSeq = rows.length > 0
        ? rows[rows.length - 1]!.recordedAt.getTime()
        : await latestServerSeq();

      return {
        serverSeq,
        events: rows.map((event) => ({
          id: event.id,
          type: event.type,
          occurredAt: event.occurredAt.toISOString(),
          orderId: event.orderId,
          deliveredUnits: event.deliveredUnits,
          recipientName: event.recipientName,
          signatureData: event.signatureData,
          photoData: event.photoData,
          reasonCode: null,
        })),
      };
    },
  );

  fastify.get(
    "/sync/bootstrap",
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
          200: {
            type: "object",
            additionalProperties: false,
            required: ["serverSeq", "run", "vocabularies"],
            properties: {
              serverSeq: { type: "integer" },
              run: RUN_SHAPE,
              vocabularies: {
                type: "object",
                additionalProperties: false,
                required: ["deferralReasons", "shortfallReasons", "problemReasons"],
                properties: {
                  deferralReasons: { type: "array", items: { type: "string" } },
                  shortfallReasons: { type: "array", items: { type: "string" } },
                  problemReasons: { type: "array", items: { type: "string" } },
                },
              },
            },
          },
          403: ERROR_RESPONSE,
        },
      },
    },
    async (request, reply) => {
      const user = request.requireRole("DRIVER", "DISPATCHER");
      const query = request.query as { date?: string };
      const date = parseDate(query.date);
      if (!date) {
        return reply.status(403).send({
          error: { code: "DATE_REQUIRED", message: "date=YYYY-MM-DD is required." },
        });
      }

      const vehicleId = user.defaultVehicleId;
      if (!vehicleId) {
        return reply.status(403).send({
          error: {
            code: "NO_VEHICLE_CLAIMED",
            message: "Claim a vehicle before bootstrapping. Fresh installs need a run to cache.",
          },
        });
      }

      const trips = await loadRun(vehicleId, date);
      const serverSeq = await latestServerSeq();

      return {
        serverSeq,
        run: {
          date: date.toISOString().slice(0, 10),
          vehicleId,
          trips: trips.map((trip) => ({
            tripId: trip.id,
            tripNo: trip.tripNo,
            wave: trip.wave,
            stops: trip.stops.map((stop) => ({
              id: stop.id,
              seq: stop.seq,
              outletId: stop.outletId,
              outletName: stop.outlet.displayName ?? undefined,
              status: stop.status,
              plannedArrivalAt: stop.plannedArrivalAt,
              windowOpen: stop.outlet.windowOpen,
              windowClose: stop.outlet.windowClose,
              accessNote: accessNoteFor(stop.outlet) || null,
              orders: stop.orders.map(({ order }) => ({
                orderId: order.id,
                orderRef: order.ref,
                expectedUnits: order.units,
              })),
            })),
          })),
        },
        vocabularies: {
          deferralReasons: [...DEFERRAL_REASONS],
          shortfallReasons: [...SHORTFALL_REASONS],
          problemReasons: [...PROBLEM_REASONS],
        },
      };
    },
  );
}
