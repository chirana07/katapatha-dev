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
  fastify.get("/reference/outlets", {
    schema: {
      response: {
        200: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: [
              "id",
              "brand",
              "districtName",
              "depotCode",
              "dockType",
              "windowOpen",
              "windowClose",
            ],
            properties: {
              id: { type: "string" },
              displayName: { type: "string" },
              brand: { type: "string", enum: ["Fresh", "Style", "Tech"] },
              districtName: { type: "string" },
              depotCode: { type: "string" },
              dockType: { type: "string", enum: ["rear_dock", "street", "mall_bay"] },
              parkingConstraint: {
                type: "string",
                enum: ["normal", "van_only", "mall_dock"],
              },
              windowOpen: { type: "string", pattern: "^([01]\\d|2[0-3]):[0-5]\\d$" },
              windowClose: { type: "string", pattern: "^([01]\\d|2[0-3]):[0-5]\\d$" },
              mallWindowOpen: {
                oneOf: [
                  { type: "string", pattern: "^([01]\\d|2[0-3]):[0-5]\\d$" },
                  { type: "null" },
                ],
              },
              mallWindowClose: {
                oneOf: [
                  { type: "string", pattern: "^([01]\\d|2[0-3]):[0-5]\\d$" },
                  { type: "null" },
                ],
              },
            },
          },
        },
      },
    },
  }, async (request) => {
    const user = request.requireRole();
    const scope = user.depotCode
      ? { depotCode: user.depotCode }
      : user.outletId
        ? { id: user.outletId }
        : { id: { in: [] as string[] } };

    const outlets = await fastify.prisma.outlet.findMany({
      where: scope,
      orderBy: { id: "asc" },
      select: {
        id: true,
        displayName: true,
        brand: true,
        districtName: true,
        depotCode: true,
        dockType: true,
        parkingConstraint: true,
        windowOpen: true,
        windowClose: true,
        mallWindowOpen: true,
        mallWindowClose: true,
      },
    });

    return outlets.map(({ displayName, ...outlet }) => ({
      ...outlet,
      ...(displayName === null ? {} : { displayName }),
    }));
  });

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

  for (const route of ["/reference/vehicles", "/reference/calendar/next-operating-day"]) {
    fastify.get(route, async (_req, reply) => reply.status(501).send(NOT_IMPLEMENTED));
  }
}
