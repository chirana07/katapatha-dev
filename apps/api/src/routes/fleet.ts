import type { FastifyInstance } from "fastify";
import type { VehicleStatus } from "@prisma/client";
import { prisma } from "../lib/db.js";
import { recordDecision } from "../lib/audit.js";

/**
 * Owner: BE2
 *
 * Fleet status — which vehicles can run on a given day. The allocator and the
 * publish validator already read `VehicleDayStatus`; until now only the seed
 * could write it. A dispatcher marks a vehicle in the workshop (or back) for
 * their own depot, before the day's plan is published.
 *
 * Changing status does not touch an existing draft: the dispatcher re-runs
 * auto-plan, and a stale draft cannot be published anyway because the
 * validator raises VEHICLE_IN_WORKSHOP for any trip on that vehicle.
 */

const DATE_ONLY = "^\\d{4}-\\d{2}-\\d{2}$";

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
      },
    },
  },
} as const;

const VEHICLE_DAY = {
  type: "object",
  additionalProperties: false,
  required: ["vehicleId", "type", "temp", "volumeCapM3", "weightCapKg", "status"],
  properties: {
    vehicleId: { type: "string" },
    type: { type: "string", enum: ["truck", "van"] },
    temp: { type: "string", enum: ["reefer", "ambient"] },
    volumeCapM3: { type: "number" },
    weightCapKg: { type: "number" },
    status: { type: "string", enum: ["AVAILABLE", "IN_WORKSHOP"] },
    note: { oneOf: [{ type: "string" }, { type: "null" }] },
    setAt: { oneOf: [{ type: "string" }, { type: "null" }] },
    setBy: { oneOf: [{ type: "string" }, { type: "null" }] },
  },
} as const;

const FLEET_DAY = {
  type: "object",
  additionalProperties: false,
  required: ["date", "depotCode", "editable", "vehicles"],
  properties: {
    date: { type: "string", pattern: DATE_ONLY },
    depotCode: { type: "string" },
    editable: { type: "boolean" },
    lockedReason: { oneOf: [{ type: "string" }, { type: "null" }] },
    hasDraft: { type: "boolean" },
    draftStale: { type: "boolean" },
    vehicles: { type: "array", items: VEHICLE_DAY },
  },
} as const;

function asDate(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

/** Whether the day's fleet can still change, and why not when it can't. */
async function lockFor(date: Date, depotCode: string) {
  const day = await prisma.planningDay.findUnique({
    where: { date_depotCode: { date, depotCode } },
    select: {
      status: true,
      plans: { where: { status: "DRAFT" }, select: { createdAt: true }, orderBy: { createdAt: "desc" }, take: 1 },
    },
  });
  if (day?.status === "PUBLISHED") {
    return {
      editable: false,
      lockedReason: "The plan for this day is published. Vehicle changes now go through the dock.",
      hasDraft: false,
      draftStale: false,
    };
  }
  const draft = day?.plans[0];
  // Stale only when a vehicle changed after the draft was built — a draft
  // made from the current fleet needs no re-run.
  const changedSince = draft
    ? await prisma.vehicleDayStatus.count({
        where: { date, vehicle: { depotCode }, setAt: { gt: draft.createdAt } },
      })
    : 0;
  return { editable: true, lockedReason: null, hasDraft: Boolean(draft), draftStale: changedSince > 0 };
}

async function fleetDay(date: Date, depotCode: string) {
  const [vehicles, statuses, lock] = await Promise.all([
    prisma.vehicle.findMany({ where: { depotCode }, orderBy: { id: "asc" } }),
    prisma.vehicleDayStatus.findMany({ where: { date, vehicle: { depotCode } } }),
    lockFor(date, depotCode),
  ]);
  const setters = await prisma.user.findMany({
    where: { id: { in: statuses.map((s) => s.setByUserId).filter((id): id is string => Boolean(id)) } },
    select: { id: true, name: true },
  });
  const nameById = new Map(setters.map((u) => [u.id, u.name]));
  const byVehicle = new Map(statuses.map((s) => [s.vehicleId, s]));

  return {
    date: date.toISOString().slice(0, 10),
    depotCode,
    ...lock,
    vehicles: vehicles.map((v) => {
      const row = byVehicle.get(v.id);
      return {
        vehicleId: v.id,
        type: v.type,
        temp: v.temp,
        volumeCapM3: v.volumeCapM3,
        weightCapKg: v.weightCapKg,
        // No row means nobody has said otherwise, so it can run — the same
        // default the allocator uses.
        status: row?.status ?? ("AVAILABLE" as VehicleStatus),
        note: row?.note ?? null,
        setAt: row?.setAt.toISOString() ?? null,
        setBy: row?.setByUserId ? (nameById.get(row.setByUserId) ?? null) : null,
      };
    }),
  };
}

export default async function (fastify: FastifyInstance) {
  fastify.get(
    "/fleet/status",
    {
      schema: {
        querystring: {
          type: "object",
          additionalProperties: false,
          required: ["date"],
          properties: { date: { type: "string", pattern: DATE_ONLY } },
        },
        response: { 200: FLEET_DAY, 403: ERROR_RESPONSE },
      },
    },
    async (request) => {
      const user = request.requireRole("DISPATCHER");
      const { date } = request.query as { date: string };
      return fleetDay(asDate(date), user.depotCode ?? "");
    },
  );

  fastify.put(
    "/fleet/status/:vehicleId",
    {
      schema: {
        params: {
          type: "object",
          required: ["vehicleId"],
          properties: { vehicleId: { type: "string", minLength: 1 } },
        },
        body: {
          type: "object",
          additionalProperties: false,
          required: ["date", "status"],
          properties: {
            date: { type: "string", pattern: DATE_ONLY },
            status: { type: "string", enum: ["AVAILABLE", "IN_WORKSHOP"] },
            note: { oneOf: [{ type: "string", maxLength: 200 }, { type: "null" }] },
          },
        },
        response: { 200: FLEET_DAY, 403: ERROR_RESPONSE, 404: ERROR_RESPONSE, 409: ERROR_RESPONSE },
      },
    },
    async (request, reply) => {
      const user = request.requireRole("DISPATCHER");
      const { vehicleId } = request.params as { vehicleId: string };
      const body = request.body as { date: string; status: VehicleStatus; note?: string | null };
      const depotCode = user.depotCode ?? "";
      const date = asDate(body.date);

      const vehicle = await prisma.vehicle.findFirst({ where: { id: vehicleId, depotCode } });
      if (!vehicle) {
        return reply
          .status(404)
          .send({ error: { code: "NOT_FOUND", message: "No such vehicle at this depot." } });
      }

      const lock = await lockFor(date, depotCode);
      if (!lock.editable) {
        return reply
          .status(409)
          .send({ error: { code: "PLAN_PUBLISHED", message: lock.lockedReason ?? "Locked." } });
      }

      const before = await prisma.vehicleDayStatus.findUnique({
        where: { date_vehicleId: { date, vehicleId } },
      });
      const note = body.note?.trim() ? body.note.trim() : null;
      const previous = before?.status ?? "AVAILABLE";

      if (previous !== body.status || (before?.note ?? null) !== note) {
        await prisma.vehicleDayStatus.upsert({
          where: { date_vehicleId: { date, vehicleId } },
          create: { date, vehicleId, status: body.status, note, setByUserId: user.id },
          update: { status: body.status, note, setByUserId: user.id, setAt: new Date() },
        });
        await recordDecision({
          actor: user,
          action: "VEHICLE_STATUS_SET",
          entityType: "Vehicle",
          entityId: vehicleId,
          note: note ?? undefined,
          before: { date: body.date, status: previous },
          after: { date: body.date, status: body.status },
        });
      }

      return fleetDay(date, depotCode);
    },
  );
}
