import type { FastifyInstance } from "fastify";
import type { Prisma } from "@prisma/client";
import { AuthError, type SessionUser } from "../lib/auth.js";
import { historyFor } from "../lib/audit.js";
import { prisma } from "../lib/db.js";
import {
  requireDispatcherPlan,
  requireDispatcherPlanningDay,
  requireDispatcherProblem,
  requireDispatcherShortfall,
  requireDispatcherVehicle,
} from "../lib/authorization.js";

/**
 * Owner: BE2
 *
 * The decision log, read back. `recordDecision` has been writing it since the
 * brief's complaint that "deferrals lack a clear record"; this is the endpoint
 * that makes the record readable — the order History tab and the exception
 * Activity panel.
 *
 * Authorisation is per record, not per role. A log is exactly as visible as
 * the record it describes, and a record the caller cannot see answers the same
 * 403 as one that does not exist, so the endpoint cannot be used to probe for
 * ids.
 */

const ENTITY_TYPES = ["Order", "Plan", "PlanningDay", "Trip", "Shortfall", "Problem", "Vehicle", "Outlet", "CapacityAction"] as const;
type EntityType = (typeof ENTITY_TYPES)[number];

const ERROR_RESPONSE = {
  type: "object",
  required: ["error"],
  properties: {
    error: {
      type: "object",
      required: ["code", "message"],
      properties: { code: { type: "string" }, message: { type: "string" } },
    },
  },
} as const;

const NULLABLE_STRING = { oneOf: [{ type: "string" }, { type: "null" }] } as const;
const NULLABLE_OBJECT = {
  oneOf: [{ type: "object", additionalProperties: true }, { type: "null" }],
} as const;

const HISTORY = {
  type: "object",
  additionalProperties: false,
  required: ["entityType", "entityId", "events"],
  properties: {
    entityType: { type: "string", enum: ENTITY_TYPES },
    entityId: { type: "string" },
    events: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "at", "action"],
        properties: {
          id: { type: "string" },
          at: { type: "string" },
          action: { type: "string" },
          actorName: NULLABLE_STRING,
          actorRole: { oneOf: [{ type: "string", enum: ["DISPATCHER", "LOADER", "DRIVER", "STORE_MANAGER"] }, { type: "null" }] },
          reasonCode: NULLABLE_STRING,
          note: NULLABLE_STRING,
          before: NULLABLE_OBJECT,
          after: NULLABLE_OBJECT,
        },
      },
    },
  },
} as const;

function deny(): never {
  throw new AuthError("You do not have access to this record", 403);
}

/**
 * Throws 403 unless `user` may read this record's log.
 *
 * Dispatchers get the depot-scoped predicates the rest of the API already uses
 * where one exists. Orders, trips and outlets have no predicate of their own
 * because nothing needed one until now, so they are checked inline.
 */
async function authorise(user: SessionUser, entityType: EntityType, entityId: string): Promise<void> {
  if (user.role === "STORE_MANAGER") {
    if (!user.outletId) return deny();
    if (entityType === "Outlet") {
      if (entityId !== user.outletId) deny();
      return;
    }
    if (entityType === "Order") {
      const order = await prisma.order.findFirst({
        where: { id: entityId, outletId: user.outletId },
        select: { id: true },
      });
      if (!order) deny();
      return;
    }
    return deny();
  }

  if (user.role !== "DISPATCHER" || !user.depotCode) return deny();
  const depotCode = user.depotCode;

  switch (entityType) {
    case "Plan":
      await requireDispatcherPlan(user, entityId);
      return;
    case "PlanningDay":
      await requireDispatcherPlanningDay(user, entityId);
      return;
    case "Vehicle":
      await requireDispatcherVehicle(user, entityId);
      return;
    case "Shortfall":
      await requireDispatcherShortfall(user, entityId);
      return;
    case "Problem":
      await requireDispatcherProblem(user, entityId);
      return;
    case "Order": {
      const order = await prisma.order.findFirst({ where: { id: entityId, depotCode }, select: { id: true } });
      if (!order) deny();
      return;
    }
    case "Trip": {
      const trip = await prisma.trip.findFirst({
        where: { id: entityId, plan: { planningDay: { depotCode } } },
        select: { id: true },
      });
      if (!trip) deny();
      return;
    }
    case "Outlet": {
      const outlet = await prisma.outlet.findFirst({ where: { id: entityId, depotCode }, select: { id: true } });
      if (!outlet) deny();
      return;
    }
    case "CapacityAction": {
      const action = await prisma.capacityAction.findFirst({ where: { id: entityId, depotCode }, select: { id: true } });
      if (!action) deny();
      return;
    }
  }
}

function asObject(value: Prisma.JsonValue | null): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

export default async function (fastify: FastifyInstance) {
  fastify.get(
    "/history/:entityType/:entityId",
    {
      schema: {
        params: {
          type: "object",
          required: ["entityType", "entityId"],
          properties: {
            entityType: { type: "string", enum: ENTITY_TYPES },
            entityId: { type: "string", minLength: 1 },
          },
        },
        response: { 200: HISTORY, 403: ERROR_RESPONSE },
      },
    },
    async (request) => {
      const user = request.requireRole("DISPATCHER", "STORE_MANAGER");
      const { entityType, entityId } = request.params as { entityType: EntityType; entityId: string };

      await authorise(user, entityType, entityId);
      const rows = await historyFor(entityType, entityId);

      return {
        entityType,
        entityId,
        events: rows.map((row) => ({
          id: row.id,
          at: row.at.toISOString(),
          action: row.action,
          actorName: row.actor?.name ?? null,
          actorRole: row.actorRole ?? null,
          reasonCode: row.reasonCode ?? null,
          note: row.note ?? null,
          before: asObject(row.before),
          after: asObject(row.after),
        })),
      };
    },
  );
}
