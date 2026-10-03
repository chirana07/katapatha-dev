import type { FastifyInstance } from "fastify";
import {
  DEFERRAL_REASONS,
  PROBLEM_REASONS,
  SHORTFALL_REASONS,
} from "@katapatha/core/domain/reasons";
import { prisma } from "../lib/db.js";
import { ORDER_ITEMS_SCHEMA, itemsOf } from "../services/products.js";
import { accessNoteFor } from "../services/store.js";
import { loadRun } from "../services/delivery.js";
import {
  applyStopEvents,
  EVENT_BODY_LIMIT,
  EVENT_RESULT_PROPERTIES,
  STOP_EVENT_REQUEST_ITEM,
  type IncomingEvent,
} from "../services/stopEvents.js";

/**
 * Owner: BE3
 *
 * All three sync endpoints are live:
 *
 * - POST /sync/stop-events → the batched outbox drain, and the request the
 *   mobile outbox tries first. One batch may span several stops, so every
 *   event carries `tripStopId` (an additive contract field) and the server
 *   routes each one. It runs the same applier as POST /stops/{stopId}/events
 *   (services/stopEvents.ts) so the online and offline paths cannot diverge;
 *   on top of that it measures device clock skew and writes a SyncLog row.
 *   Replaying an identical batch reports every event as a duplicate and
 *   changes nothing.
 *
 *   Each event is judged on its own. A stop the driver cannot see, an invalid
 *   payload or a transition the stop refuses puts THAT event in `rejected` and
 *   the rest of the batch still applies: the outbox sends what it queued over
 *   hours, and one poisoned event must not hold the others hostage. A malformed
 *   request (bad JSON shape) is still a 422 for the whole batch, since nothing
 *   in it can be trusted to be routed.
 * - GET /sync/stop-events?sinceSeq=N → the server-tail pull a reconnecting
 *   device uses to learn about events it missed (a stop reassigned to another
 *   vehicle while the phone was offline).
 * - GET /sync/bootstrap?date=YYYY-MM-DD → the fresh-install payload: that
 *   day's run for the driver's claimed vehicle plus the server-owned reason
 *   vocabularies and a serverSeq cursor to anchor subsequent pulls.
 *
 * The sequence number the two cursors share is `StopEvent.recordedAt.getTime()`
 * — server receipt time in epoch ms — rather than the `StopEvent.serverSeq`
 * column. That column is a BIGSERIAL and arrives as a JS BigInt, which the
 * contract's `integer` response field cannot serialise without a cast at every
 * boundary; receipt time needs no cast and millisecond ordering is more than
 * enough for the cross-device catchup these endpoints serve. Swapping to the
 * real sequence would be a behaviour change to all three, so it is a decision
 * of its own, not a detail of this one.
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

const STOP_EVENT_ITEM = {
  type: "object",
  additionalProperties: false,
  required: ["id", "type", "occurredAt"],
  properties: {
    id: { type: "string" },
    tripStopId: { type: "string" },
    // Metadata only. The pull is a list of up to 500 events and a page is up to
    // a megabyte of base64, so the images are not in it.
    pages: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "seq", "kind", "qualityFlags", "capturedAt"],
        properties: {
          id: { type: "string" },
          seq: { type: "integer" },
          kind: { type: "string", enum: ["RECEIPT", "SIGNATURE", "PHOTO"] },
          qualityFlags: { type: "array", items: { type: "string" } },
          capturedAt: { type: "string", format: "date-time" },
        },
      },
    },
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
          // Additive: what the order contains, cached with the run so the
          // driver can see it with no signal.
          items: ORDER_ITEMS_SCHEMA,
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

const BATCH_RESULT = {
  type: "object",
  additionalProperties: false,
  required: [
    "accepted",
    "duplicates",
    "conflicts",
    "rejected",
    "clockSkewMs",
    "serverSeq",
    "results",
  ],
  properties: {
    ...EVENT_RESULT_PROPERTIES,
    clockSkewMs: { type: "integer" },
    serverSeq: { type: "integer" },
  },
} as const;

export default async function (fastify: FastifyInstance) {
  fastify.post(
    "/sync/stop-events",
    {
      // A batch may carry several deliveries' worth of receipt pages; Fastify's
      // default 1 MiB is below the outbox's own batch cap.
      bodyLimit: EVENT_BODY_LIMIT,
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["deviceId", "clientClockAt", "events"],
          properties: {
            deviceId: { type: "string", minLength: 1 },
            clientClockAt: { type: "string", format: "date-time" },
            events: { type: "array", minItems: 1, items: STOP_EVENT_REQUEST_ITEM },
          },
        },
        response: {
          200: BATCH_RESULT,
          403: ERROR_RESPONSE,
          409: ERROR_RESPONSE,
          422: ERROR_RESPONSE,
        },
      },
    },
    async (request, reply) => {
      const user = request.requireRole("DRIVER", "DISPATCHER");
      const body = request.body as {
        deviceId: string;
        clientClockAt: string;
        events: IncomingEvent[];
      };

      const result = await applyStopEvents({
        user,
        deviceId: body.deviceId,
        events: body.events,
        strict: false,
        log: request.log,
      });

      const now = new Date();
      const clientClock = new Date(body.clientClockAt);
      // Clamped to the INT4 range, because SyncLog.clockSkewMs is a Prisma `Int`
      // and an unclamped value makes the whole drain 500. That is not a
      // hypothetical: ~24.9 days of skew overflows a 32-bit integer, and a
      // handset whose clock reset to the epoch after a flat battery reports
      // decades. The outbox treats 5xx as retryable, so such a phone would retry
      // forever and never drain a single event -- the one device state this
      // endpoint exists to tolerate.
      //
      // Clamping loses nothing that matters: anything at the cap is already far
      // past the threshold at which the app warns the driver their clock is wrong.
      const rawSkewMs = Number.isFinite(clientClock.getTime())
        ? now.getTime() - clientClock.getTime()
        : 0;
      const clockSkewMs = Math.max(-2_147_483_648, Math.min(2_147_483_647, rawSkewMs));
      const serverSeq = await latestServerSeq();

      // SyncLog has no column for rejections: batchSize minus the three counts is
      // how many were refused or left for a retry.
      await prisma.syncLog.create({
        data: {
          deviceId: body.deviceId,
          userId: user.id,
          batchSize: body.events.length,
          accepted: result.accepted,
          duplicates: result.duplicates,
          conflicts: result.conflicts,
          clockSkewMs,
        },
      });

      return reply.status(200).send({ ...result, clockSkewMs, serverSeq });
    },
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
        include: {
          podPages: {
            orderBy: { seq: "asc" },
            select: { id: true, seq: true, kind: true, qualityFlags: true, capturedAt: true },
          },
        },
      });

      const serverSeq = rows.length > 0
        ? rows[rows.length - 1]!.recordedAt.getTime()
        : await latestServerSeq();

      return {
        serverSeq,
        events: rows.map((event) => ({
          id: event.id,
          tripStopId: event.tripStopId,
          type: event.type,
          occurredAt: event.occurredAt.toISOString(),
          orderId: event.orderId,
          deliveredUnits: event.deliveredUnits,
          recipientName: event.recipientName,
          signatureData: event.signatureData,
          photoData: event.photoData,
          reasonCode: null,
          pages: event.podPages.map((page) => ({
            id: page.id,
            seq: page.seq,
            kind: page.kind,
            qualityFlags: page.qualityFlags,
            capturedAt: page.capturedAt.toISOString(),
          })),
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
                items: itemsOf(order.lines),
              })),
            })),
          })),
        },
        // Codes, not {code,label} objects: the contract's Vocabularies schema
        // is a list of strings and the serialiser was quietly stringifying each
        // object, so a fresh install cached "[object Object]" as every reason
        // and the driver's problem picker was unusable offline. Same mapping
        // BE1 does at /reference/vocabularies; the labels are the client's.
        vocabularies: {
          deferralReasons: DEFERRAL_REASONS.map(({ code }) => code),
          shortfallReasons: SHORTFALL_REASONS.map(({ code }) => code),
          problemReasons: PROBLEM_REASONS.map(({ code }) => code),
        },
      };
    },
  );
}
