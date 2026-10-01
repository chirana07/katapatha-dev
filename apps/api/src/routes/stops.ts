import type { FastifyInstance } from "fastify";
import type { ProblemKind } from "@prisma/client";
import { prisma } from "../lib/db.js";
import { requireDriverStop } from "../lib/authorization.js";
import {
  arriveAtStop,
  completeStop,
  reportProblem,
  startUnloading,
} from "../services/delivery.js";

// Driver-reported problem reasons from the vocabulary → Prisma ProblemKind.
// The vocab is the one BE1 publishes at /reference/vocabularies.problemReasons;
// anything we don't recognise falls back to OTHER so the dispatcher still
// sees the event rather than losing it to a strict mapping.
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
 * The stop-event applier. Every driver transition (ARRIVED, UNLOAD_START,
 * DELIVERED, PART_DELIVERED, FAILED, POD_CAPTURED) rides this one
 * endpoint, which is also what the sync batch endpoint drains to — same
 * applier, online or outbox, so the two paths cannot diverge.
 *
 * Idempotency: every incoming event carries a client-minted ULID. If
 * that id is already in StopEvent, we count it as a duplicate without
 * re-applying. The underlying services also no-op if the stop is
 * already past the state the event would advance it to, so a replay
 * from a flaky driver phone is always safe.
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

const SUBMIT_EVENTS_RESULT = {
  type: "object",
  additionalProperties: false,
  required: ["accepted", "duplicates", "conflicts", "results"],
  properties: {
    accepted: { type: "integer" },
    duplicates: { type: "integer" },
    conflicts: { type: "integer" },
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

type IncomingEvent = {
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
  orderId?: string | null;
  deliveredUnits?: number | null;
  recipientName?: string | null;
  signatureData?: string | null;
  photoData?: string | null;
  reasonCode?: string | null;
};

export default async function (fastify: FastifyInstance) {
  fastify.post(
    "/stops/:stopId/events",
    {
      schema: {
        params: {
          type: "object",
          required: ["stopId"],
          properties: { stopId: { type: "string", minLength: 1 } },
        },
        body: {
          type: "object",
          additionalProperties: false,
          required: ["deviceId", "events"],
          properties: {
            deviceId: { type: "string", minLength: 1 },
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
                  orderId: { oneOf: [{ type: "string" }, { type: "null" }] },
                  deliveredUnits: {
                    oneOf: [{ type: "integer", minimum: 0 }, { type: "null" }],
                  },
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
          200: SUBMIT_EVENTS_RESULT,
          403: ERROR_RESPONSE,
          404: ERROR_RESPONSE,
          409: ERROR_RESPONSE,
          422: ERROR_RESPONSE,
        },
      },
    },
    async (request, reply) => {
      const user = request.requireRole("DRIVER", "DISPATCHER");
      const { stopId } = request.params as { stopId: string };
      const body = request.body as { deviceId: string; events: IncomingEvent[] };

      try {
        await requireDriverStop(user, stopId);
      } catch {
        return reply
          .status(404)
          .send({ error: { code: "NOT_FOUND", message: "Stop not on this driver's run." } });
      }

      // Dedup first: any event id already recorded is a duplicate.
      const incomingIds = body.events.map((e) => e.id);
      const existing = await prisma.stopEvent.findMany({
        where: { id: { in: incomingIds } },
        select: { id: true },
      });
      const duplicateIds = new Set(existing.map((e) => e.id));

      const results: Array<{
        id: string;
        status: "accepted" | "duplicate" | "conflict";
        conflictState: "NONE" | null;
      }> = [];
      let accepted = 0;
      let duplicates = 0;

      // Group completion events (DELIVERED/PART_DELIVERED + POD_CAPTURED) so
      // we can call completeStop once with the right line list — the service
      // takes an array of {orderId, units, expected}.
      const completionLines: Array<{ eventId: string; orderId: string; units: number; expected: number }> = [];
      let completionRecipient: string | null = null;
      let completionSignature: string | undefined;
      let completionPhoto: string | undefined;
      let podEventId: string | null = null;
      // The POD event's device clock stands for the whole completion, since a
      // delivery is one act even though it produces several events.
      let completionOccurredAt: Date | undefined;

      // Preload expected units per order on this stop for the completion path.
      const stopOrders = await prisma.tripStopOrder.findMany({
        where: { tripStopId: stopId },
        select: { order: { select: { id: true, units: true } } },
      });
      const expectedById = new Map(stopOrders.map((row) => [row.order.id, row.order.units]));

      for (const event of body.events) {
        if (duplicateIds.has(event.id)) {
          duplicates += 1;
          results.push({ id: event.id, status: "duplicate", conflictState: "NONE" });
          continue;
        }

        // The client's own identity and timing for this fact. The id becomes the
        // StopEvent primary key, which is what makes the dedup check above work at
        // all: with a server-generated id the table never contains the ids being
        // looked up, so every replay reports `accepted` and `duplicate` -- which
        // the contract calls "a success, not an error" -- could never be returned.
        // occurredAt is the DEVICE clock; the server's receipt time is recorded
        // separately by StopEvent.recordedAt.
        const meta = {
          id: event.id,
          occurredAt: new Date(event.occurredAt),
          deviceId: body.deviceId,
        };

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
            const expected = expectedById.get(event.orderId);
            if (expected == null) {
              return reply.status(422).send({
                error: {
                  code: "ORDER_NOT_ON_STOP",
                  message: "That order is not on this stop.",
                },
              });
            }
            completionLines.push({
              eventId: event.id,
              orderId: event.orderId,
              units: event.deliveredUnits,
              expected,
            });
            if (event.recipientName) completionRecipient = event.recipientName;
          } else if (event.type === "POD_CAPTURED") {
            if (event.recipientName) completionRecipient = event.recipientName;
            if (event.signatureData) completionSignature = event.signatureData;
            if (event.photoData) completionPhoto = event.photoData;
            podEventId = event.id;
            completionOccurredAt = meta.occurredAt;
          } else if (event.type === "FAILED") {
            await reportProblem(
              user,
              {
                kind: toProblemKind(event.reasonCode),
                note: event.reasonCode ?? "Driver reported a problem.",
                tripStopId: stopId,
                outcome: "FAILED",
              },
              meta,
            );
          } else if (event.type === "SKIPPED") {
            // A problem with a reason, but NOT a failure: the outlet may have been
            // closed and the driver moved on. DOMAIN.md keeps SKIPPED and FAILED
            // as separate stop statuses, so the outcome is passed through rather
            // than flattened to FAILED.
            await reportProblem(
              user,
              {
                kind: toProblemKind(event.reasonCode),
                note: event.reasonCode ?? "Stop skipped.",
                tripStopId: stopId,
                outcome: "SKIPPED",
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

      // Flush any grouped completion in one service call. The client's ULIDs are
      // passed through -- one per delivered line plus the POD's -- so they become
      // the StopEvent primary keys and the dedup check above can recognise a
      // replay. completeStop also no-ops when the stop is already DONE, so the
      // state machine is a second line of defence rather than the only one.
      if (completionLines.length > 0) {
        if (!completionRecipient) {
          return reply.status(422).send({
            error: {
              code: "RECIPIENT_REQUIRED",
              message: "A delivery completion needs the recipient's name on a POD event.",
            },
          });
        }
        await completeStop(
          stopId,
          user,
          {
            recipientName: completionRecipient,
            delivered: completionLines.map((l) => ({
              orderId: l.orderId,
              units: l.units,
              expected: l.expected,
              eventId: l.eventId,
            })),
            signatureData: completionSignature,
            photoData: completionPhoto,
            podEventId: podEventId ?? undefined,
          },
          {
            occurredAt: completionOccurredAt,
            deviceId: body.deviceId,
          },
        );
      }

      return reply.status(200).send({
        accepted,
        duplicates,
        conflicts: 0,
        results,
      });
    },
  );
}
