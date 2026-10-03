import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CONTRACT_AJV } from "../lib/ajv.js";
import { requireRoleOf, type SessionUser } from "../lib/auth.js";
import { prisma } from "../lib/db.js";
import errorsPlugin from "../plugins/errors.js";
import orderRoutes from "../routes/orders.js";
import { nextOperatingDate, unitSizeFor } from "../services/store.js";

/**
 * Placing orders and confirming receipt.
 *
 * The role gate is the real `requireRoleOf`, so "who may" is tested rather than
 * assumed. Prisma is mocked at the module boundary; what is asserted is the
 * query shape (the scope comes from the session, never the request), the
 * idempotency behaviour a flaky phone connection depends on, and the audit rows
 * a decision leaves behind.
 */

vi.mock("../lib/db.js", () => ({
  prisma: {
    order: { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn() },
    outlet: { findUnique: vi.fn() },
    vehicle: { findMany: vi.fn() },
    receiptConfirmation: { upsert: vi.fn() },
    auditEvent: { createMany: vi.fn() },
    $transaction: vi.fn(),
  },
}));

// Size estimates and the calendar are the store service's business; the route's
// own arithmetic (limits, weights, refs) runs for real on top of them.
vi.mock("../services/store.js", () => ({
  unitSizeFor: vi.fn(),
  nextOperatingDate: vi.fn(),
}));

const manager: SessionUser = {
  id: "USR004",
  email: "fathima@waypoint.lk",
  name: "Fathima Rizvi",
  role: "STORE_MANAGER",
  depotCode: null,
  outletId: "OUT074",
  defaultVehicleId: null,
};

const dispatcher: SessionUser = {
  id: "USR001",
  email: "nimal@waypoint.lk",
  name: "Nimal Perera",
  role: "DISPATCHER",
  depotCode: "Peliyagoda",
  outletId: null,
  defaultVehicleId: null,
};

const loader: SessionUser = { ...dispatcher, id: "USR007", role: "LOADER" };
const driver: SessionUser = { ...dispatcher, id: "USR010", role: "DRIVER", depotCode: null };

const outlet = {
  id: "OUT074",
  brand: "Fresh",
  districtName: "Puttalam",
  depotCode: "Peliyagoda",
  parkingConstraint: "mall_dock",
  windowOpen: "05:30",
  windowClose: "08:00",
};

// 0.1 m3 and 8 kg per unit. The roomiest reefer is 34 m3, so 340 units.
const SIZE = { kgPerUnit: 8, m3PerUnit: 0.1, sample: 0 };
const vehicles = [
  { type: "truck", temp: "reefer", volumeCapM3: 34, weightCapKg: 5000 },
  { type: "van", temp: "ambient", volumeCapM3: 10, weightCapKg: 1000 },
];

const REQUEST_ID = "0b6f6a54-3c0e-4b8e-9d4b-7a9a6f0f2a11";
const OTHER_REQUEST_ID = "5c2f2b0e-8a41-4d0b-8f5e-0f1f3d7a9e22";

function orderRow(over: Record<string, unknown> = {}) {
  return {
    id: "ORD1",
    ref: "ORD-004001",
    outletId: "OUT074",
    brand: "Fresh",
    districtName: "Puttalam",
    depotCode: "Peliyagoda",
    tempRequirement: "chilled",
    units: 120,
    weightKg: 960,
    volumeM3: 12,
    windowOpen: "05:30",
    windowClose: "08:00",
    requestedDate: new Date("2026-10-05T00:00:00.000Z"),
    status: "QUEUED",
    clientRequestId: null,
    assignments: [],
    deferrals: [],
    ...over,
  };
}

describe("orders routes", () => {
  const servers: ReturnType<typeof Fastify>[] = [];

  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(prisma.$transaction).mockImplementation(
      ((fn: (tx: typeof prisma) => unknown) => fn(prisma)) as never,
    );
    vi.mocked(unitSizeFor).mockResolvedValue(SIZE);
    vi.mocked(prisma.vehicle.findMany).mockResolvedValue(vehicles as never);
    vi.mocked(prisma.outlet.findUnique).mockResolvedValue(outlet as never);
    vi.mocked(nextOperatingDate).mockResolvedValue(new Date("2026-10-05T00:00:00.000Z"));
  });

  afterEach(async () => {
    vi.useRealTimers();
    await Promise.all(servers.splice(0).map((server) => server.close()));
  });

  async function serverFor(user: SessionUser | null = manager) {
    // The contract's AJV options, or undeclared fields would be stripped, not refused.
    const server = Fastify({ logger: false, ajv: CONTRACT_AJV });
    servers.push(server);
    server.decorateRequest("requireRole", function (...roles: never[]) {
      return requireRoleOf(user, ...roles);
    });
    await server.register(errorsPlugin);
    await server.register(orderRoutes, { prefix: "/v1" });
    return server;
  }

  describe("GET /v1/orders/limits", () => {
    it("works the per-order ceiling out of the roomiest vehicle that may carry the goods", async () => {
      const server = await serverFor();

      const response = await server.inject({ method: "GET", url: "/v1/orders/limits" });

      expect(response.statusCode).toBe(200);
      // Chilled needs a reefer (34 m3 / 0.1). Ambient may also ride the reefer.
      expect(response.json()).toEqual({
        chilled: { m3PerUnit: 0.1, kgPerUnit: 8, maxUnitsPerOrder: 340 },
        ambient: { m3PerUnit: 0.1, kgPerUnit: 8, maxUnitsPerOrder: 340 },
      });
      expect(prisma.vehicle.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { depotCode: "Peliyagoda" } }),
      );
    });

    it("limits a van-only outlet to what the vans can hold, and to nothing for chilled", async () => {
      vi.mocked(prisma.outlet.findUnique).mockResolvedValue({ ...outlet, parkingConstraint: "van_only" } as never);
      const server = await serverFor();

      const body = (await server.inject({ method: "GET", url: "/v1/orders/limits" })).json();

      // The only van is ambient: 10 m3 / 0.1, and no reefer van exists.
      expect(body.ambient.maxUnitsPerOrder).toBe(100);
      expect(body.chilled.maxUnitsPerOrder).toBe(0);
    });

    it("is the store manager's alone", async () => {
      for (const user of [dispatcher, loader, driver]) {
        const server = await serverFor(user);
        const response = await server.inject({ method: "GET", url: "/v1/orders/limits" });
        expect(response.statusCode).toBe(403);
      }
      expect(prisma.outlet.findUnique).not.toHaveBeenCalled();
    });

    it("refuses an account that is not bound to an outlet, and one whose outlet has gone", async () => {
      const unbound = await serverFor({ ...manager, outletId: null });
      expect((await unbound.inject({ method: "GET", url: "/v1/orders/limits" })).statusCode).toBe(403);

      vi.mocked(prisma.outlet.findUnique).mockResolvedValue(null);
      const gone = await serverFor();
      expect((await gone.inject({ method: "GET", url: "/v1/orders/limits" })).statusCode).toBe(403);
    });
  });

  describe("GET /v1/orders", () => {
    it("scopes a store manager to their own outlet, whatever the query says", async () => {
      vi.mocked(prisma.order.findMany).mockResolvedValue([orderRow()] as never);
      const server = await serverFor();

      const response = await server.inject({ method: "GET", url: "/v1/orders" });

      expect(response.statusCode).toBe(200);
      expect(vi.mocked(prisma.order.findMany).mock.calls[0]![0]!.where).toEqual({ outletId: "OUT074" });
      expect(response.json()[0]).toMatchObject({ ref: "ORD-004001", requestedDate: "2026-10-05", storeState: "queued" });
    });

    it("scopes a dispatcher to their depot", async () => {
      vi.mocked(prisma.order.findMany).mockResolvedValue([] as never);
      const server = await serverFor(dispatcher);

      await server.inject({ method: "GET", url: "/v1/orders?date=2026-10-05" });

      expect(vi.mocked(prisma.order.findMany).mock.calls[0]![0]!.where).toEqual({
        depotCode: "Peliyagoda",
        requestedDate: new Date("2026-10-05T00:00:00.000Z"),
      });
    });

    it("refuses roles that have no orders of their own", async () => {
      for (const user of [loader, driver]) {
        const server = await serverFor(user);
        expect((await server.inject({ method: "GET", url: "/v1/orders" })).statusCode).toBe(403);
      }
      expect(prisma.order.findMany).not.toHaveBeenCalled();
    });

    it("returns nothing, and queries nothing, for an account with no scope", async () => {
      const noOutlet = await serverFor({ ...manager, outletId: null });
      const noDepot = await serverFor({ ...dispatcher, depotCode: null });

      expect((await noOutlet.inject({ method: "GET", url: "/v1/orders" })).json()).toEqual([]);
      expect((await noDepot.inject({ method: "GET", url: "/v1/orders" })).json()).toEqual([]);
      expect(prisma.order.findMany).not.toHaveBeenCalled();
    });

    it("rejects an undeclared outletId and a malformed date before the handler runs", async () => {
      const server = await serverFor(dispatcher);

      const spoof = await server.inject({ method: "GET", url: "/v1/orders?outletId=OUT001" });
      const badDate = await server.inject({ method: "GET", url: "/v1/orders?date=5-10-2026" });

      expect(spoof.statusCode).toBe(422);
      expect(badDate.statusCode).toBe(422);
      expect(prisma.order.findMany).not.toHaveBeenCalled();
    });

    it("refuses a date that matches the pattern but is not on the calendar, rather than failing in the database", async () => {
      const server = await serverFor();

      // 30 February would otherwise be read as 2 March; month 13 is not a date at all.
      for (const date of ["2026-02-30", "2026-13-01"]) {
        const response = await server.inject({ method: "GET", url: `/v1/orders?date=${date}` });
        expect(response.statusCode, date).toBe(422);
        expect(response.json().error.code).toBe("VALIDATION_FAILED");
      }
      expect(prisma.order.findMany).not.toHaveBeenCalled();
    });

    it("tells a store the same thing at each stage: planned, then on the way once the trip departs", async () => {
      const planned = orderRow({
        id: "ORD2",
        status: "PLANNED",
        assignments: [{ plan: { status: "PUBLISHED" }, tripStop: { trip: { status: "READY" } } }],
      });
      const moving = orderRow({
        id: "ORD3",
        status: "PLANNED",
        assignments: [{ plan: { status: "PUBLISHED" }, tripStop: { trip: { status: "DEPARTED" } } }],
      });
      // A superseded plan's trip is history, not the order's current state.
      const superseded = orderRow({
        id: "ORD4",
        status: "QUEUED",
        assignments: [{ plan: { status: "SUPERSEDED" }, tripStop: { trip: { status: "DEPARTED" } } }],
      });
      vi.mocked(prisma.order.findMany).mockResolvedValue([planned, moving, superseded] as never);
      const server = await serverFor();

      const states = (await server.inject({ method: "GET", url: "/v1/orders" })).json().map(
        (o: { storeState: string }) => o.storeState,
      );

      expect(states).toEqual(["planned", "on_the_way", "queued"]);
    });

    it("shows the published deferral's reason and move-to day, but only while the order is deferred", async () => {
      const deferral = { reasonCode: "REEFER_FULL", rolledToDate: new Date("2026-10-06T00:00:00.000Z") };
      vi.mocked(prisma.order.findMany).mockResolvedValue([
        orderRow({ id: "ORD5", status: "DEFERRED", deferrals: [deferral] }),
        // Served by a later plan: the old decision no longer describes it.
        orderRow({ id: "ORD6", status: "PLANNED", deferrals: [deferral] }),
        orderRow({ id: "ORD7", status: "DEFERRED", deferrals: [{ reasonCode: "ORDER_TOO_LARGE", rolledToDate: null }] }),
      ] as never);
      const server = await serverFor();

      const body = (await server.inject({ method: "GET", url: "/v1/orders" })).json();

      expect(body[0]).toMatchObject({ storeState: "deferred", deferral: { reasonCode: "REEFER_FULL", rolledToDate: "2026-10-06" } });
      expect(body[1].deferral).toBeNull();
      expect(body[2].deferral).toEqual({ reasonCode: "ORDER_TOO_LARGE", rolledToDate: null });
    });
  });

  describe("GET /v1/orders/:orderId", () => {
    it("looks an order up by id AND the caller's own outlet, so another outlet's order is a 404", async () => {
      vi.mocked(prisma.order.findFirst).mockResolvedValue(null);
      const server = await serverFor();

      const response = await server.inject({ method: "GET", url: "/v1/orders/ORD-OF-ANOTHER-OUTLET" });

      expect(response.statusCode).toBe(404);
      expect(response.json().error.code).toBe("NOT_FOUND");
      expect(vi.mocked(prisma.order.findFirst).mock.calls[0]![0]!.where).toEqual({
        id: "ORD-OF-ANOTHER-OUTLET",
        outletId: "OUT074",
      });
    });

    it("scopes a dispatcher to their depot", async () => {
      vi.mocked(prisma.order.findFirst).mockResolvedValue(orderRow() as never);
      const server = await serverFor(dispatcher);

      const response = await server.inject({ method: "GET", url: "/v1/orders/ORD1" });

      expect(response.statusCode).toBe(200);
      expect(vi.mocked(prisma.order.findFirst).mock.calls[0]![0]!.where).toEqual({
        id: "ORD1",
        depotCode: "Peliyagoda",
      });
    });

    it("answers 404 without a query when the account has no scope, and 403 to other roles", async () => {
      const unbound = await serverFor({ ...manager, outletId: null });
      expect((await unbound.inject({ method: "GET", url: "/v1/orders/ORD1" })).statusCode).toBe(404);

      const loaderServer = await serverFor(loader);
      expect((await loaderServer.inject({ method: "GET", url: "/v1/orders/ORD1" })).statusCode).toBe(403);
      expect(prisma.order.findFirst).not.toHaveBeenCalled();
    });
  });

  describe("POST /v1/orders", () => {
    /**
     * A database where nothing has been placed yet. `findMany` serves both the
     * prior-request lookup (filtered on clientRequestId) and the read-back of
     * the new rows (filtered on id), so the mock tells them apart.
     */
    function emptyDatabase(opts: { latestRef?: string | null } = {}) {
      const stored: ReturnType<typeof orderRow>[] = [];
      vi.mocked(prisma.order.findMany).mockImplementation((async (args: { where: Record<string, unknown> }) => {
        if (args.where.id) return stored;
        return [];
      }) as never);
      const latestRef = opts.latestRef === undefined ? "ORD-004100" : opts.latestRef;
      vi.mocked(prisma.order.findFirst).mockResolvedValue((latestRef ? { ref: latestRef } : null) as never);
      vi.mocked(prisma.order.create).mockImplementation((async ({ data }: { data: Record<string, unknown> }) => {
        const row = orderRow({ ...data, id: `ID-${stored.length + 1}` });
        stored.push(row);
        return row;
      }) as never);
      return stored;
    }

    const post = (server: Awaited<ReturnType<typeof serverFor>>, payload: unknown) =>
      server.inject({ method: "POST", url: "/v1/orders", payload: payload as never });

    const validBody = {
      requestId: REQUEST_ID,
      forDate: "2026-10-05",
      lines: [{ tempRequirement: "chilled", units: 100 }],
    };

    it("is the store manager's alone", async () => {
      for (const user of [dispatcher, loader, driver]) {
        const server = await serverFor(user);
        expect((await post(server, validBody)).statusCode).toBe(403);
      }
      expect(prisma.order.create).not.toHaveBeenCalled();
    });

    it("refuses an account that is not bound to an outlet", async () => {
      const server = await serverFor({ ...manager, outletId: null });

      const response = await post(server, validBody);

      expect(response.statusCode).toBe(403);
      expect(prisma.order.findMany).not.toHaveBeenCalled();
    });

    it("takes only units: outlet, brand and depot come from the session and a body that names them is refused", async () => {
      const server = await serverFor();

      const response = await post(server, { ...validBody, outletId: "OUT001" });
      const badLine = await post(server, { ...validBody, lines: [{ tempRequirement: "chilled", units: 5, brand: "Tech" }] });
      const notUuid = await post(server, { ...validBody, requestId: "not-a-uuid" });
      const zero = await post(server, { ...validBody, lines: [{ tempRequirement: "chilled", units: 0 }] });
      const empty = await post(server, { ...validBody, lines: [] });

      for (const r of [response, badLine, notUuid, zero, empty]) expect(r.statusCode).toBe(422);
      expect(prisma.order.create).not.toHaveBeenCalled();
    });

    it("places one order per line, with outlet details from the directory and size from the unit estimate", async () => {
      const stored = emptyDatabase();
      const server = await serverFor();

      const response = await post(server, {
        ...validBody,
        lines: [
          { tempRequirement: "chilled", units: 100 },
          { tempRequirement: "ambient", units: 50 },
        ],
      });

      expect(response.statusCode).toBe(201);
      expect(stored).toHaveLength(2);
      const [chilled, ambient] = vi.mocked(prisma.order.create).mock.calls.map((c) => c[0]!.data);
      expect(chilled).toMatchObject({
        outletId: "OUT074",
        brand: "Fresh",
        districtName: "Puttalam",
        depotCode: "Peliyagoda",
        tempRequirement: "chilled",
        units: 100,
        weightKg: 800,
        volumeM3: 10,
        windowOpen: "05:30",
        windowClose: "08:00",
        requestedDate: new Date("2026-10-05T00:00:00.000Z"),
        placedByUserId: "USR004",
        status: "QUEUED",
      });
      expect(ambient).toMatchObject({ tempRequirement: "ambient", units: 50, weightKg: 400, volumeM3: 5 });
      expect(response.json().map((o: { units: number }) => o.units)).toEqual([100, 50]);
    });

    it("allocates refs sequentially after the highest existing one, and tags each row with its line index", async () => {
      emptyDatabase({ latestRef: "ORD-004100" });
      const server = await serverFor();

      await post(server, {
        ...validBody,
        lines: [
          { tempRequirement: "chilled", units: 10 },
          { tempRequirement: "chilled", units: 20 },
          { tempRequirement: "ambient", units: 30 },
        ],
      });

      const data = vi.mocked(prisma.order.create).mock.calls.map((c) => c[0]!.data);
      expect(data.map((d) => d.ref)).toEqual(["ORD-004101", "ORD-004102", "ORD-004103"]);
      expect(data.map((d) => d.clientRequestId)).toEqual([`${REQUEST_ID}:0`, `${REQUEST_ID}:1`, `${REQUEST_ID}:2`]);
    });

    it("starts the refs at 004001 when nothing has been placed", async () => {
      emptyDatabase({ latestRef: null });
      const server = await serverFor();

      await post(server, validBody);

      expect(vi.mocked(prisma.order.create).mock.calls[0]![0]!.data.ref).toBe("ORD-004001");
    });

    it("writes one audit row per created order, after the transaction", async () => {
      emptyDatabase();
      const server = await serverFor();

      await post(server, {
        ...validBody,
        lines: [
          { tempRequirement: "chilled", units: 10 },
          { tempRequirement: "ambient", units: 20 },
        ],
      });

      const { data } = vi.mocked(prisma.auditEvent.createMany).mock.calls[0]![0] as { data: Array<Record<string, unknown>> };
      expect(data).toEqual([
        expect.objectContaining({
          actorUserId: "USR004",
          actorRole: "STORE_MANAGER",
          action: "order.place",
          entityType: "Order",
          entityId: "ID-1",
          after: { ref: "ORD-004101", units: 10, forDate: "2026-10-05" },
        }),
        expect.objectContaining({ action: "order.place", entityId: "ID-2", after: { ref: "ORD-004102", units: 20, forDate: "2026-10-05" } }),
      ]);
      expect(vi.mocked(prisma.$transaction).mock.invocationCallOrder[0]!).toBeLessThan(
        vi.mocked(prisma.auditEvent.createMany).mock.invocationCallOrder[0]!,
      );
    });

    describe("idempotency on requestId", () => {
      it("replays a repeated request as 200 with the first result and creates nothing", async () => {
        // A ten-line order comes back in line order on replay, not the
        // lexicographic order of "<uuid>:0", ":1", ":10" ...
        const prior = Array.from({ length: 11 }, (_, i) =>
          orderRow({ id: `ID-${i}`, ref: `ORD-0041${String(i).padStart(2, "0")}`, units: i + 1, clientRequestId: `${REQUEST_ID}:${i}` }),
        ).sort((a, b) => String(a.clientRequestId).localeCompare(String(b.clientRequestId)));
        vi.mocked(prisma.order.findMany).mockResolvedValue(prior as never);
        const server = await serverFor();

        const response = await post(server, validBody);

        expect(response.statusCode).toBe(200);
        expect(response.json().map((o: { units: number }) => o.units)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
        expect(prisma.order.create).not.toHaveBeenCalled();
        expect(prisma.auditEvent.createMany).not.toHaveBeenCalled();
        // The lookup is by this outlet and this request's "<uuid>:" prefix, never a bare uuid.
        expect(vi.mocked(prisma.order.findMany).mock.calls[0]![0]!.where).toEqual({
          outletId: "OUT074",
          clientRequestId: { startsWith: `${REQUEST_ID}:` },
        });
      });

      it("answers a replay before looking at the directory or the date, so a retry after the day has passed still succeeds", async () => {
        vi.mocked(prisma.order.findMany).mockResolvedValue([orderRow({ clientRequestId: `${REQUEST_ID}:0` })] as never);
        vi.mocked(nextOperatingDate).mockResolvedValue(new Date("2030-01-01T00:00:00.000Z"));
        const server = await serverFor();

        const response = await post(server, validBody);

        expect(response.statusCode).toBe(200);
        expect(prisma.outlet.findUnique).not.toHaveBeenCalled();
      });

      it("returns the first result, not a 500, when a simultaneous twin wins the clientRequestId unique index", async () => {
        const winner = orderRow({ id: "ID-WIN", clientRequestId: `${REQUEST_ID}:0` });
        // No prior row at the first look; the twin has committed by the re-read.
        vi.mocked(prisma.order.findMany).mockResolvedValueOnce([] as never).mockResolvedValue([winner] as never);
        vi.mocked(prisma.order.findFirst).mockResolvedValue({ ref: "ORD-004100" } as never);
        vi.mocked(prisma.order.create).mockRejectedValue(Object.assign(new Error("Unique constraint failed"), { code: "P2002" }));
        const server = await serverFor();

        const response = await post(server, validBody);

        expect(response.statusCode).toBe(200);
        expect(response.json()).toHaveLength(1);
        expect(response.json()[0].id).toBe("ID-WIN");
        // The loser recorded nothing: the winner's request wrote the audit row.
        expect(prisma.auditEvent.createMany).not.toHaveBeenCalled();
      });

      it("retries with fresh refs when two different outlets collide on the same ref, instead of failing with a 500", async () => {
        const stored = emptyDatabase({ latestRef: "ORD-004100" });
        // The first attempt loses the (ref, requestedDate) index to another
        // outlet's order placed in the same instant; nothing under this
        // request's key exists, so this is not a replay.
        vi.mocked(prisma.$transaction).mockRejectedValueOnce(
          Object.assign(new Error("Unique constraint failed on ref"), { code: "P2002" }),
        );
        const server = await serverFor();

        const response = await post(server, validBody);

        expect(response.statusCode).toBe(201);
        expect(stored).toHaveLength(1);
        expect(prisma.auditEvent.createMany).toHaveBeenCalledTimes(1);
      });

      it("gives up with an error, and writes no audit row, if the ref index keeps being lost", async () => {
        emptyDatabase();
        vi.mocked(prisma.$transaction).mockRejectedValue(Object.assign(new Error("Unique constraint failed on ref"), { code: "P2002" }));
        const server = await serverFor();

        const response = await post(server, validBody);

        expect(response.statusCode).toBe(500);
        expect(prisma.$transaction).toHaveBeenCalledTimes(3);
        expect(prisma.auditEvent.createMany).not.toHaveBeenCalled();
      });

      it("does not mask a failure that is not a unique violation", async () => {
        emptyDatabase();
        vi.mocked(prisma.order.create).mockRejectedValue(new Error("connection reset"));
        const server = await serverFor();

        const response = await post(server, validBody);

        expect(response.statusCode).toBe(500);
        expect(prisma.auditEvent.createMany).not.toHaveBeenCalled();
      });
    });

    describe("what an order may be", () => {
      it("refuses a line bigger than any allowed vehicle can carry, with the limit in the details", async () => {
        emptyDatabase();
        const server = await serverFor();

        const response = await post(server, {
          ...validBody,
          lines: [
            { tempRequirement: "ambient", units: 10 },
            { tempRequirement: "chilled", units: 341 },
          ],
        });

        expect(response.statusCode).toBe(422);
        const error = response.json().error;
        expect(error.code).toBe("ORDER_TOO_LARGE");
        expect(error.details).toEqual({ tempRequirement: "chilled", units: 341, maxUnitsPerOrder: 340 });
        expect(error.message).toContain("at most 340 units");
        // Nothing of a refused request is kept, even the lines that were fine.
        expect(prisma.order.create).not.toHaveBeenCalled();
      });

      it("accepts a line exactly at the limit", async () => {
        emptyDatabase();
        const server = await serverFor();

        const response = await post(server, { ...validBody, lines: [{ tempRequirement: "chilled", units: 340 }] });

        expect(response.statusCode).toBe(201);
      });

      it("says no vehicle can reach the outlet when the ceiling is zero", async () => {
        vi.mocked(prisma.outlet.findUnique).mockResolvedValue({ ...outlet, parkingConstraint: "van_only" } as never);
        emptyDatabase();
        const server = await serverFor();

        const response = await post(server, validBody);

        expect(response.statusCode).toBe(422);
        expect(response.json().error.code).toBe("ORDER_TOO_LARGE");
        expect(response.json().error.details.maxUnitsPerOrder).toBe(0);
        expect(response.json().error.message).toContain("No vehicle at this depot can carry chilled goods");
      });

      it("refuses a date before the earliest operating day, naming it", async () => {
        emptyDatabase();
        vi.useFakeTimers({ toFake: ["Date"] });
        vi.setSystemTime(new Date("2026-10-03T08:00:00.000Z"));
        vi.mocked(nextOperatingDate).mockResolvedValue(new Date("2026-10-05T00:00:00.000Z"));
        const server = await serverFor();

        const response = await post(server, { ...validBody, forDate: "2026-10-04" });

        expect(response.statusCode).toBe(422);
        expect(response.json().error.code).toBe("VALIDATION_FAILED");
        expect(response.json().error.message).toBe("Earliest operating day is 2026-10-05.");
        // The question put to the calendar is "the first operating day after
        // 24 hours ago", which is how today stays orderable.
        expect(vi.mocked(nextOperatingDate).mock.calls[0]![0]).toEqual(new Date("2026-10-02T08:00:00.000Z"));
        expect(prisma.order.create).not.toHaveBeenCalled();
      });

      it("accepts the earliest operating day itself and any later one", async () => {
        emptyDatabase();
        const server = await serverFor();

        const sameDay = await post(server, { ...validBody, forDate: "2026-10-05" });
        const later = await post(server, { ...validBody, requestId: OTHER_REQUEST_ID, forDate: "2026-10-09" });

        expect(sameDay.statusCode).toBe(201);
        expect(later.statusCode).toBe(201);
      });

      it("refuses a forDate that is not on the calendar, rather than ordering for a day the store did not pick", async () => {
        emptyDatabase();
        const server = await serverFor();

        const response = await post(server, { ...validBody, forDate: "2026-02-30" });

        expect(response.statusCode).toBe(422);
        expect(response.json().error.code).toBe("VALIDATION_FAILED");
        expect(prisma.order.create).not.toHaveBeenCalled();
      });

      it("refuses when the outlet is no longer in the directory", async () => {
        emptyDatabase();
        vi.mocked(prisma.outlet.findUnique).mockResolvedValue(null);
        const server = await serverFor();

        const response = await post(server, validBody);

        expect(response.statusCode).toBe(422);
        expect(response.json().error.code).toBe("VALIDATION_FAILED");
        expect(prisma.order.create).not.toHaveBeenCalled();
      });
    });
  });

  describe("PUT /v1/orders/:orderId/receipt", () => {
    const confirmedAt = new Date("2026-10-05T05:41:00.000Z");
    const matching = { unitsReceived: 120, matches: true };

    function put(server: Awaited<ReturnType<typeof serverFor>>, payload: unknown, id = "ORD1") {
      return server.inject({ method: "PUT", url: `/v1/orders/${id}/receipt`, payload: payload as never });
    }

    beforeEach(() => {
      vi.mocked(prisma.order.findFirst).mockResolvedValue({ id: "ORD1", status: "DELIVERED" } as never);
      vi.mocked(prisma.receiptConfirmation.upsert).mockImplementation((async ({ create }: { create: Record<string, unknown> }) => ({
        ...create,
        confirmedAt,
      })) as never);
    });

    it("is the store manager's alone, and needs an outlet", async () => {
      for (const user of [dispatcher, loader, driver, { ...manager, outletId: null }]) {
        const server = await serverFor(user);
        expect((await put(server, matching)).statusCode).toBe(403);
      }
      expect(prisma.receiptConfirmation.upsert).not.toHaveBeenCalled();
    });

    it("needs an issue kind when the delivery does not match, so the dispatcher has something to act on", async () => {
      const server = await serverFor();

      const missing = await put(server, { unitsReceived: 100, matches: false });
      const nulled = await put(server, { unitsReceived: 100, matches: false, issueKind: null });

      for (const r of [missing, nulled]) {
        expect(r.statusCode).toBe(422);
        expect(r.json().error.code).toBe("VALIDATION_FAILED");
      }
      // Refused before any lookup.
      expect(prisma.order.findFirst).not.toHaveBeenCalled();
      expect(prisma.receiptConfirmation.upsert).not.toHaveBeenCalled();
    });

    it("refuses an issue kind outside the store vocabulary at the schema", async () => {
      const server = await serverFor();

      const response = await put(server, { unitsReceived: 100, matches: false, issueKind: "I_DISLIKE_IT" });

      expect(response.statusCode).toBe(422);
      expect(response.json().error.code).toBe("REQUEST_DOES_NOT_MATCH_CONTRACT");
    });

    it("looks the order up by id and the caller's own outlet, so another outlet's order is a 404", async () => {
      vi.mocked(prisma.order.findFirst).mockResolvedValue(null);
      const server = await serverFor();

      const response = await put(server, matching, "ORD-OTHER");

      expect(response.statusCode).toBe(404);
      expect(vi.mocked(prisma.order.findFirst).mock.calls[0]![0]!.where).toEqual({ id: "ORD-OTHER", outletId: "OUT074" });
      expect(prisma.receiptConfirmation.upsert).not.toHaveBeenCalled();
      expect(prisma.auditEvent.createMany).not.toHaveBeenCalled();
    });

    it.each(["QUEUED", "PLANNED", "DEFERRED", "CANCELLED"])(
      "will not confirm receipt of an order that is %s, because the driver has not delivered it",
      async (status) => {
        vi.mocked(prisma.order.findFirst).mockResolvedValue({ id: "ORD1", status } as never);
        const server = await serverFor();

        const response = await put(server, matching);

        expect(response.statusCode).toBe(422);
        expect(response.json().error.code).toBe("NOT_DELIVERED");
        expect(prisma.receiptConfirmation.upsert).not.toHaveBeenCalled();
        expect(prisma.auditEvent.createMany).not.toHaveBeenCalled();
      },
    );

    it.each(["DELIVERED", "PART_DELIVERED"])("confirms an order that is %s", async (status) => {
      vi.mocked(prisma.order.findFirst).mockResolvedValue({ id: "ORD1", status } as never);
      const server = await serverFor();

      const response = await put(server, matching);

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        orderId: "ORD1",
        confirmedAt: "2026-10-05T05:41:00.000Z",
        unitsReceived: 120,
        matches: true,
        issueKind: null,
        note: null,
      });
    });

    it("upserts on the order, so correcting a wrong number replaces the receipt rather than opening a second", async () => {
      const server = await serverFor();

      await put(server, { unitsReceived: 95, matches: false, issueKind: "ITEMS_MISSING", note: "two cartons short" });

      const args = vi.mocked(prisma.receiptConfirmation.upsert).mock.calls[0]![0];
      expect(args.where).toEqual({ orderId: "ORD1" });
      expect(args.create).toEqual({
        orderId: "ORD1",
        confirmedByUserId: "USR004",
        unitsReceived: 95,
        matches: false,
        issueKind: "ITEMS_MISSING",
        note: "two cartons short",
      });
      // A correction is re-stamped and re-attributed, and clears what it no longer says.
      expect(args.update).toMatchObject({
        confirmedByUserId: "USR004",
        unitsReceived: 95,
        matches: false,
        issueKind: "ITEMS_MISSING",
        note: "two cartons short",
        confirmedAt: expect.any(Date),
      });
    });

    it("clears an earlier issue when the correction matches", async () => {
      const server = await serverFor();

      await put(server, { unitsReceived: 120, matches: true });

      expect(vi.mocked(prisma.receiptConfirmation.upsert).mock.calls[0]![0].update).toMatchObject({
        issueKind: null,
        note: null,
      });
    });

    it("writes one audit row carrying the issue kind as its reason code", async () => {
      const server = await serverFor();

      await put(server, { unitsReceived: 95, matches: false, issueKind: "ARRIVED_WARM", note: "probe read 9C" });

      const { data } = vi.mocked(prisma.auditEvent.createMany).mock.calls[0]![0] as { data: Array<Record<string, unknown>> };
      expect(data).toEqual([
        expect.objectContaining({
          actorUserId: "USR004",
          actorRole: "STORE_MANAGER",
          action: "order.receive",
          entityType: "Order",
          entityId: "ORD1",
          reasonCode: "ARRIVED_WARM",
          note: "probe read 9C",
          after: { unitsReceived: 95, matches: false },
        }),
      ]);
    });

    it("leaves the audit reason and note empty for a clean receipt", async () => {
      const server = await serverFor();

      await put(server, matching);

      const { data } = vi.mocked(prisma.auditEvent.createMany).mock.calls[0]![0] as { data: Array<Record<string, unknown>> };
      expect(data[0]).toMatchObject({ action: "order.receive", after: { unitsReceived: 120, matches: true } });
      expect(data[0]!.reasonCode).toBeUndefined();
      expect(data[0]!.note).toBeUndefined();
    });
  });
});
