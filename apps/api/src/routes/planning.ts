import type { FastifyInstance, FastifyReply } from "fastify";
import { validatePlan } from "@katapatha/core/validation/rules";
import type { PlanStatus } from "@prisma/client";
import { prisma } from "../lib/db.js";
import { recordDecision, recordDecisions } from "../lib/audit.js";
import { loadDayContext, loadPlan, runAutoPlan } from "../services/plans.js";
import { describeDeferrals, laneAlternatives, nextRunDate } from "../services/deferrals.js";
import { deferralMessage, shortDay } from "@katapatha/core/domain/deferral";
import { DEFERRAL_REASONS } from "@katapatha/core/domain/reasons";
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

const VEHICLE_METER = {
  type: "object",
  additionalProperties: false,
  required: [
    "vehicleId",
    "tripsUsed",
    "predawnUsedMin",
    "predawnBudgetMin",
    "daytimeUsedMin",
    "daytimeBudgetMin",
    "fuelCommittedL",
    "fuelQuotaL",
  ],
  properties: {
    vehicleId: { type: "string" },
    tripsUsed: { type: "integer" },
    predawnUsedMin: { type: "number" },
    predawnBudgetMin: { type: "number" },
    daytimeUsedMin: { type: "number" },
    daytimeBudgetMin: { type: "number" },
    fuelCommittedL: { type: "number" },
    fuelQuotaL: { type: "number" },
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

const CLOCK = { type: "string", pattern: "^([01]\\d|2[0-3]):[0-5]\\d$" } as const;
const NULLABLE_STRING = { oneOf: [{ type: "string" }, { type: "null" }] } as const;

/**
 * One row of `deferrals[]` on GET /plans/{planId}. Everything past `reasonCode`
 * is additive (CONVENTIONS.md rule 8) and feeds the Figma D-05 drawer.
 */
const DEFERRAL_ROW = {
  type: "object",
  additionalProperties: false,
  required: ["assignmentId", "orderId", "orderRef"],
  properties: {
    assignmentId: { type: "string" },
    orderId: { type: "string" },
    orderRef: { type: "string" },
    reasonCode: NULLABLE_STRING,
    note: NULLABLE_STRING,
    order: {
      type: "object",
      additionalProperties: false,
      required: ["outletId", "brand", "districtName", "units", "volumeM3", "windowOpen", "windowClose"],
      properties: {
        outletId: { type: "string" },
        outletName: NULLABLE_STRING,
        brand: { type: "string" },
        districtName: { type: "string" },
        tempRequirement: { type: "string" },
        units: { type: "integer" },
        volumeM3: { type: "number" },
        windowOpen: CLOCK,
        windowClose: CLOCK,
        deferredYesterday: { type: "boolean" },
      },
    },
    cause: {
      oneOf: [
        { type: "null" },
        {
          type: "object",
          additionalProperties: false,
          required: ["rejectionCode", "permanent", "explanation"],
          properties: {
            rejectionCode: { type: "string" },
            permanent: { type: "boolean" },
            explanation: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                required: ["code", "count"],
                properties: {
                  code: { type: "string" },
                  count: { type: "integer" },
                  sample: NULLABLE_STRING,
                },
              },
            },
            nearMiss: {
              oneOf: [
                { type: "null" },
                {
                  type: "object",
                  additionalProperties: false,
                  required: ["vehicleId", "metric", "short", "unit"],
                  properties: {
                    vehicleId: { type: "string" },
                    metric: { type: "string" },
                    short: { type: "number" },
                    unit: { type: "string" },
                  },
                },
              ],
            },
            suggestion: NULLABLE_STRING,
          },
        },
      ],
    },
    suggestedReasonCode: NULLABLE_STRING,
    movesTo: {
      oneOf: [
        { type: "null" },
        {
          type: "object",
          additionalProperties: false,
          required: ["date", "windowOpen", "windowClose", "firstOnRun"],
          properties: {
            date: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
            windowOpen: CLOCK,
            windowClose: CLOCK,
            firstOnRun: { type: "boolean" },
          },
        },
      ],
    },
    notifyRecipient: {
      oneOf: [
        { type: "null" },
        {
          type: "object",
          additionalProperties: false,
          required: ["name", "outletId"],
          properties: { name: { type: "string" }, outletId: { type: "string" } },
        },
      ],
    },
  },
} as const;

const LANE_ALTERNATIVES = {
  type: "object",
  additionalProperties: false,
  required: ["lane", "items"],
  properties: {
    lane: {
      type: "object",
      additionalProperties: false,
      required: ["brand", "districtName"],
      properties: {
        brand: { type: "string" },
        districtName: { type: "string" },
        resource: { type: "string", enum: ["refrigerated vehicle", "van", "vehicle"] },
        competing: { type: "integer" },
      },
    },
    items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["orderRef", "outletId", "isThisOrder", "decision", "rank", "impact", "why"],
        properties: {
          orderRef: { type: "string" },
          outletId: { type: "string" },
          outletName: NULLABLE_STRING,
          isThisOrder: { type: "boolean" },
          decision: { type: "string", enum: ["SERVED", "DEFERRED"] },
          rank: { type: "integer" },
          impact: { type: "string", enum: ["lowest", "protected", "skipped_twice", "high"] },
          why: { type: "string" },
        },
      },
    },
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

/**
 * The allocator's per-vehicle meters, as stored on the plan when it was built.
 * Plans made before they were kept, and plans nobody has run the allocator on,
 * have none — an empty list, not an error.
 */
function metersOf(objectiveSummary: unknown) {
  const raw = (objectiveSummary as { meters?: unknown } | null)?.meters;
  return Array.isArray(raw) ? raw : [];
}

const DEFERRAL_REASON_CODES: ReadonlySet<string> = new Set(DEFERRAL_REASONS.map((r) => r.code));

function asUtcDate(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}

function isPermanent(explanation: unknown): boolean {
  return Boolean(
    explanation &&
      typeof explanation === "object" &&
      (explanation as { permanent?: unknown }).permanent === true,
  );
}

/**
 * A calendar date, or undefined. The pattern alone passes dates that are not on
 * the calendar: "2026-02-30" parses to 2 March and "2026-13-01" to an Invalid
 * Date that is truthy and reaches Prisma as a 500. The round trip rejects both.
 */
function parseDate(value: unknown): Date | undefined {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value ? undefined : date;
}

function badDate(reply: FastifyReply) {
  return reply.status(422).send({
    error: { code: "VALIDATION_FAILED", message: "date must be a calendar date, YYYY-MM-DD." },
  });
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
          422: ERROR_RESPONSE,
        },
      },
    },
    async (request, reply) => {
      const user = request.requireRole("DISPATCHER");
      const query = request.query as { date?: string; depotCode?: string };
      const date = parseDate(query.date);
      if (query.date && !date) return badDate(reply);

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
          422: ERROR_RESPONSE,
        },
      },
    },
    async (request, reply) => {
      const user = request.requireRole("DISPATCHER");
      if (!user.depotCode) return [];
      const query = request.query as { date?: string };
      const date = parseDate(query.date);
      if (query.date && !date) return badDate(reply);

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
              // Additive: the planning day this plan belongs to, so the board
              // can link back to the right day on the desk.
              date: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
              status: { type: "string", enum: ["DRAFT", "PUBLISHED", "SUPERSEDED"] },
              stats: PLAN_STATS,
              trips: { type: "array", items: TRIP },
              // Additive: each vehicle's trips, time and fuel against budget.
              meters: { type: "array", items: VEHICLE_METER },
              deferrals: {
                // The DEFERRED assignments on this plan, including whether a
                // reason has been attached — the dispatcher needs this to
                // confirm each one before the publication gate opens. Added
                // as an additive field per CONVENTIONS.md rule 8.
                type: "array",
                items: DEFERRAL_ROW,
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

      const deferrals = await describeDeferrals(plan);

      return {
        planId: plan.id,
        date: plan.planningDay.date.toISOString().slice(0, 10),
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
        meters: metersOf(plan.objectiveSummary),
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
          409: ERROR_RESPONSE,
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

      // The contract allows the allocator only on a CLOSED or PLANNING day, and
      // the desk maps this 409 to "close the queue first". Without the check an
      // open queue could be planned while orders were still arriving, and a
      // PUBLISHED day could be re-run: runAutoPlan would put a second DRAFT
      // beside the live plan and set the day back to PLANNING, after which that
      // draft could be published over vehicles that are already loading.
      const day = await prisma.planningDay.findUnique({
        where: { date_depotCode: { date, depotCode: body.depotCode } },
        select: { status: true },
      });
      if (day?.status === "OPEN") {
        return reply.status(409).send({
          error: { code: "QUEUE_OPEN", message: "Close the order queue before building a plan." },
        });
      }
      if (day?.status === "PUBLISHED") {
        return reply.status(409).send({
          error: {
            code: "ALREADY_PUBLISHED",
            message: "This day's plan is already published, so the allocator can no longer be re-run.",
          },
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

      await recordDecision({
        actor: user,
        action: "plan.generate",
        entityType: "Plan",
        entityId: result.planId,
        after: {
          date: body.date,
          depotCode: body.depotCode,
          served: result.output.stats.served,
          deferred: result.output.stats.deferred,
        },
      });

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
      await recordDecision({
        actor: user,
        action: "queue.close",
        entityType: "PlanningDay",
        entityId: updated.id,
        before: { status: day.status },
        after: { status: updated.status, ordersAtClose: orderCount },
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
    "/plans/:planId/deferrals/:assignmentId/alternatives",
    {
      schema: {
        params: {
          type: "object",
          required: ["planId", "assignmentId"],
          properties: {
            planId: { type: "string", minLength: 1 },
            assignmentId: { type: "string", minLength: 1 },
          },
        },
        response: { 200: LANE_ALTERNATIVES, 404: ERROR_RESPONSE },
      },
    },
    async (request, reply) => {
      const user = request.requireRole("DISPATCHER");
      const { planId, assignmentId } = request.params as { planId: string; assignmentId: string };

      const plan = await loadPlan(planId);
      if (!plan || plan.planningDay.depotCode !== user.depotCode) {
        return reply.status(404).send({ error: { code: "NOT_FOUND", message: "Plan not found." } });
      }
      const result = await laneAlternatives(plan, assignmentId);
      if (!result) {
        return reply
          .status(404)
          .send({ error: { code: "NOT_FOUND", message: "No such deferral on this plan." } });
      }
      return result;
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

      // The reason is a code from the fixed list, never free text: it is what
      // the store reads in its notification and what the decision log is
      // searched by. The contract types it as a plain string, so the list is
      // enforced here, and before anything is written so a batch is all or nothing.
      const unknown = body.decisions.find((d) => !DEFERRAL_REASON_CODES.has(d.reasonCode));
      if (unknown) {
        return reply.status(422).send({
          error: {
            code: "VALIDATION_FAILED",
            message: `"${unknown.reasonCode}" is not a deferral reason code.`,
            details: { reasonCode: unknown.reasonCode, allowed: [...DEFERRAL_REASON_CODES] },
          },
        });
      }

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

      const rows = await prisma.assignment.findMany({
        where: {
          planId: plan.id,
          decision: "DEFERRED",
          id: { in: body.decisions.map((d) => d.assignmentId) },
        },
        select: { id: true, orderId: true },
      });
      const orderIdByAssignment = new Map(rows.map((r) => [r.id, r.orderId]));

      let confirmed = 0;
      const confirmedDecisions: typeof body.decisions = [];
      for (const decision of body.decisions) {
        const result = await prisma.assignment.updateMany({
          where: {
            id: decision.assignmentId,
            planId: plan.id,
            decision: "DEFERRED",
          },
          data: {
            reasonCode: decision.reasonCode,
            note: decision.note?.trim() ? decision.note.trim().slice(0, 500) : null,
          },
        });
        confirmed += result.count;
        if (result.count > 0) confirmedDecisions.push(decision);
      }
      await recordDecisions(
        confirmedDecisions.flatMap((decision) => {
          const orderId = orderIdByAssignment.get(decision.assignmentId);
          if (!orderId) return [];
          return [
            {
              actor: user,
              action: "deferral.confirm",
              entityType: "Order",
              entityId: orderId,
              reasonCode: decision.reasonCode,
              note: decision.note?.trim() ? decision.note.trim().slice(0, 500) : undefined,
              after: { planId: plan.id },
            },
          ];
        }),
      );
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
            select: {
              id: true,
              orderId: true,
              decision: true,
              reasonCode: true,
              note: true,
              explanation: true,
              order: { select: { ref: true, outletId: true, windowOpen: true, windowClose: true } },
            },
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
      const movesTo = await nextRunDate(plan.planningDay.date);

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
            // Audit-trail row per deferral so the store can see why, and
            // when the order moves to. The store hears about it here — the
            // contract has always said publishing notifies deferred outlets.
            const now = new Date();
            for (const assignment of deferredAssignments) {
              const reasonCode = assignment.reasonCode ?? "UNCONFIRMED";
              // A permanent cause has no next run to move to.
              const rolledTo = isPermanent(assignment.explanation) ? null : asUtcDate(movesTo);
              await tx.deferral.upsert({
                where: { planId_orderId: { planId: plan.id, orderId: assignment.orderId } },
                create: {
                  planId: plan.id,
                  orderId: assignment.orderId,
                  reasonCode,
                  note: assignment.note,
                  rolledToDate: rolledTo,
                  decidedByUserId: user.id,
                  storeNotifiedAt: now,
                },
                update: {
                  reasonCode,
                  note: assignment.note,
                  rolledToDate: rolledTo,
                  decidedByUserId: user.id,
                  decidedAt: now,
                  storeNotifiedAt: now,
                },
              });
              await tx.notification.create({
                data: {
                  outletId: assignment.order.outletId,
                  kind: "deferred",
                  title: isPermanent(assignment.explanation)
                    ? `Order ${assignment.order.ref} could not be delivered`
                    : `Order ${assignment.order.ref} moves to ${shortDay(movesTo)}`,
                  body: deferralMessage(
                    assignment.order,
                    reasonCode,
                    movesTo,
                    isPermanent(assignment.explanation),
                  ),
                  payload: { orderId: assignment.orderId, planId: plan.id, rolledToDate: rolledTo ? movesTo : null },
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

      // After the transaction, not in it: recordDecision uses the shared
      // client, and a decision log row for a publish that rolled back would be
      // a record of something that did not happen.
      await recordDecisions([
        {
          actor: user,
          action: "plan.publish",
          entityType: "Plan",
          entityId: plan.id,
          after: { date: plan.planningDay.date.toISOString().slice(0, 10) },
        },
        ...plan.assignments.map((a) => ({
          actor: user,
          action: a.decision === "SERVED" ? "order.plan" : "order.defer",
          entityType: "Order",
          entityId: a.orderId,
          reasonCode: a.decision === "DEFERRED" ? (a.reasonCode ?? undefined) : undefined,
          note: a.decision === "DEFERRED" ? (a.note ?? undefined) : undefined,
          after: { planId: plan.id },
        })),
      ]);

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
