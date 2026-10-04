import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CONTRACT_AJV } from "../lib/ajv.js";
import { requireRoleOf, type SessionUser } from "../lib/auth.js";
import { prisma } from "../lib/db.js";
import errorsPlugin from "../plugins/errors.js";
import adminRoutes from "../routes/admin.js";
import { changedKeys, scopeFor, windowProblem } from "../services/admin.js";

/**
 * The admin's records: who may touch them (only an admin), the rules each one
 * has to satisfy, what a write does to sessions, and the decision-log rows it
 * leaves. The role gate is the real `requireRoleOf`; Prisma is mocked at the
 * module boundary, so what is asserted is the writes and refusals.
 */

vi.mock("../lib/db.js", () => ({
  prisma: {
    user: { findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), groupBy: vi.fn() },
    session: { groupBy: vi.fn(), deleteMany: vi.fn() },
    depot: { findUnique: vi.fn(), findMany: vi.fn() },
    district: { findUnique: vi.fn(), findMany: vi.fn() },
    outlet: { findUnique: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn() },
    vehicle: { findUnique: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn() },
    trip: { groupBy: vi.fn() },
    auditEvent: { create: vi.fn(), findMany: vi.fn() },
  },
}));

const user = (role: SessionUser["role"], over: Partial<SessionUser> = {}): SessionUser => ({
  id: `USR-${role}`,
  email: `${role.toLowerCase()}@waypoint.lk`,
  name: role,
  role,
  depotCode: null,
  outletId: null,
  defaultVehicleId: null,
  ...over,
});

const admin = user("ADMIN");
const dispatcher = user("DISPATCHER", { depotCode: "Peliyagoda" });

function userRow(over: Record<string, unknown> = {}) {
  return {
    id: "USR9",
    email: "kamal@waypoint.lk",
    name: "Kamal Jayasuriya",
    role: "DRIVER",
    passwordHash: "$2b$10$hash",
    depotCode: "Kandy",
    outletId: null,
    defaultVehicleId: null,
    staffId: null,
    pinHash: null,
    active: true,
    createdAt: new Date("2026-10-04T03:00:00.000Z"),
    ...over,
  };
}

function outletRow(over: Record<string, unknown> = {}) {
  return {
    id: "OUT200",
    brand: "Fresh",
    districtName: "Kandy",
    depotCode: "Kandy",
    dockType: "street",
    parkingConstraint: "normal",
    mallWindowOpen: null,
    mallWindowClose: null,
    windowOpen: "05:30",
    windowClose: "09:00",
    displayName: null,
    lat: 7.29,
    lng: 80.63,
    geoSource: "SYNTHETIC",
    geoSnapped: false,
    geoUpdatedAt: null,
    geoUpdatedByUserId: null,
    ...over,
  };
}

function vehicleRow(over: Record<string, unknown> = {}) {
  return {
    id: "VEH120",
    type: "van",
    temp: "ambient",
    weightCapKg: 1500,
    volumeCapM3: 8,
    fuelType: "diesel",
    kmPerL: 11,
    weeklyFuelQuotaL: 200,
    depotCode: "Kandy",
    ...over,
  };
}

const NEW_VEHICLE = {
  id: "VEH120",
  type: "van",
  temp: "ambient",
  weightCapKg: 1500,
  volumeCapM3: 8,
  fuelType: "diesel",
  kmPerL: 11,
  weeklyFuelQuotaL: 200,
  depotCode: "Kandy",
};

describe("admin routes", () => {
  const servers: ReturnType<typeof Fastify>[] = [];

  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(prisma.session.groupBy).mockResolvedValue([] as never);
    vi.mocked(prisma.user.groupBy).mockResolvedValue([] as never);
    vi.mocked(prisma.trip.groupBy).mockResolvedValue([] as never);
    vi.mocked(prisma.depot.findUnique).mockResolvedValue({ code: "Kandy" } as never);
    vi.mocked(prisma.outlet.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.vehicle.findUnique).mockResolvedValue(null);
  });

  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => server.close()));
  });

  async function serverFor(who: SessionUser | null) {
    const server = Fastify({ logger: false, ajv: CONTRACT_AJV });
    servers.push(server);
    server.decorateRequest("requireRole", function (...roles: never[]) {
      return requireRoleOf(who, ...roles);
    });
    await server.register(errorsPlugin);
    await server.register(adminRoutes, { prefix: "/v1" });
    return server;
  }

  describe("who may", () => {
    it.each([
      ["GET", "/v1/admin/users"],
      ["GET", "/v1/admin/outlets"],
      ["GET", "/v1/admin/vehicles"],
      ["GET", "/v1/admin/overview"],
      ["GET", "/v1/admin/activity"],
      ["GET", "/v1/admin/directory"],
    ] as const)("refuses a dispatcher %s %s, and asks a stranger to sign in", async (method, url) => {
      expect((await (await serverFor(dispatcher)).inject({ method, url })).statusCode).toBe(403);
      expect((await (await serverFor(null)).inject({ method, url })).statusCode).toBe(401);
    });
  });

  describe("accounts", () => {
    const create = (body: Record<string, unknown>) =>
      serverFor(admin).then((s) => s.inject({ method: "POST", url: "/v1/admin/users", payload: body }));

    it("adds a driver at a depot, storing a hash and logging no password", async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValue(null);
      vi.mocked(prisma.user.create).mockImplementation((async ({ data }: { data: Record<string, unknown> }) => userRow(data)) as never);

      const response = await create({ email: "Kamal@Waypoint.LK", name: "Kamal Jayasuriya", role: "DRIVER", password: "drive1234", depotCode: "Kandy" });

      expect(response.statusCode).toBe(201);
      const data = vi.mocked(prisma.user.create).mock.calls[0]![0].data as Record<string, unknown>;
      expect(data).toMatchObject({ email: "kamal@waypoint.lk", role: "DRIVER", depotCode: "Kandy", outletId: null });
      expect(data.passwordHash).not.toBe("drive1234");
      expect(String(data.passwordHash)).toMatch(/^\$2/);
      expect(response.json()).not.toHaveProperty("passwordHash");
      const audit = vi.mocked(prisma.auditEvent.create).mock.calls[0]![0].data;
      expect(audit).toMatchObject({ action: "user.create", entityType: "User", actorRole: "ADMIN" });
      expect(JSON.stringify(audit)).not.toContain("drive1234");
      expect(JSON.stringify(audit)).not.toContain("passwordHash");
    });

    it("takes a staff ID and PIN as a pair, upper-cases the ID and stores only a hash of the PIN", async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValue(null);
      vi.mocked(prisma.user.create).mockImplementation((async ({ data }: { data: Record<string, unknown> }) => userRow(data)) as never);
      const base = { email: "kamal@waypoint.lk", name: "Kamal Jayasuriya", role: "DRIVER", password: "drive1234", depotCode: "Kandy" };

      expect((await create({ ...base, staffId: "drv-0310" })).json().error.message).toMatch(/together/);
      expect((await create({ ...base, pin: "1234" })).statusCode).toBe(422);
      expect((await create({ ...base, staffId: "drv-0310", pin: "12" })).json().error.code).toBe("REQUEST_DOES_NOT_MATCH_CONTRACT");
      expect(prisma.user.create).not.toHaveBeenCalled();

      const ok = await create({ ...base, staffId: "drv-0310", pin: "1234" });
      expect(ok.statusCode).toBe(201);
      const data = vi.mocked(prisma.user.create).mock.calls[0]![0].data as Record<string, unknown>;
      expect(data.staffId).toBe("DRV-0310");
      expect(data.pinHash).not.toBe("1234");
      expect(String(data.pinHash)).toMatch(/^\$2/);
      expect(ok.json()).not.toHaveProperty("pinHash");
      expect(JSON.stringify(vi.mocked(prisma.auditEvent.create).mock.calls[0]![0].data)).not.toContain("1234");
    });

    it("refuses a staff ID that already belongs to someone", async () => {
      vi.mocked(prisma.user.findUnique).mockImplementation((async ({ where }: { where: Record<string, string> }) =>
        where.staffId ? { id: "USR1" } : null) as never);
      const response = await create({ email: "kamal@waypoint.lk", name: "Kamal J", role: "DRIVER", password: "drive1234", depotCode: "Kandy", staffId: "DSP-0101", pin: "1234" });
      expect(response.statusCode).toBe(409);
      expect(response.json().error.code).toBe("STAFF_ID_TAKEN");
    });

    it("a PIN reset signs the account out and records only that it happened", async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValue(userRow({ staffId: "DRV-0310", pinHash: "$2b$10$old" }) as never);
      vi.mocked(prisma.user.update).mockResolvedValue(userRow({ staffId: "DRV-0310" }) as never);
      const server = await serverFor(admin);

      await server.inject({ method: "PATCH", url: "/v1/admin/users/USR9", payload: { pin: "9876" } });

      expect(prisma.session.deleteMany).toHaveBeenCalled();
      const data = vi.mocked(prisma.user.update).mock.calls[0]![0].data as Record<string, unknown>;
      expect(String(data.pinHash)).toMatch(/^\$2/);
      const audit = vi.mocked(prisma.auditEvent.create).mock.calls[0]![0].data;
      expect(audit.note).toBe("PIN reset by an admin.");
      expect(JSON.stringify(audit)).not.toContain("9876");
    });

    it("will not give an account a staff ID without a PIN, or a PIN without a staff ID", async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValue(userRow() as never);
      const server = await serverFor(admin);

      expect((await server.inject({ method: "PATCH", url: "/v1/admin/users/USR9", payload: { staffId: "DRV-0310" } })).statusCode).toBe(422);
      expect((await server.inject({ method: "PATCH", url: "/v1/admin/users/USR9", payload: { pin: "9876" } })).statusCode).toBe(422);
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it("binds each role to exactly the scope it works in", async () => {
      expect((await create({ email: "a@waypoint.lk", name: "Aa", role: "LOADER", password: "loader123" })).json().error.message).toMatch(/needs a depot/);
      expect((await create({ email: "a@waypoint.lk", name: "Aa", role: "STORE_MANAGER", password: "store1234" })).json().error.message).toMatch(/needs an outlet/);
      expect(prisma.user.create).not.toHaveBeenCalled();
    });

    it("refuses an outlet that does not exist", async () => {
      const response = await create({ email: "a@waypoint.lk", name: "Aa", role: "STORE_MANAGER", password: "store1234", outletId: "OUT999" });
      expect(response.statusCode).toBe(422);
      expect(response.json().error.message).toMatch(/no outlet OUT999/);
    });

    it("refuses a taken email, even a disabled account's", async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValue({ id: "USR1" } as never);
      const response = await create({ email: "nimal@waypoint.lk", name: "Nn", role: "ADMIN", password: "admin1234" });
      expect(response.statusCode).toBe(409);
      expect(response.json().error.code).toBe("EMAIL_TAKEN");
    });

    it("refuses a short password and an email change as contract violations", async () => {
      const short = await create({ email: "a@waypoint.lk", name: "Aa", role: "ADMIN", password: "short" });
      expect(short.json().error.code).toBe("REQUEST_DOES_NOT_MATCH_CONTRACT");
      const server = await serverFor(admin);
      const response = await server.inject({ method: "PATCH", url: "/v1/admin/users/USR9", payload: { email: "x@waypoint.lk" } });
      expect(response.json().error.code).toBe("REQUEST_DOES_NOT_MATCH_CONTRACT");
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it("disabling an account signs it out everywhere and is logged as such", async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValue(userRow() as never);
      vi.mocked(prisma.user.update).mockResolvedValue(userRow({ active: false }) as never);
      const server = await serverFor(admin);

      const response = await server.inject({ method: "PATCH", url: "/v1/admin/users/USR9", payload: { active: false } });

      expect(response.statusCode).toBe(200);
      expect(response.json().active).toBe(false);
      expect(prisma.session.deleteMany).toHaveBeenCalledWith({ where: { userId: "USR9" } });
      expect(vi.mocked(prisma.auditEvent.create).mock.calls[0]![0].data).toMatchObject({
        action: "user.disable",
        before: { active: true },
        after: { active: false },
      });
    });

    it("a password reset signs the account out and records only that it happened", async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValue(userRow() as never);
      vi.mocked(prisma.user.update).mockResolvedValue(userRow() as never);
      const server = await serverFor(admin);

      await server.inject({ method: "PATCH", url: "/v1/admin/users/USR9", payload: { password: "newpass99" } });

      expect(prisma.session.deleteMany).toHaveBeenCalled();
      const audit = vi.mocked(prisma.auditEvent.create).mock.calls[0]![0].data;
      expect(audit.note).toBe("Password reset by an admin.");
      expect(JSON.stringify(audit)).not.toContain("newpass99");
    });

    it("moving a driver to a store drops the depot and the claimed vehicle", async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValue(userRow({ defaultVehicleId: "VEH101" }) as never);
      vi.mocked(prisma.outlet.findUnique).mockResolvedValue({ id: "OUT074" } as never);
      vi.mocked(prisma.user.update).mockResolvedValue(userRow({ role: "STORE_MANAGER", depotCode: null, outletId: "OUT074" }) as never);
      const server = await serverFor(admin);

      await server.inject({ method: "PATCH", url: "/v1/admin/users/USR9", payload: { role: "STORE_MANAGER", outletId: "OUT074" } });

      expect(vi.mocked(prisma.user.update).mock.calls[0]![0].data).toMatchObject({
        role: "STORE_MANAGER",
        depotCode: null,
        outletId: "OUT074",
        defaultVehicleId: null,
      });
      expect(prisma.session.deleteMany).toHaveBeenCalled();
    });

    it("will not let an admin lock themselves out", async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValue(userRow({ id: admin.id, role: "ADMIN", depotCode: null }) as never);
      const server = await serverFor(admin);

      const disable = await server.inject({ method: "PATCH", url: `/v1/admin/users/${admin.id}`, payload: { active: false } });
      const demote = await server.inject({ method: "PATCH", url: `/v1/admin/users/${admin.id}`, payload: { role: "DRIVER", depotCode: "Kandy" } });

      expect(disable.statusCode).toBe(422);
      expect(demote.statusCode).toBe(422);
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it("an unchanged save writes nothing and logs nothing", async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValue(userRow() as never);
      const server = await serverFor(admin);

      const response = await server.inject({ method: "PATCH", url: "/v1/admin/users/USR9", payload: { name: "Kamal Jayasuriya" } });

      expect(response.statusCode).toBe(200);
      expect(prisma.user.update).not.toHaveBeenCalled();
      expect(prisma.auditEvent.create).not.toHaveBeenCalled();
    });
  });

  describe("outlets", () => {
    const body = {
      id: "OUT200",
      brand: "Fresh",
      districtName: "Kandy",
      dockType: "street",
      parkingConstraint: "normal",
      windowOpen: "05:30",
      windowClose: "09:00",
    };

    it("takes the depot from the district and places the outlet near its centre, marked approximate", async () => {
      vi.mocked(prisma.district.findUnique).mockResolvedValue({ name: "Kandy", depotCode: "Kandy", roadClass: "hill" } as never);
      vi.mocked(prisma.outlet.create).mockImplementation((async ({ data }: { data: Record<string, unknown> }) => outletRow(data)) as never);
      const server = await serverFor(admin);

      const response = await server.inject({ method: "POST", url: "/v1/admin/outlets", payload: body });

      expect(response.statusCode).toBe(201);
      const data = vi.mocked(prisma.outlet.create).mock.calls[0]![0].data as Record<string, unknown>;
      expect(data).toMatchObject({ depotCode: "Kandy", geoSource: "SYNTHETIC" });
      expect(typeof data.lat).toBe("number");
      expect(response.json().managers).toBe(0);
    });

    it("refuses an unknown district, a taken id, and a depot chosen by hand", async () => {
      const server = await serverFor(admin);
      vi.mocked(prisma.district.findUnique).mockResolvedValue(null);
      expect((await server.inject({ method: "POST", url: "/v1/admin/outlets", payload: body })).statusCode).toBe(422);

      vi.mocked(prisma.district.findUnique).mockResolvedValue({ name: "Kandy", depotCode: "Kandy", roadClass: "hill" } as never);
      vi.mocked(prisma.outlet.findUnique).mockResolvedValue({ id: "OUT200" } as never);
      const taken = await server.inject({ method: "POST", url: "/v1/admin/outlets", payload: body });
      expect(taken.statusCode).toBe(409);
      expect(taken.json().error.code).toBe("OUTLET_TAKEN");

      const depot = await server.inject({ method: "POST", url: "/v1/admin/outlets", payload: { ...body, depotCode: "Peliyagoda" } });
      expect(depot.json().error.code).toBe("REQUEST_DOES_NOT_MATCH_CONTRACT");
    });

    it("checks a change against the windows it leaves behind", async () => {
      vi.mocked(prisma.outlet.findUnique).mockResolvedValue(outletRow() as never);
      const server = await serverFor(admin);

      const response = await server.inject({ method: "PATCH", url: "/v1/admin/outlets/OUT200", payload: { windowClose: "05:00" } });

      expect(response.statusCode).toBe(422);
      expect(prisma.outlet.update).not.toHaveBeenCalled();
    });

    it("refuses moving an outlet to another district", async () => {
      const server = await serverFor(admin);
      const response = await server.inject({ method: "PATCH", url: "/v1/admin/outlets/OUT200", payload: { districtName: "Colombo" } });
      expect(response.json().error.code).toBe("REQUEST_DOES_NOT_MATCH_CONTRACT");
    });
  });

  describe("vehicles", () => {
    it("adds a vehicle to a depot and logs it", async () => {
      vi.mocked(prisma.vehicle.create).mockResolvedValue(vehicleRow() as never);
      const server = await serverFor(admin);

      const response = await server.inject({ method: "POST", url: "/v1/admin/vehicles", payload: NEW_VEHICLE });

      expect(response.statusCode).toBe(201);
      expect(response.json()).toMatchObject({ id: "VEH120", depotCode: "Kandy", trips: 0 });
      expect(vi.mocked(prisma.auditEvent.create).mock.calls[0]![0].data).toMatchObject({ action: "vehicle.create", entityId: "VEH120" });
    });

    it("refuses an unknown depot and a taken id", async () => {
      const server = await serverFor(admin);
      vi.mocked(prisma.depot.findUnique).mockResolvedValue(null);
      expect((await server.inject({ method: "POST", url: "/v1/admin/vehicles", payload: NEW_VEHICLE })).statusCode).toBe(422);

      vi.mocked(prisma.depot.findUnique).mockResolvedValue({ code: "Kandy" } as never);
      vi.mocked(prisma.vehicle.findUnique).mockResolvedValue({ id: "VEH120" } as never);
      expect((await server.inject({ method: "POST", url: "/v1/admin/vehicles", payload: NEW_VEHICLE })).json().error.code).toBe("VEHICLE_TAKEN");
    });

    it("logs only the figures that changed", async () => {
      vi.mocked(prisma.vehicle.findUnique).mockResolvedValue(vehicleRow() as never);
      vi.mocked(prisma.vehicle.update).mockResolvedValue(vehicleRow({ weightCapKg: 1600 }) as never);
      const server = await serverFor(admin);

      await server.inject({ method: "PATCH", url: "/v1/admin/vehicles/VEH120", payload: { weightCapKg: 1600, kmPerL: 11 } });

      expect(vi.mocked(prisma.vehicle.update).mock.calls[0]![0].data).toEqual({ weightCapKg: 1600 });
      expect(vi.mocked(prisma.auditEvent.create).mock.calls[0]![0].data).toMatchObject({
        before: { weightCapKg: 1500 },
        after: { weightCapKg: 1600 },
      });
    });

    it("refuses moving a vehicle to another depot", async () => {
      const server = await serverFor(admin);
      const response = await server.inject({ method: "PATCH", url: "/v1/admin/vehicles/VEH120", payload: { depotCode: "Peliyagoda" } });
      expect(response.json().error.code).toBe("REQUEST_DOES_NOT_MATCH_CONTRACT");
    });
  });

  describe("activity", () => {
    it("bounds the page size", async () => {
      const server = await serverFor(admin);
      expect((await server.inject({ method: "GET", url: "/v1/admin/activity?limit=500" })).statusCode).toBe(422);
      expect((await server.inject({ method: "GET", url: "/v1/admin/activity?limit=0" })).statusCode).toBe(422);
    });
  });
});

describe("admin rules", () => {
  it("scopes each role", () => {
    expect(scopeFor("DRIVER", "Kandy", "OUT074")).toEqual({ depotCode: "Kandy", outletId: null });
    expect(scopeFor("STORE_MANAGER", "Kandy", "OUT074")).toEqual({ depotCode: null, outletId: "OUT074" });
    expect(scopeFor("ADMIN", "Kandy", "OUT074")).toEqual({ depotCode: null, outletId: null });
    expect(scopeFor("DISPATCHER", null, null)).toHaveProperty("error");
  });

  it("checks receiving windows the way the planner reads them", () => {
    const base = { dockType: "street" as const, windowOpen: "05:00", windowClose: "08:30", mallWindowOpen: null, mallWindowClose: null };
    expect(windowProblem(base)).toBeNull();
    expect(windowProblem({ ...base, windowClose: "05:00" })).toMatch(/open before it closes/);
    expect(windowProblem({ ...base, mallWindowOpen: "09:00" })).toMatch(/both/);
    expect(windowProblem({ ...base, mallWindowOpen: "10:00", mallWindowClose: "09:00" })).toMatch(/mall window/);
    expect(windowProblem({ ...base, dockType: "mall_bay" })).toMatch(/mall bay/);
  });

  it("finds only real changes", () => {
    expect(changedKeys({ a: 1, b: 2 }, { a: 1, b: 3, c: undefined })).toEqual(["b"]);
  });
});
