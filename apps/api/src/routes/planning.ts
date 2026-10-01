import type { FastifyInstance } from "fastify";
import { prisma } from "../lib/db.js";
import { runAutoPlan, loadPlan } from "../services/plans.js";

/**
 * Owner: BE2
 *
 * Read side is live and backed by the real database. The write/validate
 * endpoints below (closure, validation, deferrals, publication) are still
 * stubs — each needs its own transactional path and the publication path
 * carries the atomic one-time claim DOMAIN.md gates on. They land in a
 * follow-up slice; the Prism mock on :4010 keeps the dispatcher UI
 * unblocked in the meantime.
 */
const NOT_IMPLEMENTED = {
  error: {
    code: "NOT_IMPLEMENTED",
    message: "Not built yet. Use the Prism mock on :4010 for this endpoint.",
  },
} as const;

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

const PLANNING_DAY = {
  type: "object",
  additionalProperties: false,
  required: ["id", "date", "depotCode", "status", "cutoffAt"],
  properties: {
    id: { type: "string" },
    date: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
    depotCode: { type: "string" },
    status: { type: "string", enum: ["OPEN", "CLOSED", "PLANNING", "PUBLISHED"] },
    cutoffAt: { type: "string", pattern: "^([01]\\d|2[0-3]):[0-5]\\d$" },
  },
} as const;

const PLAN_STATS = {
  type: "object",
  additionalProperties: false,
  required: ["orders", "served", "deferred", "tripsBuilt", "hash"],
  properties: {
    orders: { type: "integer" },
    served: { type: "integer" },
    deferred: { type: "integer" },
    tripsBuilt: { type: "integer" },
    hash: { type: "string" },
  },
} as const;

const PLAN_SUMMARY = {
  type: "object",
  additionalProperties: false,
  required: ["planId", "status", "stats"],
  properties: {
    planId: { type: "string" },
    status: { type: "string", enum: ["DRAFT", "PUBLISHED", "SUPERSEDED"] },
    stats: PLAN_STATS,
  },
} as const;

const TRIP = {
  type: "object",
  additionalProperties: false,
  required: ["id", "vehicleId", "tripNo", "brand", "districtName", "wave", "status"],
  properties: {
    id: { type: "string" },
    vehicleId: { type: "string" },
    tripNo: { type: "integer", enum: [1, 2] },
    brand: { type: "string", enum: ["Fresh", "Style", "Tech"] },
    districtName: { type: "string" },
    wave: { type: "string", enum: ["PREDAWN", "DAYTIME"] },
    status: {
      type: "string",
      enum: ["PLANNED", "LOADING", "READY", "DEPARTED", "COMPLETED", "CANCELLED"],
    },
    plannedDepartAt: { type: "string", pattern: "^([01]\\d|2[0-3]):[0-5]\\d$" },
    plannedMinutes: { type: "integer" },
    sumWeightKg: { type: "number" },
    sumVolumeM3: { type: "number" },
  },
} as const;

type AssignmentWithPlan = {
  decision: string;
  plan: { status: string };
};

type PlanWithChildren = {
  id: string;
  status: string;
  allocatorVersion: string | null;
  trips: unknown[];
  assignments: AssignmentWithPlan[];
};

function statsFor(plan: PlanWithChildren) {
  const served = plan.assignments.filter((a) => a.decision === "SERVED").length;
  const deferred = plan.assignments.filter((a) => a.decision === "DEFERRED").length;
  return {
    orders: served + deferred,
    served,
    deferred,
    tripsBuilt: plan.trips.length,
    hash: plan.allocatorVersion ?? "",
  };
}

function parseDate(value: unknown): Date | undefined {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  return new Date(`${value}T00:00:00.000Z`);
}

export default async function (fastify: FastifyInstance) {
  fastify.get(
    "/planning-days",
    {
      schema: {
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: {
            date: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
            depotCode: { type: "string", minLength: 1 },
          },
        },
        response: {
          200: { type: "array", items: PLANNING_DAY },
        },
      },
    },
    async (request) => {
      const user = request.requireRole("DISPATCHER");
      const query = request.query as { date?: string; depotCode?: string };
      const date = parseDate(query.date);

      const where: Record<string, unknown> = {};
      // Dispatchers are scoped to their depot regardless of the query. Trusting
      // the query would let a dispatcher browse the other depot's queue.
      if (!user.depotCode) return [];
      where.depotCode = user.depotCode;
      if (date) where.date = date;

      const days = await prisma.planningDay.findMany({
        where,
        orderBy: [{ date: "desc" }],
        take: 30,
      });
      return days.map((day) => ({
        id: day.id,
        date: day.date.toISOString().slice(0, 10),
        depotCode: day.depotCode,
        status: day.status,
        cutoffAt: day.cutoffAt,
      }));
    },
  );

  fastify.get(
    "/plans",
    {
      schema: {
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: {
            date: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
            depotCode: { type: "string", minLength: 1 },
          },
        },
        response: {
          200: { type: "array", items: PLAN_SUMMARY },
        },
      },
    },
    async (request) => {
      const user = request.requireRole("DISPATCHER");
      if (!user.depotCode) return [];
      const query = request.query as { date?: string };
      const date = parseDate(query.date);

      const where: Record<string, unknown> = {
        planningDay: { depotCode: user.depotCode, ...(date ? { date } : {}) },
      };

      const plans = await prisma.plan.findMany({
        where,
        orderBy: [{ createdAt: "desc" }],
        take: 20,
        include: {
          trips: { select: { id: true } },
          assignments: {
            select: {
              decision: true,
              plan: { select: { status: true } },
            },
          },
        },
      });

      return plans.map((plan) => ({
        planId: plan.id,
        status: plan.status,
        stats: statsFor(plan),
      }));
    },
  );

  fastify.get(
    "/plans/:planId",
    {
      schema: {
        params: {
          type: "object",
          required: ["planId"],
          properties: { planId: { type: "string", minLength: 1 } },
        },
        response: {
          200: {
            type: "object",
            additionalProperties: false,
            required: ["planId", "status", "stats", "trips"],
            properties: {
              planId: { type: "string" },
              status: { type: "string", enum: ["DRAFT", "PUBLISHED", "SUPERSEDED"] },
              stats: PLAN_STATS,
              trips: { type: "array", items: TRIP },
            },
          },
          404: ERROR_RESPONSE,
        },
      },
    },
    async (request, reply) => {
      const user = request.requireRole("DISPATCHER");
      const { planId } = request.params as { planId: string };

      const plan = await loadPlan(planId);
      if (!plan || plan.planningDay.depotCode !== user.depotCode) {
        return reply.status(404).send({ error: { code: "NOT_FOUND", message: "Plan not found." } });
      }

      return {
        planId: plan.id,
        status: plan.status,
        stats: statsFor({
          id: plan.id,
          status: plan.status,
          allocatorVersion: plan.allocatorVersion,
          trips: plan.trips,
          assignments: plan.assignments.map((a) => ({
            decision: a.decision,
            plan: { status: plan.status },
          })),
        }),
        trips: plan.trips.map((trip) => ({
          id: trip.id,
          vehicleId: trip.vehicleId,
          tripNo: trip.tripNo,
          brand: trip.brand,
          districtName: trip.districtName,
          wave: trip.wave,
          status: trip.status,
          plannedDepartAt: trip.plannedDepartAt ?? undefined,
          plannedMinutes: trip.plannedMinutes ?? undefined,
          sumWeightKg: trip.sumWeightKg ?? undefined,
          sumVolumeM3: trip.sumVolumeM3 ?? undefined,
        })),
      };
    },
  );

  fastify.post(
    "/plans",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["date", "depotCode"],
          properties: {
            date: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
            depotCode: { type: "string", minLength: 1 },
          },
        },
        response: {
          201: PLAN_SUMMARY,
          403: ERROR_RESPONSE,
          404: ERROR_RESPONSE,
          422: ERROR_RESPONSE,
        },
      },
    },
    async (request, reply) => {
      const user = request.requireRole("DISPATCHER");
      const body = request.body as { date: string; depotCode: string };

      if (!user.depotCode || user.depotCode !== body.depotCode) {
        return reply.status(403).send({
          error: {
            code: "FORBIDDEN",
            message: "A dispatcher can only run the allocator for their own depot.",
          },
        });
      }

      const date = parseDate(body.date);
      if (!date) {
        return reply.status(422).send({
          error: { code: "VALIDATION_FAILED", message: "date must be YYYY-MM-DD." },
        });
      }

      const result = await runAutoPlan(date, body.depotCode as "Peliyagoda" | "Kandy", user.id);
      if (!result) {
        return reply.status(404).send({
          error: {
            code: "NO_PLANNING_DAY",
            message:
              "No planning day exists for that depot and date. Close the queue first to create one.",
          },
        });
      }

      return reply.status(201).send({
        planId: result.planId,
        status: "DRAFT" as const,
        stats: {
          orders: result.output.stats.orders,
          served: result.output.stats.served,
          deferred: result.output.stats.deferred,
          tripsBuilt: result.output.stats.tripsBuilt,
          hash: result.output.stats.hash,
        },
      });
    },
  );

  fastify.post(
    "/planning-days/:planningDayId/closure",
    async (_req, reply) => reply.status(501).send(NOT_IMPLEMENTED),
  );
  fastify.get(
    "/plans/:planId/validation",
    async (_req, reply) => reply.status(501).send(NOT_IMPLEMENTED),
  );
  fastify.put(
    "/plans/:planId/deferrals",
    async (_req, reply) => reply.status(501).send(NOT_IMPLEMENTED),
  );
  fastify.post(
    "/plans/:planId/publication",
    async (_req, reply) => reply.status(501).send(NOT_IMPLEMENTED),
  );
}
