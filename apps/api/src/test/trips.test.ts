import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionUser } from "../lib/auth.js";
import { requireLoaderTrip, requireOrderOnTrip } from "../lib/authorization.js";
import { prisma } from "../lib/db.js";
import errorsPlugin from "../plugins/errors.js";
import tripRoutes from "../routes/trips.js";

/**
 * The loader's dock surface.
 *
 * The routes talk to `lib/db` directly rather than through a decorator, so the
 * client is mocked at the module boundary. What is being tested is the gate
 * logic and the query shape — the two things a dock terminal depends on and the
 * two things a refactor can quietly break.
 */

vi.mock("../lib/db.js", () => ({
  prisma: {
    trip: { findMany: vi.fn(), findUnique: vi.fn(), updateMany: vi.fn() },
    loadCheck: { upsert: vi.fn(), findUnique: vi.fn() },
    loadProgress: { deleteMany: vi.fn(), upsert: vi.fn() },
    shortfall: { findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    chillerReading: { findMany: vi.fn() },
    auditEvent: { createMany: vi.fn() },
    $transaction: vi.fn(),
  },
}));

// The dock's extras (bays, units on board, swaps) have their own tests in
// dock.test.ts; here they are stubbed so the query-shape assertions below stay
// about the trip queries.
vi.mock("../services/dock.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../services/dock.js")>()),
  ensureBaysForDate: vi.fn(async () => undefined),
  loadedUnitsByTrip: vi.fn(async () => new Map()),
  latestSwaps: vi.fn(async () => new Map()),
}));

vi.mock("../lib/authorization.js", () => ({
  requireLoaderTrip: vi.fn(),
  requireOrderOnTrip: vi.fn(),
}));

const requireLoaderTripMock = vi.mocked(requireLoaderTrip);
const requireOrderOnTripMock = vi.mocked(requireOrderOnTrip);

const loader: SessionUser = {
  id: "USR007",
  email: "sunil@waypoint.lk",
  name: "Sunil Fernando",
  role: "LOADER",
  depotCode: "Peliyagoda",
  outletId: null,
  defaultVehicleId: null,
};

const trip = {
  id: "TRP001",
  vehicleId: "VEH043",
  tripNo: 1,
  brand: "Fresh" as const,
  districtName: "Colombo",
  wave: "PREDAWN" as const,
  status: "PLANNED" as const,
  plannedDepartAt: "04:00",
  plannedMinutes: 182.4,
  sumWeightKg: 2100,
  sumVolumeM3: 12.5,
};

describe("the loader's trip routes", () => {
  const servers: ReturnType<typeof Fastify>[] = [];

  beforeEach(() => {
    // Reset, not clear: a test that makes an authorization check reject must
    // not leave that implementation standing for the next one.
    vi.resetAllMocks();
    // Access is granted by default; the denial cases opt out explicitly.
    requireLoaderTripMock.mockResolvedValue({} as never);
    // Nothing holds a trip and nobody has read a gauge, unless a test says so.
    vi.mocked(prisma.shortfall.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.chillerReading.findMany).mockResolvedValue([] as never);
    // Every mutation runs inside one transaction. Handing the callback the same
    // mocked client keeps the assertions about `tx.*` calls readable.
    vi.mocked(prisma.$transaction).mockImplementation(
      ((fn: (tx: typeof prisma) => unknown) => fn(prisma)) as never,
    );
  });

  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => server.close()));
  });

  async function serverFor(user: SessionUser = loader) {
    const server = Fastify({ logger: false });
    servers.push(server);
    server.decorateRequest("requireRole", function () {
      return user;
    });
    await server.register(errorsPlugin);
    await server.register(tripRoutes, { prefix: "/v1" });
    return server;
  }

  describe("GET /v1/trips", () => {
    it("filters by date and status within the signed-in user's depot", async () => {
      const server = await serverFor();
      vi.mocked(prisma.trip.findMany).mockResolvedValue([trip] as never);

      const response = await server.inject({
        method: "GET",
        url: "/v1/trips?date=2026-04-09&status=READY",
      });

      expect(response.statusCode).toBe(200);
      expect(vi.mocked(prisma.trip.findMany).mock.calls[0]![0]).toMatchObject({
        where: {
          plan: {
            status: "PUBLISHED",
            planningDay: {
              depotCode: "Peliyagoda",
              date: new Date("2026-04-09T00:00:00.000Z"),
            },
          },
          status: "READY",
        },
      });
    });

    it("omits both filters when neither is given", async () => {
      const server = await serverFor();
      vi.mocked(prisma.trip.findMany).mockResolvedValue([] as never);

      await server.inject({ method: "GET", url: "/v1/trips" });

      const where = vi.mocked(prisma.trip.findMany).mock.calls[0]![0]!.where as {
        status?: unknown;
        plan: { planningDay: { date?: unknown } };
      };
      expect(where.status).toBeUndefined();
      expect(where.plan.planningDay.date).toBeUndefined();
    });

    it("rounds plannedMinutes, which the contract declares an integer", async () => {
      const server = await serverFor();
      vi.mocked(prisma.trip.findMany).mockResolvedValue([trip] as never);

      const response = await server.inject({ method: "GET", url: "/v1/trips" });

      expect(response.statusCode).toBe(200);
      expect(response.json()[0]).toMatchObject({ id: "TRP001", plannedMinutes: 182 });
    });

    it("marks a trip held by an open shortfall, and carries its latest chiller reading", async () => {
      const server = await serverFor();
      vi.mocked(prisma.trip.findMany).mockResolvedValue([trip, { ...trip, id: "TRP002" }] as never);
      vi.mocked(prisma.shortfall.findMany).mockResolvedValue([{ tripId: "TRP002" }] as never);
      vi.mocked(prisma.chillerReading.findMany).mockResolvedValue([
        {
          tripId: "TRP001", tempC: 6, targetMinC: 2, targetMaxC: 5, source: "LOADER_AT_BAY",
          recordedByName: "Ranjith Silva", recordedAt: new Date(Date.now() - 61 * 60_000),
        },
      ] as never);

      const response = await server.inject({ method: "GET", url: "/v1/trips?date=2026-04-09" });

      const [first, second] = response.json() as Array<{ blocked: boolean; chiller: Record<string, unknown> | null }>;
      expect(first!.blocked).toBe(false);
      expect(first!.chiller).toMatchObject({ tempC: 6, inRange: false, recordedByName: "Ranjith Silva" });
      expect(first!.chiller!.ageSeconds).toBeGreaterThanOrEqual(61 * 60);
      expect(second!.blocked).toBe(true);
      expect(second!.chiller).toBeNull();
      // Blocking means open AND blocking departure; a resolved one frees the vehicle.
      expect(vi.mocked(prisma.shortfall.findMany).mock.calls[0]![0]).toMatchObject({
        where: { status: "OPEN", blocksDeparture: true },
      });
    });

    it("returns nothing, and queries nothing, for an account with no depot", async () => {
      const server = await serverFor({ ...loader, depotCode: null });

      const response = await server.inject({ method: "GET", url: "/v1/trips" });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual([]);
      expect(prisma.trip.findMany).not.toHaveBeenCalled();
    });
  });

  describe("GET /v1/trips/:tripId", () => {
    it("returns one trip with its day and depot, once the depot check passes", async () => {
      const server = await serverFor();
      requireLoaderTripMock.mockResolvedValue({
        ...trip,
        plannedMinutes: 182.4,
        plan: { planningDay: { date: new Date("2026-04-09T00:00:00.000Z"), depotCode: "Peliyagoda" } },
      } as never);
      vi.mocked(prisma.shortfall.findMany).mockResolvedValue([{ tripId: "TRP001" }] as never);

      const response = await server.inject({ method: "GET", url: "/v1/trips/TRP001" });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        id: "TRP001", vehicleId: "VEH043", plannedMinutes: 182, blocked: true,
        date: "2026-04-09", depotCode: "Peliyagoda", chiller: null,
      });
    });

    it("answers 404, not 403, for a trip at another depot", async () => {
      const server = await serverFor();
      requireLoaderTripMock.mockRejectedValue(new Error("denied"));

      const response = await server.inject({ method: "GET", url: "/v1/trips/TRP999" });

      expect(response.statusCode).toBe(404);
    });
  });

  describe("GET /v1/trips/:tripId/load-list", () => {
    const loadListTrip = {
      id: "TRP001",
      status: "PLANNED" as const,
      stops: [
        { seq: 3, outletId: "OUT900", orders: [{ order: { id: "ORD3", ref: "ORD-3", units: 30 } }] },
        { seq: 2, outletId: "OUT200", orders: [{ order: { id: "ORD2", ref: "ORD-2", units: 20 } }] },
        { seq: 1, outletId: "OUT100", orders: [{ order: { id: "ORD1", ref: "ORD-1", units: 10 } }] },
      ],
      loadChecks: [{ orderId: "ORD2", loadedUnits: 18, condition: "SHORT" as const, checkedAt: new Date("2026-04-09T01:00:00Z"), itemCounts: null }],
      loadProgress: [] as Array<{ orderId: string; loadedUnits: number; itemCounts: unknown; updatedByName: string; updatedAt: Date }>,
      shortfalls: [] as Array<{
        id: string; orderId: string; status: "OPEN" | "RESOLVED"; blocksDeparture: boolean; resolution: string | null;
      }>,
    };

    it("returns the lines in reverse delivery order, because the dock loads back to front", async () => {
      const server = await serverFor();
      vi.mocked(prisma.trip.findUnique).mockResolvedValue(loadListTrip as never);

      const response = await server.inject({
        method: "GET",
        url: "/v1/trips/TRP001/load-list",
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().lines.map((line: { seq: number }) => line.seq)).toEqual([3, 2, 1]);
      // The order is the database's to give, not the route's to sort, so the
      // query has to ask for it.
      const select = vi.mocked(prisma.trip.findUnique).mock.calls[0]![0]!.select as {
        stops: { orderBy: unknown };
      };
      expect(select.stops.orderBy).toEqual({ seq: "desc" });
    });

    it("folds an existing check onto its line and leaves unchecked lines null", async () => {
      const server = await serverFor();
      vi.mocked(prisma.trip.findUnique).mockResolvedValue(loadListTrip as never);

      const response = await server.inject({
        method: "GET",
        url: "/v1/trips/TRP001/load-list",
      });

      const lines = response.json().lines as Array<Record<string, unknown>>;
      expect(lines[1]).toMatchObject({
        orderId: "ORD2",
        orderRef: "ORD-2",
        outletId: "OUT200",
        expectedUnits: 20,
        loadedUnits: 18,
        condition: "SHORT",
      });
      expect(lines[0]).toMatchObject({ orderId: "ORD3", loadedUnits: null, condition: null });
    });

    it("says what became of a line's shortfall, so a cleared line is not mistaken for a waiting one", async () => {
      const server = await serverFor();
      vi.mocked(prisma.trip.findUnique).mockResolvedValue({
        ...loadListTrip,
        shortfalls: [
          // Newest first: the open one on ORD3 is the current word on it, the
          // resolved one beneath it is history.
          { id: "SF3", orderId: "ORD3", status: "OPEN", blocksDeparture: true, resolution: null },
          { id: "SF2", orderId: "ORD2", status: "RESOLVED", blocksDeparture: false, resolution: "SEND_SHORT" },
          { id: "SF1", orderId: "ORD3", status: "RESOLVED", blocksDeparture: false, resolution: "HOLD_ORDER" },
        ],
      } as never);

      const response = await server.inject({ method: "GET", url: "/v1/trips/TRP001/load-list" });

      const lines = response.json().lines as Array<{ orderId: string; shortfall: unknown }>;
      expect(lines.find((l) => l.orderId === "ORD3")!.shortfall).toEqual({
        id: "SF3", status: "OPEN", blocksDeparture: true, resolution: null, hasPhoto: false,
      });
      expect(lines.find((l) => l.orderId === "ORD2")!.shortfall).toEqual({
        id: "SF2", status: "RESOLVED", blocksDeparture: false, resolution: "SEND_SHORT", hasPhoto: false,
      });
      expect(lines.find((l) => l.orderId === "ORD1")!.shortfall).toBeNull();
    });

    it("shows what each order contains, and the query asks for it", async () => {
      const server = await serverFor();
      vi.mocked(prisma.trip.findUnique).mockResolvedValue({
        ...loadListTrip,
        stops: [
          {
            seq: 2,
            outletId: "OUT200",
            orders: [
              {
                order: {
                  id: "ORD2",
                  ref: "ORD-2",
                  units: 20,
                  lines: [
                    { sku: "FC001", productName: "Fresh Milk 1 L (12 per crate)", unitLabel: "crate", quantity: 12 },
                    { sku: "FC002", productName: "Set Yoghurt 80 g (24 per tray)", unitLabel: "tray", quantity: 8 },
                  ],
                },
              },
            ],
          },
          // A legacy, units-only order: no lines, and still a valid line on the list.
          { seq: 1, outletId: "OUT100", orders: [{ order: { id: "ORD1", ref: "ORD-1", units: 10, lines: [] } }] },
        ],
      } as never);

      const response = await server.inject({ method: "GET", url: "/v1/trips/TRP001/load-list" });

      expect(response.statusCode).toBe(200);
      const lines = response.json().lines as Array<{ orderId: string; items: unknown; expectedUnits: number }>;
      expect(lines.find((l) => l.orderId === "ORD2")!.items).toEqual([
        { sku: "FC001", name: "Fresh Milk 1 L (12 per crate)", quantity: 12, unitLabel: "crate" },
        { sku: "FC002", name: "Set Yoghurt 80 g (24 per tray)", quantity: 8, unitLabel: "tray" },
      ]);
      // The load check still counts the order's units, not products.
      expect(lines.find((l) => l.orderId === "ORD2")!.expectedUnits).toBe(20);
      expect(lines.find((l) => l.orderId === "ORD1")!.items).toEqual([]);

      const select = vi.mocked(prisma.trip.findUnique).mock.calls[0]![0]!.select as {
        stops: { select: { orders: { select: { order: { select: { lines: unknown } } } } } };
      };
      expect(select.stops.select.orders.select.order.select.lines).toBeTruthy();
    });

    it("answers 404 for a trip outside the loader's depot", async () => {
      const server = await serverFor();
      requireLoaderTripMock.mockRejectedValue(new Error("denied"));

      const response = await server.inject({
        method: "GET",
        url: "/v1/trips/TRP999/load-list",
      });

      expect(response.statusCode).toBe(404);
      expect(response.json()).toEqual({
        error: { code: "NOT_FOUND", message: "Trip not found at this depot." },
      });
      expect(prisma.trip.findUnique).not.toHaveBeenCalled();
    });
  });

  describe("PUT /v1/trips/:tripId/load-checks/:orderId", () => {
    const order = { id: "ORD1", units: 40 };

    beforeEach(() => {
      requireOrderOnTripMock.mockResolvedValue(order as never);
      vi.mocked(prisma.shortfall.findFirst).mockResolvedValue(null as never);
      vi.mocked(prisma.trip.updateMany).mockResolvedValue({ count: 1 } as never);
    });

    function check(body: Record<string, unknown>) {
      return {
        method: "PUT" as const,
        url: "/v1/trips/TRP001/load-checks/ORD1",
        payload: body,
      };
    }

    it("upserts the line so a correction replaces the earlier one", async () => {
      const server = await serverFor();
      vi.mocked(prisma.loadCheck.upsert).mockResolvedValue({
        id: "LC1",
        loadedUnits: 40,
        condition: "OK",
      } as never);

      const response = await server.inject(
        check({ loadedUnits: 40, condition: "OK", checkedByName: "Sunil" }),
      );

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        tripId: "TRP001",
        orderId: "ORD1",
        expectedUnits: 40,
        loadedUnits: 40,
        condition: "OK",
        shortfallId: null,
      });
      expect(vi.mocked(prisma.loadCheck.upsert).mock.calls[0]![0]).toMatchObject({
        where: { tripId_orderId: { tripId: "TRP001", orderId: "ORD1" } },
        create: { expectedUnits: 40, loadedUnits: 40, condition: "OK", checkedByName: "Sunil" },
        update: { loadedUnits: 40, condition: "OK" },
      });
    });

    it("closes an open shortfall once the line comes back OK", async () => {
      const server = await serverFor();
      vi.mocked(prisma.loadCheck.upsert).mockResolvedValue({
        id: "LC1",
        loadedUnits: 40,
        condition: "OK",
      } as never);

      await server.inject(check({ loadedUnits: 40, condition: "OK", checkedByName: "Sunil" }));

      expect(vi.mocked(prisma.shortfall.updateMany).mock.calls[0]![0]).toMatchObject({
        where: { tripId: "TRP001", orderId: "ORD1", status: "OPEN" },
        data: { status: "RESOLVED", blocksDeparture: false },
      });
      expect(prisma.shortfall.create).not.toHaveBeenCalled();
    });

    it("opens a shortfall for the missing units when the condition is not OK", async () => {
      const server = await serverFor();
      vi.mocked(prisma.loadCheck.upsert).mockResolvedValue({
        id: "LC1",
        loadedUnits: 25,
        condition: "SHORT",
      } as never);
      vi.mocked(prisma.shortfall.create).mockResolvedValue({ id: "SF1" } as never);

      const response = await server.inject(
        check({
          loadedUnits: 25,
          condition: "SHORT",
          checkedByName: "Sunil",
          reasonCode: "MISSING",
        }),
      );

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ condition: "SHORT", shortfallId: "SF1" });
      expect(vi.mocked(prisma.shortfall.create).mock.calls[0]![0]).toMatchObject({
        data: {
          tripId: "TRP001",
          orderId: "ORD1",
          loadCheckId: "LC1",
          kind: "SHORT",
          missingUnits: 15,
          reasonCode: "MISSING",
        },
      });
    });

    it("updates the shortfall already open on the line rather than opening a second", async () => {
      const server = await serverFor();
      vi.mocked(prisma.loadCheck.upsert).mockResolvedValue({
        id: "LC1",
        loadedUnits: 0,
        condition: "MISSING",
      } as never);
      vi.mocked(prisma.shortfall.findFirst).mockResolvedValue({ id: "SF1" } as never);
      vi.mocked(prisma.shortfall.update).mockResolvedValue({ id: "SF1" } as never);

      const response = await server.inject(
        check({
          loadedUnits: 0,
          condition: "MISSING",
          checkedByName: "Sunil",
          reasonCode: "MISSING",
        }),
      );

      expect(response.json()).toMatchObject({ shortfallId: "SF1" });
      expect(prisma.shortfall.create).not.toHaveBeenCalled();
      expect(vi.mocked(prisma.shortfall.update).mock.calls[0]![0]).toMatchObject({
        where: { id: "SF1" },
        data: { kind: "MISSING", missingUnits: 40 },
      });
    });

    it("moves the trip to LOADING on the first check, and only from PLANNED", async () => {
      const server = await serverFor();
      vi.mocked(prisma.loadCheck.upsert).mockResolvedValue({
        id: "LC1",
        loadedUnits: 40,
        condition: "OK",
      } as never);

      await server.inject(check({ loadedUnits: 40, condition: "OK", checkedByName: "Sunil" }));

      expect(vi.mocked(prisma.trip.updateMany).mock.calls[0]![0]).toEqual({
        where: { id: "TRP001", status: "PLANNED" },
        data: { status: "LOADING" },
      });
    });

    it("refuses a non-OK condition that carries no reason code", async () => {
      const server = await serverFor();

      const response = await server.inject(
        check({ loadedUnits: 25, condition: "SHORT", checkedByName: "Sunil" }),
      );

      expect(response.statusCode).toBe(422);
      expect(response.json()).toEqual({
        error: {
          code: "REASON_REQUIRED",
          message: "A non-OK condition opens a shortfall and must carry a reason code.",
        },
      });
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it("answers 404 when the order is not on the trip", async () => {
      const server = await serverFor();
      requireOrderOnTripMock.mockRejectedValue(new Error("denied"));

      const response = await server.inject(
        check({ loadedUnits: 40, condition: "OK", checkedByName: "Sunil" }),
      );

      expect(response.statusCode).toBe(404);
      expect(response.json()).toEqual({
        error: { code: "NOT_FOUND", message: "Order not on this trip." },
      });
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });

  describe("POST /v1/trips/:tripId/readiness", () => {
    function readinessTrip(overrides: Record<string, unknown> = {}) {
      return {
        id: "TRP001",
        status: "LOADING" as const,
        stops: [{ orders: [{ orderId: "ORD1" }, { orderId: "ORD2" }] }],
        loadChecks: [{ orderId: "ORD1" }, { orderId: "ORD2" }],
        shortfalls: [],
        ...overrides,
      };
    }

    const release = { method: "POST" as const, url: "/v1/trips/TRP001/readiness" };

    it("refuses to release a trip with lines still unchecked", async () => {
      const server = await serverFor();
      vi.mocked(prisma.trip.findUnique).mockResolvedValue(
        readinessTrip({ loadChecks: [{ orderId: "ORD1" }] }) as never,
      );

      const response = await server.inject(release);

      expect(response.statusCode).toBe(409);
      expect(response.json()).toMatchObject({
        error: {
          code: "LOAD_INCOMPLETE",
          message: "1 of 2 lines are still unchecked.",
        },
      });
      expect(prisma.trip.updateMany).not.toHaveBeenCalled();
    });

    it("refuses to release a trip while a shortfall still blocks departure", async () => {
      const server = await serverFor();
      vi.mocked(prisma.trip.findUnique).mockResolvedValue(
        readinessTrip({ shortfalls: [{ id: "SF1", kind: "MISSING", orderId: "ORD2" }] }) as never,
      );

      const response = await server.inject(release);

      expect(response.statusCode).toBe(409);
      expect(response.json()).toMatchObject({
        error: { code: "SHORTFALL_BLOCKING" },
      });
      // The gate asks the database for blocking shortfalls only — a resolved
      // one must not hold the vehicle on the dock.
      const select = vi.mocked(prisma.trip.findUnique).mock.calls[0]![0]!.select as {
        shortfalls: { where: unknown };
      };
      expect(select.shortfalls.where).toEqual({ status: "OPEN", blocksDeparture: true });
      expect(prisma.trip.updateMany).not.toHaveBeenCalled();
    });

    it("releases a complete, unblocked load and stamps the time", async () => {
      const server = await serverFor();
      vi.mocked(prisma.trip.findUnique).mockResolvedValue(readinessTrip() as never);
      vi.mocked(prisma.trip.updateMany).mockResolvedValue({ count: 1 } as never);

      const response = await server.inject(release);

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ tripId: "TRP001", status: "READY" });
      expect(Number.isNaN(Date.parse(response.json().releasedAt))).toBe(false);
      expect(vi.mocked(prisma.trip.updateMany).mock.calls[0]![0]).toMatchObject({
        where: { id: "TRP001", status: { in: ["PLANNED", "LOADING"] } },
        data: { status: "READY" },
      });
      // The release is a decision somebody may later be asked about.
      expect(vi.mocked(prisma.auditEvent.createMany).mock.calls[0]![0]).toMatchObject({
        data: [{ action: "trip.ready", entityType: "Trip", entityId: "TRP001" }],
      });
    });

    it("loses the atomic claim rather than flipping a trip another terminal released", async () => {
      const server = await serverFor();
      vi.mocked(prisma.trip.findUnique).mockResolvedValue(readinessTrip() as never);
      vi.mocked(prisma.trip.updateMany).mockResolvedValue({ count: 0 } as never);

      const response = await server.inject(release);

      expect(response.statusCode).toBe(409);
      expect(response.json()).toEqual({
        error: {
          code: "RACE_LOST",
          message: "Another dock terminal released this trip just now.",
        },
      });
    });

    it("refuses a second release once the trip is already READY", async () => {
      const server = await serverFor();
      vi.mocked(prisma.trip.findUnique).mockResolvedValue(
        readinessTrip({ status: "READY" }) as never,
      );

      const response = await server.inject(release);

      expect(response.statusCode).toBe(409);
      expect(response.json()).toEqual({
        error: { code: "ALREADY_READY", message: "Trip is already ready." },
      });
      expect(prisma.trip.updateMany).not.toHaveBeenCalled();
    });
  });
});
