import type { FastifyInstance } from "fastify";

/**
 * Owner: BE2
 *
 * Not implemented yet. The contract for these endpoints is already frozen in
 * packages/contracts/openapi/paths/planning.yaml, and the Prism mock on :4010
 * serves them with realistic examples — so the web and mobile teams are not
 * blocked by this file being a stub.
 *
 * Replace each notImplemented() with a real handler. Do not change the paths;
 * they are the contract.
 */
const NOT_IMPLEMENTED = {
  error: {
    code: "NOT_IMPLEMENTED",
    message: "Not built yet. Use the Prism mock on :4010 for this endpoint.",
  },
} as const;

export default async function (fastify: FastifyInstance) {
  fastify.get("/planning-days", async (_req, reply) => reply.status(501).send(NOT_IMPLEMENTED));
  fastify.post("/planning-days/:planningDayId/closure", async (_req, reply) => reply.status(501).send(NOT_IMPLEMENTED));
  fastify.get("/plans", async (_req, reply) => reply.status(501).send(NOT_IMPLEMENTED));
  fastify.post("/plans", async (_req, reply) => reply.status(501).send(NOT_IMPLEMENTED));
  fastify.get("/plans/:planId", async (_req, reply) => reply.status(501).send(NOT_IMPLEMENTED));
  fastify.get("/plans/:planId/validation", async (_req, reply) => reply.status(501).send(NOT_IMPLEMENTED));
  fastify.put("/plans/:planId/deferrals", async (_req, reply) => reply.status(501).send(NOT_IMPLEMENTED));
  fastify.post("/plans/:planId/publication", async (_req, reply) => reply.status(501).send(NOT_IMPLEMENTED));
}
