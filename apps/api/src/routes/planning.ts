import type { FastifyInstance } from "fastify";
import { validatePlan } from "@katapatha/core/validation/rules";
import type { PlanStatus } from "@prisma/client";
import { prisma } from "../lib/db.js";
import { loadDayContext, loadPlan, runAutoPlan } from "../services/plans.js";
import { snapshotFromPlan } from "../services/snapshot.js";
import type { DepotCode } from "@katapatha/core/domain/types";

/**
 * Owner: BE2
 *
 * Reads, allocator run, and the publication path all live here. The
 * publish handler uses an atomic one-time claim: the DRAFT -> PUBLISHED
 * update is gated on the current status matching DRAFT, so a second
 * attempt updates zero rows and the handler returns 409 instead of
 * silently succeeding. DOMAIN.md calls that explicitly out as the
 * guarantee publication offers.
 */

/**
 * Thrown inside the publication transaction when the DRAFT -> PUBLISHED claim
 * matches zero rows, so the whole transaction rolls back rather than leaving a
 * plan published with its orders unflipped. Caught at the handler boundary and
 * turned into a 409.
 */
class RaceLost extends Error {
  constructor() {
    super("Plan was already claimed by another publish.");
    this.name = "RaceLost";
  }
}

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
            required: ["planId", "status", "stats", "trips", "deferrals"],
            properties: {
              planId: { type: "string" },
              status: { type: "string", enum: ["DRAFT", "PUBLISHED", "SUPERSEDED"] },
              stats: PLAN_STATS,
              trips: { type: "array", items: TRIP },
              deferrals: {
                // The DEFERRED assignments on this plan, including whether a
                // reason has been attached — the dispatcher needs this to
                // confirm each one before the publication gate opens. Added
                // as an additive field per CONVENTIONS.md rule 8.
                type: "array",
                items: {
                  type: "object",
                  additionalProperties: false,
                  required: ["assignmentId", "orderId", "orderRef"],
                  properties: {
                    assignmentId: { type: "string" },
                    orderId: { type: "string" },
                    orderRef: { type: "string" },
                    reasonCode: { oneOf: [{ type: "string" }, { type: "null" }] },
                  },
                },
              },
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

      const deferrals = plan.assignments
        .filter((a) => a.decision === "DEFERRED")
        .map((a) => ({
          assignmentId: a.id,
          orderId: a.orderId,
          orderRef: a.order.ref,
          reasonCode: a.reasonCode ?? null,
        }));

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
        deferrals,
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
    {
      schema: {
        params: {
          type: "object",
          required: ["planningDayId"],
          properties: { planningDayId: { type: "string", minLength: 1 } },
        },
        response: {
          200: PLANNING_DAY,
          403: ERROR_RESPONSE,
          404: ERROR_RESPONSE,
        },
      },
    },
    async (request, reply) => {
      const user = request.requireRole("DISPATCHER");
      const { planningDayId } = request.params as { planningDayId: string };
      const day = await prisma.planningDay.findFirst({
        where: { id: planningDayId, depotCode: user.depotCode ?? "" },
      });
      if (!day) {
        return reply
          .status(404)
          .send({ error: { code: "NOT_FOUND", message: "Planning day not found." } });
      }
      // Closing twice is not a mistake worth blocking the dispatcher for.
      if (day.status !== "OPEN") {
        return {
          id: day.id,
          date: day.date.toISOString().slice(0, 10),
          depotCode: day.depotCode,
          status: day.status,
          cutoffAt: day.cutoffAt,
        };
      }
      const orderCount = await prisma.order.count({
        where: {
          depotCode: day.depotCode,
          requestedDate: day.date,
          status: { notIn: ["CANCELLED"] },
        },
      });
      const updated = await prisma.planningDay.update({
        where: { id: day.id },
        data: {
          status: "CLOSED",
          closedAt: new Date(),
          closedByUserId: user.id,
          queueSnapshot: { ordersAtClose: orderCount, closedAt: new Date().toISOString() },
        },
      });
      return {
        id: updated.id,
        date: updated.date.toISOString().slice(0, 10),
        depotCode: updated.depotCode,
        status: updated.status,
        cutoffAt: updated.cutoffAt,
      };
    },
  );

  fastify.get(
    "/plans/:planId/validation",
    {
      schema: {
        params: {
          type: "object",
          required: ["planId"],
          properties: { planId: { type: "string", minLength: 1 } },
        },
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: { stage: { type: "string", enum: ["draft", "publish"] } },
        },
        response: {
          200: {
            type: "object",
            additionalProperties: false,
            required: ["stage", "violations", "blocking"],
            properties: {
              stage: { type: "string", enum: ["draft", "publish"] },
              blocking: { type: "boolean" },
              violations: {
                type: "array",
                items: {
                  type: "object",
                  additionalProperties: true,
                  required: ["code", "severity", "message"],
                  properties: {
                    code: { type: "string" },
                    severity: { type: "string", enum: ["error", "warning"] },
                    message: { type: "string" },
                    tripId: { oneOf: [{ type: "string" }, { type: "null" }] },
                    orderRef: { oneOf: [{ type: "string" }, { type: "null" }] },
                    overridable: { type: "boolean" },
                  },
                },
              },
            },
          },
          404: ERROR_RESPONSE,
        },
      },
    },
    async (request, reply) => {
      const user = request.requireRole("DISPATCHER");
      const { planId } = request.params as { planId: string };
      const query = request.query as { stage?: "draft" | "publish" };
      const stage = query.stage ?? "draft";

      const plan = await loadPlan(planId);
      if (!plan || plan.planningDay.depotCode !== user.depotCode) {
        return reply
          .status(404)
          .send({ error: { code: "NOT_FOUND", message: "Plan not found." } });
      }
      const ctx = await loadDayContext(plan.planningDay.date, plan.planningDay.depotCode as DepotCode);
      if (!ctx) {
        return reply
          .status(404)
          .send({ error: { code: "NO_PLANNING_DAY", message: "Planning day no longer exists." } });
      }
      const snapshot = await snapshotFromPlan(plan, ctx);
      const violations = validatePlan(snapshot, { stage });
      const blocking = violations.some((v) => v.severity === "error");
      return { stage, violations, blocking };
    },
  );

  fastify.put(
    "/plans/:planId/deferrals",
    {
      schema: {
        params: {
          type: "object",
          required: ["planId"],
          properties: { planId: { type: "string", minLength: 1 } },
        },
        body: {
          type: "object",
          additionalProperties: false,
          required: ["decisions"],
          properties: {
            decisions: {
              type: "array",
              minItems: 1,
              items: {
                type: "object",
                additionalProperties: false,
                required: ["assignmentId", "reasonCode"],
                properties: {
                  assignmentId: { type: "string", minLength: 1 },
                  reasonCode: { type: "string", minLength: 1 },
                  note: { oneOf: [{ type: "string" }, { type: "null" }] },
                },
              },
            },
          },
        },
        response: {
          200: {
            type: "object",
            additionalProperties: false,
            required: ["confirmed"],
            properties: { confirmed: { type: "integer" } },
          },
          403: ERROR_RESPONSE,
          404: ERROR_RESPONSE,
          422: ERROR_RESPONSE,
        },
      },
    },
    async (request, reply) => {
      const user = request.requireRole("DISPATCHER");
      const { planId } = request.params as { planId: string };
      const body = request.body as {
        decisions: Array<{ assignmentId: string; reasonCode: string; note?: string | null }>;
      };

      const plan = await prisma.plan.findFirst({
        where: { id: planId, planningDay: { depotCode: user.depotCode ?? "" } },
        select: { id: true, status: true },
      });
      if (!plan) {
        return reply
          .status(404)
          .send({ error: { code: "NOT_FOUND", message: "Plan not found." } });
      }
      if (plan.status !== "DRAFT") {
        return reply.status(422).send({
          error: {
            code: "NOT_DRAFT",
            message: "Deferral reasons can only be confirmed on a DRAFT plan.",
          },
        });
      }

      let confirmed = 0;
      for (const decision of body.decisions) {
        const result = await prisma.assignment.updateMany({
          where: {
            id: decision.assignmentId,
            planId: plan.id,
            decision: "DEFERRED",
          },
          data: { reasonCode: decision.reasonCode },
        });
        confirmed += result.count;
      }
      return { confirmed };
    },
  );

  fastify.post(
    "/plans/:planId/publication",
    {
      schema: {
        params: {
          type: "object",
          required: ["planId"],
          properties: { planId: { type: "string", minLength: 1 } },
        },
        response: {
          201: PLAN_SUMMARY,
          403: ERROR_RESPONSE,
          409: ERROR_RESPONSE,
          422: ERROR_RESPONSE,
        },
      },
    },
    async (request, reply) => {
      const user = request.requireRole("DISPATCHER");
      const { planId } = request.params as { planId: string };

      const plan = await prisma.plan.findFirst({
        where: { id: planId, planningDay: { depotCode: user.depotCode ?? "" } },
        include: {
          planningDay: true,
          assignments: {
            select: { id: true, orderId: true, decision: true, reasonCode: true },
          },
        },
      });
      if (!plan) {
        return reply
          .status(409)
          .send({ error: { code: "PLAN_MISSING", message: "Plan not found at this depot." } });
      }
      if (plan.status !== "DRAFT") {
        return reply.status(409).send({
          error: {
            code: "ALREADY_PUBLISHED",
            message: `Plan is already ${plan.status.toLowerCase()} — publishing it again is not allowed.`,
          },
        });
      }
      const unreasoned = plan.assignments.filter(
        (a) => a.decision === "DEFERRED" && !a.reasonCode,
      );
      if (unreasoned.length > 0) {
        return reply.status(422).send({
          error: {
            code: "DEFERRALS_UNCONFIRMED",
            message: `${unreasoned.length} deferral${unreasoned.length === 1 ? "" : "s"} still ${unreasoned.length === 1 ? "lacks" : "lack"} a reason code.`,
          },
        });
      }

      // Atomic one-time claim, INSIDE the transaction that does the rest of the
      // work. The DRAFT -> PUBLISHED update is gated on status matching DRAFT,
      // so a concurrent second attempt updates zero rows and loses the race.
      //
      // The claim has to be in here rather than before it. A top-level Prisma
      // call autocommits, so claiming first and then opening a transaction left
      // a window where the plan was PUBLISHED but its orders were still QUEUED
      // and the planning day was still PLANNING -- and because the claim is
      // one-time, a retry got 409 RACE_LOST forever and the only repair was
      // manual SQL. That state is also silently wrong rather than loudly broken:
      // loadRun() and requireDriverStop() both filter on plan.status ===
      // "PUBLISHED", so a driver would get a run for orders the store still saw
      // as QUEUED. Publication is the spine of the demo, so it is the one
      // operation that must not have an unrecoverable half-state.
      try {
        await prisma.$transaction(async (tx) => {
          const claimed = await tx.plan.updateMany({
            where: { id: plan.id, status: "DRAFT" as PlanStatus },
            data: {
              status: "PUBLISHED",
              publishedAt: new Date(),
              publishedByUserId: user.id,
            },
          });
          if (claimed.count === 0) throw new RaceLost();

          await tx.planningDay.update({
            where: { id: plan.planningDayId },
            data: { status: "PUBLISHED" },
          });
          // Flip the orders the plan either served or deferred.
          const servedOrderIds = plan.assignments
            .filter((a) => a.decision === "SERVED")
            .map((a) => a.orderId);
          const deferredAssignments = plan.assignments.filter((a) => a.decision === "DEFERRED");
          if (servedOrderIds.length > 0) {
            await tx.order.updateMany({
              where: { id: { in: servedOrderIds } },
              data: { status: "PLANNED" },
            });
          }
          if (deferredAssignments.length > 0) {
            await tx.order.updateMany({
              where: { id: { in: deferredAssignments.map((a) => a.orderId) } },
              data: { status: "DEFERRED" },
            });
            // Audit-trail row per deferral so the store can see why.
            for (const assignment of deferredAssignments) {
              await tx.deferral.upsert({
                where: { planId_orderId: { planId: plan.id, orderId: assignment.orderId } },
                create: {
                  planId: plan.id,
                  orderId: assignment.orderId,
                  reasonCode: assignment.reasonCode ?? "UNCONFIRMED",
                  decidedByUserId: user.id,
                },
                update: {
                  reasonCode: assignment.reasonCode ?? "UNCONFIRMED",
                  decidedByUserId: user.id,
                  decidedAt: new Date(),
                },
              });
            }
          }
        });
      } catch (error) {
        // RaceLost is the only expected throw: a concurrent publish won the
        // claim, so this transaction rolled back and changed nothing. Any other
        // error also rolled back, which is the point -- the plan is still DRAFT
        // and the dispatcher can retry.
        if (error instanceof RaceLost) {
          return reply
            .status(409)
            .send({ error: { code: "RACE_LOST", message: "Someone else published this plan." } });
        }
        throw error;
      }

      const summary = await prisma.plan.findUnique({
        where: { id: plan.id },
        include: {
          trips: { select: { id: true } },
          assignments: {
            select: { decision: true, plan: { select: { status: true } } },
          },
        },
      });
      if (!summary) {
        return reply
          .status(409)
          .send({ error: { code: "PLAN_MISSING", message: "Plan vanished after publish." } });
      }
      return reply.status(201).send({
        planId: summary.id,
        status: summary.status,
        stats: statsFor(summary),
      });
    },
  );
}
