import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CONTRACT_AJV } from "../lib/ajv.js";
import { AuthError, type SessionUser } from "../lib/auth.js";
import { prisma } from "../lib/db.js";
import { recordDecisions } from "../lib/audit.js";
import { requireDispatcherPlan, requireDispatcherProblem, requireDispatcherShortfall } from "../lib/authorization.js";
import errorsPlugin from "../plugins/errors.js";
import exceptionRoutes from "../routes/exceptions.js";
import {
  deriveExceptions,
  emptyInputs,
  filterExceptions,
  loadExceptionInputs,
  parseExceptionId,
  problemSeverity,
  summarise,
  type ChillerInput,
  type ExceptionInputs,
  type ProblemInput,
  type ShortfallInput,
  type StopInput,
  type TripInput,
} from "../services/exceptions.js";

/**
 * The Exceptions console.
 *
 * Most of what matters is derivation: which rows become exceptions, how bad
 * each is, how the list is ordered and how the tiles add up. That is a pure
 * function over plain rows, so it is tested with no database at all. The route
 * tests then cover who may see and decide what, and what each decision writes.
 */

vi.mock("../lib/db.js", () => ({
  prisma: {
    $transaction: vi.fn(),
    shortfall: { updateMany: vi.fn() },
    order: { findUnique: vi.fn(), findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    tripStopOrder: { deleteMany: vi.fn(), create: vi.fn() },
    tripStop: { update: vi.fn(), create: vi.fn() },
    trip: { update: vi.fn(), findUnique: vi.fn(), findFirst: vi.fn() },
    assignment: { updateMany: vi.fn() },
    deferral: { upsert: vi.fn() },
    notification: { create: vi.fn() },
    problem: { updateMany: vi.fn() },
    outlet: { findUnique: vi.fn() },
    serviceAllowance: { findUnique: vi.fn() },
    planningDay: { upsert: vi.fn() },
    orderLine: { findMany: vi.fn() },
    district: { findUnique: vi.fn() },
    stopReassignment: { create: vi.fn() },
    chillerReading: { findFirst: vi.fn() },
  },
}));

vi.mock("../lib/audit.js", () => ({ recordDecisions: vi.fn(), recordDecision: vi.fn(), historyFor: vi.fn(async () => []) }));

vi.mock("../lib/authorization.js", () => ({
  requireDispatcherShortfall: vi.fn(),
  requireDispatcherProblem: vi.fn(),
  requireDispatcherPlan: vi.fn(),
}));

// The loader is the only part that talks to Prisma for reads; the decision
// code under test is real, and is fed hand-built inputs.
vi.mock("../services/exceptions.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/exceptions.js")>();
  return { ...actual, loadExceptionInputs: vi.fn(), exceptionsForDay: vi.fn() };
});

const NOW = new Date("2026-09-29T06:00:00+05:30");
const at = (hhmm: string) => new Date(`2026-09-29T${hhmm}:00+05:30`);
const minutesAgo = (n: number) => new Date(NOW.getTime() - n * 60_000);

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function stop(over: Partial<StopInput> = {}): StopInput {
  return {
    id: "ST1",
    seq: 1,
    outletId: "OUT027",
    outletName: "Kandy City Centre",
    status: "PENDING",
    plannedArrivalAt: "05:00",
    arrivedAt: null,
    orders: [{ id: "ORD1", ref: "S1-082", units: 20, tempRequirement: "ambient", weightKg: 200, volumeM3: 2 }],
    ...over,
  };
}

function trip(over: Partial<TripInput> = {}): TripInput {
  return {
    id: "T1",
    planId: "PLN1",
    vehicleId: "VEH017",
    vehicleTemp: "ambient",
    vehicleWeightCapKg: 3000,
    vehicleVolumeCapM3: 20,
    tripNo: 1,
    status: "LOADING",
    brand: "Fresh",
    districtName: "Kurunegala",
    plannedDepartAt: "04:11",
    departedAt: null,
    sumWeightKg: 1000,
    sumVolumeM3: 10,
    stops: [stop()],
    ...over,
  };
}

function shortfall(over: Partial<ShortfallInput> = {}): ShortfallInput {
  return {
    id: "SF1",
    tripId: "T1",
    orderId: "ORD1",
    orderRef: "S1-082",
    orderUnits: 20,
    orderWeightKg: 200,
    orderVolumeM3: 2,
    outletId: "OUT027",
    outletName: "Kandy City Centre",
    kind: "SHORT",
    missingUnits: 4,
    reasonCode: "MISSING",
    note: null,
    raisedBy: { name: "Ranjith Silva", role: "LOADER" },
    raisedByUserId: "USR-L",
    raisedAt: minutesAgo(8),
    status: "OPEN",
    resolution: null,
    resolvedAt: null,
    resolvedByName: null,
    blocksDeparture: true,
    ...over,
  };
}

function reading(over: Partial<ChillerInput> = {}): ChillerInput {
  return {
    id: "CR1",
    tripId: "T1",
    tempC: 6.5,
    targetMinC: 2,
    targetMaxC: 5,
    source: "LOADER_AT_BAY",
    recordedByName: "Ranjith Silva",
    recordedAt: minutesAgo(14),
    ...over,
  };
}

function problem(over: Partial<ProblemInput> = {}): ProblemInput {
  return {
    id: "PRB1",
    kind: "OUTLET_CLOSED",
    note: "Shutters down",
    reasonCode: null,
    status: "NEW",
    resolution: null,
    raisedBy: { name: "Sunil Fernando", role: "DRIVER" },
    raisedAt: minutesAgo(5),
    acknowledgedAt: null,
    acknowledgedByName: null,
    resolvedAt: null,
    resolvedByName: null,
    units: null,
    orderId: "ORD1",
    orderRef: "S1-082",
    orderUnits: 20,
    outletId: "OUT027",
    outletName: "Kandy City Centre",
    stopSeq: 1,
    tripId: "T1",
    vehicleId: "VEH017",
    ...over,
  };
}

function inputs(over: Partial<ExceptionInputs> = {}): ExceptionInputs {
  return { ...emptyInputs("2026-09-29", "2026-09-30"), trips: [trip()], ...over };
}

const one = (i: ExceptionInputs) => {
  const items = deriveExceptions(i, NOW);
  expect(items).toHaveLength(1);
  return items[0]!;
};

// ---------------------------------------------------------------------------
// Shortfalls
// ---------------------------------------------------------------------------

describe("shortfall exceptions", () => {
  it("is critical and a loading problem while it is open and blocks departure", () => {
    const item = one(inputs({ shortfalls: [shortfall()] }));
    expect(item).toMatchObject({
      id: "shortfall:SF1",
      kind: "SHORTFALL",
      severity: "critical",
      category: "loading",
      status: "open",
      vehicleId: "VEH017",
      departsAt: "04:11",
      ageMinutes: 8,
      orderRefs: ["S1-082"],
      quantities: { loaded: 16, expected: 20, short: 4 },
      reportedBy: { name: "Ranjith Silva", role: "LOADER" },
    });
    expect(item.title).toBe("Short 4 units · S1-082 on VEH017");
    expect(item.affectedOutlets).toEqual([
      { outletId: "OUT027", outletName: "Kandy City Centre", stopSeq: 1, ordered: 20, delta: -4 },
    ]);
  });

  it("is not critical once it no longer blocks departure, and reads as resolved with who decided", () => {
    const item = one(
      inputs({
        shortfalls: [shortfall({ status: "RESOLVED", resolution: "SEND_SHORT", resolvedAt: minutesAgo(2), blocksDeparture: false })],
        shortfallDecisions: new Map([["SF1", { at: minutesAgo(2), byName: "Nimal Perera", note: "On tomorrow's truck", decision: "SEND_SHORT" }]]),
      }),
    );
    expect(item).toMatchObject({ status: "resolved", severity: "warning", decisionOptions: [] });
    expect(item.resolution).toMatchObject({ decision: "SEND_SHORT", byName: "Nimal Perera", note: "On tomorrow's truck" });
  });

  it("offers send short as the recommendation, with a follow-up for the missing units", () => {
    const { decisionOptions } = one(inputs({ shortfalls: [shortfall()] }));
    expect(decisionOptions.map((o) => o.decision)).toEqual(["SEND_SHORT", "HOLD_ORDER", "CANCEL_LINE"]);
    const send = decisionOptions[0]!;
    expect(send.recommended).toBe(true);
    expect(send.followUp).toMatchObject({ forDate: "2026-09-30", units: 4 });
    // Nothing in the list promises a substitution or a credit: the system has neither.
    const text = JSON.stringify(decisionOptions).toLowerCase();
    expect(text).not.toContain("substitute");
    expect(text).not.toContain("credit");
  });

  it("does not claim the driver's counts are adjusted by sending short", () => {
    const send = one(inputs({ shortfalls: [shortfall()] })).decisionOptions[0]!;
    expect(send.consequences.map((c) => c.audience)).toEqual(["loader", "store", "record"]);
  });

  it("does not offer send short when nothing was loaded; hold becomes the recommendation", () => {
    const { decisionOptions } = one(inputs({ shortfalls: [shortfall({ missingUnits: 20, kind: "MISSING" })] }));
    expect(decisionOptions.map((o) => o.decision)).toEqual(["HOLD_ORDER", "CANCEL_LINE"]);
    expect(decisionOptions.find((o) => o.recommended)?.decision).toBe("HOLD_ORDER");
  });

  describe("move to the later trip", () => {
    const later = (over: Partial<TripInput> = {}) =>
      trip({ id: "T2", tripNo: 2, status: "PLANNED", plannedDepartAt: "09:00", sumWeightKg: 500, sumVolumeM3: 5, stops: [], ...over });
    const offered = (trips: TripInput[]) =>
      one(inputs({ trips, shortfalls: [shortfall()] })).decisionOptions.map((o) => o.decision);

    it("is offered when the same vehicle has a later compatible trip on the plan", () => {
      expect(offered([trip(), later()])).toContain("MOVE_TO_TRIP_2");
    });

    it("is not offered for another vehicle, another plan, an earlier trip, or a sealed trip", () => {
      expect(offered([trip(), later({ vehicleId: "VEH018" })])).not.toContain("MOVE_TO_TRIP_2");
      expect(offered([trip(), later({ planId: "PLN2" })])).not.toContain("MOVE_TO_TRIP_2");
      expect(offered([trip({ tripNo: 2 }), later({ tripNo: 1 })])).not.toContain("MOVE_TO_TRIP_2");
      expect(offered([trip(), later({ status: "READY" })])).not.toContain("MOVE_TO_TRIP_2");
    });

    it("is not offered when the later trip would mix brands or districts (rule 1)", () => {
      expect(offered([trip(), later({ brand: "Style" })])).not.toContain("MOVE_TO_TRIP_2");
      expect(offered([trip(), later({ districtName: "Colombo" })])).not.toContain("MOVE_TO_TRIP_2");
    });

    it("is not offered when the order would not fit the vehicle's caps", () => {
      expect(offered([trip(), later({ sumWeightKg: 2900 })])).not.toContain("MOVE_TO_TRIP_2");
      expect(offered([trip(), later({ sumVolumeM3: 19 })])).not.toContain("MOVE_TO_TRIP_2");
    });
  });

  it("offers only send short once the trip has departed: the order can no longer come off it", () => {
    const { decisionOptions } = one(inputs({ trips: [trip({ status: "DEPARTED" })], shortfalls: [shortfall()] }));
    expect(decisionOptions.map((o) => o.decision)).toEqual(["SEND_SHORT"]);
  });
});

// ---------------------------------------------------------------------------
// Chiller
// ---------------------------------------------------------------------------

describe("chiller exceptions", () => {
  const reefer = (over: Partial<TripInput> = {}) => trip({ vehicleTemp: "reefer", ...over });

  it("raises a critical item for a reading outside its stored band, before departure as loading", () => {
    const item = one(inputs({ trips: [reefer()], chiller: [reading()] }));
    expect(item).toMatchObject({ id: "chiller:CR1", kind: "CHILLER", severity: "critical", category: "loading", status: "open" });
    expect(item.title).toBe("VEH017 chiller read 6.5 °C — target 2–5 °C");
    expect(item.reportedBy).toEqual({ name: "Ranjith Silva", role: "LOADER" });
  });

  it("is a gauge reading by a named person, never a sensor alert or live feed", () => {
    const item = one(inputs({ trips: [reefer()], chiller: [reading()] }));
    expect(item.detail).toContain("Gauge reading entered by Ranjith Silva");
    expect(item.detail).toContain("not a live feed");
    expect(`${item.title} ${item.subtitle} ${item.detail}`.toLowerCase()).not.toContain("sensor");
  });

  it("moves to on the road after departure, with the driver as the source", () => {
    const item = one(
      inputs({
        trips: [reefer({ status: "DEPARTED", departedAt: minutesAgo(60) })],
        pings: new Map([["VEH017", { recordedAt: minutesAgo(1) }]]),
        chiller: [reading({ source: "DRIVER_ON_ARRIVAL", recordedByName: "Sunil Fernando" })],
      }),
    );
    expect(item.category).toBe("on_the_road");
    expect(item.reportedBy).toEqual({ name: "Sunil Fernando", role: "DRIVER" });
  });

  it("raises nothing for an in-range reading, bounds included", () => {
    expect(deriveExceptions(inputs({ trips: [reefer()], chiller: [reading({ tempC: 5 })] }), NOW)).toEqual([]);
    expect(deriveExceptions(inputs({ trips: [reefer()], chiller: [reading({ tempC: 2 })] }), NOW)).toEqual([]);
  });

  it("judges against the band on the row, not today's policy", () => {
    // 6.5 is out of a 2-5 band but fine for a band that was 4-8 when it was read.
    expect(deriveExceptions(inputs({ trips: [reefer()], chiller: [reading({ targetMinC: 4, targetMaxC: 8 })] }), NOW)).toEqual([]);
  });

  it("keys on the reading, so a newer bad reading is a new exception", () => {
    const first = one(inputs({ trips: [reefer()], chiller: [reading({ id: "CR1" })] }));
    const second = one(inputs({ trips: [reefer()], chiller: [reading({ id: "CR2" })] }));
    expect(first.id).not.toBe(second.id);
  });
});

// ---------------------------------------------------------------------------
// Late and Lamp
// ---------------------------------------------------------------------------

describe("late exceptions", () => {
  const departed = (arrivedAt: string | null, plannedArrivalAt = "05:00") =>
    trip({
      status: "DEPARTED",
      departedAt: minutesAgo(90),
      stops: [
        stop({ id: "S1", seq: 1, plannedArrivalAt, status: arrivedAt ? "DONE" : "PENDING", arrivedAt: arrivedAt ? at(arrivedAt) : null }),
        stop({ id: "S2", seq: 2, outletId: "OUT056", outletName: "Fresh Mart Kurunegala", plannedArrivalAt: "05:40", orders: [{ id: "ORD2", ref: "S1-090", units: 8, tempRequirement: "ambient", weightKg: 80, volumeM3: 1 }] }),
      ],
    });
  const lateItems = (t: TripInput) =>
    deriveExceptions(inputs({ trips: [t], pings: new Map([["VEH017", { recordedAt: minutesAgo(1) }]]) }), NOW).filter((i) => i.kind === "LATE");

  it("is not raised under ten minutes late", () => {
    expect(lateItems(departed("05:09"))).toEqual([]);
  });

  it("is a warning from ten minutes and critical from thirty", () => {
    expect(lateItems(departed("05:10"))[0]).toMatchObject({ severity: "warning", title: "VEH017 running 10 min late" });
    expect(lateItems(departed("05:29"))[0]!.severity).toBe("warning");
    expect(lateItems(departed("05:30"))[0]).toMatchObject({ severity: "critical", title: "VEH017 running 30 min late" });
  });

  it("is on the road, names only the stops still ahead, and says where the figure came from", () => {
    const item = lateItems(departed("05:12"))[0]!;
    expect(item).toMatchObject({ id: "late:T1", category: "on_the_road", orderRefs: ["S1-090"] });
    expect(item.affectedOutlets.map((o) => o.outletId)).toEqual(["OUT056"]);
    expect(item.subtitle).toBe("Kurunegala route · stop 1 of 2 · 1 outlet may be late");
    expect(item.detail).toContain("as recorded by the driver");
  });

  it("has no evidence, and so is not late, before the driver has arrived anywhere", () => {
    expect(lateItems(departed(null))).toEqual([]);
  });

  it("only applies to a trip that has departed", () => {
    const t = departed("05:50");
    expect(lateItems({ ...t, status: "LOADING" })).toEqual([]);
  });
});

describe("Lamp Mode exceptions", () => {
  const out = (over: Partial<TripInput> = {}) =>
    trip({ status: "DEPARTED", departedAt: minutesAgo(60), stops: [stop({ plannedArrivalAt: "07:00" })], ...over });
  const lamp = (t: TripInput, pings: ExceptionInputs["pings"]) =>
    deriveExceptions(inputs({ trips: [t], pings }), NOW).filter((i) => i.kind === "LAMP");

  it("is raised once the last report is older than the lamp threshold", () => {
    const [item] = lamp(out(), new Map([["VEH017", { recordedAt: minutesAgo(14) }]]));
    expect(item).toMatchObject({ id: "lamp:T1", severity: "warning", category: "on_the_road" });
    expect(item!.title).toBe("VEH017 in Lamp Mode · no update 14 min");
    expect(item!.subtitle).toBe("Kurunegala · last reliable update 05:46");
    expect(item!.detail).toBe("Driver works offline; ETA is estimated");
    expect(item!.reportedBy.name).toBe("System");
  });

  it("is not raised while the report is fresh enough", () => {
    expect(lamp(out(), new Map([["VEH017", { recordedAt: minutesAgo(10) }]]))).toEqual([]);
  });

  it("is raised for a vehicle that has never reported, ten minutes after it departed", () => {
    const [item] = lamp(out({ departedAt: minutesAgo(12) }), new Map());
    expect(item!.title).toBe("VEH017 in Lamp Mode · no update 12 min");
    expect(item!.subtitle).toContain("no position reported since departure");
    expect(lamp(out({ departedAt: minutesAgo(9) }), new Map())).toEqual([]);
  });

  it("does not take a ping from before departure as a report from the road", () => {
    // The phone said where it was at the dock at 05:00; the vehicle left at 05:30 and has said nothing since.
    const t = out({ departedAt: minutesAgo(30) });
    const [item] = lamp(t, new Map([["VEH017", { recordedAt: minutesAgo(45) }]]));
    expect(item!.subtitle).toContain("no position reported since departure");
  });

  it("only applies to departed trips", () => {
    expect(lamp({ ...out(), status: "READY" }, new Map())).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Problems
// ---------------------------------------------------------------------------

describe("problem exceptions", () => {
  it("is on the road when a driver raised it and store when a store manager did", () => {
    const driver = one(inputs({ problems: [problem()] }));
    expect(driver).toMatchObject({ id: "problem:PRB1", category: "on_the_road", kind: "PROBLEM" });
    const store = one(
      inputs({ problems: [problem({ raisedBy: { name: "Fathima Rizvi", role: "STORE_MANAGER" }, kind: "GOODS_DAMAGED", reasonCode: "ITEMS_MISSING", units: 4 })] }),
    );
    expect(store).toMatchObject({ category: "store", severity: "info", title: "Items missing reported · S1-082" });
    expect(store.subtitle).toBe("Kandy City Centre · S1-082 · 4 units affected");
    expect(store.affectedOutlets[0]).toMatchObject({ delta: -4 });
  });

  it("maps driver problem kinds to severities by whether the run can still finish", () => {
    expect(problemSeverity("VEHICLE_BREAKDOWN", false, null)).toBe("critical");
    for (const kind of ["ROAD_BLOCKED", "OUTLET_CLOSED", "ACCESS_DENIED", "DELIVERY_REFUSED", "GOODS_DAMAGED"]) {
      expect(problemSeverity(kind, false, null), kind).toBe("warning");
    }
    expect(problemSeverity("OTHER", false, null)).toBe("info");
  });

  it("maps store issues to info, except warm chilled goods and a refused or blocked delivery", () => {
    expect(problemSeverity("GOODS_DAMAGED", true, "ITEMS_MISSING")).toBe("info");
    expect(problemSeverity("OTHER", true, null)).toBe("info");
    expect(problemSeverity("OUTLET_CLOSED", true, null)).toBe("info");
    expect(problemSeverity("GOODS_DAMAGED", true, "ARRIVED_WARM")).toBe("warning");
    expect(problemSeverity("DELIVERY_REFUSED", true, null)).toBe("warning");
    expect(problemSeverity("ACCESS_DENIED", true, null)).toBe("warning");
  });

  it("keeps an acknowledged problem open, and offers only resolve", () => {
    const item = one(inputs({ problems: [problem({ status: "ACKNOWLEDGED", acknowledgedAt: minutesAgo(2), acknowledgedByName: "Nimal Perera" })] }));
    expect(item.status).toBe("open");
    expect(item.acknowledgement).toMatchObject({ byName: "Nimal Perera" });
    expect(item.decisionOptions.map((o) => o.decision)).toEqual(["RESOLVE"]);
    expect(item.decisionOptions[0]).toMatchObject({ requiresNote: true, recommended: true });
  });

  it("offers acknowledge and resolve on a new problem, and nothing on a resolved one", () => {
    expect(one(inputs({ problems: [problem()] })).decisionOptions.map((o) => o.decision)).toEqual(["ACKNOWLEDGE", "RESOLVE"]);
    const resolved = one(inputs({ problems: [problem({ status: "RESOLVED", resolution: "Rebooked", resolvedAt: minutesAgo(1) })] }));
    expect(resolved).toMatchObject({ status: "resolved", decisionOptions: [] });
    expect(resolved.resolution).toMatchObject({ decision: "RESOLVE", note: "Rebooked" });
  });
});

// ---------------------------------------------------------------------------
// Planning
// ---------------------------------------------------------------------------

describe("planning exceptions", () => {
  const planning = {
    planId: "PLN9",
    createdAt: minutesAgo(32),
    outletNames: new Map([["OUT033", "Colombo City Centre (Mall)"]]),
    departAtByTrip: new Map([["VEH017|1", "04:11"]]),
    violations: [
      { code: "CHILLED_ON_NON_REEFER", severity: "error", message: "S1-0005 is chilled but VEH017 is not refrigerated.", vehicleId: "VEH017", tripNo: 1, orderRefs: ["S1-0005"], outletIds: ["OUT033"], overridable: false },
      { code: "NON_FRESH_WINDOW_MISSED", severity: "warning", message: "ETA 12:18 vs 10:00-12:00.", orderRefs: ["S1-0010"], overridable: false },
      { code: "NON_FRESH_WINDOW_MISSED", severity: "warning", message: "Another.", orderRefs: ["S1-0011"], overridable: false },
    ],
  } as const;

  it("maps error to critical and warning to warning, with no decisions and a link to the plan", () => {
    const items = deriveExceptions(inputs({ trips: [], planning: planning as never }), NOW);
    expect(items.map((i) => [i.severity, i.category, i.planId])).toEqual([
      ["critical", "planning", "PLN9"],
      ["warning", "planning", "PLN9"],
      ["warning", "planning", "PLN9"],
    ]);
    expect(items.every((i) => i.decisionOptions.length === 0)).toBe(true);
    expect(items[0]).toMatchObject({ title: "Chilled needs a refrigerated vehicle", departsAt: "04:11", vehicleId: "VEH017" });
    expect(items[0]!.affectedOutlets).toEqual([{ outletId: "OUT033", outletName: "Colombo City Centre (Mall)", stopSeq: null, ordered: null, delta: null }]);
  });

  it("numbers repeats of a rule so every id is distinct and stable", () => {
    const ids = deriveExceptions(inputs({ trips: [], planning: planning as never }), NOW).map((i) => i.id);
    expect(ids).toEqual([
      "plan:PLN9:CHILLED_ON_NON_REEFER:0",
      "plan:PLN9:NON_FRESH_WINDOW_MISSED:0",
      "plan:PLN9:NON_FRESH_WINDOW_MISSED:1",
    ]);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

// ---------------------------------------------------------------------------
// Ordering, acknowledgement, summary, filters
// ---------------------------------------------------------------------------

describe("ordering", () => {
  it("lists open before resolved, then by departure, then by when it was raised", () => {
    const trips = [
      trip({ id: "T1", plannedDepartAt: "06:00" }),
      trip({ id: "T2", vehicleId: "VEH018", plannedDepartAt: "04:11", tripNo: 1, planId: "PLN1" }),
    ];
    const items = deriveExceptions(
      inputs({
        trips,
        shortfalls: [
          shortfall({ id: "A", tripId: "T1", raisedAt: minutesAgo(30) }),
          shortfall({ id: "B", tripId: "T2", raisedAt: minutesAgo(5) }),
          shortfall({ id: "C", tripId: "T2", raisedAt: minutesAgo(20), orderRef: "S1-083" }),
          shortfall({ id: "D", tripId: "T2", raisedAt: minutesAgo(50), status: "RESOLVED", resolution: "SEND_SHORT", resolvedAt: minutesAgo(40) }),
        ],
        // A store issue about a delivery already made has no departure to race.
        problems: [problem({ id: "P", raisedBy: { name: "F", role: "STORE_MANAGER" }, tripId: "T1", raisedAt: minutesAgo(900) })],
      }),
      NOW,
    );
    expect(items.map((i) => i.id)).toEqual(["shortfall:C", "shortfall:B", "shortfall:A", "problem:P", "shortfall:D"]);
  });
});

describe("acknowledgement", () => {
  const lateTrip = (arrived: string) =>
    trip({ status: "DEPARTED", departedAt: minutesAgo(90), stops: [stop({ status: "DONE", arrivedAt: at(arrived) }), stop({ id: "S2", seq: 2, plannedArrivalAt: "06:30" })] });
  const pings = new Map([["VEH017", { recordedAt: minutesAgo(1) }]]);

  it("is read back onto the item and removes the acknowledge option", () => {
    const item = one(
      inputs({
        trips: [lateTrip("05:12")],
        pings,
        acknowledgements: new Map([["late:T1", { at: minutesAgo(3), byName: "Nimal Perera", severity: "warning" as const }]]),
      }),
    );
    expect(item.status).toBe("open");
    expect(item.acknowledgement).toMatchObject({ byName: "Nimal Perera" });
    expect(item.decisionOptions).toEqual([]);
  });

  it("is void once the item has become more severe than when it was acknowledged", () => {
    const item = one(
      inputs({
        trips: [lateTrip("05:40")],
        pings,
        acknowledgements: new Map([["late:T1", { at: minutesAgo(30), byName: "Nimal Perera", severity: "warning" as const }]]),
      }),
    );
    expect(item.severity).toBe("critical");
    expect(item.acknowledgement).toBeNull();
    expect(item.decisionOptions.map((o) => o.decision)).toEqual(["ACKNOWLEDGE"]);
  });
});

describe("summary", () => {
  const items = () =>
    deriveExceptions(
      inputs({
        trips: [trip(), trip({ id: "T2", vehicleId: "VEH018", plannedDepartAt: "05:00", stops: [stop({ id: "S9", outletId: "OUT099", orders: [{ id: "ORD9", ref: "S1-099", units: 5, tempRequirement: "ambient", weightKg: 1, volumeM3: 1 }] })] })],
        shortfalls: [
          shortfall({ id: "A" }),
          shortfall({ id: "B", orderId: "ORD1", orderRef: "S1-082", raisedAt: minutesAgo(40) }),
          shortfall({ id: "R1", status: "RESOLVED", resolution: "SEND_SHORT", raisedAt: minutesAgo(60), resolvedAt: minutesAgo(40) }),
          shortfall({ id: "R2", status: "RESOLVED", resolution: "HOLD_ORDER", raisedAt: minutesAgo(50), resolvedAt: minutesAgo(41) }),
        ],
        problems: [
          problem({ id: "P1", tripId: "T2", vehicleId: "VEH018", orderRef: "S1-099", outletId: "OUT099", kind: "VEHICLE_BREAKDOWN" }),
          problem({ id: "P2", raisedBy: { name: "F", role: "STORE_MANAGER" }, kind: "OTHER", orderRef: null, outletId: "OUT074", vehicleId: null }),
        ],
      }),
      NOW,
    );

  it("counts open, critical, and distinct orders, outlets and vehicles over open items only", () => {
    const s = summarise(items());
    expect(s.open).toBe(4);
    expect(s.critical).toBe(3); // two blocking shortfalls + the breakdown
    expect(s.ordersAffected).toBe(2); // S1-082 twice counts once; S1-099
    expect(s.outletsAffected).toBe(3); // OUT027, OUT099, OUT074
    expect(s.vehiclesAffected).toBe(2); // VEH017, VEH018
    expect(s.countsByCategory).toEqual({ planning: 0, loading: 2, on_the_road: 1, store: 1 });
    expect(s.countsBySeverity).toEqual({ critical: 3, warning: 0, info: 1 });
  });

  it("counts resolved items and averages raise-to-resolve minutes, rounded", () => {
    const s = summarise(items());
    expect(s.resolvedToday).toBe(2);
    // (20 + 9) / 2 = 14.5 -> 15
    expect(s.avgResolveMinutes).toBe(15);
  });

  it("reports no average, not zero, when nothing resolved has a resolution time", () => {
    const s = summarise(deriveExceptions(inputs({ shortfalls: [shortfall()] }), NOW));
    expect(s.resolvedToday).toBe(0);
    expect(s.avgResolveMinutes).toBeNull();
    const noTime = summarise(deriveExceptions(inputs({ shortfalls: [shortfall({ status: "RESOLVED", resolution: "SEND_SHORT", resolvedAt: null })] }), NOW));
    expect(noTime.resolvedToday).toBe(1);
    expect(noTime.avgResolveMinutes).toBeNull();
  });
});

describe("filtering", () => {
  const all = deriveExceptions(
    inputs({
      shortfalls: [shortfall(), shortfall({ id: "R", orderRef: "S1-555", status: "RESOLVED", resolution: "SEND_SHORT", resolvedAt: minutesAgo(1) })],
      problems: [problem({ kind: "OTHER", raisedBy: { name: "F", role: "STORE_MANAGER" } })],
    }),
    NOW,
  );

  it("defaults to open", () => {
    expect(filterExceptions(all, {}).map((i) => i.id)).toEqual(["shortfall:SF1", "problem:PRB1"]);
    expect(filterExceptions(all, { status: "resolved" }).map((i) => i.id)).toEqual(["shortfall:R"]);
    expect(filterExceptions(all, { status: "all" })).toHaveLength(3);
  });

  it("narrows by category and severity", () => {
    expect(filterExceptions(all, { category: "store" }).map((i) => i.id)).toEqual(["problem:PRB1"]);
    expect(filterExceptions(all, { severity: "critical" }).map((i) => i.id)).toEqual(["shortfall:SF1"]);
  });

  it("searches order ref, vehicle and outlet, case-insensitively", () => {
    expect(filterExceptions(all, { q: "s1-082" })).toHaveLength(2);
    expect(filterExceptions(all, { q: "veh017" })).toHaveLength(2);
    expect(filterExceptions(all, { q: "kandy" })).toHaveLength(2);
    expect(filterExceptions(all, { q: "nothing like this" })).toEqual([]);
  });
});

describe("ids", () => {
  it("parses every kind and rejects anything else", () => {
    expect(parseExceptionId("shortfall:clx1")).toEqual({ kind: "SHORTFALL", key: "clx1" });
    expect(parseExceptionId("problem:01JB2X8Q9K7YC4V3M0ZQ5T6RWE")).toEqual({ kind: "PROBLEM", key: "01JB2X8Q9K7YC4V3M0ZQ5T6RWE" });
    expect(parseExceptionId("chiller:clx2")).toEqual({ kind: "CHILLER", key: "clx2" });
    expect(parseExceptionId("late:clx3")).toEqual({ kind: "LATE", key: "clx3" });
    expect(parseExceptionId("lamp:clx3")).toEqual({ kind: "LAMP", key: "clx3" });
    expect(parseExceptionId("plan:clx4:CHILLED_ON_NON_REEFER:2")).toEqual({ kind: "PLANNING", key: "clx4" });
    for (const bad of ["", "shortfall", "shortfall:", "order:clx1", "plan:clx4", "shortfall:a:b", "shortfall:../x"]) {
      expect(parseExceptionId(bad), bad).toBeNull();
    }
  });
});

// ---------------------------------------------------------------------------
// Routes: who may see and decide what, and what a decision writes
// ---------------------------------------------------------------------------

const dispatcher: SessionUser = {
  id: "USR-D",
  email: "nimal@waypoint.lk",
  name: "Nimal Perera",
  role: "DISPATCHER",
  depotCode: "Peliyagoda",
  outletId: null,
  defaultVehicleId: null,
};

describe("exceptions routes", () => {
  const servers: ReturnType<typeof Fastify>[] = [];

  async function serverFor(user: SessionUser) {
    const server = Fastify({ logger: false, ajv: CONTRACT_AJV });
    servers.push(server);
    server.decorateRequest("requireRole", function (...roles: string[]) {
      if (roles.length && !roles.includes(user.role)) throw new AuthError("Forbidden", 403);
      return user;
    });
    await server.register(errorsPlugin);
    await server.register(exceptionRoutes, { prefix: "/v1" });
    return server;
  }

  const load = vi.mocked(loadExceptionInputs);

  beforeEach(async () => {
    vi.resetAllMocks();
    vi.mocked(prisma.$transaction).mockImplementation((async (fn: (tx: unknown) => unknown) => fn(prisma)) as never);
    // The singleton `exceptionsForDay` is replaced above; route it back through the real derivation.
    const actual = await vi.importActual<typeof import("../services/exceptions.js")>("../services/exceptions.js");
    const { exceptionsForDay } = await import("../services/exceptions.js");
    vi.mocked(exceptionsForDay).mockImplementation(async (depot, date, now) =>
      actual.deriveExceptions(await load(depot, date, now), now),
    );
    vi.mocked(recordDecisions).mockResolvedValue(undefined);
  });

  afterEach(async () => {
    await Promise.all(servers.splice(0).map((s) => s.close()));
  });

  describe("GET /exceptions", () => {
    it("refuses every role but a dispatcher", async () => {
      for (const role of ["LOADER", "DRIVER", "STORE_MANAGER"] as const) {
        const server = await serverFor({ ...dispatcher, role });
        const response = await server.inject({ method: "GET", url: "/v1/exceptions" });
        expect(response.statusCode, role).toBe(403);
      }
      expect(load).not.toHaveBeenCalled();
    });

    it("scopes to the dispatcher's own depot, never one the caller names", async () => {
      load.mockResolvedValue(inputs());
      const server = await serverFor(dispatcher);
      const response = await server.inject({ method: "GET", url: "/v1/exceptions?date=2026-09-29" });
      expect(response.statusCode).toBe(200);
      expect(load.mock.calls[0]![0]).toBe("Peliyagoda");
      const rejected = await server.inject({ method: "GET", url: "/v1/exceptions?depot=Kandy" });
      expect(rejected.statusCode).toBe(422);
    });

    it("returns the summary over the whole day and the list filtered", async () => {
      load.mockResolvedValue(inputs({ shortfalls: [shortfall()], problems: [problem({ kind: "OTHER", raisedBy: { name: "F", role: "STORE_MANAGER" } })] }));
      const server = await serverFor(dispatcher);
      const response = await server.inject({ method: "GET", url: "/v1/exceptions?date=2026-09-29&category=store" });
      const body = response.json();
      expect(body.date).toBe("2026-09-29");
      expect(body.summary.open).toBe(2);
      expect(body.exceptions.map((e: { id: string }) => e.id)).toEqual(["problem:PRB1"]);
    });
  });

  describe("GET /exceptions/:id", () => {
    it("answers 403 for a shortfall at another depot, the same as one that does not exist", async () => {
      vi.mocked(requireDispatcherShortfall).mockRejectedValue(new AuthError("no", 403));
      const server = await serverFor(dispatcher);
      const response = await server.inject({ method: "GET", url: "/v1/exceptions/shortfall:SFX" });
      expect(response.statusCode).toBe(403);
      expect(load).not.toHaveBeenCalled();
    });

    it("answers 403 for a problem or plan the predicates refuse", async () => {
      vi.mocked(requireDispatcherProblem).mockRejectedValue(new AuthError("no", 403));
      vi.mocked(requireDispatcherPlan).mockRejectedValue(new AuthError("no", 403));
      const server = await serverFor(dispatcher);
      expect((await server.inject({ method: "GET", url: "/v1/exceptions/problem:PX" })).statusCode).toBe(403);
      expect((await server.inject({ method: "GET", url: "/v1/exceptions/plan:PL1:CHILLED_ON_NON_REEFER:0" })).statusCode).toBe(403);
    });

    it("answers 403 for a trip-derived item whose trip is at another depot", async () => {
      vi.mocked(prisma.trip.findFirst).mockResolvedValue(null);
      vi.mocked(prisma.chillerReading.findFirst).mockResolvedValue(null);
      const server = await serverFor(dispatcher);
      expect((await server.inject({ method: "GET", url: "/v1/exceptions/late:TX" })).statusCode).toBe(403);
      expect((await server.inject({ method: "GET", url: "/v1/exceptions/chiller:CX" })).statusCode).toBe(403);
      expect(vi.mocked(prisma.trip.findFirst).mock.calls[0]![0]).toMatchObject({
        where: { id: "TX", plan: { planningDay: { depotCode: "Peliyagoda" } } },
      });
    });

    it("answers 404 for an id that is not one of ours", async () => {
      const server = await serverFor(dispatcher);
      expect((await server.inject({ method: "GET", url: "/v1/exceptions/order:ORD1" })).statusCode).toBe(404);
    });

    it("answers 404 EXCEPTION_NOT_ACTIVE for a condition that has cleared", async () => {
      vi.mocked(prisma.trip.findFirst).mockResolvedValue({ plan: { planningDay: { date: new Date("2026-09-29T00:00:00Z") } } } as never);
      load.mockResolvedValue(inputs());
      const server = await serverFor(dispatcher);
      const response = await server.inject({ method: "GET", url: "/v1/exceptions/late:T1" });
      expect(response.statusCode).toBe(404);
      expect(response.json().error.code).toBe("EXCEPTION_NOT_ACTIVE");
    });

    it("returns the exception with its activity, oldest last", async () => {
      vi.mocked(requireDispatcherShortfall).mockResolvedValue({ tripId: "T1" } as never);
      vi.mocked(prisma.trip.findUnique).mockResolvedValue({ plan: { planningDay: { date: new Date("2026-09-29T00:00:00Z") } } } as never);
      load.mockResolvedValue(inputs({ shortfalls: [shortfall()] }));
      const server = await serverFor(dispatcher);
      const response = await server.inject({ method: "GET", url: "/v1/exceptions/shortfall:SF1" });
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.id).toBe("shortfall:SF1");
      expect(body.activity.at(-1)).toMatchObject({ action: "exception.raise", actorName: "Ranjith Silva" });
      // Only the sources an item needs are loaded, so opening a shortfall never runs the plan validator.
      expect(load.mock.calls[0]![3]).toEqual(["shortfall"]);
    });
  });

  describe("POST /exceptions/:id/decision", () => {
    const decide = async (id: string, body: unknown, user = dispatcher) =>
      (await serverFor(user)).inject({ method: "POST", url: `/v1/exceptions/${id}/decision`, payload: body as never });

    const locateShortfall = () => {
      vi.mocked(requireDispatcherShortfall).mockResolvedValue({ tripId: "T1" } as never);
      vi.mocked(prisma.trip.findUnique).mockResolvedValue({ plan: { planningDay: { date: new Date("2026-09-29T00:00:00Z") } } } as never);
    };
    const orderRow = {
      id: "ORD1", ref: "S1-082", outletId: "OUT027", brand: "Fresh", districtName: "Kurunegala", depotCode: "Peliyagoda",
      tempRequirement: "ambient", units: 20, weightKg: 200, volumeM3: 2, windowOpen: "06:00", windowClose: "08:00",
    };

    it("refuses another role and an unknown decision", async () => {
      expect((await decide("shortfall:SF1", { decision: "SEND_SHORT" }, { ...dispatcher, role: "LOADER" })).statusCode).toBe(403);
      expect((await decide("shortfall:SF1", { decision: "SUBSTITUTE" })).statusCode).toBe(422);
      expect((await decide("shortfall:SF1", { decision: "SEND_SHORT", surprise: 1 })).statusCode).toBe(422);
    });

    it("does not let a dispatcher at another depot decide a shortfall", async () => {
      vi.mocked(requireDispatcherShortfall).mockRejectedValue(new AuthError("no", 403));
      const response = await decide("shortfall:SF1", { decision: "SEND_SHORT" });
      expect(response.statusCode).toBe(403);
      expect(prisma.shortfall.updateMany).not.toHaveBeenCalled();
    });

    it("answers 409 NO_DECISION_AVAILABLE for a planning item", async () => {
      vi.mocked(requireDispatcherPlan).mockResolvedValue({ planningDay: { date: new Date("2026-09-29T00:00:00Z") } } as never);
      const response = await decide("plan:PLN1:CHILLED_ON_NON_REEFER:0", { decision: "ACKNOWLEDGE" });
      expect(response.statusCode).toBe(409);
      expect(response.json().error.code).toBe("NO_DECISION_AVAILABLE");
      expect(recordDecisions).not.toHaveBeenCalled();
    });

    describe("SEND_SHORT", () => {
      beforeEach(() => {
        locateShortfall();
        vi.mocked(prisma.shortfall.updateMany).mockResolvedValue({ count: 1 });
        vi.mocked(prisma.order.findUnique).mockResolvedValue(orderRow as never);
      });

      it("closes the shortfall, lifts the block, tells the store, and leaves the order and trip alone", async () => {
        const open = inputs({ shortfalls: [shortfall()] });
        const done = inputs({ shortfalls: [shortfall({ status: "RESOLVED", resolution: "SEND_SHORT", resolvedAt: NOW, blocksDeparture: false })] });
        load.mockResolvedValueOnce(open).mockResolvedValueOnce(done);

        const response = await decide("shortfall:SF1", { decision: "SEND_SHORT", note: "Stock is on tomorrow's truck" });

        expect(response.statusCode).toBe(200);
        expect(prisma.shortfall.updateMany).toHaveBeenCalledWith({
          where: { id: "SF1", status: "OPEN" },
          data: expect.objectContaining({ status: "RESOLVED", resolution: "SEND_SHORT", blocksDeparture: false, resolvedByUserId: "USR-D" }),
        });
        expect(prisma.notification.create).toHaveBeenCalledTimes(1);
        expect(vi.mocked(prisma.notification.create).mock.calls[0]![0].data).toMatchObject({
          outletId: "OUT027",
          kind: "shortfall.send_short",
        });
        // The order is not rewritten: the store ordered 20.
        expect(prisma.order.update).not.toHaveBeenCalled();
        expect(prisma.order.create).not.toHaveBeenCalled();
        expect(prisma.tripStopOrder.deleteMany).not.toHaveBeenCalled();
        expect(prisma.trip.update).not.toHaveBeenCalled();

        const records = vi.mocked(recordDecisions).mock.calls[0]![0];
        expect(records.map((r) => [r.entityType, r.action])).toEqual([
          ["Shortfall", "shortfall.resolve"],
          ["Order", "order.ship_short"],
        ]);
        expect(records[0]).toMatchObject({ entityId: "SF1", note: "Stock is on tomorrow's truck" });

        const body = response.json();
        expect(body.replayed).toBe(false);
        expect(body.exception.status).toBe("resolved");
        expect(body.consequences.map((c: { audience: string }) => c.audience)).toEqual(["loader", "store", "record"]);
      });

      it("with followUp creates the next-day order for the missing units, keyed on the shortfall", async () => {
        load.mockResolvedValue(inputs({ shortfalls: [shortfall()] }));
        vi.mocked(prisma.order.findUnique).mockImplementation((async (args: { where: { id?: string; clientRequestId?: string } }) =>
          args.where.clientRequestId ? null : orderRow) as never);
        vi.mocked(prisma.order.findFirst).mockResolvedValue({ ref: "ORD-004390" } as never);
        vi.mocked(prisma.order.create).mockImplementation((async (args: { data: Record<string, unknown> }) => ({ id: "ORD-NEW", ...args.data })) as never);

        const response = await decide("shortfall:SF1", { decision: "SEND_SHORT", followUp: true });

        expect(response.statusCode).toBe(200);
        expect(vi.mocked(prisma.order.create).mock.calls[0]![0].data).toMatchObject({
          ref: "ORD-004391",
          outletId: "OUT027",
          units: 4,
          // 4 of 20 units: a fifth of the order's weight and volume.
          weightKg: 40,
          volumeM3: 0.4,
          status: "QUEUED",
          rolledFromOrderId: "ORD1",
          clientRequestId: "followup:SF1",
        });
        expect(vi.mocked(prisma.order.create).mock.calls[0]![0].data.requestedDate).toEqual(new Date("2026-09-30T00:00:00.000Z"));
        // The new day has to exist for the order to be closable and plannable.
        expect(prisma.planningDay.upsert).toHaveBeenCalledWith({
          where: { date_depotCode: { date: new Date("2026-09-30T00:00:00.000Z"), depotCode: orderRow.depotCode } },
          create: { date: new Date("2026-09-30T00:00:00.000Z"), depotCode: orderRow.depotCode },
          update: {},
        });
        // A share of an order is not the whole of its contents, so no lines are copied.
        expect(prisma.orderLine.findMany).not.toHaveBeenCalled();
        const body = response.json();
        expect(body.consequences.map((c: { audience: string }) => c.audience)).toEqual(["loader", "store", "order", "record"]);
        expect(body.consequences[2].detail).toContain("ORD-004391");
        expect(vi.mocked(recordDecisions).mock.calls[0]![0].map((r) => r.action)).toEqual([
          "shortfall.resolve",
          "order.ship_short",
          "order.place",
        ]);
      });

      it("returns the same body and does nothing when the identical decision is repeated", async () => {
        const decided = inputs({
          shortfalls: [shortfall({ status: "RESOLVED", resolution: "SEND_SHORT", resolvedAt: NOW, blocksDeparture: false })],
          shortfallDecisions: new Map([["SF1", { at: NOW, byName: "Nimal Perera", note: null, decision: "SEND_SHORT" }]]),
        });
        load.mockResolvedValue(decided);
        vi.mocked(prisma.order.findUnique).mockResolvedValue(null);

        const response = await decide("shortfall:SF1", { decision: "SEND_SHORT" });

        expect(response.statusCode).toBe(200);
        expect(response.json().replayed).toBe(true);
        expect(prisma.shortfall.updateMany).not.toHaveBeenCalled();
        expect(prisma.notification.create).not.toHaveBeenCalled();
        expect(recordDecisions).not.toHaveBeenCalled();
      });

      it("never double-creates the follow-up order when a decision is retried", async () => {
        load.mockResolvedValue(
          inputs({
            shortfalls: [shortfall({ status: "RESOLVED", resolution: "SEND_SHORT", resolvedAt: NOW, blocksDeparture: false })],
            shortfallDecisions: new Map([["SF1", { at: NOW, byName: "Nimal Perera", note: null, decision: "SEND_SHORT" }]]),
          }),
        );
        vi.mocked(prisma.order.findUnique).mockResolvedValue({ ref: "ORD-004391" } as never);

        const response = await decide("shortfall:SF1", { decision: "SEND_SHORT", followUp: true });

        expect(response.statusCode).toBe(200);
        expect(response.json().replayed).toBe(true);
        expect(response.json().consequences.find((c: { audience: string }) => c.audience === "order").detail).toContain("ORD-004391");
        expect(prisma.order.create).not.toHaveBeenCalled();
        expect(prisma.order.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { clientRequestId: "followup:SF1" } }));
      });

      it("answers 409 ALREADY_DECIDED with the existing resolution when decided differently", async () => {
        load.mockResolvedValue(
          inputs({
            shortfalls: [shortfall({ status: "RESOLVED", resolution: "SEND_SHORT", resolvedAt: NOW, blocksDeparture: false })],
            shortfallDecisions: new Map([["SF1", { at: NOW, byName: "Nimal Perera", note: null, decision: "SEND_SHORT" }]]),
          }),
        );
        vi.mocked(prisma.order.findUnique).mockResolvedValue(null);

        const response = await decide("shortfall:SF1", { decision: "HOLD_ORDER" });

        expect(response.statusCode).toBe(409);
        expect(response.json().error).toMatchObject({ code: "ALREADY_DECIDED", details: { resolution: "SEND_SHORT", decidedBy: "Nimal Perera" } });
        expect(prisma.shortfall.updateMany).not.toHaveBeenCalled();
      });

      it("treats a retry that asks for a follow-up the first call did not make as a different decision", async () => {
        load.mockResolvedValue(
          inputs({
            shortfalls: [shortfall({ status: "RESOLVED", resolution: "SEND_SHORT", resolvedAt: NOW, blocksDeparture: false })],
            shortfallDecisions: new Map([["SF1", { at: NOW, byName: "Nimal Perera", note: null, decision: "SEND_SHORT" }]]),
          }),
        );
        vi.mocked(prisma.order.findUnique).mockResolvedValue(null);
        const response = await decide("shortfall:SF1", { decision: "SEND_SHORT", followUp: true });
        expect(response.statusCode).toBe(409);
        expect(prisma.order.create).not.toHaveBeenCalled();
      });

      it("will not let a loader's corrected load check be re-decided as if the dispatcher had done it", async () => {
        load.mockResolvedValue(inputs({ shortfalls: [shortfall({ status: "RESOLVED", resolution: "SEND_SHORT", resolvedAt: NOW, blocksDeparture: false })] }));
        vi.mocked(prisma.order.findUnique).mockResolvedValue(null);
        const response = await decide("shortfall:SF1", { decision: "SEND_SHORT" });
        expect(response.statusCode).toBe(409);
        expect(response.json().error.message).toContain("loader corrected the load check");
      });

      it("re-classifies instead of writing when another dispatcher won the claim", async () => {
        load.mockResolvedValueOnce(inputs({ shortfalls: [shortfall()] })).mockResolvedValue(
          inputs({
            shortfalls: [shortfall({ status: "RESOLVED", resolution: "HOLD_ORDER", resolvedAt: NOW, blocksDeparture: false })],
            shortfallDecisions: new Map([["SF1", { at: NOW, byName: "Other Dispatcher", note: null, decision: "HOLD_ORDER" }]]),
          }),
        );
        vi.mocked(prisma.shortfall.updateMany).mockResolvedValue({ count: 0 });
        vi.mocked(prisma.order.findUnique).mockResolvedValue(null);
        const response = await decide("shortfall:SF1", { decision: "SEND_SHORT" });
        expect(response.statusCode).toBe(409);
        expect(response.json().error.code).toBe("ALREADY_DECIDED");
        expect(prisma.notification.create).not.toHaveBeenCalled();
        expect(recordDecisions).not.toHaveBeenCalled();
      });

      it("refuses followUp on any other decision", async () => {
        load.mockResolvedValue(inputs({ shortfalls: [shortfall()] }));
        const response = await decide("shortfall:SF1", { decision: "HOLD_ORDER", followUp: true });
        expect(response.statusCode).toBe(422);
        expect(response.json().error.code).toBe("FOLLOW_UP_NOT_APPLICABLE");
      });
    });

    describe("HOLD_ORDER, CANCEL_LINE and MOVE_TO_TRIP_2", () => {
      beforeEach(() => {
        locateShortfall();
        vi.mocked(prisma.shortfall.updateMany).mockResolvedValue({ count: 1 });
        vi.mocked(prisma.order.findUnique).mockResolvedValue(orderRow as never);
      });
      const base = () => inputs({ shortfalls: [shortfall()] });

      it("hold: order DEFERRED, off the trip, stop skipped, a deferral to the next run, store told", async () => {
        load.mockResolvedValue(base());
        const response = await decide("shortfall:SF1", { decision: "HOLD_ORDER", note: "Restock Thursday" });

        expect(response.statusCode).toBe(200);
        expect(prisma.tripStopOrder.deleteMany).toHaveBeenCalledWith({ where: { orderId: "ORD1", tripStopId: "ST1" } });
        // The stop's only order left it, so it is passed over rather than visited for nothing.
        expect(prisma.tripStop.update).toHaveBeenCalledWith({ where: { id: "ST1" }, data: { status: "SKIPPED" } });
        expect(prisma.trip.update).toHaveBeenCalledWith({
          where: { id: "T1" },
          data: { sumWeightKg: { decrement: 200 }, sumVolumeM3: { decrement: 2 } },
        });
        expect(prisma.assignment.updateMany).toHaveBeenCalledWith({
          where: { planId: "PLN1", orderId: "ORD1" },
          data: expect.objectContaining({ decision: "DEFERRED", tripStopId: null }),
        });
        expect(prisma.order.update).toHaveBeenCalledWith({ where: { id: "ORD1" }, data: { status: "DEFERRED" } });
        expect(vi.mocked(prisma.deferral.upsert).mock.calls[0]![0].create).toMatchObject({
          planId: "PLN1",
          orderId: "ORD1",
          reasonCode: "MISSING",
          rolledToDate: new Date("2026-09-30T00:00:00.000Z"),
          decidedByUserId: "USR-D",
        });
        expect(vi.mocked(prisma.notification.create).mock.calls[0]![0].data).toMatchObject({ outletId: "OUT027", kind: "deferred" });
        expect(vi.mocked(recordDecisions).mock.calls[0]![0].map((r) => r.action)).toEqual(["shortfall.resolve", "order.defer"]);
        expect(response.json().consequences.map((c: { audience: string }) => c.audience)).toEqual(["loader", "driver", "store", "order", "record"]);
      });

      it("hold: keeps a stop that still has other orders", async () => {
        const shared = trip({
          stops: [stop({ orders: [...stop().orders, { id: "ORD7", ref: "S1-090", units: 3, tempRequirement: "ambient", weightKg: 30, volumeM3: 0.3 }] })],
        });
        load.mockResolvedValue(inputs({ trips: [shared], shortfalls: [shortfall()] }));
        await decide("shortfall:SF1", { decision: "HOLD_ORDER" });
        expect(prisma.tripStopOrder.deleteMany).toHaveBeenCalled();
        expect(prisma.tripStop.update).not.toHaveBeenCalled();
      });

      it("cancel: order CANCELLED, off the trip, no deferral, store told", async () => {
        load.mockResolvedValue(base());
        const response = await decide("shortfall:SF1", { decision: "CANCEL_LINE" });
        expect(response.statusCode).toBe(200);
        expect(prisma.order.update).toHaveBeenCalledWith({ where: { id: "ORD1" }, data: { status: "CANCELLED" } });
        expect(prisma.deferral.upsert).not.toHaveBeenCalled();
        expect(prisma.tripStopOrder.deleteMany).toHaveBeenCalled();
        expect(vi.mocked(prisma.notification.create).mock.calls[0]![0].data).toMatchObject({ kind: "cancelled" });
        expect(vi.mocked(recordDecisions).mock.calls[0]![0].map((r) => r.action)).toEqual(["shortfall.resolve", "order.cancel"]);
      });

      it("move: relinks the order to a stop on the later trip and records a reassignment", async () => {
        const second = trip({
          id: "T2", tripNo: 2, status: "PLANNED", plannedDepartAt: "09:00", sumWeightKg: 500, sumVolumeM3: 5,
          stops: [stop({ id: "T2S1", seq: 1, outletId: "OUT056", outletName: "Fresh Mart Kurunegala", plannedArrivalAt: "10:00", orders: [{ id: "ORD5", ref: "S1-050", units: 10, tempRequirement: "ambient", weightKg: 100, volumeM3: 1 }] })],
        });
        load.mockResolvedValue(inputs({ trips: [trip(), second], shortfalls: [shortfall()] }));
        vi.mocked(prisma.outlet.findUnique).mockResolvedValue({ dockType: "rear_dock" } as never);
        vi.mocked(prisma.serviceAllowance.findUnique).mockResolvedValue({ minutes: 10 } as never);
        vi.mocked(prisma.district.findUnique).mockResolvedValue({ interStopFreeflowMin: 8 } as never);
        vi.mocked(prisma.tripStop.create).mockResolvedValue({ id: "NEWSTOP" } as never);

        const response = await decide("shortfall:SF1", { decision: "MOVE_TO_TRIP_2" });

        expect(response.statusCode).toBe(200);
        // A new last stop: previous arrival 10:00 + 10 min handling x 1 order + 8 min between stops.
        expect(prisma.tripStop.create).toHaveBeenCalledWith({
          data: { tripId: "T2", seq: 2, outletId: "OUT027", plannedArrivalAt: "10:18" },
        });
        expect(prisma.tripStopOrder.create).toHaveBeenCalledWith({ data: { tripStopId: "NEWSTOP", orderId: "ORD1" } });
        expect(prisma.assignment.updateMany).toHaveBeenCalledWith({ where: { planId: "PLN1", orderId: "ORD1" }, data: { tripStopId: "NEWSTOP" } });
        expect(prisma.stopReassignment.create).toHaveBeenCalledWith({
          data: expect.objectContaining({ tripStopId: "NEWSTOP", fromTripId: "T1", toTripId: "T2", byUserId: "USR-D", reasonCode: "SHORTFALL" }),
        });
        expect(prisma.trip.update).toHaveBeenCalledWith({
          where: { id: "T2" },
          data: { sumWeightKg: { increment: 200 }, sumVolumeM3: { increment: 2 }, plannedMinutes: { increment: 18 } },
        });
        // Stays planned: neither deferred nor cancelled.
        expect(prisma.order.update).not.toHaveBeenCalled();
        expect(vi.mocked(prisma.notification.create).mock.calls[0]![0].data).toMatchObject({ kind: "shortfall.moved" });
        expect(vi.mocked(recordDecisions).mock.calls[0]![0].map((r) => r.action)).toEqual(["shortfall.resolve", "order.reassign"]);
      });

      it("move: merges into the outlet's existing stop on the later trip instead of adding one", async () => {
        const second = trip({ id: "T2", tripNo: 2, status: "PLANNED", sumWeightKg: 500, sumVolumeM3: 5, stops: [stop({ id: "T2S1", plannedArrivalAt: "10:00", orders: [] })] });
        load.mockResolvedValue(inputs({ trips: [trip(), second], shortfalls: [shortfall()] }));
        vi.mocked(prisma.outlet.findUnique).mockResolvedValue({ dockType: "rear_dock" } as never);
        vi.mocked(prisma.serviceAllowance.findUnique).mockResolvedValue({ minutes: 10 } as never);
        await decide("shortfall:SF1", { decision: "MOVE_TO_TRIP_2" });
        expect(prisma.tripStop.create).not.toHaveBeenCalled();
        expect(prisma.tripStopOrder.create).toHaveBeenCalledWith({ data: { tripStopId: "T2S1", orderId: "ORD1" } });
      });

      it("answers 409 DECISION_NOT_AVAILABLE for a move that is not offered, and writes nothing", async () => {
        load.mockResolvedValue(base());
        const response = await decide("shortfall:SF1", { decision: "MOVE_TO_TRIP_2" });
        expect(response.statusCode).toBe(409);
        expect(response.json().error).toMatchObject({ code: "DECISION_NOT_AVAILABLE", details: { offered: ["SEND_SHORT", "HOLD_ORDER", "CANCEL_LINE"] } });
        expect(prisma.shortfall.updateMany).not.toHaveBeenCalled();
      });

      it("answers 409 for a hold once the trip has departed", async () => {
        load.mockResolvedValue(inputs({ trips: [trip({ status: "DEPARTED" })], shortfalls: [shortfall()] }));
        const response = await decide("shortfall:SF1", { decision: "HOLD_ORDER" });
        expect(response.statusCode).toBe(409);
        expect(prisma.order.update).not.toHaveBeenCalled();
      });

      it("rejects acknowledge and resolve on a shortfall", async () => {
        load.mockResolvedValue(base());
        expect((await decide("shortfall:SF1", { decision: "ACKNOWLEDGE" })).statusCode).toBe(409);
        expect((await decide("shortfall:SF1", { decision: "RESOLVE", note: "x" })).statusCode).toBe(409);
      });
    });

    describe("problems", () => {
      beforeEach(() => {
        vi.mocked(requireDispatcherProblem).mockResolvedValue({ occurredAt: minutesAgo(5) } as never);
        vi.mocked(prisma.problem.updateMany).mockResolvedValue({ count: 1 });
      });
      const storeIssue = (over: Partial<ProblemInput> = {}) =>
        problem({ raisedBy: { name: "Fathima Rizvi", role: "STORE_MANAGER" }, kind: "GOODS_DAMAGED", units: 4, ...over });

      it("acknowledge marks it acknowledged, keeps it open, and tells a store that raised it", async () => {
        load.mockResolvedValue(inputs({ problems: [storeIssue()] }));
        const response = await decide("problem:PRB1", { decision: "ACKNOWLEDGE" });
        expect(response.statusCode).toBe(200);
        expect(prisma.problem.updateMany).toHaveBeenCalledWith({
          where: { id: "PRB1", status: "NEW" },
          data: { status: "ACKNOWLEDGED", acknowledgedByUserId: "USR-D", acknowledgedAt: expect.any(Date) },
        });
        expect(vi.mocked(prisma.notification.create).mock.calls[0]![0].data).toMatchObject({ outletId: "OUT027", kind: "issue.acknowledged" });
        expect(vi.mocked(recordDecisions).mock.calls[0]![0].map((r) => [r.entityType, r.action])).toEqual([
          ["Problem", "problem.acknowledge"],
          ["Order", "issue.acknowledge"],
        ]);
      });

      it("does not notify a store about a driver's problem", async () => {
        load.mockResolvedValue(inputs({ problems: [problem()] }));
        await decide("problem:PRB1", { decision: "ACKNOWLEDGE" });
        expect(prisma.notification.create).not.toHaveBeenCalled();
      });

      it("resolve needs a note, and keeps it as the resolution", async () => {
        load.mockResolvedValue(inputs({ problems: [storeIssue()] }));
        const missing = await decide("problem:PRB1", { decision: "RESOLVE" });
        expect(missing.statusCode).toBe(422);
        expect(missing.json().error.code).toBe("NOTE_REQUIRED");
        expect(prisma.problem.updateMany).not.toHaveBeenCalled();

        const ok = await decide("problem:PRB1", { decision: "RESOLVE", note: "Credit raised" });
        expect(ok.statusCode).toBe(200);
        expect(prisma.problem.updateMany).toHaveBeenCalledWith({
          where: { id: "PRB1", status: { in: ["NEW", "ACKNOWLEDGED"] } },
          data: expect.objectContaining({ status: "RESOLVED", resolution: "Credit raised" }),
        });
        expect(vi.mocked(prisma.notification.create).mock.calls[0]![0].data).toMatchObject({ kind: "issue.resolved", body: "Credit raised" });
      });

      it("repeating acknowledge, or resolve on a resolved problem, is a 200 that does nothing", async () => {
        load.mockResolvedValue(inputs({ problems: [problem({ status: "ACKNOWLEDGED", acknowledgedAt: NOW, acknowledgedByName: "Nimal Perera" })] }));
        const again = await decide("problem:PRB1", { decision: "ACKNOWLEDGE" });
        expect(again.statusCode).toBe(200);
        expect(again.json().replayed).toBe(true);

        load.mockResolvedValue(inputs({ problems: [problem({ status: "RESOLVED", resolution: "Done", resolvedAt: NOW })] }));
        const resolvedAgain = await decide("problem:PRB1", { decision: "RESOLVE", note: "Done" });
        expect(resolvedAgain.json().replayed).toBe(true);
        expect(prisma.problem.updateMany).not.toHaveBeenCalled();
        expect(recordDecisions).not.toHaveBeenCalled();
      });

      it("answers 409 ALREADY_DECIDED when acknowledging a problem already resolved", async () => {
        load.mockResolvedValue(inputs({ problems: [problem({ status: "RESOLVED", resolution: "Done", resolvedAt: NOW })] }));
        const response = await decide("problem:PRB1", { decision: "ACKNOWLEDGE" });
        expect(response.statusCode).toBe(409);
        expect(response.json().error.code).toBe("ALREADY_DECIDED");
      });

      it("offers no shortfall decisions on a problem", async () => {
        load.mockResolvedValue(inputs({ problems: [problem()] }));
        const response = await decide("problem:PRB1", { decision: "SEND_SHORT" });
        expect(response.statusCode).toBe(409);
        expect(response.json().error.details.offered).toEqual(["ACKNOWLEDGE", "RESOLVE"]);
      });
    });

    describe("chiller, late and lamp", () => {
      const locateTrip = () =>
        vi.mocked(prisma.trip.findFirst).mockResolvedValue({ plan: { planningDay: { date: new Date("2026-09-29T00:00:00Z") } } } as never);
      const lampInputs = (acknowledged = false) =>
        inputs({
          trips: [trip({ status: "DEPARTED", departedAt: minutesAgo(60), stops: [stop()] })],
          pings: new Map([["VEH017", { recordedAt: minutesAgo(14) }]]),
          acknowledgements: acknowledged ? new Map([["lamp:T1", { at: NOW, byName: "Nimal Perera", severity: "warning" as const }]]) : new Map(),
        });

      it("acknowledge is logged against the trip with the exception id and severity", async () => {
        locateTrip();
        load.mockResolvedValueOnce(lampInputs()).mockResolvedValueOnce(lampInputs(true));
        const response = await decide("lamp:T1", { decision: "ACKNOWLEDGE" });
        expect(response.statusCode).toBe(200);
        expect(vi.mocked(recordDecisions).mock.calls[0]![0]).toEqual([
          expect.objectContaining({ entityType: "Trip", entityId: "T1", action: "exception.acknowledge", after: { exceptionId: "lamp:T1", kind: "LAMP", severity: "warning" } }),
        ]);
        const body = response.json();
        expect(body.exception.status).toBe("open");
        expect(body.exception.acknowledgement).toMatchObject({ byName: "Nimal Perera" });
      });

      it("a second acknowledge is a 200 that logs nothing", async () => {
        locateTrip();
        load.mockResolvedValue(lampInputs(true));
        const response = await decide("lamp:T1", { decision: "ACKNOWLEDGE" });
        expect(response.statusCode).toBe(200);
        expect(response.json().replayed).toBe(true);
        expect(recordDecisions).not.toHaveBeenCalled();
      });

      it("offers nothing but acknowledge", async () => {
        locateTrip();
        load.mockResolvedValue(lampInputs());
        const response = await decide("lamp:T1", { decision: "RESOLVE", note: "x" });
        expect(response.statusCode).toBe(409);
        expect(response.json().error.code).toBe("DECISION_NOT_AVAILABLE");
      });
    });
  });
});
