import type { FastifyInstance, FastifyReply } from "fastify";
import bcrypt from "bcryptjs";
import type { Brand, DockType, ParkingConstraint, Prisma, Role, VehicleTemp, VehicleType } from "@prisma/client";
import { DISTRICT_POSITIONS, syntheticOutletPosition } from "@katapatha/core/domain/geography";
import { prisma } from "../lib/db.js";
import { normalizeStaffId } from "../lib/auth.js";
import { recordDecision } from "../lib/audit.js";
import { addDays, parseIsoDate } from "../services/forecast.js";
import {
  MAX_RANGE_DAYS,
  buildOverview,
  loadReportContext,
  loadWindowData,
  previousWindow,
  windowOf,
} from "../services/reports.js";
import {
  changedKeys,
  outletSnapshot,
  scopeFor,
  toAdminOutlet,
  toAdminUser,
  toAdminVehicle,
  userSnapshot,
  vehicleSnapshot,
  windowProblem,
} from "../services/admin.js";

/**
 * Owner: ADMIN slice
 *
 * The admin's workspace: accounts, outlets and vehicles at every depot, a
 * Waypoint-wide overview and the decision log. Admin only, and scoped to no
 * depot — that is the point of the role.
 *
 * Nothing is deleted. An account is disabled (audit events and decisions point
 * at it); an outlet or vehicle is kept because orders, plans and history point
 * at it. For the same reason the keys those records hang on — an outlet's id,
 * brand and district, a vehicle's id and depot, an account's email — cannot be
 * changed here, and attempting it is refused by the schema rather than ignored.
 *
 * Every write leaves a decision-log row. A password never does.
 */

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

const DATE_ONLY = "^\\d{4}-\\d{2}-\\d{2}$";
const CLOCK = "^([01]\\d|2[0-3]):[0-5]\\d$";
const CODE = "^[A-Z0-9][A-Z0-9_-]{1,31}$";

const nullable = (schema: object) => ({ oneOf: [schema, { type: "null" }] });
const ROLE = { type: "string", enum: ["DISPATCHER", "LOADER", "DRIVER", "STORE_MANAGER", "ADMIN"] } as const;
const BRAND = { type: "string", enum: ["Fresh", "Style", "Tech"] } as const;
const DOCK = { type: "string", enum: ["rear_dock", "street", "mall_bay"] } as const;
const PARKING = { type: "string", enum: ["normal", "van_only", "mall_dock"] } as const;
const CLOCK_TIME = { type: "string", pattern: CLOCK } as const;
const VEHICLE_TYPE = { type: "string", enum: ["truck", "van"] } as const;
const VEHICLE_TEMP = { type: "string", enum: ["reefer", "ambient"] } as const;
const ERRORS = { 401: ERROR_RESPONSE, 403: ERROR_RESPONSE, 404: ERROR_RESPONSE, 409: ERROR_RESPONSE, 422: ERROR_RESPONSE };

const USER = {
  type: "object",
  additionalProperties: false,
  required: ["id", "email", "name", "role", "depotCode", "outletId", "staffId", "active", "createdAt", "lastSignInAt"],
  properties: {
    id: { type: "string" },
    email: { type: "string" },
    name: { type: "string" },
    role: ROLE,
    depotCode: nullable({ type: "string" }),
    outletId: nullable({ type: "string" }),
    staffId: nullable({ type: "string" }),
    active: { type: "boolean" },
    createdAt: { type: "string", format: "date-time" },
    lastSignInAt: nullable({ type: "string", format: "date-time" }),
  },
} as const;

const NAME = { type: "string", minLength: 2, maxLength: 120 } as const;
const PASSWORD = { type: "string", minLength: 8, maxLength: 200 } as const;
const STAFF_ID = { type: "string", minLength: 2, maxLength: 32 } as const;
const PIN = { type: "string", pattern: "^[0-9]{4,8}$" } as const;

const CREATE_USER = {
  type: "object",
  additionalProperties: false,
  required: ["email", "name", "role", "password"],
  properties: {
    email: { type: "string", format: "email", maxLength: 160 },
    name: NAME,
    role: ROLE,
    password: PASSWORD,
    staffId: STAFF_ID,
    pin: PIN,
    depotCode: nullable({ type: "string", minLength: 1 }),
    outletId: nullable({ type: "string", minLength: 1 }),
  },
} as const;

const UPDATE_USER = {
  type: "object",
  additionalProperties: false,
  minProperties: 1,
  properties: {
    name: NAME,
    role: ROLE,
    password: PASSWORD,
    staffId: STAFF_ID,
    pin: PIN,
    depotCode: nullable({ type: "string", minLength: 1 }),
    outletId: nullable({ type: "string", minLength: 1 }),
    active: { type: "boolean" },
  },
} as const;

const OUTLET = {
  type: "object",
  additionalProperties: false,
  required: [
    "id", "displayName", "brand", "districtName", "depotCode", "dockType", "parkingConstraint",
    "windowOpen", "windowClose", "mallWindowOpen", "mallWindowClose", "lat", "lng", "geoSource", "managers",
  ],
  properties: {
    id: { type: "string" },
    displayName: nullable({ type: "string" }),
    brand: BRAND,
    districtName: { type: "string" },
    depotCode: { type: "string" },
    dockType: DOCK,
    parkingConstraint: PARKING,
    windowOpen: { type: "string" },
    windowClose: { type: "string" },
    mallWindowOpen: nullable({ type: "string" }),
    mallWindowClose: nullable({ type: "string" }),
    lat: nullable({ type: "number" }),
    lng: nullable({ type: "number" }),
    geoSource: nullable({ type: "string", enum: ["SYNTHETIC", "CSV", "DISPATCHER"] }),
    managers: { type: "integer", minimum: 0 },
  },
} as const;

const OUTLET_EDITABLE = {
  displayName: nullable({ type: "string", maxLength: 120 }),
  dockType: DOCK,
  parkingConstraint: PARKING,
  windowOpen: CLOCK_TIME,
  windowClose: CLOCK_TIME,
  mallWindowOpen: nullable(CLOCK_TIME),
  mallWindowClose: nullable(CLOCK_TIME),
} as const;

const CREATE_OUTLET = {
  type: "object",
  additionalProperties: false,
  required: ["id", "brand", "districtName", "dockType", "parkingConstraint", "windowOpen", "windowClose"],
  properties: {
    id: { type: "string", pattern: CODE },
    brand: BRAND,
    districtName: { type: "string", minLength: 1 },
    lat: { type: "number", minimum: 5.8, maximum: 9.9 },
    lng: { type: "number", minimum: 79.5, maximum: 82.0 },
    ...OUTLET_EDITABLE,
  },
} as const;

const UPDATE_OUTLET = { type: "object", additionalProperties: false, minProperties: 1, properties: OUTLET_EDITABLE } as const;

const VEHICLE = {
  type: "object",
  additionalProperties: false,
  required: ["id", "type", "temp", "weightCapKg", "volumeCapM3", "fuelType", "kmPerL", "weeklyFuelQuotaL", "depotCode", "trips"],
  properties: {
    id: { type: "string" },
    type: VEHICLE_TYPE,
    temp: VEHICLE_TEMP,
    weightCapKg: { type: "integer" },
    volumeCapM3: { type: "number" },
    fuelType: { type: "string" },
    kmPerL: { type: "number" },
    weeklyFuelQuotaL: { type: "integer" },
    depotCode: { type: "string" },
    trips: { type: "integer", minimum: 0 },
  },
} as const;

const VEHICLE_EDITABLE = {
  type: VEHICLE_TYPE,
  temp: VEHICLE_TEMP,
  weightCapKg: { type: "integer", minimum: 1, maximum: 40000 },
  volumeCapM3: { type: "number", exclusiveMinimum: 0, maximum: 120 },
  fuelType: { type: "string", minLength: 1, maxLength: 24 },
  kmPerL: { type: "number", exclusiveMinimum: 0, maximum: 50 },
  weeklyFuelQuotaL: { type: "integer", minimum: 0, maximum: 10000 },
} as const;

const CREATE_VEHICLE = {
  type: "object",
  additionalProperties: false,
  required: ["id", "type", "temp", "weightCapKg", "volumeCapM3", "fuelType", "kmPerL", "weeklyFuelQuotaL", "depotCode"],
  properties: { id: { type: "string", pattern: CODE }, depotCode: { type: "string", minLength: 1 }, ...VEHICLE_EDITABLE },
} as const;

const UPDATE_VEHICLE = { type: "object", additionalProperties: false, minProperties: 1, properties: VEHICLE_EDITABLE } as const;

const idParams = (name: string) => ({
  type: "object",
  required: [name],
  properties: { [name]: { type: "string", minLength: 1, maxLength: 64 } },
});

type CreateUser = {
  email: string;
  name: string;
  role: Role;
  password: string;
  staffId?: string;
  pin?: string;
  depotCode?: string | null;
  outletId?: string | null;
};
type UpdateUser = Partial<Omit<CreateUser, "email">> & { active?: boolean };
type OutletEditable = {
  displayName?: string | null;
  dockType?: DockType;
  parkingConstraint?: ParkingConstraint;
  windowOpen?: string;
  windowClose?: string;
  mallWindowOpen?: string | null;
  mallWindowClose?: string | null;
};
type CreateOutlet = OutletEditable & {
  id: string;
  brand: Brand;
  districtName: string;
  dockType: DockType;
  parkingConstraint: ParkingConstraint;
  windowOpen: string;
  windowClose: string;
  lat?: number;
  lng?: number;
};
type VehicleEditable = {
  type?: VehicleType;
  temp?: VehicleTemp;
  weightCapKg?: number;
  volumeCapM3?: number;
  fuelType?: string;
  kmPerL?: number;
  weeklyFuelQuotaL?: number;
};
type CreateVehicle = Required<VehicleEditable> & { id: string; depotCode: string };

const BCRYPT_COST = 10;

function invalid(reply: FastifyReply, message: string) {
  return reply.status(422).send({ error: { code: "VALIDATION_FAILED", message } });
}
function notFound(reply: FastifyReply, what: string) {
  return reply.status(404).send({ error: { code: "NOT_FOUND", message: `${what} not found.` } });
}
function conflict(reply: FastifyReply, code: string, message: string) {
  return reply.status(409).send({ error: { code, message } });
}

/** Prisma's unique-constraint error: two admins adding the same key at once. */
function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === "P2002";
}

function todayInColombo(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Colombo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const value = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${value.year}-${value.month}-${value.day}`;
}

const isRealDate = (d: string): boolean =>
  !Number.isNaN(parseIsoDate(d).getTime()) && parseIsoDate(d).toISOString().slice(0, 10) === d;

/** The newest session per user: as close to "last signed in" as the records allow. */
async function lastSignIns(userIds: string[]): Promise<Map<string, Date>> {
  if (userIds.length === 0) return new Map();
  const rows = await prisma.session.groupBy({
    by: ["userId"],
    where: { userId: { in: userIds } },
    _max: { createdAt: true },
  });
  return new Map(rows.flatMap((r) => (r._max.createdAt ? [[r.userId, r._max.createdAt] as const] : [])));
}

/** Checks a role's binding against the records it names. Null when it is fine. */
async function scopeProblem(depotCode: string | null, outletId: string | null): Promise<string | null> {
  if (depotCode && !(await prisma.depot.findUnique({ where: { code: depotCode }, select: { code: true } }))) {
    return `There is no depot ${depotCode}.`;
  }
  if (outletId && !(await prisma.outlet.findUnique({ where: { id: outletId }, select: { id: true } }))) {
    return `There is no outlet ${outletId}.`;
  }
  return null;
}

export default async function (fastify: FastifyInstance) {
  // ---- directory, overview, activity ----------------------------------------------------------

  fastify.get("/admin/directory", { schema: { response: { 401: ERROR_RESPONSE, 403: ERROR_RESPONSE } } }, async (request) => {
    request.requireRole("ADMIN");
    const [depots, districts] = await Promise.all([
      prisma.depot.findMany({ orderBy: { code: "asc" }, select: { code: true, name: true } }),
      prisma.district.findMany({ orderBy: { name: "asc" }, select: { name: true, depotCode: true } }),
    ]);
    return { depots, districts };
  });

  fastify.get(
    "/admin/overview",
    {
      schema: {
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: { from: { type: "string", pattern: DATE_ONLY }, to: { type: "string", pattern: DATE_ONLY } },
        },
        response: { 401: ERROR_RESPONSE, 403: ERROR_RESPONSE, 422: ERROR_RESPONSE },
      },
    },
    async (request, reply) => {
      request.requireRole("ADMIN");
      const query = request.query as { from?: string; to?: string };
      if ((query.from && !isRealDate(query.from)) || (query.to && !isRealDate(query.to))) {
        return invalid(reply, "from and to must be real calendar dates (YYYY-MM-DD).");
      }
      // One range for every depot: a comparison across depots over different
      // weeks would read as a difference between depots that is not there.
      const to = query.to ?? (query.from ? addDays(query.from, 6) : todayInColombo());
      const from = query.from ?? addDays(to, -6);
      if (from > to) return invalid(reply, "from must not be after to.");
      const days = Math.round((parseIsoDate(to).getTime() - parseIsoDate(from).getTime()) / 86_400_000) + 1;
      if (days > MAX_RANGE_DAYS) return invalid(reply, `An overview covers at most ${MAX_RANGE_DAYS} days.`);

      const window = windowOf(from, to);
      const [depots, users, outletsByDepot, vehicles] = await Promise.all([
        prisma.depot.findMany({ orderBy: { code: "asc" }, select: { code: true, name: true } }),
        prisma.user.findMany({ select: { role: true, active: true, depotCode: true, outlet: { select: { depotCode: true } } } }),
        prisma.outlet.groupBy({ by: ["depotCode"], _count: { _all: true } }),
        prisma.vehicle.findMany({ select: { depotCode: true, temp: true } }),
      ]);

      const rows = await Promise.all(
        depots.map(async (depot) => {
          const [cur, prev, ctx] = await Promise.all([
            loadWindowData(depot.code, window),
            loadWindowData(depot.code, previousWindow(window)),
            loadReportContext(depot.code, window),
          ]);
          const overview = buildOverview(cur, prev, ctx);
          const fleet = vehicles.filter((v) => v.depotCode === depot.code);
          return {
            depotCode: depot.code,
            name: depot.name,
            outlets: outletsByDepot.find((o) => o.depotCode === depot.code)?._count._all ?? 0,
            vehicles: fleet.length,
            reefers: fleet.filter((v) => v.temp === "reefer").length,
            // A store manager belongs to a depot through their outlet.
            activeUsers: users.filter((u) => u.active && (u.depotCode ?? u.outlet?.depotCode) === depot.code).length,
            onTimePct: overview.onTime.pct,
            stops: overview.onTime.total,
            orders: overview.orders.planned,
            delivered: overview.orders.delivered,
            deferred: overview.orders.deferred,
            utilisationPct: overview.utilisation.pct,
            discrepancies: overview.discrepancies.count,
          };
        }),
      );

      const roles: Role[] = ["DISPATCHER", "LOADER", "DRIVER", "STORE_MANAGER", "ADMIN"];
      return {
        from,
        to,
        totals: {
          users: users.length,
          activeUsers: users.filter((u) => u.active).length,
          usersByRole: roles.map((role) => ({ role, count: users.filter((u) => u.role === role).length })),
          outlets: outletsByDepot.reduce((sum, o) => sum + o._count._all, 0),
          vehicles: vehicles.length,
        },
        depots: rows,
      };
    },
  );

  fastify.get(
    "/admin/activity",
    {
      schema: {
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: {
            // A string, like every query parameter here: coercion is off.
            limit: { type: "string", pattern: "^[0-9]{1,3}$" },
            entityType: { type: "string", minLength: 1, maxLength: 40 },
          },
        },
        response: { 401: ERROR_RESPONSE, 403: ERROR_RESPONSE, 422: ERROR_RESPONSE },
      },
    },
    async (request, reply) => {
      request.requireRole("ADMIN");
      const query = request.query as { limit?: string; entityType?: string };
      const limit = query.limit === undefined ? 50 : Number(query.limit);
      if (limit < 1 || limit > 200) return invalid(reply, "limit is 1 to 200.");
      const events = await prisma.auditEvent.findMany({
        where: query.entityType ? { entityType: query.entityType } : {},
        orderBy: { at: "desc" },
        take: limit,
        include: { actor: { select: { name: true } } },
      });
      return events.map((e) => ({
        id: e.id,
        at: e.at.toISOString(),
        actorName: e.actor?.name ?? null,
        actorRole: e.actorRole,
        action: e.action,
        entityType: e.entityType,
        entityId: e.entityId,
        note: e.note,
      }));
    },
  );

  // ---- users -----------------------------------------------------------------------------------

  fastify.get("/admin/users", { schema: { response: { 200: { type: "array", items: USER }, 401: ERROR_RESPONSE, 403: ERROR_RESPONSE } } }, async (request) => {
    request.requireRole("ADMIN");
    const users = await prisma.user.findMany({ orderBy: [{ role: "asc" }, { name: "asc" }] });
    const seen = await lastSignIns(users.map((u) => u.id));
    return users.map((u) => toAdminUser(u, seen.get(u.id) ?? null));
  });

  fastify.post("/admin/users", { schema: { body: CREATE_USER, response: { 201: USER, ...ERRORS } } }, async (request, reply) => {
    const admin = request.requireRole("ADMIN");
    const body = request.body as CreateUser;
    const email = body.email.trim().toLowerCase();
    const name = body.name.trim();
    if (name.length < 2) return invalid(reply, "A name needs at least two characters.");

    const scope = scopeFor(body.role, body.depotCode, body.outletId);
    if ("error" in scope) return invalid(reply, scope.error);
    const problem = await scopeProblem(scope.depotCode, scope.outletId);
    if (problem) return invalid(reply, problem);

    // The staff ID and PIN the web sign-in asks for come as a pair: a PIN with
    // nobody to enter it for, or an ID that cannot be signed in with, is a mistake.
    if ((body.staffId === undefined) !== (body.pin === undefined)) return invalid(reply, "Give the staff ID and the PIN together, or neither.");
    const staffId = body.staffId === undefined ? null : normalizeStaffId(body.staffId);

    const taken = () => conflict(reply, "EMAIL_TAKEN", `${email} already has an account.`);
    const staffTaken = () => conflict(reply, "STAFF_ID_TAKEN", `Staff ID ${staffId} already belongs to someone.`);
    // A disabled account still holds its email and staff ID: its history is that person's.
    if (await prisma.user.findUnique({ where: { email }, select: { id: true } })) return taken();
    if (staffId && (await prisma.user.findUnique({ where: { staffId }, select: { id: true } }))) return staffTaken();

    let created;
    try {
      created = await prisma.user.create({
        data: {
          email,
          name,
          role: body.role,
          passwordHash: await bcrypt.hash(body.password, BCRYPT_COST),
          staffId,
          pinHash: body.pin === undefined ? null : await bcrypt.hash(body.pin, BCRYPT_COST),
          ...scope,
        },
      });
    } catch (error) {
      if (isUniqueViolation(error)) return staffId && !(await prisma.user.findUnique({ where: { email }, select: { id: true } })) ? staffTaken() : taken();
      throw error;
    }

    await recordDecision({
      actor: admin,
      action: "user.create",
      entityType: "User",
      entityId: created.id,
      after: userSnapshot(created),
    });
    return reply.status(201).send(toAdminUser(created, null));
  });

  fastify.patch(
    "/admin/users/:userId",
    { schema: { params: idParams("userId"), body: UPDATE_USER, response: { 200: USER, ...ERRORS } } },
    async (request, reply) => {
      const admin = request.requireRole("ADMIN");
      const { userId } = request.params as { userId: string };
      const body = request.body as UpdateUser;

      const existing = await prisma.user.findUnique({ where: { id: userId } });
      if (!existing) return notFound(reply, "Account");

      // The one way to lock every admin out is to do it to yourself.
      if (existing.id === admin.id) {
        if (body.active === false) return invalid(reply, "You cannot disable your own account.");
        if (body.role !== undefined && body.role !== "ADMIN") return invalid(reply, "You cannot change your own role.");
      }

      const role = body.role ?? existing.role;
      const scope = scopeFor(
        role,
        body.depotCode !== undefined ? body.depotCode : existing.depotCode,
        body.outletId !== undefined ? body.outletId : existing.outletId,
      );
      if ("error" in scope) return invalid(reply, scope.error);
      const problem = await scopeProblem(scope.depotCode, scope.outletId);
      if (problem) return invalid(reply, problem);

      // An account that has no staff ID yet needs the PIN given with it.
      const staffId = body.staffId === undefined ? undefined : normalizeStaffId(body.staffId);
      if (staffId !== undefined && body.pin === undefined && !existing.pinHash) {
        return invalid(reply, "Give a PIN with the staff ID: the account has none yet.");
      }
      if (staffId !== undefined && staffId !== existing.staffId && (await prisma.user.findUnique({ where: { staffId }, select: { id: true } }))) {
        return conflict(reply, "STAFF_ID_TAKEN", `Staff ID ${staffId} already belongs to someone.`);
      }
      if (body.pin !== undefined && staffId === undefined && !existing.staffId) {
        return invalid(reply, "Give a staff ID with the PIN: the account has none yet.");
      }

      const data: Prisma.UserUncheckedUpdateInput = { role, depotCode: scope.depotCode, outletId: scope.outletId };
      const fields: Record<string, unknown> = { role, depotCode: scope.depotCode, outletId: scope.outletId };
      if (body.name !== undefined) {
        const name = body.name.trim();
        if (name.length < 2) return invalid(reply, "A name needs at least two characters.");
        data.name = name;
        fields.name = name;
      }
      if (staffId !== undefined) {
        data.staffId = staffId;
        fields.staffId = staffId;
      }
      if (body.active !== undefined) {
        data.active = body.active;
        fields.active = body.active;
      }
      // A role change also drops a driver's claimed vehicle: it belonged to the old job.
      if (role !== existing.role) data.defaultVehicleId = null;

      const changed = changedKeys(userSnapshot(existing), fields);
      const resetPassword = body.password !== undefined;
      const resetPin = body.pin !== undefined;
      if (changed.length === 0 && !resetPassword && !resetPin) {
        const seen = await lastSignIns([existing.id]);
        return toAdminUser(existing, seen.get(existing.id) ?? null);
      }
      if (resetPassword) data.passwordHash = await bcrypt.hash(body.password!, BCRYPT_COST);
      if (resetPin) data.pinHash = await bcrypt.hash(body.pin!, BCRYPT_COST);

      const updated = await prisma.user.update({ where: { id: userId }, data });
      // A new password, a disabled account or a new role ends every session:
      // nobody should carry on under a binding the admin just changed.
      if (resetPassword || resetPin || body.active === false || changed.some((k) => k === "role" || k === "depotCode" || k === "outletId")) {
        await prisma.session.deleteMany({ where: { userId } });
      }

      const before = userSnapshot(existing) as Record<string, unknown>;
      const after = userSnapshot(updated) as Record<string, unknown>;
      await recordDecision({
        actor: admin,
        action: body.active === false ? "user.disable" : body.active === true && !existing.active ? "user.enable" : "user.update",
        entityType: "User",
        entityId: updated.id,
        // That a password or PIN changed is recorded; what it is, never.
        note: [resetPassword ? "Password reset by an admin." : null, resetPin ? "PIN reset by an admin." : null].filter(Boolean).join(" ") || undefined,
        before: Object.fromEntries(changed.map((k) => [k, before[k]])) as Prisma.InputJsonValue,
        after: Object.fromEntries(changed.map((k) => [k, after[k]])) as Prisma.InputJsonValue,
      });
      const seen = await lastSignIns([updated.id]);
      return toAdminUser(updated, seen.get(updated.id) ?? null);
    },
  );

  // ---- outlets ---------------------------------------------------------------------------------

  async function managerCounts(): Promise<Map<string, number>> {
    const rows = await prisma.user.groupBy({
      by: ["outletId"],
      where: { role: "STORE_MANAGER", active: true, outletId: { not: null } },
      _count: { _all: true },
    });
    return new Map(rows.map((r) => [r.outletId as string, r._count._all]));
  }

  fastify.get("/admin/outlets", { schema: { response: { 200: { type: "array", items: OUTLET }, 401: ERROR_RESPONSE, 403: ERROR_RESPONSE } } }, async (request) => {
    request.requireRole("ADMIN");
    const [outlets, managers] = await Promise.all([prisma.outlet.findMany({ orderBy: { id: "asc" } }), managerCounts()]);
    return outlets.map((o) => toAdminOutlet(o, managers.get(o.id) ?? 0));
  });

  fastify.post("/admin/outlets", { schema: { body: CREATE_OUTLET, response: { 201: OUTLET, ...ERRORS } } }, async (request, reply) => {
    const admin = request.requireRole("ADMIN");
    const body = request.body as CreateOutlet;

    const district = await prisma.district.findUnique({ where: { name: body.districtName } });
    if (!district) return invalid(reply, `There is no district ${body.districtName}.`);

    const windows = {
      dockType: body.dockType,
      windowOpen: body.windowOpen,
      windowClose: body.windowClose,
      mallWindowOpen: body.mallWindowOpen ?? null,
      mallWindowClose: body.mallWindowClose ?? null,
    };
    const problem = windowProblem(windows);
    if (problem) return invalid(reply, problem);
    if ((body.lat === undefined) !== (body.lng === undefined)) return invalid(reply, "Give both latitude and longitude, or neither.");

    // A position typed in by a person is recorded as one; otherwise the outlet
    // is placed near its district centre exactly as the seed places one, and
    // says so, until someone moves it on the dispatcher's map.
    const centre = DISTRICT_POSITIONS[district.name];
    const position =
      body.lat !== undefined && body.lng !== undefined
        ? { lat: body.lat, lng: body.lng, geoSource: "DISPATCHER" as const, geoUpdatedAt: new Date(), geoUpdatedByUserId: admin.id }
        : centre
          ? { ...syntheticOutletPosition(body.id, centre, district.roadClass), geoSource: "SYNTHETIC" as const }
          : {};

    const taken = () => conflict(reply, "OUTLET_TAKEN", `Outlet ${body.id} already exists.`);
    if (await prisma.outlet.findUnique({ where: { id: body.id }, select: { id: true } })) return taken();

    let created;
    try {
      created = await prisma.outlet.create({
        data: {
          id: body.id,
          brand: body.brand,
          districtName: district.name,
          // The district decides the depot: the mapping is 1:1, not a choice.
          depotCode: district.depotCode,
          displayName: body.displayName?.trim() || null,
          parkingConstraint: body.parkingConstraint,
          ...windows,
          ...position,
        },
      });
    } catch (error) {
      if (isUniqueViolation(error)) return taken();
      throw error;
    }

    await recordDecision({ actor: admin, action: "outlet.create", entityType: "Outlet", entityId: created.id, after: outletSnapshot(created) });
    return reply.status(201).send(toAdminOutlet(created, 0));
  });

  fastify.patch(
    "/admin/outlets/:outletId",
    { schema: { params: idParams("outletId"), body: UPDATE_OUTLET, response: { 200: OUTLET, ...ERRORS } } },
    async (request, reply) => {
      const admin = request.requireRole("ADMIN");
      const { outletId } = request.params as { outletId: string };
      const body = request.body as OutletEditable;

      const existing = await prisma.outlet.findUnique({ where: { id: outletId } });
      if (!existing) return notFound(reply, "Outlet");

      const fields: Record<string, unknown> = {
        displayName: body.displayName === undefined ? undefined : body.displayName?.trim() || null,
        dockType: body.dockType,
        parkingConstraint: body.parkingConstraint,
        windowOpen: body.windowOpen,
        windowClose: body.windowClose,
        mallWindowOpen: body.mallWindowOpen,
        mallWindowClose: body.mallWindowClose,
      };
      const merged = { ...outletSnapshot(existing), ...Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined)) };
      const problem = windowProblem(merged as Parameters<typeof windowProblem>[0]);
      if (problem) return invalid(reply, problem);

      const before = outletSnapshot(existing) as Record<string, unknown>;
      const changed = changedKeys(before, fields);
      const managers = (await managerCounts()).get(outletId) ?? 0;
      if (changed.length === 0) return toAdminOutlet(existing, managers);

      const updated = await prisma.outlet.update({
        where: { id: outletId },
        data: Object.fromEntries(changed.map((k) => [k, fields[k]])) as Prisma.OutletUpdateInput,
      });
      const after = outletSnapshot(updated) as Record<string, unknown>;
      await recordDecision({
        actor: admin,
        action: "outlet.update",
        entityType: "Outlet",
        entityId: outletId,
        before: Object.fromEntries(changed.map((k) => [k, before[k]])) as Prisma.InputJsonValue,
        after: Object.fromEntries(changed.map((k) => [k, after[k]])) as Prisma.InputJsonValue,
      });
      return toAdminOutlet(updated, managers);
    },
  );

  // ---- vehicles --------------------------------------------------------------------------------

  async function tripCounts(): Promise<Map<string, number>> {
    const rows = await prisma.trip.groupBy({ by: ["vehicleId"], _count: { _all: true } });
    return new Map(rows.map((r) => [r.vehicleId, r._count._all]));
  }

  fastify.get("/admin/vehicles", { schema: { response: { 200: { type: "array", items: VEHICLE }, 401: ERROR_RESPONSE, 403: ERROR_RESPONSE } } }, async (request) => {
    request.requireRole("ADMIN");
    const [vehicles, trips] = await Promise.all([prisma.vehicle.findMany({ orderBy: { id: "asc" } }), tripCounts()]);
    return vehicles.map((v) => toAdminVehicle(v, trips.get(v.id) ?? 0));
  });

  fastify.post("/admin/vehicles", { schema: { body: CREATE_VEHICLE, response: { 201: VEHICLE, ...ERRORS } } }, async (request, reply) => {
    const admin = request.requireRole("ADMIN");
    const body = request.body as CreateVehicle;
    if (!(await prisma.depot.findUnique({ where: { code: body.depotCode }, select: { code: true } }))) {
      return invalid(reply, `There is no depot ${body.depotCode}.`);
    }
    const fuelType = body.fuelType.trim();
    if (fuelType === "") return invalid(reply, "Name the fuel, for example diesel.");

    const taken = () => conflict(reply, "VEHICLE_TAKEN", `Vehicle ${body.id} already exists.`);
    if (await prisma.vehicle.findUnique({ where: { id: body.id }, select: { id: true } })) return taken();

    let created;
    try {
      created = await prisma.vehicle.create({ data: { ...body, fuelType } });
    } catch (error) {
      if (isUniqueViolation(error)) return taken();
      throw error;
    }
    await recordDecision({ actor: admin, action: "vehicle.create", entityType: "Vehicle", entityId: created.id, after: vehicleSnapshot(created) });
    return reply.status(201).send(toAdminVehicle(created, 0));
  });

  fastify.patch(
    "/admin/vehicles/:vehicleId",
    { schema: { params: idParams("vehicleId"), body: UPDATE_VEHICLE, response: { 200: VEHICLE, ...ERRORS } } },
    async (request, reply) => {
      const admin = request.requireRole("ADMIN");
      const { vehicleId } = request.params as { vehicleId: string };
      const body = request.body as VehicleEditable;

      const existing = await prisma.vehicle.findUnique({ where: { id: vehicleId } });
      if (!existing) return notFound(reply, "Vehicle");
      if (body.fuelType !== undefined && body.fuelType.trim() === "") return invalid(reply, "Name the fuel, for example diesel.");

      const fields: Record<string, unknown> = { ...body, fuelType: body.fuelType?.trim() };
      const before = vehicleSnapshot(existing) as Record<string, unknown>;
      const changed = changedKeys(before, fields);
      const trips = (await tripCounts()).get(vehicleId) ?? 0;
      if (changed.length === 0) return toAdminVehicle(existing, trips);

      const updated = await prisma.vehicle.update({
        where: { id: vehicleId },
        data: Object.fromEntries(changed.map((k) => [k, fields[k]])) as Prisma.VehicleUpdateInput,
      });
      const after = vehicleSnapshot(updated) as Record<string, unknown>;
      await recordDecision({
        actor: admin,
        action: "vehicle.update",
        entityType: "Vehicle",
        entityId: vehicleId,
        before: Object.fromEntries(changed.map((k) => [k, before[k]])) as Prisma.InputJsonValue,
        after: Object.fromEntries(changed.map((k) => [k, after[k]])) as Prisma.InputJsonValue,
      });
      return toAdminVehicle(updated, trips);
    },
  );
}
