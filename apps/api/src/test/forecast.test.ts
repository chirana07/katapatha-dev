import { describe, expect, it } from "vitest";
import {
  AMBIENT_FILL,
  REEFER_FILL,
  actionLabel,
  addWeeks,
  assessReefers,
  backtest,
  buildForecastRows,
  dayFactor,
  fleetCapacityM3,
  forecastWeek,
  groupCalendarByWeek,
  inferFestivalNames,
  isoWeekOfDate,
  isoWeekStart,
  isoWeeksInYear,
  planRelief,
  weekKeyStr,
  weekSignalIndex,
  weekSignalLabels,
  weeksBetween,
  type CalendarSignalDay,
  type FleetVehicle,
  type WeeklyPoint,
} from "../services/forecast.js";

/**
 * The forecast is pure arithmetic, so these tests use series small enough to
 * check by hand. The point of each is a number a reviewer can recompute.
 */

const day = (over: Partial<CalendarSignalDay> & { date: string }): CalendarSignalDay => ({
  isoYear: isoWeekOfDate(over.date).isoYear,
  isoWeek: isoWeekOfDate(over.date).isoWeek,
  isOperating: true,
  isPayday: false,
  isHoliday: false,
  festival: null,
  festivalRamp: 0,
  monsoon: false,
  ...over,
});

/** A run of weekly points, one per ISO week from `start`, with `value(i)` total and a third of it chilled. */
function series(start: { isoYear: number; isoWeek: number }, count: number, value: (i: number) => number): WeeklyPoint[] {
  return Array.from({ length: count }, (_, i) => {
    const wk = addWeeks(start, i);
    return { ...wk, totalM3: value(i), chilledM3: value(i) / 4 };
  });
}

describe("ISO week arithmetic", () => {
  it("numbers weeks the way the calendar does, including the year boundary", () => {
    expect(isoWeekOfDate("2026-04-09")).toEqual({ isoYear: 2026, isoWeek: 15 });
    // 29 December 2025 is a Monday and belongs to week 1 of 2026.
    expect(isoWeekOfDate("2025-12-29")).toEqual({ isoYear: 2026, isoWeek: 1 });
    // 3 January 2027 is a Sunday and still belongs to 2026's 53rd week.
    expect(isoWeekOfDate("2027-01-03")).toEqual({ isoYear: 2026, isoWeek: 53 });
    expect(isoWeeksInYear(2026)).toBe(53);
    expect(isoWeeksInYear(2025)).toBe(52);
  });

  it("finds a week's Monday and steps across the 53-week year", () => {
    expect(isoWeekStart({ isoYear: 2026, isoWeek: 15 })).toBe("2026-04-06");
    expect(addWeeks({ isoYear: 2026, isoWeek: 52 }, 2)).toEqual({ isoYear: 2027, isoWeek: 1 });
    expect(addWeeks({ isoYear: 2026, isoWeek: 3 }, -5)).toEqual({ isoYear: 2025, isoWeek: 50 });
    expect(weeksBetween({ isoYear: 2025, isoWeek: 50 }, { isoYear: 2026, isoWeek: 3 })).toBe(5);
  });
});

describe("the signal index", () => {
  it("lifts a payday, lifts a festival ramp, trims a monsoon day, and zeroes a closed day", () => {
    expect(dayFactor(day({ date: "2026-04-09" }))).toBe(1);
    expect(dayFactor(day({ date: "2026-04-09", isPayday: true }))).toBeCloseTo(1.12);
    expect(dayFactor(day({ date: "2026-04-09", festivalRamp: 1 }))).toBeCloseTo(1.3);
    expect(dayFactor(day({ date: "2026-04-09", monsoon: true }))).toBeCloseTo(0.98);
    expect(dayFactor(day({ date: "2026-04-14", isOperating: false, festivalRamp: 1 }))).toBe(0);
  });

  it("treats a week with no calendar as six neutral days, not as closed", () => {
    expect(weekSignalIndex(undefined)).toBe(6);
    expect(weekSignalIndex([])).toBe(6);
  });

  it("names the causes in words, borrowing a festival's name for its build-up days", () => {
    const days = inferFestivalNames([
      day({ date: "2026-04-10", festivalRamp: 0.7 }),
      day({ date: "2026-04-11", festivalRamp: 0.8, isPayday: true, monsoon: true }),
      day({ date: "2026-04-12", festivalRamp: 0.9, monsoon: true, isOperating: false }),
      day({ date: "2026-04-13", festival: "new_year", festivalRamp: 1, monsoon: true }),
    ]);
    expect(days[0].festival).toBe("new_year");
    expect(weekSignalLabels(days)).toEqual(["New Year ramp", "Payday", "Monsoon"]);
    // A ramp with no festival anywhere ahead is left unnamed rather than guessed.
    expect(inferFestivalNames([day({ date: "2026-05-01", festivalRamp: 0.3 })])[0].festival).toBeNull();
  });
});

describe("forecastWeek", () => {
  it("blends last year's same week with the trailing level, equally", () => {
    // Weekly totals of 100, except the same ISO week a year earlier, which was 200.
    const history = series({ isoYear: 2025, isoWeek: 1 }, 61, (i) => (i === 9 ? 200 : 100)); // 2025-W10 is index 9
    const f = forecastWeek(history, new Map(), { isoYear: 2026, isoWeek: 10 }, 1)!;
    // Seasonal-naive 200, trailing-8 mean 100 -> 150. Chilled is a quarter.
    expect(f.totalM3).toBeCloseTo(150);
    expect(f.chilledM3).toBeCloseTo(37.5);
    expect(f.basis).toBe("seasonal+trailing");
  });

  it("falls back to the trailing level alone with no year of history, and to nothing with none", () => {
    const history = series({ isoYear: 2026, isoWeek: 1 }, 10, () => 80);
    const f = forecastWeek(history, new Map(), { isoYear: 2026, isoWeek: 14 }, 1)!;
    expect(f.totalM3).toBeCloseTo(80);
    expect(f.basis).toBe("trailing-only");
    expect(forecastWeek([], new Map(), { isoYear: 2026, isoWeek: 14 }, 1)).toBeNull();
  });

  it("scales both components by the target week's own signals, not last year's", () => {
    const history = series({ isoYear: 2025, isoWeek: 1 }, 61, () => 100);
    // Last year's W10 had no signals; this year's has one payday among six operating days.
    const target = Array.from({ length: 6 }, (_, i) =>
      day({ date: `2026-03-${String(2 + i).padStart(2, "0")}`, isPayday: i === 0 }),
    );
    const calendar = groupCalendarByWeek(target);
    expect(weekKeyStr({ isoYear: 2026, isoWeek: 10 })).toBe("2026-W10");
    const f = forecastWeek(history, calendar, { isoYear: 2026, isoWeek: 10 }, 1)!;
    // Neutral index 6 for the source weeks; target index 5 + 1.12 = 6.12 -> x1.02.
    expect(f.totalM3).toBeCloseTo(102);
  });

  it("uses only history that would have been known at the stated lead", () => {
    const history = series({ isoYear: 2026, isoWeek: 1 }, 10, (i) => (i === 9 ? 1000 : 100));
    // Forecasting W11 from a lead of 3 weeks may only see weeks up to W08, so the W10 spike is invisible.
    const f = forecastWeek(history, new Map(), { isoYear: 2026, isoWeek: 11 }, 3)!;
    expect(f.totalM3).toBeCloseTo(100);
  });
});

describe("backtest", () => {
  it("reruns the method on the last known weeks and reports the error it would have made", () => {
    // Twenty weeks at 100 then five at 120.
    const history = series({ isoYear: 2025, isoWeek: 1 }, 25, (i) => (i < 20 ? 100 : 120));
    const result = backtest([history], new Map(), { weeks: 2, leadWeeks: 1 });
    // W24: trailing-8 = (5x100 + 3x120)/8 = 107.5 vs 120 -> 10.4%.
    // W25: trailing-8 = (4x100 + 4x120)/8 = 110   vs 120 ->  8.3%.
    expect(result.weeks.map((w) => w.forecastTotalM3)).toEqual([107.5, 110]);
    expect(result.mapeTotalPct).toBe(9.4);
    expect(result.weeks).toHaveLength(2);
  });

  it("is zero for a perfectly flat series and null when there is nothing to test", () => {
    const flat = series({ isoYear: 2025, isoWeek: 1 }, 30, () => 100);
    expect(backtest([flat], new Map(), { weeks: 8 }).mapeTotalPct).toBe(0);
    expect(backtest([], new Map(), { weeks: 8 }).mapeTotalPct).toBeNull();
  });

  it("is worse at a longer lead when demand is trending", () => {
    const trend = series({ isoYear: 2025, isoWeek: 1 }, 30, (i) => 100 + 4 * i);
    const near = backtest([trend], new Map(), { weeks: 4, leadWeeks: 1 }).mapeTotalPct!;
    const far = backtest([trend], new Map(), { weeks: 4, leadWeeks: 6 }).mapeTotalPct!;
    expect(far).toBeGreaterThan(near);
  });
});

describe("persisted rows", () => {
  it("produces one rounded row per series per target week, and none for a series with no history", () => {
    const rows = buildForecastRows(
      new Map([
        ["Peliyagoda|Fresh", { depotCode: "Peliyagoda", brand: "Fresh" as const, points: series({ isoYear: 2026, isoWeek: 1 }, 10, () => 100.123456) }],
        ["Kandy|Tech", { depotCode: "Kandy", brand: "Tech" as const, points: [] }],
      ]),
      new Map(),
      [{ isoYear: 2026, isoWeek: 14 }, { isoYear: 2026, isoWeek: 15 }],
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ isoYear: 2026, isoWeek: 14, depotCode: "Peliyagoda", brand: "Fresh", predTotalVolumeM3: 100.12, predChilledVolumeM3: 25.03 });
  });
});

describe("reefer trips", () => {
  const reefers: FleetVehicle[] = [
    { id: "VEH101", temp: "reefer", volumeCapM3: 30 },
    { id: "VEH103", temp: "reefer", volumeCapM3: 10 },
  ];

  it("needs chilled m3 per operating day over the planned load per trip, rounded up", () => {
    // Mean reefer capacity 20 x 25% fill = 5 m3 per trip. 105.5 m3 over 5 days = 21.1 -> 4.22 -> 5 trips.
    const a = assessReefers({ chilledM3: 105.5, operatingDays: 5, reefers, reefersInWorkshop: 0 });
    expect(a.loadPerTripM3).toBe(20 * REEFER_FILL);
    expect(a.tripsNeededPerDay).toBe(5);
    expect(a.tripsCapacityPerDay).toBe(4);
    expect(a.shortfallTripsPerDay).toBe(1);
    expect(a.shortfallReefers).toBe(1);
    expect(a.level).toBe("over");
    expect(actionLabel(a)).toBe("+1 hired reefer");
  });

  it("does not turn an exact fit into an extra trip, and calls a full fleet 'near' rather than 'over'", () => {
    const a = assessReefers({ chilledM3: 100, operatingDays: 5, reefers, reefersInWorkshop: 0 });
    expect(a.tripsNeededPerDay).toBe(4);
    expect(a.shortfallTripsPerDay).toBe(0);
    expect(a.level).toBe("near");
    expect(actionLabel(a)).toBe("Covered, no slack");
    expect(actionLabel(assessReefers({ chilledM3: 60, operatingDays: 5, reefers, reefersInWorkshop: 0 }))).toBe("Covered");
  });

  it("counts a reefer in the workshop out, and recalls it before hiring", () => {
    const a = assessReefers({ chilledM3: 125, operatingDays: 5, reefers, reefersInWorkshop: 1 });
    // 125/5/5 = 5 trips against one available reefer's 2: short 3 trips -> 2 reefers.
    expect(a.tripsCapacityPerDay).toBe(2);
    expect(a.shortfallTripsPerDay).toBe(3);
    expect(a.shortfallReefers).toBe(2);
    expect(planRelief(a)).toEqual({ recallReefers: 1, hireReefers: 1 });
    expect(actionLabel(a)).toBe("Recall 1 from workshop, +1 hired reefer");
  });

  it("never reports an infinite need when a depot has no reefer but some chilled demand", () => {
    const a = assessReefers({ chilledM3: 40, operatingDays: 6, reefers: [], reefersInWorkshop: 0 });
    expect(Number.isFinite(a.tripsNeededPerDay)).toBe(true);
    expect(a.tripsCapacityPerDay).toBe(0);
  });

  it("sizes the whole fleet at observed loading, two trips a day", () => {
    const fleet: FleetVehicle[] = [...reefers, { id: "VEH104", temp: "ambient", volumeCapM3: 12 }];
    const perDay = 30 * REEFER_FILL * 2 + 10 * REEFER_FILL * 2 + 12 * AMBIENT_FILL * 2;
    expect(fleetCapacityM3(fleet, 6)).toBeCloseTo(perDay * 6);
  });
});
