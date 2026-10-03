import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CONTRACT_AJV } from "../lib/ajv.js";
import { AuthError, type SessionUser } from "../lib/auth.js";
import { requireDispatcherVehicle } from "../lib/authorization.js";
import { prisma } from "../lib/db.js";
import errorsPlugin from "../plugins/errors.js";
import vehicleRoutes from "../routes/vehicles.js";
import {
  deriveVehicleState,
  mapStateOf,
  nextStopOf,
  pickMapTrip,
  pickPingTrip,
  summariseFleet,
  tripFill,
  utilisationPct,
} from "../services/vehicles.js";

/**
 * The dispatcher's fleet views.
 *
 * The rules (status, utilisation, map state) are pure functions and tested
 * directly; the routes are tested for scoping and for the shape a screen
 * depends on, with the database mocked at the module boundary.
 */

vi.mock("../lib/db.js", () => ({
  prisma: {
    vehicle: { findMany: vi.fn() },
    vehicleDayStatus: { findMany: vi.fn(), findUnique: vi.fn() },
    trip: { findMany: vi.fn() },
    user: { findMany: vi.fn() },
    chillerReading: { findFirst: vi.fn() },
    vehiclePing: { findMany: vi.fn() },
  },
}));

vi.mock("../lib/authorization.js", () => ({
  requireDispatcherVehicle: vi.fn(),
}));

const requireVehicleMock = vi.mocked(requireDispatcherVehicle);

describe("deriveVehicleState", () => {
  it.each([
    ["AVAILABLE", [], "AVAILABLE"],
    ["AVAILABLE", ["PLANNED"], "AVAILABLE"],
    ["AVAILABLE", ["LOADING"], "LOADING"],
    ["AVAILABLE", ["READY"], "LOADING"],
    ["AVAILABLE", ["DEPARTED"], "ON_ROUTE"],
    ["AVAILABLE", ["COMPLETED"], "RETURNED"],
    ["AVAILABLE", ["COMPLETED", "COMPLETED"], "RETURNED"],
    // Back from trip 1 with trip 2 still to load: free again, not finished.
    ["AVAILABLE", ["COMPLETED", "PLANNED"], "AVAILABLE"],
    ["AVAILABLE", ["COMPLETED", "LOADING"], "LOADING"],
    ["AVAILABLE", ["COMPLETED", "DEPARTED"], "ON_ROUTE"],
    // Cancelled trips carry nothing and are ignored.
    ["AVAILABLE", ["CANCELLED"], "AVAILABLE"],
    ["AVAILABLE", ["CANCELLED", "COMPLETED"], "RETURNED"],
    ["IN_WORKSHOP", [], "IN_WORKSHOP"],
    ["IN_WORKSHOP", ["PLANNED"], "IN_WORKSHOP"],
    ["IN_WORKSHOP", ["LOADING"], "IN_WORKSHOP"],
    ["IN_WORKSHOP", ["COMPLETED"], "IN_WORKSHOP"],
    // A vehicle that is actually on the road is on the road, whatever the flag says.
    ["IN_WORKSHOP", ["DEPARTED"], "ON_ROUTE"],
  ] as const)("%s with trips %j is %s", (dayStatus, trips, expected) => {
    expect(deriveVehicleState(dayStatus, [...trips])).toBe(expected);
  });
});

describe("utilisation", () => {
  const caps = { volumeCapM3: 20, weightCapKg: 6000 };

  it("takes whichever of volume and weight binds first", () => {
    expect(tripFill({ sumVolumeM3: 10, sumWeightKg: 1500 }, caps)).toBeCloseTo(0.5);
    expect(tripFill({ sumVolumeM3: 5, sumWeightKg: 4500 }, caps)).toBeCloseTo(0.75);
  });

  it("is zero with no trips", () => {
    expect(utilisationPct([], caps)).toBe(0);
  });

  it("is the mean of the trips, not the peak", () => {
    // 100% and 50% -> 75%, not 100%.
    expect(
      utilisationPct(
        [
          { sumVolumeM3: 20, sumWeightKg: 0 },
          { sumVolumeM3: 0, sumWeightKg: 3000 },
        ],
        caps,
      ),
    ).toBe(75);
  });

  it("rounds to a whole percentage", () => {
    expect(utilisationPct([{ sumVolumeM3: 12.3, sumWeightKg: 0 }], { volumeCapM3: 15, weightCapKg: 4800 })).toBe(82);
  });

  it("never draws past 100", () => {
    expect(utilisationPct([{ sumVolumeM3: 25, sumWeightKg: 0 }], caps)).toBe(100);
  });

  it("does not divide by a zero capacity", () => {
    expect(utilisationPct([{ sumVolumeM3: 5, sumWeightKg: 100 }], { volumeCapM3: 0, weightCapKg: 0 })).toBe(0);
  });
});

describe("summariseFleet", () => {
  it("counts every vehicle exactly once across the status buckets", () => {
    const summary = summariseFleet([
      { temp: "reefer", status: "ON_ROUTE" },
      { temp: "ambient", status: "ON_ROUTE" },
      { temp: "ambient", status: "LOADING" },
      { temp: "ambient", status: "RETURNED" },
      { temp: "ambient", status: "AVAILABLE" },
      { temp: "reefer", status: "IN_WORKSHOP" },
    ]);
    expect(summary).toEqual({
      total: 6,
      refrigerated: 2,
      ambient: 4,
      available: 5, // everything that can run today: all but the workshop
      idle: 1,
      onRoute: 2,
      loading: 1,
      returned: 1,
      inWorkshop: 1,
    });
    expect(summary.idle + summary.onRoute + summary.loading + summary.returned + summary.inWorkshop).toBe(summary.total);
  });
});

describe("mapStateOf precedence: LAMP > LATE > RETURNING > ON_TIME", () => {
  const fresh = { lamp: false };
  const stale = { lamp: true };
  const pending = ["DONE", "PENDING"] as const;
  const allDone = ["DONE", "DONE"] as const;

  const state = (over: Partial<Parameters<typeof mapStateOf>[0]>) =>
    mapStateOf({
      tripStatus: "DEPARTED",
      stopStatuses: [...pending],
      lateMinutes: 0,
      position: fresh,
      ...over,
    });

  it("is ON_TIME for a fresh report with nothing behind", () => {
    expect(state({})).toBe("ON_TIME");
  });

  it("is LATE from five minutes behind, not four", () => {
    expect(state({ lateMinutes: 4 })).toBe("ON_TIME");
    expect(state({ lateMinutes: 5 })).toBe("LATE");
  });

  it("is RETURNING once no stop is left, counting skipped and failed stops as finished", () => {
    expect(state({ stopStatuses: [...allDone] })).toBe("RETURNING");
    expect(state({ stopStatuses: ["DONE", "FAILED", "SKIPPED"] })).toBe("RETURNING");
    expect(state({ stopStatuses: ["DONE", "ARRIVED"] })).toBe("ON_TIME");
  });

  it("is LAMP when the last report is stale", () => {
    expect(state({ position: stale })).toBe("LAMP");
  });

  it("is LAMP when a departed vehicle has never reported", () => {
    expect(state({ position: null })).toBe("LAMP");
  });

  it("puts LAMP above LATE, and LATE above RETURNING", () => {
    expect(state({ position: stale, lateMinutes: 30 })).toBe("LAMP");
    expect(state({ position: stale, stopStatuses: [...allDone] })).toBe("LAMP");
    expect(state({ lateMinutes: 30, stopStatuses: [...allDone] })).toBe("LATE");
  });

  it("is NOT_STARTED for a trip still at the dock, with or without a report", () => {
    expect(state({ tripStatus: "LOADING", position: null })).toBe("NOT_STARTED");
    expect(state({ tripStatus: "READY", position: stale, lateMinutes: 40 })).toBe("NOT_STARTED");
  });
});

describe("trip selection", () => {
  it("shows the departed trip over a waiting one, and a sealed one over one still loading", () => {
    expect(pickMapTrip([{ status: "LOADING", tripNo: 1 }, { status: "DEPARTED", tripNo: 2 }])?.tripNo).toBe(2);
    expect(pickMapTrip([{ status: "LOADING", tripNo: 1 }, { status: "READY", tripNo: 2 }])?.tripNo).toBe(2);
  });

  it("does not put completed or planned trips on the map", () => {
    expect(pickMapTrip([{ status: "COMPLETED", tripNo: 1 }, { status: "PLANNED", tripNo: 2 }])).toBeNull();
  });

  it("files a ping against the departed, then the ready, then the loading trip", () => {
    const day = "2026-04-09";
    expect(
      pickPingTrip([
        { status: "LOADING", planDate: day },
        { status: "READY", planDate: day },
      ])?.status,
    ).toBe("READY");
    expect(
      pickPingTrip([
        { status: "READY", planDate: day },
        { status: "DEPARTED", planDate: day },
      ])?.status,
    ).toBe("DEPARTED");
    expect(pickPingTrip([])).toBeNull();
  });

  it("ignores a trip left departed by an earlier day when today has a live one", () => {
    const picked = pickPingTrip([
      { status: "DEPARTED", planDate: "2026-04-08" },
      { status: "LOADING", planDate: "2026-04-09" },
    ]);
    expect(picked?.planDate).toBe("2026-04-09");
  });

  it("finds the next stop, including one the driver is standing at", () => {
    expect(
      nextStopOf([
        { seq: 1, status: "ARRIVED" },
        { seq: 0, status: "DONE" },
        { seq: 2, status: "PENDING" },
      ])?.seq,
    ).toBe(1);
    expect(nextStopOf([{ seq: 0, status: "DONE" }, { seq: 1, status: "SKIPPED" }])).toBeNull();
  });
});

const dispatcher: SessionUser = {
  id: "USR001",
  email: "nimal@waypoint.lk",
  name: "Nimal Perera",
  role: "DISPATCHER",
  depotCode: "Peliyagoda",
  outletId: null,
  defaultVehicleId: null,
};

const loader: SessionUser = { ...dispatcher, id: "USR002", role: "LOADER", name: "Ranjith Silva" };

const vehicleRow = (over: Record<string, unknown> = {}) => ({
  id: "VEH014",
  type: "truck",
  temp: "reefer",
  depotCode: "Peliyagoda",
  volumeCapM3: 15,
  weightCapKg: 4800,
  ...over,
});

describe("the vehicle routes", () => {
  const servers: ReturnType<typeof Fastify>[] = [];

  beforeEach(() => {
    vi.resetAllMocks();
    vi.useFakeTimers({ toFake: ["Date"] });
    // 06:50 in Colombo on the hero day.
    vi.setSystemTime(new Date("2026-04-09T01:20:00.000Z"));
    vi.mocked(prisma.user.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.vehiclePing.findMany).mockResolvedValue([] as never);
  });

  afterEach(async () => {
    vi.useRealTimers();
    await Promise.all(servers.splice(0).map((server) => server.close()));
  });

  async function serverFor(user: SessionUser) {
    const server = Fastify({ logger: false, ajv: CONTRACT_AJV });
    servers.push(server);
    server.decorateRequest("requireRole", function (...roles: string[]) {
      if (roles.length && !roles.includes(user.role)) throw new AuthError("Forbidden", 403);
      return user;
    });
    await server.register(errorsPlugin);
    await server.register(vehicleRoutes, { prefix: "/v1" });
    return server;
  }

  describe("GET /v1/vehicles", () => {
    function seedFleet() {
      vi.mocked(prisma.vehicle.findMany).mockResolvedValue([
        vehicleRow(),
        vehicleRow({ id: "VEH017", temp: "ambient", volumeCapM3: 18, weightCapKg: 5000 }),
        vehicleRow({ id: "VEH038" }),
        vehicleRow({ id: "VEH040", temp: "ambient", type: "van" }),
      ] as never);
      vi.mocked(prisma.vehicleDayStatus.findMany).mockResolvedValue([
        { vehicleId: "VEH038", status: "IN_WORKSHOP", note: "Compressor fault" },
      ] as never);
      vi.mocked(prisma.trip.findMany).mockResolvedValue([
        { vehicleId: "VEH014", status: "DEPARTED", sumVolumeM3: 12.3, sumWeightKg: 3000 },
        { vehicleId: "VEH014", status: "PLANNED", sumVolumeM3: 12.3, sumWeightKg: 3000 },
        { vehicleId: "VEH017", status: "LOADING", sumVolumeM3: 6.3, sumWeightKg: 500 },
      ] as never);
      vi.mocked(prisma.user.findMany).mockResolvedValue([
        { name: "Sunil Fernando", defaultVehicleId: "VEH014" },
      ] as never);
    }

    it("is the dispatcher's own depot only, for the day asked", async () => {
      seedFleet();
      const server = await serverFor(dispatcher);

      const response = await server.inject({ method: "GET", url: "/v1/vehicles?date=2026-04-09" });

      expect(response.statusCode).toBe(200);
      expect(vi.mocked(prisma.vehicle.findMany).mock.calls[0]![0]).toMatchObject({
        where: { depotCode: "Peliyagoda" },
      });
      const tripQuery = vi.mocked(prisma.trip.findMany).mock.calls[0]![0] as { where: Record<string, unknown> };
      // Only the published plan counts, for this depot and this day.
      expect(tripQuery.where).toMatchObject({
        plan: { status: "PUBLISHED", planningDay: { date: new Date("2026-04-09T00:00:00.000Z"), depotCode: "Peliyagoda" } },
      });
    });

    it("derives status, utilisation, driver and the summary", async () => {
      seedFleet();
      const server = await serverFor(dispatcher);

      const body = (await server.inject({ method: "GET", url: "/v1/vehicles?date=2026-04-09" })).json();

      expect(body.date).toBe("2026-04-09");
      expect(body.depotCode).toBe("Peliyagoda");
      expect(body.summary).toEqual({
        total: 4,
        refrigerated: 2,
        ambient: 2,
        available: 3,
        idle: 1,
        onRoute: 1,
        loading: 1,
        returned: 0,
        inWorkshop: 1,
      });
      const byId = Object.fromEntries(body.vehicles.map((v: { vehicleId: string }) => [v.vehicleId, v]));
      expect(byId.VEH014).toMatchObject({
        status: "ON_ROUTE",
        tripsToday: 2,
        driverName: "Sunil Fernando",
        utilisationPct: 82,
        depotCode: "Peliyagoda",
      });
      expect(byId.VEH017).toMatchObject({ status: "LOADING", tripsToday: 1, utilisationPct: 35, driverName: null });
      expect(byId.VEH038).toMatchObject({ status: "IN_WORKSHOP", tripsToday: 0, utilisationPct: 0, note: "Compressor fault" });
      expect(byId.VEH040).toMatchObject({ status: "AVAILABLE", note: null });
    });

    it("carries nothing the system cannot back", async () => {
      seedFleet();
      const server = await serverFor(dispatcher);
      const body = (await server.inject({ method: "GET", url: "/v1/vehicles?date=2026-04-09" })).json();
      expect(Object.keys(body.vehicles[0]).sort()).toEqual(
        [
          "depotCode",
          "driverName",
          "note",
          "status",
          "temp",
          "tripsToday",
          "type",
          "utilisationPct",
          "vehicleId",
          "volumeCapM3",
          "weightCapKg",
        ].sort(),
      );
    });

    it("defaults to today in Colombo", async () => {
      seedFleet();
      const server = await serverFor(dispatcher);
      // 01:20Z is already 06:50 on the 9th in Colombo; push to 20:00Z, which is the 10th there.
      vi.setSystemTime(new Date("2026-04-09T20:00:00.000Z"));
      const body = (await server.inject({ method: "GET", url: "/v1/vehicles" })).json();
      expect(body.date).toBe("2026-04-10");
    });

    it("refuses other roles and undeclared query parameters", async () => {
      const server = await serverFor(loader);
      expect((await server.inject({ method: "GET", url: "/v1/vehicles" })).statusCode).toBe(403);
      const dispatcherServer = await serverFor(dispatcher);
      expect((await dispatcherServer.inject({ method: "GET", url: "/v1/vehicles?depot=Gampaha" })).statusCode).toBe(422);
    });
  });

  describe("GET /v1/vehicles/:vehicleId", () => {
    it("answers 403 for a vehicle at another depot, as for one that does not exist", async () => {
      requireVehicleMock.mockRejectedValue(new AuthError("You do not have access to this record", 403));
      const server = await serverFor(dispatcher);

      const response = await server.inject({ method: "GET", url: "/v1/vehicles/VEH002?date=2026-04-09" });

      expect(response.statusCode).toBe(403);
      expect(response.json().error.code).toBe("FORBIDDEN");
      expect(requireVehicleMock).toHaveBeenCalledWith(dispatcher, "VEH002");
      expect(prisma.trip.findMany).not.toHaveBeenCalled();
    });

    it("returns the day, the driver, the last chiller reading and the last reported position", async () => {
      requireVehicleMock.mockResolvedValue(vehicleRow() as never);
      vi.mocked(prisma.vehicleDayStatus.findUnique).mockResolvedValue(null as never);
      vi.mocked(prisma.trip.findMany).mockResolvedValue([
        {
          id: "TRP1",
          tripNo: 1,
          districtName: "Colombo",
          plannedDepartAt: "06:00",
          status: "DEPARTED",
          wave: "DAYTIME",
          sumVolumeM3: 12.3,
          sumWeightKg: 3420,
          stops: [{ _count: { orders: 2 } }, { _count: { orders: 1 } }, { _count: { orders: 3 } }],
        },
        {
          id: "TRP2",
          tripNo: 2,
          districtName: "Dehiwala",
          plannedDepartAt: "12:30",
          status: "PLANNED",
          wave: "DAYTIME",
          sumVolumeM3: 3,
          sumWeightKg: 400,
          stops: [{ _count: { orders: 1 } }],
        },
      ] as never);
      vi.mocked(prisma.user.findMany).mockResolvedValue([{ name: "Sunil Fernando", defaultVehicleId: "VEH014" }] as never);
      vi.mocked(prisma.chillerReading.findFirst).mockResolvedValue({
        tempC: 3.8,
        targetMinC: 2,
        targetMaxC: 5,
        source: "LOADER_AT_BAY",
        recordedByName: "Ranjith Silva",
        recordedAt: new Date("2026-04-09T00:20:00.000Z"),
      } as never);
      vi.mocked(prisma.vehiclePing.findMany).mockResolvedValue([
        {
          vehicleId: "VEH014",
          tripId: "TRP1",
          lat: 6.94,
          lng: 79.86,
          accuracyM: 18,
          recordedAt: new Date("2026-04-09T01:19:00.000Z"),
        },
      ] as never);
      const server = await serverFor(dispatcher);

      const response = await server.inject({ method: "GET", url: "/v1/vehicles/VEH014?date=2026-04-09" });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body).toMatchObject({
        vehicleId: "VEH014",
        status: "ON_ROUTE",
        driverName: "Sunil Fernando",
        tripsToday: 2,
      });
      expect(body.trips).toEqual([
        { tripId: "TRP1", tripNo: 1, route: "Peliyagoda → Colombo", plannedDepartAt: "06:00", stops: 3, orders: 6, status: "DEPARTED", wave: "DAYTIME" },
        { tripId: "TRP2", tripNo: 2, route: "Peliyagoda → Dehiwala", plannedDepartAt: "12:30", stops: 1, orders: 1, status: "PLANNED", wave: "DAYTIME" },
      ]);
      expect(body.chiller).toEqual({
        tempC: 3.8,
        targetMinC: 2,
        targetMaxC: 5,
        inRange: true,
        source: "LOADER_AT_BAY",
        recordedByName: "Ranjith Silva",
        recordedAt: "2026-04-09T00:20:00.000Z",
        ageSeconds: 3600,
      });
      expect(body.position).toEqual({
        lat: 6.94,
        lng: 79.86,
        accuracyM: 18,
        recordedAt: "2026-04-09T01:19:00.000Z",
        ageSeconds: 60,
        lamp: false,
      });
    });

    it("judges the reading against the band stored on it, not the current one", async () => {
      requireVehicleMock.mockResolvedValue(vehicleRow() as never);
      vi.mocked(prisma.vehicleDayStatus.findUnique).mockResolvedValue(null as never);
      vi.mocked(prisma.trip.findMany).mockResolvedValue([] as never);
      vi.mocked(prisma.chillerReading.findFirst).mockResolvedValue({
        tempC: 6,
        targetMinC: 4,
        targetMaxC: 8,
        source: "DRIVER_ON_ARRIVAL",
        recordedByName: null,
        recordedAt: new Date("2026-04-09T01:00:00.000Z"),
      } as never);
      const server = await serverFor(dispatcher);

      const body = (await server.inject({ method: "GET", url: "/v1/vehicles/VEH014?date=2026-04-09" })).json();

      expect(body.chiller.inRange).toBe(true);
      expect(body.position).toBeNull();
    });

    it("has no chiller for an ambient vehicle and never asks for one", async () => {
      requireVehicleMock.mockResolvedValue(vehicleRow({ id: "VEH040", temp: "ambient", type: "van" }) as never);
      vi.mocked(prisma.vehicleDayStatus.findUnique).mockResolvedValue(null as never);
      vi.mocked(prisma.trip.findMany).mockResolvedValue([] as never);
      const server = await serverFor(dispatcher);

      const body = (await server.inject({ method: "GET", url: "/v1/vehicles/VEH040?date=2026-04-09" })).json();

      expect(body.chiller).toBeNull();
      expect(body.status).toBe("AVAILABLE");
      expect(prisma.chillerReading.findFirst).not.toHaveBeenCalled();
    });
  });

  describe("GET /v1/fleet/positions", () => {
    const outlet = (id: string, name: string | null) => ({
      id,
      displayName: name,
      windowOpen: "05:30",
      windowClose: "08:00",
    });
    // 06:00 Colombo is 00:30Z.
    const stop = (seq: number, status: string, planned: string, arrivedAtZ: string | null, outletId = `OUT${seq}`) => ({
      seq,
      outletId,
      status,
      plannedArrivalAt: planned,
      arrivedAt: arrivedAtZ ? new Date(`2026-04-09T${arrivedAtZ}:00.000Z`) : null,
      outlet: outlet(outletId, outletId === "OUT074" ? "Fresh Puttalam" : null),
    });
    const trip = (vehicleId: string, status: string, stops: ReturnType<typeof stop>[], tripNo = 1) => ({
      id: `TRP-${vehicleId}`,
      vehicleId,
      tripNo,
      status,
      districtName: "Puttalam",
      stops,
    });
    const ping = (vehicleId: string, recordedAtZ: string) => ({
      vehicleId,
      tripId: `TRP-${vehicleId}`,
      lat: 7.6,
      lng: 79.8,
      accuracyM: null,
      recordedAt: new Date(`2026-04-09T${recordedAtZ}:00.000Z`),
    });

    function seedMap() {
      vi.mocked(prisma.trip.findMany).mockResolvedValue([
        // On time: first stop done on plan, next planned 07:21.
        trip("VEH025", "DEPARTED", [stop(0, "DONE", "06:00", "00:30"), stop(1, "PENDING", "07:21", null, "OUT074")]),
        // Late: arrived at stop 1 at 06:42 against 06:30 -> 12 minutes.
        trip("VEH018", "DEPARTED", [stop(0, "DONE", "06:30", "01:12"), stop(1, "PENDING", "07:36", null)]),
        // Stale report, though late too: LAMP wins.
        trip("VEH043", "DEPARTED", [stop(0, "DONE", "06:00", "00:50"), stop(1, "PENDING", "07:05", null)]),
        // Departed and never reported.
        trip("VEH050", "DEPARTED", [stop(0, "PENDING", "07:00", null)]),
        // Nothing left to serve.
        trip("VEH011", "DEPARTED", [stop(0, "DONE", "06:00", "00:30"), stop(1, "DONE", "06:30", "01:00")]),
        // Still at the dock.
        trip("VEH028", "LOADING", [stop(0, "PENDING", "08:00", null)]),
      ] as never);
      vi.mocked(prisma.user.findMany).mockResolvedValue([
        { name: "K. Fernando", defaultVehicleId: "VEH025" },
        { name: "R. Dias", defaultVehicleId: "VEH018" },
      ] as never);
      vi.mocked(prisma.vehiclePing.findMany).mockResolvedValue([
        ping("VEH025", "01:19"),
        ping("VEH018", "01:19"),
        ping("VEH043", "01:06"), // 14 minutes old
        ping("VEH011", "01:16"),
      ] as never);
    }

    it("is the dispatcher's own depot, published plan, and only trips that are out or waiting", async () => {
      seedMap();
      const server = await serverFor(dispatcher);

      await server.inject({ method: "GET", url: "/v1/fleet/positions?date=2026-04-09" });

      expect(vi.mocked(prisma.trip.findMany).mock.calls[0]![0]).toMatchObject({
        where: {
          plan: { status: "PUBLISHED", planningDay: { depotCode: "Peliyagoda" } },
          status: { in: ["DEPARTED", "READY", "LOADING"] },
        },
      });
    });

    it("classifies each vehicle by the precedence rules", async () => {
      seedMap();
      const server = await serverFor(dispatcher);

      const body = (await server.inject({ method: "GET", url: "/v1/fleet/positions?date=2026-04-09" })).json();

      const state = Object.fromEntries(body.vehicles.map((v: { vehicleId: string; state: string }) => [v.vehicleId, v.state]));
      expect(state).toEqual({
        VEH011: "RETURNING",
        VEH018: "LATE",
        VEH025: "ON_TIME",
        VEH028: "NOT_STARTED",
        VEH043: "LAMP",
        VEH050: "LAMP",
      });
      expect(body.summary).toEqual({ all: 6, late: 1, lamp: 2 });
      expect(body.updatedAt).toBe("2026-04-09T01:20:00.000Z");
    });

    it("gives the next stop, with the arrival pushed back by the slip", async () => {
      seedMap();
      const server = await serverFor(dispatcher);

      const body = (await server.inject({ method: "GET", url: "/v1/fleet/positions?date=2026-04-09" })).json();
      const byId = Object.fromEntries(body.vehicles.map((v: { vehicleId: string }) => [v.vehicleId, v]));

      expect(byId.VEH025.nextStop).toEqual({
        outletId: "OUT074",
        outletName: "Fresh Puttalam",
        stopNumber: 2,
        totalStops: 2,
        deliveredStops: 1,
        eta: "07:21",
        windowOpen: "05:30",
        windowClose: "08:00",
      });
      expect(byId.VEH025.driverName).toBe("K. Fernando");
      expect(byId.VEH025.trip).toEqual({ tripId: "TRP-VEH025", tripNo: 1, districtName: "Puttalam" });
      expect(byId.VEH018).toMatchObject({ lateMinutes: 12, nextStop: { eta: "07:48", outletName: "OUT1" } });
      expect(byId.VEH011.nextStop).toBeNull();
      expect(byId.VEH011.lateMinutes).toBe(0);
    });

    it("keeps a stale vehicle's lateness but reports LAMP", async () => {
      seedMap();
      const server = await serverFor(dispatcher);
      const body = (await server.inject({ method: "GET", url: "/v1/fleet/positions?date=2026-04-09" })).json();
      const lamp = body.vehicles.find((v: { vehicleId: string }) => v.vehicleId === "VEH043");
      expect(lamp.state).toBe("LAMP");
      expect(lamp.lateMinutes).toBe(20);
      expect(lamp.position).toMatchObject({ ageSeconds: 14 * 60, lamp: true });
    });

    it("never invents a position for a vehicle that has not reported", async () => {
      seedMap();
      const server = await serverFor(dispatcher);
      const body = (await server.inject({ method: "GET", url: "/v1/fleet/positions?date=2026-04-09" })).json();
      const byId = Object.fromEntries(body.vehicles.map((v: { vehicleId: string }) => [v.vehicleId, v]));
      expect(byId.VEH050.position).toBeNull();
      expect(byId.VEH028.position).toBeNull();
      expect(byId.VEH025.position).toMatchObject({ ageSeconds: 60, lamp: false });
    });

    it("shows a vehicle once, on its departed trip, when trip 2 is also waiting", async () => {
      vi.mocked(prisma.trip.findMany).mockResolvedValue([
        trip("VEH025", "LOADING", [stop(0, "PENDING", "13:00", null)], 2),
        trip("VEH025", "DEPARTED", [stop(0, "PENDING", "07:00", null)], 1),
      ] as never);
      vi.mocked(prisma.vehiclePing.findMany).mockResolvedValue([ping("VEH025", "01:19")] as never);
      const server = await serverFor(dispatcher);

      const body = (await server.inject({ method: "GET", url: "/v1/fleet/positions?date=2026-04-09" })).json();

      expect(body.vehicles).toHaveLength(1);
      expect(body.vehicles[0].trip.tripNo).toBe(1);
    });

    it("is dispatcher only", async () => {
      const server = await serverFor(loader);
      expect((await server.inject({ method: "GET", url: "/v1/fleet/positions" })).statusCode).toBe(403);
      expect(prisma.trip.findMany).not.toHaveBeenCalled();
    });
  });
});
