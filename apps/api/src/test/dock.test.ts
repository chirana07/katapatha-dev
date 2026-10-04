import { describe, expect, it } from "vitest";
import {
  assignBays,
  bayBoard,
  cleanItemCounts,
  colomboInstant,
  minutesBehindPlan,
  minutesIntoDay,
  sealLateMinutes,
  sealedOnTime,
  unitsPerQuarterHour,
} from "../services/dock.js";

const day = new Date("2026-04-09T00:00:00.000Z");

describe("colombo clock", () => {
  it("puts a wall-clock time on the planning day at +05:30", () => {
    expect(colomboInstant(day, "07:07").toISOString()).toBe("2026-04-09T01:37:00.000Z");
    expect(minutesIntoDay(day, new Date("2026-04-09T01:37:00.000Z"))).toBe(7 * 60 + 7);
  });
});

describe("assignBays", () => {
  it("spreads overlapping departures across bays and reuses a bay once it frees", () => {
    const bays = assignBays(
      [
        { id: "a", plannedDepartAt: "07:00", dockBay: null },
        { id: "b", plannedDepartAt: "07:10", dockBay: null },
        { id: "c", plannedDepartAt: "08:30", dockBay: null },
      ],
      6,
    );
    expect(bays.get("a")).toBe(1);
    expect(bays.get("b")).toBe(2);
    // a leaves at 07:00 and c's window opens at 07:30, so bay 1 is free again.
    expect(bays.get("c")).toBe(1);
  });

  it("never moves a trip that already has a bay, and only returns the new ones", () => {
    const bays = assignBays(
      [
        { id: "a", plannedDepartAt: "07:00", dockBay: 3 },
        { id: "b", plannedDepartAt: "07:00", dockBay: null },
      ],
      6,
    );
    expect(bays.has("a")).toBe(false);
    expect(bays.get("b")).toBe(1);
  });

  it("shares the bay that frees first when every bay is busy", () => {
    const bays = assignBays(
      [
        { id: "a", plannedDepartAt: "07:00", dockBay: null },
        { id: "b", plannedDepartAt: "07:20", dockBay: null },
        { id: "c", plannedDepartAt: "07:30", dockBay: null },
      ],
      2,
    );
    expect(bays.get("c")).toBe(1);
  });
});

describe("seal timing", () => {
  it("is on time at or before the planned departure and late after it", () => {
    const due = colomboInstant(day, "07:07");
    expect(sealedOnTime(day, { plannedDepartAt: "07:07", sealedAt: due })).toBe(true);
    const late = new Date(due.getTime() + 6 * 60_000);
    expect(sealedOnTime(day, { plannedDepartAt: "07:07", sealedAt: late })).toBe(false);
    expect(sealLateMinutes(day, { plannedDepartAt: "07:07", sealedAt: late })).toBe(6);
    expect(sealedOnTime(day, { plannedDepartAt: "07:07", sealedAt: null })).toBeNull();
  });
});

describe("minutesBehindPlan", () => {
  it("is null before the loading window opens", () => {
    expect(minutesBehindPlan(8 * 60, 7 * 60, 0, 100)).toBeNull();
  });

  it("measures the gap between planned and actual progress in minutes", () => {
    // Window opened 30 minutes ago; a third is on board (15 min of plan).
    expect(minutesBehindPlan(8 * 60, 8 * 60 - 15, 33, 99)).toBe(15);
    expect(minutesBehindPlan(8 * 60, 8 * 60 - 15, 99, 99)).toBe(0);
  });
});

describe("unitsPerQuarterHour", () => {
  it("buckets the day's events and leaves gaps as zero", () => {
    const at = (clock: string) => colomboInstant(day, clock);
    expect(
      unitsPerQuarterHour(day, [
        { at: at("06:16"), units: 10 },
        { at: at("06:29"), units: 5 },
        { at: at("07:02"), units: 7 },
        // another day: ignored
        { at: new Date("2026-04-11T01:00:00Z"), units: 99 },
      ]),
    ).toEqual([
      { start: "06:15", units: 15 },
      { start: "06:30", units: 0 },
      { start: "06:45", units: 0 },
      { start: "07:00", units: 7 },
    ]);
  });

  it("is empty with nothing loaded", () => {
    expect(unitsPerQuarterHour(day, [])).toEqual([]);
  });
});

describe("bayBoard", () => {
  it("shows the loading vehicle as current and the next planned one", () => {
    const trip = (id: string, status: "PLANNED" | "LOADING" | "READY", depart: string, bay: number) => ({
      id,
      vehicleId: id.toUpperCase(),
      tripNo: 1,
      status,
      plannedDepartAt: depart,
      dockBay: bay,
      loadedUnits: 0,
      expectedUnits: 10,
    });
    const board = bayBoard([trip("a", "LOADING", "08:00", 1), trip("b", "PLANNED", "09:00", 1), trip("c", "READY", "07:00", 2)], 2);
    expect(board[0]!.current?.vehicleId).toBe("A");
    expect(board[0]!.next?.vehicleId).toBe("B");
    // A sealed vehicle has left the bay.
    expect(board[1]!.current).toBeNull();
    expect(board[1]!.next).toBeNull();
  });
});

describe("cleanItemCounts", () => {
  it("keeps whole non-negative counts only", () => {
    expect(cleanItemCounts({ FA001: 3, FA002: -1, FA003: 1.5, FA004: 0 })).toEqual({ FA001: 3, FA004: 0 });
    expect(cleanItemCounts(null)).toBeNull();
    expect(cleanItemCounts([])).toBeNull();
  });
});
