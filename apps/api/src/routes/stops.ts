import type { FastifyInstance } from "fastify";
import { resolveStopAccess } from "../services/conflicts.js";
import {
  applyStopEvents,
  EVENT_BODY_LIMIT,
  EVENT_RESULT_PROPERTIES,
  InvalidEventError,
  STOP_EVENT_REQUEST_ITEM,
  type IncomingEvent,
} from "../services/stopEvents.js";

/**
 * Owner: BE3
 *
 * The stop-event applier. Every driver transition (ARRIVED, UNLOAD_START,
 * DELIVERED, PART_DELIVERED, FAILED, POD_CAPTURED) rides this one
 * endpoint, which is also what the sync batch endpoint drains to — same
 * applier, online or outbox, so the two paths cannot diverge.
 *
 * Idempotency: every incoming event carries a client-minted ULID, and it IS
 * the StopEvent primary key. An id already stored is a duplicate: counted, not
 * re-applied, and none of its side effects (order and stop status, the store's
 * notification, the decision log) run again. See services/stopEvents.ts, which
 * the sync route shares, so the two paths are one applier.
 *
 * Validation: unlike the sync route, a bad event fails the whole request with
 * 422 and writes nothing, because the caller here is a person who can fix it.
 * An event the stop's state refuses (a delivery for a stop already completed)
 * comes back in `rejected` instead.
 *
 * Conflicts: a stop can move to another vehicle, or be delivered by one,
 * between the moment the device recorded a fact and the moment it reaches
 * here. Such an event is recorded with its `ConflictState` and NOT applied —
 * see services/conflicts.ts for why that is neither an acceptance nor an
 * error.
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
  required: ["accepted", "duplicates", "conflicts", "results", "rejected"],
  properties: EVENT_RESULT_PROPERTIES,
} as const;

export default async function (fastify: FastifyInstance) {
  fastify.post(
    "/stops/:stopId/events",
    {
      // Eight pages of receipt photo do not fit in Fastify's default 1 MiB.
      bodyLimit: EVENT_BODY_LIMIT,
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
            events: { type: "array", minItems: 1, items: STOP_EVENT_REQUEST_ITEM },
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

      // A stop that is not on this run may still have been on it when the
      // device recorded these events, which is a conflict rather than a 404.
      const access = await resolveStopAccess(user, stopId);
      if (access === "DENIED") {
        return reply
          .status(404)
          .send({ error: { code: "NOT_FOUND", message: "Stop not on this driver's run." } });
      }

      try {
        // The URL names the stop. A tripStopId in the body is accepted (the
        // contract's StopEvent carries one so the outbox can send one shape to
        // both endpoints) and ignored.
        const result = await applyStopEvents({
          user,
          deviceId: body.deviceId,
          events: body.events.map((event) => ({ ...event, tripStopId: stopId })),
          strict: true,
          knownAccess: new Map([[stopId, access]]),
          log: request.log,
        });
        return reply.status(200).send(result);
      } catch (error) {
        if (error instanceof InvalidEventError) {
          return reply.status(422).send({ error: { code: error.code, message: error.message } });
        }
        return reply.status(409).send({
          error: {
            code: "APPLY_FAILED",
            message: error instanceof Error ? error.message : "Could not apply event.",
          },
        });
      }
    },
  );
}
