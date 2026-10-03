import Fastify from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CONTRACT_AJV } from "../lib/ajv.js";
import { AuthError, type SessionUser } from "../lib/auth.js";
import errorsPlugin from "../plugins/errors.js";
import reportRoutes from "../routes/reports.js";
import * as reports from "../services/reports.js";
import {
  buildOverview,
  classifyLiveExceptions,
  discrepancyCount,
  exceptionCounts,
  isOnTime,
  lateExceptions,
  onTimeStat,
  outletStats,
  previousWindow,
  summariseDays,
  utilisationPct,
  windowOf,
  type DayDemand,
  type ReportContext,
  type StopObservation,
  type WindowData,
} from "../services/reports.js";

/**
 * Reports. The interesting questions are all about merging and honesty: what
 * counts as on time, which source owns a day, and when a figure is null with a
 * note instead of a number.
 */

vi.mock("../lib/db.js", () => ({ prisma: {} }));

const stop = (over: Partial<StopObservation> = {}): StopObservation => ({
  date: "2026-04-09",
  source: "live",
  outletId: "OUT010",
  brand: "Fresh",
  vehicleId: "VEH101",
  tripKey: "t1",
  arrivalMin: 5 * 60 + 20,
  plannedArrivalMin: 5 * 60 + 10,
  windowCloseMin: 8 * 60 + 30,
  ...over,
});

describe("what 'on time' means", () => {
  it("is arrival no later than the window closing, not arrival against the plan", () => {
    expect(isOnTime(stop({ arrivalMin: 8 * 60 + 30 }))).toBe(true);
    expect(isOnTime(stop({ arrivalMin: 8 * 60 + 31 }))).toBe(false);
    // Early is not late: the vehicle waits for the window to open.
    expect(isOnTime(stop({ arrivalMin: 3 * 60 }))).toBe(true);
    // 40 minutes behind plan but still inside the window is on time...
    expect(isOnTime(stop({ plannedArrivalMin: 5 * 60, arrivalMin: 5 * 60 + 40 }))).toBe(true);
    // ...and on the plan but after the window closed is not.
    expect(isOnTime(stop({ plannedArrivalMin: 9 * 60, arrivalMin: 9 * 60 }))).toBe(false);
  });

  it("reports the share and the mean delta against plan separately", () => {
    const stat = onTimeStat([
      stop({ arrivalMin: 5 * 60 + 5 }), // +5... plan is 5:10 so -5
      stop({ arrivalMin: 5 * 60 + 40 }), // +30
      stop({ arrivalMin: 9 * 60 }), // late, +230
    ]);
    expect(stat).toMatchObject({ total: 3, onTime: 2, pct: 66.7 });
    expect(stat.avgArrivalDeltaMin).toBe(85);
  });

  it("has no percentage, not 100%, when nobody arrived", () => {
    expect(onTimeStat([])).toEqual({ total: 0, onTime: 0, pct: null, avgArrivalDeltaMin: null });
  });

  it("leaves the delta null for stops that carried no plan", () => {
    expect(onTimeStat([stop({ plannedArrivalMin: null })]).avgArrivalDeltaMin).toBeNull();
  });
});

describe("merging live and historical days", () => {
  const window = windowOf("2026-04-08", "2026-04-10");
  const demand = (date: string, source: DayDemand["source"], planned: number, delivered: number, deferred = 0): DayDemand => ({
    date,
    source,
    brand: "Fresh",
    planned,
    delivered,
    deferred,
  });

  it("takes each date from exactly one source, live first, and never adds both", () => {
    const live = new Set(["2026-04-09"]);
    const days = summariseDays(
      window,
      live,
      [demand("2026-04-08", "history", 10, 9, 1), demand("2026-04-09", "live", 4, 3), demand("2026-04-09", "history", 500, 500)],
      [stop({ date: "2026-04-09" }), stop({ date: "2026-04-09", source: "history" }), stop({ date: "2026-04-08", source: "history" })],
    );
    expect(days.map((d) => [d.date, d.source])).toEqual([
      ["2026-04-08", "history"],
      ["2026-04-09", "live"],
      ["2026-04-10", "none"],
    ]);
    // The history row for the live date was ignored, not summed.
    expect(days[1]).toMatchObject({ planned: 4, delivered: 3, stops: 1 });
    expect(days[0]).toMatchObject({ planned: 10, delivered: 9, deferred: 1, undelivered: 0 });
    expect(days[2]).toMatchObject({ planned: 0, stops: 0, onTimePct: null });
  });

  it("measures the previous window as the same number of days immediately before", () => {
    const prev = previousWindow(windowOf("2026-04-08", "2026-04-14"));
    expect(prev.dates).toHaveLength(7);
    expect(prev.from).toBe("2026-04-01");
    expect(prev.to).toBe("2026-04-07");
  });
});

describe("exceptions and discrepancies", () => {
  const orders = [
    { id: "o1", ref: "DEMO-001", date: "2026-04-09", outletId: "OUT010", status: "DELIVERED" as const },
    { id: "o2", ref: "DEMO-002", date: "2026-04-09", outletId: "OUT010", status: "PART_DELIVERED" as const },
    { id: "o3", ref: "DEMO-003", date: "2026-04-09", outletId: "OUT040", status: "DELIVERED" as const },
  ];

  it("counts one bad delivery once per kind however many records describe it", () => {
    const records = classifyLiveExceptions({
      orders,
      shortfalls: [
        { id: "s1", orderId: "o1", kind: "SHORT", reasonCode: null, raisedAt: new Date("2026-04-09T01:00:00Z"), date: "2026-04-09", outletId: "OUT010", ref: "DEMO-001" },
      ],
      // The store's receipt says items missing for the same order: the same event, seen again.
      receipts: [{ orderId: "o1", matches: false, issueKind: "ITEMS_MISSING", confirmedAt: new Date("2026-04-09T05:00:00Z") }],
      problems: [],
    });
    expect(records.filter((r) => r.kind === "SHORT_DELIVERY" && r.orderId === "o1")).toHaveLength(1);
  });

  it("maps the sources onto the design's kinds", () => {
    const records = classifyLiveExceptions({
      orders,
      shortfalls: [{ id: "s2", orderId: "o3", kind: "DAMAGED", reasonCode: null, raisedAt: new Date("2026-04-09T01:00:00Z"), date: "2026-04-09", outletId: "OUT040", ref: "DEMO-003" }],
      receipts: [{ orderId: "o2", matches: false, issueKind: "ARRIVED_WARM", confirmedAt: new Date("2026-04-09T05:00:00Z") }],
      problems: [
        { id: "p1", kind: "ROAD_BLOCKED", orderId: null, outletId: "OUT080", occurredAt: new Date("2026-04-09T02:00:00Z"), date: "2026-04-09", note: "Flooded" },
        { id: "p2", kind: "GOODS_DAMAGED", orderId: "o1", outletId: "OUT010", occurredAt: new Date("2026-04-09T02:00:00Z"), date: "2026-04-09", note: null },
      ],
    });
    const kinds = records.map((r) => `${r.kind}:${r.orderRef ?? r.outletId}`).sort();
    expect(kinds).toEqual(
      [
        "DAMAGED_ITEMS:DEMO-001", // problem GOODS_DAMAGED
        "DAMAGED_ITEMS:DEMO-003", // shortfall DAMAGED
        "ROAD_BLOCKED:OUT080",
        "SHORT_DELIVERY:DEMO-002", // PART_DELIVERED order
        "TEMPERATURE:DEMO-002", // receipt ARRIVED_WARM
      ].sort(),
    );
  });

  it("counts a discrepancy as a distinct order with a goods problem, not as a late or blocked stop", () => {
    const records = classifyLiveExceptions({
      // No part-delivered order here: this test is about one order carrying two goods records.
      orders: [orders[0], orders[2]],
      shortfalls: [
        { id: "s1", orderId: "o1", kind: "SHORT", reasonCode: null, raisedAt: new Date(), date: "2026-04-09", outletId: "OUT010", ref: "DEMO-001" },
        { id: "s2", orderId: "o1", kind: "DAMAGED", reasonCode: null, raisedAt: new Date(), date: "2026-04-09", outletId: "OUT010", ref: "DEMO-001" },
      ],
      receipts: [],
      problems: [{ id: "p1", kind: "ROAD_BLOCKED", orderId: null, outletId: "OUT080", occurredAt: new Date(), date: "2026-04-09", note: null }],
    });
    const all = [...records, ...lateExceptions([stop({ arrivalMin: 9 * 60 })])];
    expect(all.map((r) => r.kind).sort()).toEqual(["DAMAGED_ITEMS", "LATE_DELIVERY", "ROAD_BLOCKED", "SHORT_DELIVERY"]);
    // One order carries both a short and a damaged record: one discrepancy.
    expect(discrepancyCount(all)).toBe(1);
    expect(exceptionCounts(all)[0].count).toBe(1);
  });

  it("derives late exceptions from stops of either source", () => {
    const late = lateExceptions([stop({ arrivalMin: 9 * 60 }), stop({ source: "history", arrivalMin: 10 * 60 }), stop()]);
    expect(late).toHaveLength(2);
    expect(late.map((l) => l.source).sort()).toEqual(["history", "live"]);
  });
});

describe("per-outlet figures", () => {
  it("shows orders and discrepancies only where this system has them", () => {
    const rows = outletStats(
      [stop({ outletId: "OUT010" }), stop({ outletId: "OUT040", source: "history", date: "2026-03-01" })],
      [{ id: "o1", ref: "R1", date: "2026-04-09", outletId: "OUT010", brand: "Fresh", status: "DELIVERED" }],
      [],
    );
    const live = rows.find((r) => r.outletId === "OUT010")!;
    const hist = rows.find((r) => r.outletId === "OUT040")!;
    expect(live).toMatchObject({ orders: 1, discrepancies: 0 });
    // Historical legs record visits, not orders: no made-up order count.
    expect(hist).toMatchObject({ stops: 1, orders: null, discrepancies: null });
  });
});

describe("utilisation", () => {
  it("is the mean trip load against capacity, and null with no trip", () => {
    expect(utilisationPct([])).toBeNull();
    expect(
      utilisationPct([
        { date: "d", vehicleId: "a", tripNo: 1, loadM3: 9, capM3: 30, temp: "reefer" },
        { date: "d", vehicleId: "b", tripNo: 1, loadM3: 12, capM3: 12, temp: "ambient" },
      ]),
    ).toBe(65);
  });
});

describe("the overview", () => {
  const ctx: ReportContext = {
    depotCode: "Peliyagoda",
    provenance: { kind: "synthetic", label: "synthetic" },
    vehicles: [{ id: "VEH101", type: "truck", temp: "reefer", volumeCapM3: 30 }],
    outlets: new Map([["OUT010", { displayName: null, districtName: "Colombo", brand: "Fresh" }]]),
    workshopDays: new Map(),
  };
  const empty = (from: string, to: string): WindowData => ({
    window: windowOf(from, to),
    liveDates: new Set(),
    demand: [],
    stops: [],
    liveOrders: [],
    exceptions: [],
    trips: [],
  });

  it("returns null with a note, never a number, for what a history-only range cannot support", () => {
    const cur: WindowData = {
      ...empty("2026-03-23", "2026-03-24"),
      demand: [{ date: "2026-03-23", source: "history", brand: "Fresh", planned: 100, delivered: 98, deferred: 2 }],
      stops: [stop({ date: "2026-03-23", source: "history" })],
    };
    const o = buildOverview(cur, empty("2026-03-21", "2026-03-22"), ctx);
    expect(o.utilisation.pct).toBeNull();
    expect(o.utilisation.note).toMatch(/no load|none in this range|carry no load/i);
    expect(o.discrepancies.count).toBeNull();
    expect(o.discrepancies.note).toBeTruthy();
    expect(o.orders).toMatchObject({ planned: 100, delivered: 98, deferred: 2 });
    expect(o.orders.note).toMatch(/does not record whether/);
    expect(o.coverage).toEqual({ liveDays: 0, historyDays: 1, emptyDays: 1 });
    expect(o.onTime.pct).toBe(100);
    expect(o.onTime.vsPreviousPts).toBeNull(); // nothing to compare with
    expect(o.utilisationByDepot).toHaveLength(1);
    expect(o.utilisationByDepot[0].depotCode).toBe("Peliyagoda");
  });

  it("computes utilisation, discrepancies and the delta from live days", () => {
    const cur: WindowData = {
      ...empty("2026-04-09", "2026-04-09"),
      liveDates: new Set(["2026-04-09"]),
      demand: [{ date: "2026-04-09", source: "live", brand: "Fresh", planned: 4, delivered: 3, deferred: 1 }],
      stops: [stop(), stop({ arrivalMin: 9 * 60 })],
      liveOrders: [
        { id: "o1", ref: "R1", date: "2026-04-09", outletId: "OUT010", brand: "Fresh", status: "DELIVERED" },
        { id: "o2", ref: "R2", date: "2026-04-09", outletId: "OUT010", brand: "Fresh", status: "PART_DELIVERED" },
        { id: "o3", ref: "R3", date: "2026-04-09", outletId: "OUT010", brand: "Fresh", status: "DELIVERED" },
        { id: "o4", ref: "R4", date: "2026-04-09", outletId: "OUT010", brand: "Fresh", status: "DEFERRED" },
      ],
      exceptions: classifyLiveExceptions({
        orders: [{ id: "o2", ref: "R2", date: "2026-04-09", outletId: "OUT010", status: "PART_DELIVERED" }],
        shortfalls: [],
        receipts: [],
        problems: [],
      }),
      trips: [{ date: "2026-04-09", vehicleId: "VEH101", tripNo: 1, loadM3: 24, capM3: 30, temp: "reefer" }],
    };
    const prev: WindowData = { ...empty("2026-04-08", "2026-04-08"), stops: [stop({ date: "2026-04-08", source: "history" })] };
    const o = buildOverview(cur, prev, ctx);
    expect(o.onTime).toMatchObject({ pct: 50, onTime: 1, total: 2, vsPreviousPts: -50 });
    expect(o.utilisation).toMatchObject({ pct: 80, trips: 1, targetPct: 80 });
    expect(o.discrepancies).toMatchObject({ count: 1, pctOfOrders: 25 });
    expect(o.topExceptions.items.map((i) => i.kind).sort()).toEqual(["SHORT_DELIVERY"]);
    expect(o.coverage.liveDays).toBe(1);
  });
});

describe("GET /v1/reports/*", () => {
  const servers: ReturnType<typeof Fastify>[] = [];
  afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(servers.splice(0).map((s) => s.close()));
  });

  const dispatcher: SessionUser = {
    id: "U1", email: "n@w", name: "Nimal", role: "DISPATCHER", depotCode: "Peliyagoda", outletId: null, defaultVehicleId: null,
  };

  async function serverFor(user: SessionUser) {
    const server = Fastify({ logger: false, ajv: CONTRACT_AJV });
    servers.push(server);
    server.decorateRequest("requireRole", function (...roles: string[]) {
      if (roles.length && !roles.includes(user.role)) throw new AuthError("Forbidden", 403);
      return user;
    });
    await server.register(errorsPlugin);
    await server.register(reportRoutes, { prefix: "/v1" });
    return server;
  }

  const emptyData = (from: string, to: string): WindowData => ({
    window: windowOf(from, to), liveDates: new Set(), demand: [], stops: [], liveOrders: [], exceptions: [], trips: [],
  });

  function stubLoaders() {
    const load = vi.spyOn(reports, "loadWindowData").mockImplementation(async (_depot, window) => emptyData(window.from, window.to));
    vi.spyOn(reports, "loadReportContext").mockResolvedValue({
      depotCode: "Peliyagoda",
      provenance: { kind: "synthetic", label: "synthetic" },
      vehicles: [],
      outlets: new Map(),
      workshopDays: new Map(),
    });
    vi.spyOn(reports, "loadProvenance").mockResolvedValue({ kind: "synthetic", label: "synthetic" });
    return load;
  }

  it("answers a dispatcher for their own depot and never asks the loaders about another", async () => {
    const load = stubLoaders();
    const server = await serverFor(dispatcher);
    const res = await server.inject({ method: "GET", url: "/v1/reports/overview?from=2026-04-03&to=2026-04-09" });
    expect(res.statusCode).toBe(200);
    expect(load.mock.calls.every(([depot]) => depot === "Peliyagoda")).toBe(true);
    expect(res.json().depotCode).toBe("Peliyagoda");
  });

  it("refuses another depot, and every role but a dispatcher, with 403", async () => {
    stubLoaders();
    const server = await serverFor(dispatcher);
    for (const path of ["overview", "deliveries", "fleet", "outlets", "exceptions", "capacity-forecast"]) {
      const res = await server.inject({ method: "GET", url: `/v1/reports/${path}?depot=Kandy` });
      expect(res.statusCode, path).toBe(403);
    }
    const loaderServer = await serverFor({ ...dispatcher, role: "LOADER" });
    expect((await loaderServer.inject({ method: "GET", url: "/v1/reports/overview" })).statusCode).toBe(403);
    const noDepot = await serverFor({ ...dispatcher, depotCode: null });
    expect((await noDepot.inject({ method: "GET", url: "/v1/reports/fleet" })).statusCode).toBe(403);
  });

  it("rejects an inverted, impossible or oversized range, and parameters it does not declare", async () => {
    stubLoaders();
    const server = await serverFor(dispatcher);
    expect((await server.inject({ method: "GET", url: "/v1/reports/overview?from=2026-04-10&to=2026-04-01" })).statusCode).toBe(422);
    expect((await server.inject({ method: "GET", url: "/v1/reports/overview?from=2026-02-31&to=2026-03-02" })).statusCode).toBe(422);
    expect((await server.inject({ method: "GET", url: "/v1/reports/overview?from=2024-01-01&to=2026-04-01" })).statusCode).toBe(422);
    expect((await server.inject({ method: "GET", url: "/v1/reports/overview?bogus=1" })).statusCode).toBe(422);
    expect((await server.inject({ method: "GET", url: "/v1/reports/outlets?sort=alphabetical" })).statusCode).toBe(422);
  });

  it("serialises every report without losing a declared field", async () => {
    stubLoaders();
    const server = await serverFor(dispatcher);
    for (const path of ["deliveries", "fleet", "outlets", "exceptions"]) {
      const res = await server.inject({ method: "GET", url: `/v1/reports/${path}?from=2026-04-03&to=2026-04-09` });
      expect(res.statusCode, path).toBe(200);
      expect(res.json().coverage).toEqual({ liveDays: 0, historyDays: 0, emptyDays: 7 });
      expect(res.json().historySource.kind).toBe("synthetic");
    }
  });
});
