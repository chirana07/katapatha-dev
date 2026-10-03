import type { FastifyInstance } from "fastify";
import type { ConflictState, ProblemKind } from "@prisma/client";
import {
  DEFERRAL_REASONS,
  PROBLEM_REASONS,
  SHORTFALL_REASONS,
} from "@katapatha/core/domain/reasons";
import { prisma } from "../lib/db.js";
import {
  detectConflict,
  loadConflictContexts,
  recordConflictedEvent,
  resolveStopAccess,
  type StopAccess,
  type StopConflictContext,
} from "../services/conflicts.js";
import { accessNoteFor } from "../services/store.js";
import {
  arriveAtStop,
  completeStop,
  loadRun,
  reportProblem,
  startUnloading,
} from "../services/delivery.js";

function toProblemKind(code: string | null | undefined): ProblemKind {
  switch (code) {
    case "OUTLET_CLOSED":
      return "OUTLET_CLOSED";
    case "ROAD_BLOCKED":
      return "ROAD_BLOCKED";
    case "VEHICLE_BREAKDOWN":
      return "VEHICLE_BREAKDOWN";
    case "ACCESS_DENIED":
      return "ACCESS_DENIED";
    case "DELIVERY_REFUSED":
      return "DELIVERY_REFUSED";
    default:
      return "OTHER";
  }
}

/**
 * Owner: BE3
 *
 * All three sync endpoints are live:
 *
 * - POST /sync/stop-events → the batched outbox drain, and the request the
 *   mobile outbox tries first. One batch may span several stops, so every
 *   event carries `tripStopId` (an additive contract field) and the server
 *   routes each one. It runs the same applier as POST /stops/{stopId}/events
 *   so the online and offline paths cannot diverge; on top of that it measures
 *   device clock skew and writes a SyncLog row. Replaying an identical batch
 *   reports every event as a duplicate and changes nothing.
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

const BATCH_RESULT = {
  type: "object",
  additionalProperties: false,
  required: ["accepted", "duplicates", "conflicts", "clockSkewMs", "serverSeq", "results"],
  properties: {
    accepted: { type: "integer" },
    duplicates: { type: "integer" },
    conflicts: { type: "integer" },
    clockSkewMs: { type: "integer" },
    serverSeq: { type: "integer" },
    results: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "status"],
        properties: {
          id: { type: "string" },
          status: { type: "string", enum: ["accepted", "duplicate", "conflict"] },
          conflictState: {
            oneOf: [
              { type: "string", enum: ["NONE", "STALE_ASSIGNMENT", "SUPERSEDED"] },
              { type: "null" },
            ],
          },
        },
      },
    },
  },
} as const;

type IncomingSyncEvent = {
  id: string;
  type:
    | "ARRIVED"
    | "UNLOAD_START"
    | "DELIVERED"
    | "PART_DELIVERED"
    | "FAILED"
    | "SKIPPED"
    | "POD_CAPTURED";
  occurredAt: string;
  tripStopId?: string | null;
  orderId?: string | null;
  deliveredUnits?: number | null;
  recipientName?: string | null;
  signatureData?: string | null;
  photoData?: string | null;
  reasonCode?: string | null;
};

export default async function (fastify: FastifyInstance) {
  fastify.post(
    "/sync/stop-events",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["deviceId", "clientClockAt", "events"],
          properties: {
            deviceId: { type: "string", minLength: 1 },
            clientClockAt: { type: "string", format: "date-time" },
            events: {
              type: "array",
              minItems: 1,
              items: {
                type: "object",
                additionalProperties: false,
                required: ["id", "type", "occurredAt"],
                properties: {
                  id: { type: "string", pattern: "^[0-9A-HJKMNP-TV-Z]{26}$" },
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
                  tripStopId: { oneOf: [{ type: "string" }, { type: "null" }] },
                  orderId: { oneOf: [{ type: "string" }, { type: "null" }] },
                  deliveredUnits: { oneOf: [{ type: "integer", minimum: 0 }, { type: "null" }] },
                  recipientName: { oneOf: [{ type: "string" }, { type: "null" }] },
                  signatureData: { oneOf: [{ type: "string" }, { type: "null" }] },
                  photoData: { oneOf: [{ type: "string" }, { type: "null" }] },
                  reasonCode: { oneOf: [{ type: "string" }, { type: "null" }] },
                },
              },
            },
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
        events: IncomingSyncEvent[];
      };

      // Every event in the batch must know its stop — the batch spans several
      // of them and the server dispatches by this id. The mobile outbox has
      // stop_id on every row already; a missing field is a client bug.
      const missingStop = body.events.find((event) => !event.tripStopId);
      if (missingStop) {
        return reply.status(422).send({
          error: {
            code: "MISSING_TRIP_STOP_ID",
            message:
              "Every event in a /sync batch must carry tripStopId. Use POST /stops/:stopId/events when the stopId lives in the URL instead.",
          },
        });
      }

      // Scope-check each distinct stop. The driver can only drain events for
      // stops on their claimed vehicle's run — a batch that touches someone
      // else's stop fails fast with no partial writes. A stop that has since
      // been reassigned away from them is the exception: it was theirs when the
      // device recorded these events, so those events are stale rather than
      // unauthorised and the loop below records them as conflicts.
      const stopIds = Array.from(new Set(body.events.map((event) => event.tripStopId!)));
      const accessByStop = new Map<string, StopAccess>();
      for (const stopId of stopIds) {
        const access = await resolveStopAccess(user, stopId);
        if (access === "DENIED") {
          return reply.status(403).send({
            error: {
              code: "STOP_NOT_ON_RUN",
              message: `Stop ${stopId} is not on this driver's run.`,
            },
          });
        }
        accessByStop.set(stopId, access);
      }

      const actor = { userId: user.id, vehicleId: user.defaultVehicleId, deviceId: body.deviceId };

      // Dedup by StopEvent.id in one query — a replay from a flaky phone sees
      // every id again and the server reports duplicate without re-applying.
      // The stored conflictState rides along so a replayed conflict is reported
      // as the conflict it was rather than as a plain duplicate.
      const incomingIds = body.events.map((event) => event.id);
      const existing = await prisma.stopEvent.findMany({
        where: { id: { in: incomingIds } },
        select: { id: true, conflictState: true },
      });
      const recordedState = new Map(existing.map((row) => [row.id, row.conflictState]));

      // Ownership history, but only when something in the batch would be
      // applied. A batch that is entirely duplicates is the common case on an
      // endpoint the outbox retries every few seconds, and it decides nothing.
      const hasNewWork = body.events.some((event) => !recordedState.has(event.id));
      const conflictContexts: Map<string, StopConflictContext> = hasNewWork
        ? await loadConflictContexts(stopIds)
        : new Map();

      // Pre-load expected units per stop for the completion grouping.
      const stopOrders = await prisma.tripStopOrder.findMany({
        where: { tripStopId: { in: stopIds } },
        select: { tripStopId: true, order: { select: { id: true, units: true } } },
      });
      const expectedByStopAndOrder = new Map<string, Map<string, number>>();
      for (const row of stopOrders) {
        const inner = expectedByStopAndOrder.get(row.tripStopId) ?? new Map<string, number>();
        inner.set(row.order.id, row.order.units);
        expectedByStopAndOrder.set(row.tripStopId, inner);
      }

      type ResultRow = {
        id: string;
        status: "accepted" | "duplicate" | "conflict";
        conflictState: ConflictState | null;
      };
      const results: ResultRow[] = [];
      let accepted = 0;
      let duplicates = 0;
      let conflicts = 0;

      type CompletionPlan = {
        recipient: string | null;
        signature?: string;
        photo?: string;
        /** The client's ULID for the stop-level POD_CAPTURED event. */
        podEventId?: string;
        /** The POD event's device clock, which stands for the whole completion. */
        occurredAt?: Date;
        lines: Array<{ eventId: string; orderId: string; units: number; expected: number }>;
      };
      const completionsByStop = new Map<string, CompletionPlan>();

      for (const event of body.events) {
        const alreadyRecorded = recordedState.get(event.id);
        if (alreadyRecorded !== undefined) {
          // A duplicate either way — the row exists and nothing is re-applied.
          // A replay of a conflicted event is still reported as a conflict, so
          // the device settles the row terminally rather than retrying it
          // forever, but it counts under `duplicates`: the conflict was counted
          // when it was first detected, and counting it again on every replay
          // would be a lie about how many conflicts happened, in the response
          // and in SyncLog alike.
          duplicates += 1;
          results.push(
            alreadyRecorded === "NONE"
              ? { id: event.id, status: "duplicate", conflictState: "NONE" }
              : { id: event.id, status: "conflict", conflictState: alreadyRecorded },
          );
          continue;
        }

        const stopId = event.tripStopId!;
        const occurredAt = new Date(event.occurredAt);
        // Access granted only on the strength of a reassignment means the stop
        // is someone else's now, so the event cannot apply to it whatever its
        // timing: their assignment is stale by definition.
        const conflictState: ConflictState =
          accessByStop.get(stopId) === "REASSIGNED_AWAY"
            ? "STALE_ASSIGNMENT"
            : detectConflict(conflictContexts.get(stopId), { occurredAt }, actor);

        if (conflictState !== "NONE") {
          await recordConflictedEvent({
            stopId,
            conflictState,
            fact: { ...event, occurredAt },
            orderOnStop:
              event.orderId != null &&
              expectedByStopAndOrder.get(stopId)?.has(event.orderId) === true,
            actor,
          });
          conflicts += 1;
          results.push({ id: event.id, status: "conflict", conflictState });
          continue;
        }

        // The client's identity and timing for this fact, exactly as the per-stop
        // route passes them. Without this the services mint their own ULID, so
        // the dedup query above would look for ids that are never stored and
        // `duplicates` would be structurally 0 on this path -- and occurredAt
        // would be the drain time rather than the moment the driver was at the
        // outlet. This endpoint is the one the outbox tries FIRST, so the
        // guarantee has to hold here, not only on the fallback.
        const meta = { id: event.id, occurredAt, deviceId: body.deviceId };

        try {
          if (event.type === "ARRIVED") {
            await arriveAtStop(stopId, user, meta);
          } else if (event.type === "UNLOAD_START") {
            await startUnloading(stopId, user, meta);
          } else if (event.type === "DELIVERED" || event.type === "PART_DELIVERED") {
            if (!event.orderId || event.deliveredUnits == null) {
              return reply.status(422).send({
                error: {
                  code: "DELIVERED_INCOMPLETE",
                  message: "DELIVERED/PART_DELIVERED events need orderId and deliveredUnits.",
                },
              });
            }
            const expected = expectedByStopAndOrder.get(stopId)?.get(event.orderId);
            if (expected == null) {
              return reply.status(422).send({
                error: {
                  code: "ORDER_NOT_ON_STOP",
                  message: `Order ${event.orderId} is not on stop ${stopId}.`,
                },
              });
            }
            const plan = completionsByStop.get(stopId) ?? { recipient: null, lines: [] };
            plan.lines.push({
              eventId: event.id,
              orderId: event.orderId,
              units: event.deliveredUnits,
              expected,
            });
            if (event.recipientName) plan.recipient = event.recipientName;
            completionsByStop.set(stopId, plan);
          } else if (event.type === "POD_CAPTURED") {
            const plan = completionsByStop.get(stopId) ?? { recipient: null, lines: [] };
            if (event.recipientName) plan.recipient = event.recipientName;
            if (event.signatureData) plan.signature = event.signatureData;
            if (event.photoData) plan.photo = event.photoData;
            plan.podEventId = event.id;
            plan.occurredAt = meta.occurredAt;
            completionsByStop.set(stopId, plan);
          } else if (event.type === "FAILED" || event.type === "SKIPPED") {
            // outcome, so a skip is recorded as SKIPPED rather than flattened to
            // FAILED -- DOMAIN.md keeps them as distinct stop statuses.
            await reportProblem(
              user,
              {
                kind: toProblemKind(event.reasonCode),
                note: event.reasonCode ?? (event.type === "SKIPPED" ? "Stop skipped." : "Problem reported."),
                tripStopId: stopId,
                outcome: event.type,
              },
              meta,
            );
          }

          accepted += 1;
          results.push({ id: event.id, status: "accepted", conflictState: "NONE" });
        } catch (error) {
          return reply.status(409).send({
            error: {
              code: "APPLY_FAILED",
              message: error instanceof Error ? error.message : "Could not apply event.",
            },
          });
        }
      }

      for (const [stopId, plan] of completionsByStop) {
        if (plan.lines.length === 0) continue;
        if (!plan.recipient) {
          return reply.status(422).send({
            error: {
              code: "RECIPIENT_REQUIRED",
              message: `Stop ${stopId}'s delivery completion needs the recipient's name on a POD event.`,
            },
          });
        }
        await completeStop(
          stopId,
          user,
          {
            recipientName: plan.recipient,
            delivered: plan.lines.map((line) => ({
              orderId: line.orderId,
              units: line.units,
              expected: line.expected,
              // Was collected into plan.lines and then dropped here, which is
              // what made a replayed delivery look new.
              eventId: line.eventId,
            })),
            signatureData: plan.signature,
            photoData: plan.photo,
            podEventId: plan.podEventId,
          },
          { occurredAt: plan.occurredAt, deviceId: body.deviceId },
        );
      }

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

      await prisma.syncLog.create({
        data: {
          deviceId: body.deviceId,
          userId: user.id,
          batchSize: body.events.length,
          accepted,
          duplicates,
          conflicts,
          clockSkewMs,
        },
      });

      return reply.status(200).send({
        accepted,
        duplicates,
        conflicts,
        clockSkewMs,
        serverSeq,
        results,
      });
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
