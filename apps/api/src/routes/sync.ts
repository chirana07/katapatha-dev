import type { FastifyInstance } from "fastify";

/**
 * Owner: BE3
 *
 * These three endpoints are MOB1's offline-outbox contract: a batched
 * drain, a server-tail pull for cross-device catchup, and a bootstrap
 * for a fresh install.
 *
 * They are deliberately 501 on this BE3 slice: shipping them without the
 * mobile outbox that drives them means code with no reader. The applier
 * they would delegate to is already live on POST /stops/{stopId}/events,
 * and this file's batched handler would call it in a loop with a server
 * sequence stamp.
 *
 * When MOB1 lands the outbox, these three can be wired against the
 * existing stop-event applier without new business logic — hence a
 * clearly-labelled 501 rather than half-built code.
 */
const NOT_IMPLEMENTED = {
  error: {
    code: "NOT_IMPLEMENTED",
    message:
      "Not built yet — MOB1's offline outbox is the reader for these three. The applier they would delegate to is live on POST /stops/:stopId/events.",
  },
} as const;

export default async function (fastify: FastifyInstance) {
  fastify.post("/sync/stop-events", async (_req, reply) => reply.status(501).send(NOT_IMPLEMENTED));
  fastify.get("/sync/stop-events", async (_req, reply) => reply.status(501).send(NOT_IMPLEMENTED));
  fastify.get("/sync/bootstrap", async (_req, reply) => reply.status(501).send(NOT_IMPLEMENTED));
}
