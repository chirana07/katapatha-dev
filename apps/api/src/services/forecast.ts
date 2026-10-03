/**
 * The weekly demand forecast, and the arithmetic that turns it into reefer trips.
 *
 * Pure on purpose: no database, no clock, no randomness. The seed calls it to
 * persist the forecast, the capacity service calls it to explain a week, and
 * the tests call it on series small enough to check by hand. Anything that
 * needs rows from Postgres loads them elsewhere and hands them in.
 *
 * THE METHOD (id below, stored in DemandForecast.method)
 *
 *   For a target ISO week, per depot x brand series, for total m3 and chilled m3
 *   separately:
 *
 *     1. Seasonal-naive: the same ISO week one year earlier. It carries what
 *        the calendar cannot say (a depot's local rhythm, how the week sits in
 *        the season).
 *     2. Trailing level: the mean of the eight most recent known weeks. It
 *        carries where demand is NOW, which last year cannot.
 *     3. Both are first divided by the signal index of the week they came
 *        from and multiplied by the target week's index, so last year's
 *        Deepavali does not leak into a forecast for a week without one, and
 *        a festival week this year is lifted even if last year's was not.
 *     4. The two are averaged with equal weight. With no history from a year
 *        ago the trailing level stands alone; with no history at all there is
 *        no forecast, never a made-up zero.
 *
 *   It is deliberately simple. Its job is to be explainable to a dispatcher in
 *   two sentences and to be honest about its error, which `backtest` measures
 *   by running the identical method over weeks whose outcome is known.
 *
 * THE SIGNAL INDEX
 *
 *   A day's factor is (1 + paydayUplift*payday) * (1 + festivalUplift*ramp) *
 *   (1 + monsoonEffect*monsoon), and zero when the depot does not run that day.
 *   A week's index is the sum over its days, so a week with a closed holiday is
 *   lower and a festival week is higher. The three coefficients are estimates
 *   from the 26 months of competition training data (payday days ran ~12%
 *   above comparable days; days at full festival ramp ~29% above, a ramp
 *   under 0.3 ~ flat, so +30% x ramp; monsoon days ~2% below). They are
 *   assumptions here, not fitted at runtime, and are the first thing to revisit
 *   if the backtest error is poor.
 */

import { level, type Level } from "@katapatha/core/domain/capacity";
import { MAX_TRIPS_PER_VEHICLE } from "@katapatha/core/domain/types";

// --- ISO weeks ---------------------------------------------------------------
// Dates travel as "YYYY-MM-DD" strings and are only turned into Dates at UTC
// midnight inside these helpers, so no caller can trip over a local timezone.

export interface WeekKey {
  isoYear: number;
  isoWeek: number;
}

const DAY_MS = 86_400_000;

export function parseIsoDate(date: string): Date {
  return new Date(`${date}T00:00:00.000Z`);
}

export function isoDateOf(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function addDays(date: string, days: number): string {
  return isoDateOf(new Date(parseIsoDate(date).getTime() + days * DAY_MS));
}

/** Monday of ISO week 1: the week containing 4 January. */
function week1Monday(isoYear: number): number {
  const jan4 = Date.UTC(isoYear, 0, 4);
  const dow = (new Date(jan4).getUTCDay() + 6) % 7;
  return jan4 - dow * DAY_MS;
}

export function isoWeekOfDate(date: string): WeekKey {
  const d = parseIsoDate(date).getTime();
  const dow = (new Date(d).getUTCDay() + 6) % 7;
  // The ISO year of a date is the year of the Thursday of its week.
  const thursday = d - dow * DAY_MS + 3 * DAY_MS;
  const isoYear = new Date(thursday).getUTCFullYear();
  const isoWeek = 1 + Math.round((thursday - 3 * DAY_MS - week1Monday(isoYear)) / (7 * DAY_MS));
  return { isoYear, isoWeek };
}

/** The Monday of an ISO week. */
export function isoWeekStart(key: WeekKey): string {
  return isoDateOf(new Date(week1Monday(key.isoYear) + (key.isoWeek - 1) * 7 * DAY_MS));
}

export function isoWeekDates(key: WeekKey): string[] {
  const start = isoWeekStart(key);
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

export function isoWeeksInYear(isoYear: number): number {
  return isoWeekOfDate(`${isoYear}-12-28`).isoWeek;
}

export function addWeeks(key: WeekKey, weeks: number): WeekKey {
  return isoWeekOfDate(addDays(isoWeekStart(key), weeks * 7));
}

export function weekKeyStr(key: WeekKey): string {
  return `${key.isoYear}-W${String(key.isoWeek).padStart(2, "0")}`;
}

/** Whole weeks from `a` to `b`; positive when `b` is later. */
export function weeksBetween(a: WeekKey, b: WeekKey): number {
  return Math.round((parseIsoDate(isoWeekStart(b)).getTime() - parseIsoDate(isoWeekStart(a)).getTime()) / (7 * DAY_MS));
}

// --- Calendar signals --------------------------------------------------------

export interface CalendarSignalDay {
  date: string;
  isoYear: number;
  isoWeek: number;
  isOperating: boolean;
  isPayday: boolean;
  isHoliday: boolean;
  festival: string | null;
  festivalRamp: number;
  monsoon: boolean;
}

export const SIGNAL_EFFECTS = {
  paydayUplift: 0.12,
  festivalUplift: 0.3,
  monsoonEffect: -0.02,
} as const;

/** A week of six operating days and no signals. The neutral index. */
export const NEUTRAL_WEEK_INDEX = 6;

export function dayFactor(day: CalendarSignalDay): number {
  if (!day.isOperating) return 0;
  return (
    (1 + SIGNAL_EFFECTS.paydayUplift * (day.isPayday ? 1 : 0)) *
    (1 + SIGNAL_EFFECTS.festivalUplift * day.festivalRamp) *
    (1 + SIGNAL_EFFECTS.monsoonEffect * (day.monsoon ? 1 : 0))
  );
}

/**
 * The week's signal index. A week we have no calendar for is treated as
 * neutral rather than zero: a missing calendar must not read as "the depot is
 * closed".
 */
export function weekSignalIndex(days: readonly CalendarSignalDay[] | undefined): number {
  if (!days || days.length === 0) return NEUTRAL_WEEK_INDEX;
  return days.reduce((sum, d) => sum + dayFactor(d), 0);
}

export function operatingDaysIn(days: readonly CalendarSignalDay[] | undefined): number {
  if (!days || days.length === 0) return NEUTRAL_WEEK_INDEX;
  return days.filter((d) => d.isOperating).length;
}

function prettyFestival(name: string): string {
  return name
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Plain-language signals for a week, in the order a dispatcher cares about.
 * "Inter-monsoon" is the honest word for a week with no monsoon flag in a
 * season that otherwise has one; it is only used when a neighbouring day is
 * flagged, so a dry-season week shows no weather label at all.
 */
export function weekSignalLabels(days: readonly CalendarSignalDay[] | undefined): string[] {
  if (!days || days.length === 0) return [];
  const labels: string[] = [];
  const festivalDays = days.filter((d) => d.festival && d.festivalRamp > 0);
  if (festivalDays.length > 0) {
    const peak = festivalDays.reduce((a, b) => (b.festivalRamp > a.festivalRamp ? b : a));
    labels.push(`${prettyFestival(peak.festival ?? "")} ramp`);
  }
  if (days.some((d) => d.isPayday)) labels.push("Payday");
  const monsoonDays = days.filter((d) => d.monsoon).length;
  if (monsoonDays >= Math.ceil(days.length / 2)) labels.push("Monsoon");
  const holiday = days.filter((d) => d.isHoliday && !d.festival);
  if (holiday.length > 0) labels.push("Public holiday");
  return labels;
}

/**
 * Give ramp days their festival's name.
 *
 * In the supplied calendar only the festival day itself carries the name; the
 * days of build-up before it have a ramp but a blank festival. Without this a
 * week of heavy pre-festival demand would show no cause at all. Each unnamed
 * ramp day takes the name of the next festival within `lookAheadDays`.
 */
export function inferFestivalNames(days: readonly CalendarSignalDay[], lookAheadDays = 14): CalendarSignalDay[] {
  const sorted = [...days].sort((a, b) => a.date.localeCompare(b.date));
  const out: CalendarSignalDay[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const d = sorted[i];
    if (d.festival || d.festivalRamp <= 0) {
      out.push(d);
      continue;
    }
    const limit = addDays(d.date, lookAheadDays);
    const next = sorted.slice(i + 1).find((x) => x.date <= limit && x.festival);
    out.push(next ? { ...d, festival: next.festival } : d);
  }
  return out;
}

export function groupCalendarByWeek(
  days: readonly CalendarSignalDay[],
): Map<string, CalendarSignalDay[]> {
  const out = new Map<string, CalendarSignalDay[]>();
  for (const d of days) {
    const key = weekKeyStr(d);
    const list = out.get(key);
    if (list) list.push(d);
    else out.set(key, [d]);
  }
  return out;
}

// --- The forecast ------------------------------------------------------------

export const FORECAST_METHOD_ID = "seasonal-naive+trailing8 v1 (calendar-scaled)";
export const TRAILING_WEEKS = 8;
export const SEASONAL_WEIGHT = 0.5;

export interface WeeklyPoint extends WeekKey {
  totalM3: number;
  chilledM3: number;
}

export interface Forecast {
  totalM3: number;
  chilledM3: number;
  /** Which ingredients were available — surfaced so a reviewer can see why a number is what it is. */
  basis: "seasonal+trailing" | "trailing-only";
}

type CalendarByWeek = ReadonlyMap<string, readonly CalendarSignalDay[]>;

function blend(parts: { seasonal: number | null; trailing: number | null }): number | null {
  if (parts.trailing === null && parts.seasonal === null) return null;
  if (parts.seasonal === null) return parts.trailing;
  if (parts.trailing === null) return parts.seasonal;
  return SEASONAL_WEIGHT * parts.seasonal + (1 - SEASONAL_WEIGHT) * parts.trailing;
}

/**
 * Forecast one week of one series, as if standing at `leadWeeks` before it.
 *
 * `leadWeeks` is how far ahead we are forecasting: only weeks at or before
 * (target - leadWeeks) count as known. It is 1 for "next week" and larger when
 * the latest history is stale, which is why the backtest is told the real gap
 * instead of flattering itself with one-step-ahead forecasts.
 */
export function forecastWeek(
  history: readonly WeeklyPoint[],
  calendar: CalendarByWeek,
  target: WeekKey,
  leadWeeks = 1,
): Forecast | null {
  const cutoff = addWeeks(target, -Math.max(1, leadWeeks));
  const known = history
    .filter((p) => weeksBetween(p, cutoff) >= 0)
    .sort((a, b) => weeksBetween(b, a));
  if (known.length === 0) return null;

  const targetIndex = weekSignalIndex(calendar.get(weekKeyStr(target)));
  const scaled = (p: WeeklyPoint, pick: (p: WeeklyPoint) => number): number => {
    const idx = weekSignalIndex(calendar.get(weekKeyStr(p)));
    return idx > 0 ? (pick(p) / idx) * targetIndex : 0;
  };

  const recent = known.slice(-TRAILING_WEEKS);
  const trailing = (pick: (p: WeeklyPoint) => number): number =>
    recent.reduce((s, p) => s + scaled(p, pick), 0) / recent.length;

  // Same ISO week a year earlier; week 53 has no counterpart in a 52-week year.
  let lastYear = known.find((p) => p.isoYear === target.isoYear - 1 && p.isoWeek === target.isoWeek);
  if (!lastYear && target.isoWeek === 53) {
    lastYear = known.find((p) => p.isoYear === target.isoYear - 1 && p.isoWeek === 52);
  }

  const total = blend({
    seasonal: lastYear ? scaled(lastYear, (p) => p.totalM3) : null,
    trailing: trailing((p) => p.totalM3),
  });
  const chilled = blend({
    seasonal: lastYear ? scaled(lastYear, (p) => p.chilledM3) : null,
    trailing: trailing((p) => p.chilledM3),
  });
  if (total === null || chilled === null) return null;

  return {
    totalM3: total,
    // Chilled is a subset of total; the two are forecast separately, so the
    // invariant has to be restored rather than assumed.
    chilledM3: Math.min(chilled, total),
    basis: lastYear ? "seasonal+trailing" : "trailing-only",
  };
}

// --- The backtest ------------------------------------------------------------

export interface BacktestWeek extends WeekKey {
  actualTotalM3: number;
  forecastTotalM3: number;
  /** Absolute percentage error on total volume, 0.08 = 8%. */
  apeTotal: number;
  actualChilledM3: number;
  forecastChilledM3: number;
  /** Null when the week had no chilled volume to be wrong about. */
  apeChilled: number | null;
}

export interface Backtest {
  weeks: BacktestWeek[];
  /** Mean absolute percentage error on total volume, in percent to one decimal. Null when nothing could be tested. */
  mapeTotalPct: number | null;
  mapeChilledPct: number | null;
  leadWeeks: number;
}

/**
 * Rerun `forecastWeek` over the last `weeks` known weeks and score it.
 *
 * Series are summed before scoring: the capacity page plans a depot, so the
 * error that matters is the depot's, not each brand's. Positive and negative
 * brand errors partly cancel in a sum, which is exactly how they behave when
 * the fleet is sized against the depot total.
 *
 * Computed at read time, never stored: it depends on which weeks are known,
 * and a stored number would quietly go stale after the next import.
 */
export function backtest(
  seriesList: readonly (readonly WeeklyPoint[])[],
  calendar: CalendarByWeek,
  opts: { weeks?: number; leadWeeks?: number } = {},
): Backtest {
  const leadWeeks = Math.max(1, opts.leadWeeks ?? 1);
  const wanted = opts.weeks ?? 8;

  const knownWeeks = new Map<string, WeekKey>();
  for (const series of seriesList) {
    for (const p of series) knownWeeks.set(weekKeyStr(p), { isoYear: p.isoYear, isoWeek: p.isoWeek });
  }
  const latest = [...knownWeeks.values()]
    .sort((a, b) => weeksBetween(b, a))
    .slice(-wanted);

  const weeks: BacktestWeek[] = [];
  for (const week of latest) {
    let actualTotal = 0;
    let forecastTotal = 0;
    let actualChilled = 0;
    let forecastChilled = 0;
    let used = 0;
    for (const series of seriesList) {
      const actual = series.find((p) => p.isoYear === week.isoYear && p.isoWeek === week.isoWeek);
      if (!actual) continue;
      const forecast = forecastWeek(series, calendar, week, leadWeeks);
      if (!forecast) continue;
      actualTotal += actual.totalM3;
      forecastTotal += forecast.totalM3;
      actualChilled += actual.chilledM3;
      forecastChilled += forecast.chilledM3;
      used++;
    }
    if (used === 0 || actualTotal <= 0) continue;
    weeks.push({
      ...week,
      actualTotalM3: actualTotal,
      forecastTotalM3: forecastTotal,
      apeTotal: Math.abs(forecastTotal - actualTotal) / actualTotal,
      actualChilledM3: actualChilled,
      forecastChilledM3: forecastChilled,
      apeChilled: actualChilled > 0 ? Math.abs(forecastChilled - actualChilled) / actualChilled : null,
    });
  }

  const mean = (xs: number[]): number | null =>
    xs.length === 0 ? null : Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 1000) / 10;

  return {
    weeks,
    mapeTotalPct: mean(weeks.map((w) => w.apeTotal)),
    mapeChilledPct: mean(weeks.flatMap((w) => (w.apeChilled === null ? [] : [w.apeChilled]))),
    leadWeeks,
  };
}

// --- Reefer trips ------------------------------------------------------------

/**
 * How full a trip actually runs, as a share of the vehicle's volume cap.
 *
 * Calibrated against the competition training deliveries: across 9,734 reefer
 * routes the mean load was 25% of the vehicle's volume capacity (ambient: 40%
 * across 15,464). Trips are limited by one-district-per-trip, delivery windows
 * and the time budget long before they are limited by cubic metres, so sizing
 * the fleet on nameplate volume would say there is never a shortage while the
 * allocator is deferring orders for want of a reefer. The planning load per
 * trip is therefore capacity x fill, using the REAL capacities of the depot's
 * own vehicles. If the fleet's operating pattern changes, change these two.
 */
export const REEFER_FILL = 0.25;
export const AMBIENT_FILL = 0.4;

/** Rule 7: a vehicle runs at most two trips a day. */
export const TRIPS_PER_VEHICLE_DAY = MAX_TRIPS_PER_VEHICLE;

export interface FleetVehicle {
  id: string;
  temp: "reefer" | "ambient";
  volumeCapM3: number;
}

export function loadPerReeferTripM3(reefers: readonly FleetVehicle[]): number {
  if (reefers.length === 0) return 0;
  const meanCap = reefers.reduce((s, v) => s + v.volumeCapM3, 0) / reefers.length;
  return meanCap * REEFER_FILL;
}

export interface ReeferAssessment {
  operatingDays: number;
  /** m3 a reefer trip is planned to carry: mean reefer capacity x REEFER_FILL. */
  loadPerTripM3: number;
  tripsNeededPerDay: number;
  /** Reefers at the depot that are not in the workshop. */
  reefersAvailable: number;
  reefersInWorkshop: number;
  tripsCapacityPerDay: number;
  shortfallTripsPerDay: number;
  /** Whole reefers that would close the shortfall, two trips each. */
  shortfallReefers: number;
  /** The week's chilled volume the available reefers can carry at the planning load. */
  chilledCapacityM3: number;
  level: Level;
}

/**
 * Trips per day the chilled volume needs, against what the reefers can run.
 *
 * Needed = chilled m3 per operating day / planning load per trip, rounded up:
 * a part-trip is still a trip. Capacity = available reefers x two trips. A
 * reefer in the workshop on any day of the week is counted out for the whole
 * week — the conservative reading, and the one a dispatcher would plan on.
 */
export function assessReefers(input: {
  chilledM3: number;
  operatingDays: number;
  reefers: readonly FleetVehicle[];
  reefersInWorkshop: number;
}): ReeferAssessment {
  const loadPerTripM3 = loadPerReeferTripM3(input.reefers);
  const days = input.operatingDays;
  const needed =
    days > 0 && loadPerTripM3 > 0
      ? // The epsilon keeps 4.000000001 from becoming a fifth trip.
        Math.ceil(input.chilledM3 / days / loadPerTripM3 - 1e-9)
      : input.chilledM3 > 0
        ? Infinity
        : 0;
  const available = Math.max(0, input.reefers.length - input.reefersInWorkshop);
  const capacity = available * TRIPS_PER_VEHICLE_DAY;
  const shortfall = Number.isFinite(needed) ? Math.max(0, needed - capacity) : 0;
  return {
    operatingDays: days,
    loadPerTripM3,
    tripsNeededPerDay: Number.isFinite(needed) ? needed : 0,
    reefersAvailable: available,
    reefersInWorkshop: input.reefersInWorkshop,
    tripsCapacityPerDay: capacity,
    shortfallTripsPerDay: shortfall,
    shortfallReefers: Math.ceil(shortfall / TRIPS_PER_VEHICLE_DAY),
    chilledCapacityM3: capacity * days * loadPerTripM3,
    level: level(Number.isFinite(needed) ? needed : 0, capacity),
  };
}

/**
 * Whole-fleet capacity for a week, at observed loading: sum over vehicles of
 * volume cap x fill x two trips, for each operating day. This is "what the
 * fleet can carry in practice", the orange line on the demand chart — not the
 * nameplate sum, for the reason given at REEFER_FILL.
 */
export function fleetCapacityM3(vehicles: readonly FleetVehicle[], operatingDays: number): number {
  const perDay = vehicles.reduce(
    (s, v) => s + v.volumeCapM3 * (v.temp === "reefer" ? REEFER_FILL : AMBIENT_FILL) * TRIPS_PER_VEHICLE_DAY,
    0,
  );
  return perDay * operatingDays;
}

/**
 * What to do about a week, in the order the system can do it: bring back a
 * reefer that is only in the workshop, then hire for whatever remains.
 */
export function planRelief(a: ReeferAssessment): { recallReefers: number; hireReefers: number } {
  const recallReefers = Math.min(a.reefersInWorkshop, a.shortfallReefers);
  return { recallReefers, hireReefers: Math.max(0, a.shortfallReefers - recallReefers) };
}

export function actionLabel(a: ReeferAssessment): string {
  if (a.shortfallTripsPerDay > 0) {
    const { recallReefers, hireReefers } = planRelief(a);
    const parts: string[] = [];
    if (recallReefers > 0) parts.push(`Recall ${recallReefers} from workshop`);
    if (hireReefers > 0) parts.push(`+${hireReefers} hired reefer${hireReefers > 1 ? "s" : ""}`);
    return parts.join(", ");
  }
  return a.level === "near" ? "Covered, no slack" : "Covered";
}

// --- Rows for DemandForecast --------------------------------------------------

export interface ForecastRow {
  isoYear: number;
  isoWeek: number;
  depotCode: string;
  brand: "Fresh" | "Style" | "Tech";
  predTotalVolumeM3: number;
  predChilledVolumeM3: number;
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

/** One forecast row per series per target week; series without history yield none. */
export function buildForecastRows(
  series: ReadonlyMap<string, { depotCode: string; brand: ForecastRow["brand"]; points: readonly WeeklyPoint[] }>,
  calendar: CalendarByWeek,
  targets: readonly WeekKey[],
  leadWeeks: (target: WeekKey) => number = () => 1,
): ForecastRow[] {
  const rows: ForecastRow[] = [];
  for (const target of targets) {
    for (const s of series.values()) {
      const f = forecastWeek(s.points, calendar, target, leadWeeks(target));
      if (!f) continue;
      rows.push({
        isoYear: target.isoYear,
        isoWeek: target.isoWeek,
        depotCode: s.depotCode,
        brand: s.brand,
        predTotalVolumeM3: round2(f.totalM3),
        predChilledVolumeM3: round2(f.chilledM3),
      });
    }
  }
  return rows;
}
