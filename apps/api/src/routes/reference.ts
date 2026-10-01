import type { FastifyInstance } from "fastify";
import {
  DEFERRAL_REASONS,
  PROBLEM_REASONS,
  SHORTFALL_REASONS,
} from "@katapatha/core/domain/reasons";

/**
 * Owner: BE1
 *
 * Not implemented yet. The contract for these endpoints is already frozen in
 * packages/contracts/openapi/paths/reference.yaml, and the Prism mock on :4010
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
  fastify.get("/reference/vocabularies", {
    schema: {
      response: {
        200: {
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
  }, async (request) => {
    request.requireRole();

    return {
      deferralReasons: DEFERRAL_REASONS.map(({ code }) => code),
      shortfallReasons: SHORTFALL_REASONS.map(({ code }) => code),
      problemReasons: PROBLEM_REASONS.map(({ code }) => code),
    };
  });

  for (const route of ["/reference/outlets", "/reference/vehicles", "/reference/calendar/next-operating-day"]) {
    fastify.get(route, async (_req, reply) => reply.status(501).send(NOT_IMPLEMENTED));
  }
}
