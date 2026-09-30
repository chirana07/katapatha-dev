import type { FastifyInstance } from "fastify";

/**
 * Owner: BE3
 *
 * Not implemented yet. The contract for these endpoints is already frozen in
 * packages/contracts/openapi/paths/driver.yaml, and the Prism mock on :4010
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
  fastify.put("/drivers/me/vehicle", async (_req, reply) => reply.status(501).send(NOT_IMPLEMENTED));
  fastify.delete("/drivers/me/vehicle", async (_req, reply) => reply.status(501).send(NOT_IMPLEMENTED));
  fastify.get("/drivers/me/run", async (_req, reply) => reply.status(501).send(NOT_IMPLEMENTED));
}
