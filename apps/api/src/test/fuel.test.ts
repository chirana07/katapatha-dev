import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "../lib/db.js";
import { commitPlanFuel, committedOtherDays, fuelPositions, type FuelEntryLike } from "../services/fuel.js";

/**
 * The weekly fuel allowance. The sum is pure and tested directly; the database
 * reads and the publication write are tested against a mocked client, because
 * what matters there is which rows are asked for and which are written.
 */

vi.mock("../lib/db.js", () => ({
  prisma: { fuelLedger: { findMany: vi.fn() } },
}));

const entry = (litres: number, over: Partial<FuelEntryLike> = {}): FuelEntryLike => ({
  litres,
  kind: "PLANNED",
  plannedFor: "2026-10-05",
  ...over,
});

describe("committedOtherDays", () => {
  it("adds up the litres other days have spent", () => {
    expect(committedOtherDays([entry(40), entry(25.5, { plannedFor: "2026-10-06" })], "2026-10-07")).toBeCloseTo(65.5);
  });

  it("never charges the day being planned against itself", () => {
    expect(committedOtherDays([entry(40), entry(25, { plannedFor: "2026-10-06" })], "2026-10-05")).toBe(25);
  });

  it("counts a manual adjustment, positive or negative, whichever day it names", () => {
    expect(committedOtherDays([entry(100), entry(-30, { kind: "ADJUSTMENT", plannedFor: null })], "2026-10-07")).toBe(70);
  });

  it("leaves ACTUAL entries out, so they cannot double-count the planned figure", () => {
    expect(committedOtherDays([entry(40), entry(38, { kind: "ACTUAL" })], "2026-10-07")).toBe(40);
  });

  it("is zero with nothing recorded", () => {
    expect(committedOtherDays([], "2026-10-05")).toBe(0);
  });
});

describe("fuelPositions", () => {
  beforeEach(() => vi.resetAllMocks());

  const vehicles = [
    { id: "V1", weeklyFuelQuotaL: 300 },
    { id: "V2", weeklyFuelQuotaL: 250 },
  ];
  const dbEntry = (litres: number, day: string | null, kind = "PLANNED") => ({
    litres,
    kind,
    trip: day ? { plan: { planningDay: { date: new Date(`${day}T00:00:00.000Z`) } } } : null,
  });

  it("reads the week's ledger for the vehicles asked about, by ISO week", async () => {
    vi.mocked(prisma.fuelLedger.findMany).mockResolvedValue([] as never);

    await fuelPositions(new Date("2026-10-07T00:00:00.000Z"), vehicles);

    expect(vi.mocked(prisma.fuelLedger.findMany).mock.calls[0]![0]!.where).toEqual({
      vehicleId: { in: ["V1", "V2"] },
      isoYear: 2026,
      isoWeek: 41,
    });
  });

  it("falls back to the standing quota, with nothing committed, when the week has no ledger yet", async () => {
    vi.mocked(prisma.fuelLedger.findMany).mockResolvedValue([] as never);

    const positions = await fuelPositions(new Date("2026-10-07T00:00:00.000Z"), vehicles);

    expect(positions.get("V1")).toEqual({ quotaL: 300, committedOtherDaysL: 0 });
    expect(positions.get("V2")).toEqual({ quotaL: 250, committedOtherDaysL: 0 });
  });

  it("honours a quota raised for the week, and sums what other days spent", async () => {
    vi.mocked(prisma.fuelLedger.findMany).mockResolvedValue([
      { vehicleId: "V1", quotaL: 380, entries: [dbEntry(90, "2026-10-05"), dbEntry(60, "2026-10-06")] },
    ] as never);

    const positions = await fuelPositions(new Date("2026-10-07T00:00:00.000Z"), vehicles);

    expect(positions.get("V1")).toEqual({ quotaL: 380, committedOtherDaysL: 150 });
    expect(positions.get("V2")).toEqual({ quotaL: 250, committedOtherDaysL: 0 });
  });

  it("excludes the day being planned, so a re-plan is not charged twice", async () => {
    vi.mocked(prisma.fuelLedger.findMany).mockResolvedValue([
      { vehicleId: "V1", quotaL: 300, entries: [dbEntry(90, "2026-10-05"), dbEntry(60, "2026-10-06")] },
    ] as never);

    const positions = await fuelPositions(new Date("2026-10-06T00:00:00.000Z"), vehicles);

    expect(positions.get("V1")!.committedOtherDaysL).toBe(90);
  });

  it("counts an adjustment with no trip", async () => {
    vi.mocked(prisma.fuelLedger.findMany).mockResolvedValue([
      { vehicleId: "V1", quotaL: 300, entries: [dbEntry(-20, null, "ADJUSTMENT"), dbEntry(90, "2026-10-05")] },
    ] as never);

    const positions = await fuelPositions(new Date("2026-10-07T00:00:00.000Z"), vehicles);

    expect(positions.get("V1")!.committedOtherDaysL).toBe(70);
  });
});

describe("commitPlanFuel", () => {
  const trip = (id: string, vehicleId: string, km: number, litres: number, entries: unknown[] = []) => ({
    id,
    vehicleId,
    plannedDistanceKm: km,
    plannedFuelL: litres,
    vehicle: { weeklyFuelQuotaL: 300 },
    fuelEntries: entries,
  });

  function txFor(trips: ReturnType<typeof trip>[]) {
    return {
      trip: { findMany: vi.fn().mockResolvedValue(trips) },
      fuelLedger: {
        upsert: vi.fn(async ({ where }: { where: { vehicleId_isoYear_isoWeek: { vehicleId: string } }; create?: unknown; update?: unknown }) => ({
          id: `L-${where.vehicleId_isoYear_isoWeek.vehicleId}`,
        })),
        update: vi.fn().mockResolvedValue({}),
      },
      fuelLedgerEntry: { create: vi.fn().mockResolvedValue({}) },
    };
  }

  const commit = (tx: ReturnType<typeof txFor>) =>
    commitPlanFuel(tx as never, "PLN1", new Date("2026-10-05T00:00:00.000Z"));

  it("writes one PLANNED entry per trip, against the vehicle's ledger for the plan's week", async () => {
    const tx = txFor([trip("T1", "V1", 120, 24), trip("T2", "V1", 80, 16), trip("T3", "V2", 60, 12)]);

    const result = await commit(tx);

    expect(result).toEqual({ trips: 3, litres: 52 });
    expect(tx.fuelLedgerEntry.create.mock.calls.map((c) => c[0].data)).toEqual([
      { ledgerId: "L-V1", tripId: "T1", km: 120, litres: 24, kind: "PLANNED" },
      { ledgerId: "L-V1", tripId: "T2", km: 80, litres: 16, kind: "PLANNED" },
      { ledgerId: "L-V2", tripId: "T3", km: 60, litres: 12, kind: "PLANNED" },
    ]);
    expect(tx.fuelLedger.upsert.mock.calls[0]![0].where).toEqual({
      vehicleId_isoYear_isoWeek: { vehicleId: "V1", isoYear: 2026, isoWeek: 41 },
    });
  });

  it("creates a missing ledger at the standing quota, and never overwrites a raised one", async () => {
    const tx = txFor([trip("T1", "V1", 120, 24)]);

    await commit(tx);

    const args = tx.fuelLedger.upsert.mock.calls[0]![0];
    expect(args.create).toMatchObject({ vehicleId: "V1", quotaL: 300 });
    expect(args.update).toEqual({});
  });

  it("raises the ledger's committed cache by the trip's litres", async () => {
    const tx = txFor([trip("T1", "V1", 120, 24), trip("T2", "V1", 80, 16)]);

    await commit(tx);

    expect(tx.fuelLedger.update.mock.calls.map((c) => c[0])).toEqual([
      { where: { id: "L-V1" }, data: { committedL: { increment: 24 } } },
      { where: { id: "L-V1" }, data: { committedL: { increment: 16 } } },
    ]);
  });

  it("skips a trip that already has a planned entry, so a repeat call changes nothing", async () => {
    const tx = txFor([trip("T1", "V1", 120, 24, [{ id: "E1" }]), trip("T2", "V1", 80, 16)]);

    const result = await commit(tx);

    expect(result).toEqual({ trips: 1, litres: 16 });
    expect(tx.fuelLedgerEntry.create).toHaveBeenCalledTimes(1);
    expect(tx.fuelLedgerEntry.create.mock.calls[0]![0].data.tripId).toBe("T2");
  });

  it("does nothing for a plan with no trips", async () => {
    const tx = txFor([]);
    expect(await commit(tx)).toEqual({ trips: 0, litres: 0 });
    expect(tx.fuelLedger.upsert).not.toHaveBeenCalled();
  });
});
