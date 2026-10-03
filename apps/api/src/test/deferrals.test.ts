import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "../lib/db.js";
import { describeDeferrals, laneAlternatives, nextRunDate } from "../services/deferrals.js";
import { nextOperatingDate } from "../services/store.js";

/**
 * What the dispatcher's "Defer order" drawer reads: the deferral rows on a plan
 * and the "why this order and not another" ranking.
 *
 * The allocator's priority policy and the core reason mapping run for real, so a
 * change to either that the drawer would show differently fails here. Only the
 * database and the calendar are stubbed.
 */

vi.mock("../lib/db.js", () => ({
  prisma: {
    user: { findMany: vi.fn() },
    vehicle: { aggregate: vi.fn() },
  },
}));

vi.mock("../services/store.js", () => ({ nextOperatingDate: vi.fn() }));

type Plan = Parameters<typeof describeDeferrals>[0];

function outlet(over: Record<string, unknown> = {}) {
  return {
    id: "OUT1",
    displayName: "Fresh Puttalam",
    brand: "Fresh",
    districtName: "Puttalam",
    depotCode: "Peliyagoda",
    dockType: "rear_dock",
    parkingConstraint: "mall_dock",
    mallWindowOpen: null,
    mallWindowClose: null,
    windowOpen: "05:30",
    windowClose: "08:00",
    ...over,
  };
}

function assignment(id: string, decision: "SERVED" | "DEFERRED", over: Record<string, unknown> = {}, outletOver: Record<string, unknown> = {}) {
  const o = outlet({ id: `OUT-${id}`, ...outletOver });
  return {
    id,
    orderId: `O-${id}`,
    decision,
    reasonCode: null,
    note: null,
    explanation: null,
    order: {
      ref: `ORD-${id}`,
      outletId: o.id,
      outlet: o,
      brand: "Fresh",
      districtName: "Puttalam",
      depotCode: "Peliyagoda",
      tempRequirement: "chilled",
      units: 100,
      weightKg: 800,
      volumeM3: 9,
      windowOpen: "05:30",
      windowClose: "08:00",
      deferredYesterday: false,
      daysSinceLastServed: 1,
      ...over,
    },
  };
}

function plan(assignments: ReturnType<typeof assignment>[], trips: unknown[] = []) {
  return {
    id: "PLN1",
    planningDay: { date: new Date("2026-10-03T00:00:00.000Z"), depotCode: "Peliyagoda" },
    assignments,
    trips,
  } as unknown as Plan;
}

/** A trip on this kind of vehicle carrying these assignments' orders. */
function trip(vehicle: { type: "truck" | "van"; temp: "reefer" | "ambient" }, ...served: ReturnType<typeof assignment>[]) {
  return { vehicle, stops: [{ orders: served.map((a) => ({ orderId: a.orderId })) }] };
}

describe("nextRunDate", () => {
  beforeEach(() => vi.resetAllMocks());

  it("is the calendar's next operating day, as a date string", async () => {
    vi.mocked(nextOperatingDate).mockResolvedValue(new Date("2026-10-06T00:00:00.000Z"));

    expect(await nextRunDate(new Date("2026-10-03T00:00:00.000Z"))).toBe("2026-10-06");
  });

  it("falls back to the shared rule past the end of the calendar, which skips Sunday", async () => {
    vi.mocked(nextOperatingDate).mockResolvedValue(null);

    // 3 October 2026 is a Saturday; the next operating day is Monday the 5th.
    expect(await nextRunDate(new Date("2026-10-03T00:00:00.000Z"))).toBe("2026-10-05");
  });
});

describe("describeDeferrals", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(nextOperatingDate).mockResolvedValue(new Date("2026-10-05T00:00:00.000Z"));
    vi.mocked(prisma.user.findMany).mockResolvedValue([] as never);
  });

  it("returns nothing, and asks nothing, when the plan deferred nothing", async () => {
    const rows = await describeDeferrals(plan([assignment("A1", "SERVED")]));

    expect(rows).toEqual([]);
    expect(prisma.user.findMany).not.toHaveBeenCalled();
  });

  it("describes each deferral: its cause, the reason the allocator points at, and where it moves to", async () => {
    const deferred = assignment("A2", "DEFERRED", { deferredYesterday: true }, { displayName: "Fresh Puttalam" });
    deferred.explanation = {
      reasonCode: "NO_REEFER_AVAILABLE",
      permanent: false,
      explanation: [{ code: "VOLUME_CAP_EXCEEDED", count: 3 }],
      nearMiss: { vehicleId: "VEH043", metric: "volume", short: 0.4, unit: "m3" },
      suggestion: null,
    } as never;
    deferred.reasonCode = "REEFER_FULL" as never;
    deferred.note = "all reefers committed" as never;

    const [row] = await describeDeferrals(plan([deferred, assignment("A1", "SERVED")]));

    expect(row).toMatchObject({
      assignmentId: "A2",
      orderId: "O-A2",
      orderRef: "ORD-A2",
      reasonCode: "REEFER_FULL",
      note: "all reefers committed",
      order: { outletId: "OUT-A2", outletName: "Fresh Puttalam", tempRequirement: "chilled", deferredYesterday: true },
      cause: {
        rejectionCode: "NO_REEFER_AVAILABLE",
        permanent: false,
        explanation: [{ code: "VOLUME_CAP_EXCEEDED", count: 3, sample: null }],
        nearMiss: { vehicleId: "VEH043", metric: "volume", short: 0.4, unit: "m3" },
      },
      // The fleet is full, not off the road: a busy vehicle is among the causes.
      suggestedReasonCode: "REEFER_FULL",
      movesTo: { date: "2026-10-05", windowOpen: "05:30", windowClose: "08:00", firstOnRun: true },
    });
  });

  it("reads the metric's name from a draft stored with the allocator's whole record", async () => {
    // Drafts built before the allocator's {name, have, limit, unit} record was
    // flattened carry it as an object. The board serialised it against a string
    // schema and returned 500, which stopped the plan being published.
    const deferred = assignment("A3", "DEFERRED");
    deferred.explanation = {
      reasonCode: "NO_REEFER_AVAILABLE",
      permanent: false,
      explanation: [],
      nearMiss: {
        vehicleId: "VEH043",
        metric: { name: "volume", have: 31.4, limit: 30, unit: "m3" },
        short: 1.4,
        unit: "m3",
      },
    } as never;

    const [row] = await describeDeferrals(plan([deferred]));

    expect(row?.cause?.nearMiss).toEqual({ vehicleId: "VEH043", metric: "volume", short: 1.4, unit: "m3" });
  });

  it("suggests the workshop, not a full fleet, when the vehicles were only off the road", async () => {
    const deferred = assignment("A2", "DEFERRED");
    deferred.explanation = {
      reasonCode: "NO_REEFER_AVAILABLE",
      permanent: false,
      explanation: [{ code: "VEHICLE_IN_WORKSHOP", count: 2 }],
    } as never;

    const [row] = await describeDeferrals(plan([deferred]));

    expect(row!.suggestedReasonCode).toBe("VEHICLE_IN_WORKSHOP");
  });

  it("does not promise a first place on the next run when the cause is permanent", async () => {
    const deferred = assignment("A2", "DEFERRED");
    deferred.explanation = { reasonCode: "ORDER_EXCEEDS_FLEET_CAPACITY", permanent: true } as never;

    const [row] = await describeDeferrals(plan([deferred]));

    expect(row!.cause).toMatchObject({ permanent: true });
    expect(row!.movesTo!.firstOnRun).toBe(false);
    expect(row!.suggestedReasonCode).toBe("ORDER_TOO_LARGE");
  });

  it("gives no cause and no suggestion for a deferral the allocator left no explanation for", async () => {
    const [row] = await describeDeferrals(plan([assignment("A2", "DEFERRED")]));

    expect(row!.cause).toBeNull();
    expect(row!.suggestedReasonCode).toBeNull();
    expect(row!.reasonCode).toBeNull();
    expect(row!.note).toBeNull();
  });

  it("names the store manager to be told, the first alphabetically when an outlet has several, and null when none", async () => {
    vi.mocked(prisma.user.findMany).mockResolvedValue([
      { name: "Amara Silva", outletId: "OUT-A2" },
      { name: "Zainab Cader", outletId: "OUT-A2" },
    ] as never);

    const rows = await describeDeferrals(plan([assignment("A2", "DEFERRED"), assignment("A3", "DEFERRED")]));

    expect(rows[0]!.notifyRecipient).toEqual({ name: "Amara Silva", outletId: "OUT-A2" });
    expect(rows[1]!.notifyRecipient).toBeNull();
    const query = vi.mocked(prisma.user.findMany).mock.calls[0]![0]!;
    expect(query.where).toEqual({ role: "STORE_MANAGER", outletId: { in: ["OUT-A2", "OUT-A3"] } });
    expect(query.orderBy).toEqual({ name: "asc" });
  });
});

describe("laneAlternatives", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(prisma.vehicle.aggregate).mockResolvedValue({ _max: { volumeCapM3: 34 } } as never);
  });

  const reefer = { type: "truck", temp: "reefer" } as const;
  const dryVan = { type: "van", temp: "ambient" } as const;

  it("is null for an assignment that is not a deferral on this plan", async () => {
    const served = assignment("A1", "SERVED");
    const p = plan([served, assignment("A2", "DEFERRED")], [trip(reefer, served)]);

    expect(await laneAlternatives(p, "A1")).toBeNull();
    expect(await laneAlternatives(p, "NOPE")).toBeNull();
    expect(prisma.vehicle.aggregate).not.toHaveBeenCalled();
  });

  it("compares a chilled deferral only with orders served on a reefer, because only they held a vehicle it could use", async () => {
    const target = assignment("T", "DEFERRED", { daysSinceLastServed: 1 });
    const onReefer = assignment("R", "SERVED", { daysSinceLastServed: 5 });
    const onDryVan = assignment("V", "SERVED", { daysSinceLastServed: 6 });
    const p = plan([target, onReefer, onDryVan], [trip(reefer, onReefer), trip(dryVan, onDryVan)]);

    const result = await laneAlternatives(p, "T");

    expect(result!.lane).toEqual({ brand: "Fresh", districtName: "Puttalam", resource: "refrigerated vehicle", competing: 2 });
    expect(result!.items.map((i) => i.orderRef)).toEqual(["ORD-T", "ORD-R"]);
    expect(prisma.vehicle.aggregate).toHaveBeenCalledWith(
      expect.objectContaining({ where: { depotCode: "Peliyagoda" } }),
    );
  });

  it("limits a van-only outlet's deferral to orders served on vans", async () => {
    const target = assignment("T", "DEFERRED", { tempRequirement: "ambient", brand: "Tech" }, { parkingConstraint: "van_only" });
    const onVan = assignment("V", "SERVED", { tempRequirement: "ambient" });
    const onTruck = assignment("K", "SERVED", { tempRequirement: "ambient" });
    const p = plan([target, onVan, onTruck], [trip(dryVan, onVan), trip({ type: "truck", temp: "ambient" }, onTruck)]);

    const result = await laneAlternatives(p, "T");

    expect(result!.lane.resource).toBe("van");
    expect(result!.items.map((i) => i.orderRef)).toEqual(["ORD-T", "ORD-V"]);
  });

  it("puts this order first and ranks everyone by the allocator's priority, with what protects or exposes each", async () => {
    const target = assignment("T", "DEFERRED", { daysSinceLastServed: 1 });
    const waiting = assignment("W", "SERVED", { daysSinceLastServed: 5 });
    const protectedOrder = assignment("P", "SERVED", { deferredYesterday: true });
    const mid = assignment("M", "SERVED", { daysSinceLastServed: 3 });
    const p = plan([target, waiting, protectedOrder, mid], [trip(reefer, waiting, protectedOrder, mid)]);

    const { items } = (await laneAlternatives(p, "T"))!;

    // Ranks 1..4 by score: deferred-yesterday first, then days waiting, the target last.
    expect(items.map((i) => [i.orderRef, i.rank])).toEqual([
      ["ORD-T", 4],
      ["ORD-P", 1],
      ["ORD-W", 2],
      ["ORD-M", 3],
    ]);
    expect(items[0]).toMatchObject({ isThisOrder: true, decision: "DEFERRED", impact: "lowest", why: "window shuts 08:00" });
    expect(items[1]).toMatchObject({ isThisOrder: false, decision: "SERVED", impact: "protected", why: "deferred yesterday, window shuts 08:00" });
    expect(items[2]!.impact).toBe("high");
    expect(items[3]!.why).toBe("3 days since last served, window shuts 08:00");
  });

  it("calls a second deferral a second skip, never 'protected'", async () => {
    const target = assignment("T", "DEFERRED", { deferredYesterday: true });
    const other = assignment("O", "SERVED", { daysSinceLastServed: 5 });
    const p = plan([target, other], [trip(reefer, other)]);

    const { items } = (await laneAlternatives(p, "T"))!;

    expect(items[0]).toMatchObject({ isThisOrder: true, impact: "skipped_twice", rank: 1 });
  });

  it("shows only the four lowest-priority competitors, since those are the realistic swaps", async () => {
    const target = assignment("T", "DEFERRED", { daysSinceLastServed: 1 });
    // Six served orders, days 2..7: the lowest four are days 2, 3, 4, 5.
    const served = [2, 3, 4, 5, 6, 7].map((d) => assignment(`S${d}`, "SERVED", { daysSinceLastServed: d }));
    const p = plan([target, ...served], [trip(reefer, ...served)]);

    const result = (await laneAlternatives(p, "T"))!;

    expect(result.lane.competing).toBe(7);
    expect(result.items.map((i) => i.orderRef)).toEqual(["ORD-T", "ORD-S5", "ORD-S4", "ORD-S3", "ORD-S2"]);
  });

  it("labels an outlet with no display name as null rather than inventing one", async () => {
    const target = assignment("T", "DEFERRED", {}, { displayName: null });
    const result = (await laneAlternatives(plan([target]), "T"))!;

    expect(result.items[0]!.outletName).toBeNull();
    expect(result.lane.competing).toBe(1);
  });
});
