import type { FastifyInstance } from "fastify";

/** Owner: BE1 */
export default async function (fastify: FastifyInstance) {
  fastify.get("/health", {
    config: { rateLimit: false },
    schema: {
      response: {
        200: {
          type: "object",
          required: ["ok", "at"],
          properties: { ok: { type: "boolean" }, at: { type: "string" } },
        },
      },
    },
  }, async () => ({ ok: true, at: new Date().toISOString() }));
}
