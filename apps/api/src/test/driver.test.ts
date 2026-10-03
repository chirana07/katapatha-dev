import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionUser } from "../lib/auth.js";
import { prisma } from "../lib/db.js";
import errorsPlugin from "../plugins/errors.js";
import driverRoutes from "../routes/driver.js";
import { loadRun } from "../services/delivery.js";

/**
 * Claiming a vehicle, releasing it, and reading the day's run.
 *
 * The claim is persisted on the user row rather than held in the session, so a
 * driver who reinstalls the app resumes against the same run. These tests pin
 * the two things that depends on: the claim is validated against the driver's
 * own depot, and the run is loaded for the claimed vehicle and the asked-for
 * date.
 */

vi.mock("../lib/db.js", () => ({
  prisma: {
    vehicle: { findFirst: vi.fn() },
    user: { update: vi.fn() },
  },
}));

vi.mock("../services/delivery.js", () => ({ loadRun: vi.fn() }));

const loadRunMock = vi.mocked(loadRun);

const driver: SessionUser = {
  id: "USR012",
  email: "ruwan@waypoint.lk",
  name: "Ruwan Silva",
  role: "DRIVER",
  depotCode: "Peliyagoda",
  outletId: null,
  defaultVehicleId: "VEH043",
};

const outlet = {
  displayName: "Fresh Nugegoda",
  dockType: "rear_dock",
  parkingConstraint: "van_only",
  windowOpen: "06:00",
  windowClose: "11:00",
};

const runTrip = {
  id: "TRP001",
  tripNo: 1,
  wave: "PREDAWN" as const,
  stops: [
    {
      id: "STP001",
      seq: 1,
      outletId: "OUT074",
      outlet,
      status: "PENDING" as const,
      plannedArrivalAt: "04:40",
      orders: [{ order: { id: "ORD1", ref: "ORD-004312", units: 120 } }],
    },
  ],
};

describe("the driver's own routes", () => {
  const servers: ReturnType<typeof Fastify>[] = [];

  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(prisma.user.update).mockResolvedValue({} as never);
  });

  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => server.close()));
  });

  async function serverFor(user: SessionUser = driver) {
    const server = Fastify({ logger: false });
    servers.push(server);
    server.decorateRequest("requireRole", function () {
      return user;
    });
    await server.register(errorsPlugin);
    await server.register(driverRoutes, { prefix: "/v1" });
    return server;
  }

  describe("PUT /v1/drivers/me/vehicle", () => {
    const claim = {
      method: "PUT" as const,
      url: "/v1/drivers/me/vehicle",
      payload: { vehicleId: "VEH043" },
    };

    it("records the claim on the user row once the vehicle checks out", async () => {
      const server = await serverFor();
      vi.mocked(prisma.vehicle.findFirst).mockResolvedValue({ id: "VEH043" } as never);

      const response = await server.inject(claim);

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ vehicleId: "VEH043" });
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: "USR012" },
        data: { defaultVehicleId: "VEH043" },
      });
    });

    it("looks the vehicle up at the driver's depot, not globally", async () => {
      const server = await serverFor();
      vi.mocked(prisma.vehicle.findFirst).mockResolvedValue({ id: "VEH043" } as never);

      await server.inject(claim);

      expect(vi.mocked(prisma.vehicle.findFirst).mock.calls[0]![0]).toMatchObject({
        where: { id: "VEH043", depotCode: "Peliyagoda" },
      });
    });

    it("refuses a vehicle that is not at the driver's depot", async () => {
      const server = await serverFor();
      vi.mocked(prisma.vehicle.findFirst).mockResolvedValue(null as never);

      const response = await server.inject(claim);

      expect(response.statusCode).toBe(404);
      expect(response.json()).toEqual({
        error: { code: "VEHICLE_NOT_AT_DEPOT", message: "Vehicle not found at this depot." },
      });
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it("refuses an account with no depot before touching the database", async () => {
      const server = await serverFor({ ...driver, depotCode: null });

      const response = await server.inject(claim);

      expect(response.statusCode).toBe(403);
      expect(response.json()).toEqual({
        error: { code: "FORBIDDEN", message: "This account is not bound to a depot." },
      });
      expect(prisma.vehicle.findFirst).not.toHaveBeenCalled();
    });
  });

  describe("DELETE /v1/drivers/me/vehicle", () => {
    it("clears the claim and answers 204", async () => {
      const server = await serverFor();

      const response = await server.inject({
        method: "DELETE",
        url: "/v1/drivers/me/vehicle",
      });

      expect(response.statusCode).toBe(204);
      expect(response.body).toBe("");
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: "USR012" },
        data: { defaultVehicleId: null },
      });
    });
  });

  describe("GET /v1/drivers/me/run", () => {
    it("loads the run for the claimed vehicle on the asked-for date", async () => {
      const server = await serverFor();
      loadRunMock.mockResolvedValue([runTrip] as never);

      const response = await server.inject({
        method: "GET",
        url: "/v1/drivers/me/run?date=2026-04-09",
      });

      expect(response.statusCode).toBe(200);
      expect(loadRunMock).toHaveBeenCalledWith("VEH043", new Date("2026-04-09T00:00:00.000Z"));
      expect(response.json()).toEqual({
        date: "2026-04-09",
        vehicleId: "VEH043",
        trips: [
          {
            tripId: "TRP001",
            tripNo: 1,
            wave: "PREDAWN",
            stops: [
              {
                id: "STP001",
                seq: 1,
                outletId: "OUT074",
                outletName: "Fresh Nugegoda",
                status: "PENDING",
                plannedArrivalAt: "04:40",
                windowOpen: "06:00",
                windowClose: "11:00",
                accessNote: "Use the rear dock. Vans only — no truck access.",
                orders: [{ orderId: "ORD1", orderRef: "ORD-004312", expectedUnits: 120 }],
              },
            ],
          },
        ],
      });
    });

    it("refuses to guess a date", async () => {
      const server = await serverFor();

      const response = await server.inject({ method: "GET", url: "/v1/drivers/me/run" });

      expect(response.statusCode).toBe(403);
      expect(response.json()).toEqual({
        error: { code: "DATE_REQUIRED", message: "date=YYYY-MM-DD is required." },
      });
      expect(loadRunMock).not.toHaveBeenCalled();
    });

    it("tells an unclaimed driver to claim a vehicle first", async () => {
      const server = await serverFor({ ...driver, defaultVehicleId: null });

      const response = await server.inject({
        method: "GET",
        url: "/v1/drivers/me/run?date=2026-04-09",
      });

      expect(response.statusCode).toBe(403);
      expect(response.json().error.code).toBe("NO_VEHICLE_CLAIMED");
      expect(loadRunMock).not.toHaveBeenCalled();
    });
  });
});
