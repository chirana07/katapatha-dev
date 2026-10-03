/**
 * Analytics history: what the field reported back, and the forecast built on it.
 *
 * Four tables are filled here and nothing else writes them:
 *
 *   DailyDemandHistory / WeeklyDemandHistory  demand per depot x brand x temp,
 *                                             counted by the day the store asked
 *   HistoricalLeg                             planned vs actual times per stop
 *   ServiceObservation                        handling minutes per order, observed
 *   DemandForecast                            the next weeks, from `services/forecast.ts`
 *
 * TWO MODES, ONE SHAPE
 *
 *   real     deliveries_train.csv and route_legs_train.csv are streamed and
 *            aggregated. Column names come from the Challenge Booklet's data
 *            dictionary; the parsers are defensive (aliases, skipped-and-counted
 *            bad rows) so a renamed column degrades one field rather than
 *            aborting a seed that took a minute to get this far.
 *   fixture  the CSVs are confidential and absent from a clean clone, so the
 *            history is GENERATED for the fixture network with a seeded PRNG:
 *            the same output every run, shaped by the calendar's own signals.
 *
 * THE SYNTHETIC HISTORY IS NOT THE COMPETITION DATA and must never be shown as
 * if it were. It is labelled in three places that survive being copied around:
 * SeedMeta.dataSource ("fixture-synthetic"), DemandForecast.method (starts with
 * "SYNTHETIC"), and the id of every HistoricalLeg ("SYN-..."). The numbers are
 * invented to have the right shape — weekday rhythm, payday, festival ramps —
 * so the reports and the forecast have something truthful-looking to chew on.
 *
 * The functions above `seedHistory` are pure and unit-tested.
 */

import type { PrismaClient } from "@prisma/client";
import { readCsv, readCsvAll, str, type CsvRow } from "@katapatha/allocator/csv";
import { computeStopSchedule, effectiveWindow } from "@katapatha/core/domain/schedule";
import { allowanceKey, type AllowanceTable } from "@katapatha/core/domain/tripTime";
import { fromMin, toMin } from "@katapatha/core/domain/time";
import type { Brand, DepotCode, DistrictTravel, DockType, OutletRef } from "@katapatha/core/domain/types";
import {
  FORECAST_METHOD_ID,
  addDays,
  addWeeks,
  buildForecastRows,
  groupCalendarByWeek,
  isoWeekOfDate,
  isoWeekStart,
  parseIsoDate,
  weekKeyStr,
  weeksBetween,
  type CalendarSignalDay,
  type WeekKey,
  type WeeklyPoint,
  dayFactor,
} from "../../src/services/forecast";
import type { DataSource } from "./source";

// --- Constants ---------------------------------------------------------------

/** Fixed so a re-seed reproduces the history byte for byte. */
export const SYNTHETIC_SEED = 20260409;

/** 78 ISO weeks (~18 months) ending the Sunday before the first forecast week, 2026-W14. */
export const SYNTHETIC_HISTORY_START = "2024-10-07";
export const SYNTHETIC_HISTORY_END = "2026-03-29";
/** Eight weeks of legs, the part of the history the tracking and on-time reports lean on. */
export const SYNTHETIC_LEGS_START = "2026-02-02";
/** The organisers' horizon: W14-W23 of 2026. */
export const FORECAST_FIRST_WEEK: WeekKey = { isoYear: 2026, isoWeek: 14 };
export const FORECAST_WEEK_COUNT = 10;

export const SYNTHETIC_DATA_SOURCE = "fixture-synthetic";

// --- Seeded randomness --------------------------------------------------------
// Never Math.random: the seed must be reproducible, and a stream keyed by
// (date, depot, ...) must not change when an unrelated loop is reordered.

export function hashString(text: string): number {
  // FNV-1a, 32 bit.
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32: tiny, fast, and good enough for noise on a demo history. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function rngFor(...parts: (string | number)[]): () => number {
  return mulberry32(hashString([SYNTHETIC_SEED, ...parts].join("|")));
}

/** Standard normal by Box-Muller. */
export function gaussian(rng: () => number): number {
  const u = Math.max(rng(), 1e-12);
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// --- Row shapes ----------------------------------------------------------------

export type Temp = "chilled" | "ambient";

export interface DailyRow {
  date: string;
  depotCode: string;
  brand: Brand;
  temp: Temp;
  orders: number;
  units: number;
  weightKg: number;
  volumeM3: number;
  deferred: number;
  notRun: number;
}

export interface WeeklyRow {
  isoYear: number;
  isoWeek: number;
  depotCode: string;
  brand: Brand;
  totalVolumeM3: number;
  chilledVolumeM3: number;
  orderCount: number;
  deferredCount: number;
}

export interface LegRow {
  id: string;
  date: string;
  routeId: string;
  vehicleId: string;
  districtName: string;
  brand: Brand;
  seq: number;
  fromPoint: string;
  outletId: string;
  distanceKm: number;
  plannedDepart: string;
  plannedArrival: string;
  actualDepart: string | null;
  arrivalTime: string | null;
  leaveOutletTime: string | null;
  monsoon: boolean;
}

export interface ServiceRow {
  brand: Brand;
  dockType: DockType;
  districtName: string;
  monsoon: boolean;
  n: number;
  meanActualMin: number;
  p90ActualMin: number;
}

export interface CalendarRow {
  date: string;
  dow: number;
  dowName: string;
  isWeekend: boolean;
  isoYear: number;
  isoWeek: number;
  isPayday: boolean;
  festival: string | null;
  festivalRamp: number;
  isHoliday: boolean;
  monsoon: boolean;
  isOperating: boolean;
}

// --- Defensive CSV parsing ------------------------------------------------------
// Real files are parsed row by row and a bad row is skipped and counted, never
// thrown: one malformed line in 92,000 must not abort the seed. Column names
// are looked up through aliases for the same reason.

function pick(row: CsvRow, names: readonly string[]): string | undefined {
  for (const name of names) {
    const v = row[name];
    if (v !== undefined) return v.trim();
  }
  return undefined;
}

function pickNum(row: CsvRow, names: readonly string[]): number | null {
  const raw = pick(row, names);
  if (raw === undefined || raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/** "5:07", "05:07" or "05:07:30" -> "05:07"; anything else -> null. */
export function parseClock(raw: string | undefined): string | null {
  if (!raw) return null;
  const m = /^(\d{1,2}):([0-5]\d)(?::[0-5]\d)?$/.exec(raw.trim());
  if (!m) return null;
  const h = Number(m[1]);
  if (h > 23) return null;
  return `${String(h).padStart(2, "0")}:${m[2]}`;
}

function parseDate(raw: string | undefined): string | null {
  if (!raw) return null;
  const t = raw.trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return null;
  return Number.isNaN(parseIsoDate(t).getTime()) ? null : t;
}

const BRANDS: readonly string[] = ["Fresh", "Style", "Tech"];

function parseBrand(raw: string | undefined): Brand | null {
  if (!raw) return null;
  const t = raw.trim();
  const hit = BRANDS.find((b) => b.toLowerCase() === t.toLowerCase());
  return (hit as Brand | undefined) ?? null;
}

export type DispatchStatus = "attempted" | "deferred" | "not_run";

export interface DeliveryRecord {
  orderDate: string;
  dispatchDate: string | null;
  status: DispatchStatus;
  outletId: string;
  brand: Brand;
  depot: string;
  temp: Temp;
  units: number;
  weightKg: number;
  volumeM3: number;
  routeId: string | null;
  seqInRoute: number | null;
}

/** One row of deliveries_train.csv; null when it cannot be trusted. */
export function parseDeliveryRow(row: CsvRow): DeliveryRecord | null {
  const orderDate = parseDate(pick(row, ["order_date", "requested_date"]));
  const brand = parseBrand(pick(row, ["brand"]));
  const depot = pick(row, ["depot"]);
  const outletId = pick(row, ["outlet_id"]);
  const rawStatus = pick(row, ["dispatch_status", "status"])?.toLowerCase().replace(/[\s-]+/g, "_");
  const rawTemp = pick(row, ["temp_requirement", "temp"])?.toLowerCase();
  const volume = pickNum(row, ["order_volume_m3", "volume_m3"]);
  if (!orderDate || !brand || !depot || !outletId || volume === null || volume < 0) return null;

  const status: DispatchStatus | null =
    rawStatus === "attempted" || rawStatus === "deferred" ? rawStatus : rawStatus === "not_run" || rawStatus === "notrun" ? "not_run" : null;
  const temp: Temp | null = rawTemp === "chilled" || rawTemp === "ambient" ? rawTemp : null;
  if (!status || !temp) return null;

  const seq = pickNum(row, ["seq_in_route", "seq"]);
  return {
    orderDate,
    dispatchDate: parseDate(pick(row, ["dispatch_date"])),
    status,
    outletId,
    brand,
    depot,
    temp,
    units: Math.round(pickNum(row, ["order_units", "units"]) ?? 0),
    weightKg: pickNum(row, ["order_weight_kg", "weight_kg"]) ?? 0,
    volumeM3: volume,
    routeId: pick(row, ["route_id"]) || null,
    seqInRoute: seq === null ? null : Math.round(seq),
  };
}

export interface LegRecord {
  id: string;
  date: string;
  routeId: string;
  vehicleId: string;
  depot: string | null;
  districtName: string;
  brand: Brand;
  seq: number;
  fromPoint: string;
  outletId: string;
  distanceKm: number;
  plannedDepart: string;
  plannedArrival: string;
  actualDepart: string | null;
  arrivalTime: string | null;
  leaveOutletTime: string | null;
  monsoon: boolean;
}

/** One row of route_legs_train.csv; null when the planned side is unusable. */
export function parseLegRow(row: CsvRow): LegRecord | null {
  const id = pick(row, ["leg_id", "id"]);
  const date = parseDate(pick(row, ["date", "dispatch_date"]));
  const routeId = pick(row, ["route_id"]);
  const vehicleId = pick(row, ["vehicle_id"]);
  const district = pick(row, ["district"]);
  const brand = parseBrand(pick(row, ["brand"]));
  const outletId = pick(row, ["to_outlet", "outlet_id"]);
  const seq = pickNum(row, ["seq"]);
  const distance = pickNum(row, ["distance_km"]);
  const plannedDepart = parseClock(pick(row, ["planned_depart_time", "planned_depart"]));
  const plannedArrival = parseClock(pick(row, ["planned_arrival_time", "planned_arrival"]));
  if (!id || !date || !routeId || !vehicleId || !district || !brand || !outletId) return null;
  if (seq === null || distance === null || !plannedDepart || !plannedArrival) return null;

  const monsoonRaw = pick(row, ["monsoon"]);
  return {
    id,
    date,
    routeId,
    vehicleId,
    depot: pick(row, ["depot"]) || null,
    districtName: district,
    brand,
    seq: Math.round(seq),
    fromPoint: pick(row, ["from_point"]) || "DEPOT",
    outletId,
    distanceKm: distance,
    plannedDepart,
    plannedArrival,
    actualDepart: parseClock(pick(row, ["actual_depart_time", "actual_depart"])),
    arrivalTime: parseClock(pick(row, ["arrival_time", "actual_arrival_time"])),
    leaveOutletTime: parseClock(pick(row, ["leave_outlet_time"])),
    monsoon: monsoonRaw === "1" || monsoonRaw?.toLowerCase() === "true",
  };
}

// --- Aggregation ---------------------------------------------------------------

const r3 = (n: number): number => Math.round(n * 1000) / 1000;

/** Streaming accumulator for DailyDemandHistory, keyed date x depot x brand x temp. */
export class DailyAccumulator {
  private readonly map = new Map<string, DailyRow>();

  add(rec: Pick<DeliveryRecord, "orderDate" | "depot" | "brand" | "temp" | "units" | "weightKg" | "volumeM3" | "status">): void {
    const key = `${rec.orderDate}|${rec.depot}|${rec.brand}|${rec.temp}`;
    let row = this.map.get(key);
    if (!row) {
      row = {
        date: rec.orderDate,
        depotCode: rec.depot,
        brand: rec.brand,
        temp: rec.temp,
        orders: 0,
        units: 0,
        weightKg: 0,
        volumeM3: 0,
        deferred: 0,
        notRun: 0,
      };
      this.map.set(key, row);
    }
    // Every order counts once, deferred and never-run included: they are
    // demand the depot could not serve, which is exactly what a forecast of
    // what to prepare for needs to see.
    row.orders += 1;
    row.units += rec.units;
    row.weightKg += rec.weightKg;
    row.volumeM3 += rec.volumeM3;
    if (rec.status === "deferred") row.deferred += 1;
    if (rec.status === "not_run") row.notRun += 1;
  }

  rows(): DailyRow[] {
    return [...this.map.values()]
      .map((r) => ({ ...r, weightKg: r3(r.weightKg), volumeM3: r3(r.volumeM3) }))
      .sort((a, b) => a.date.localeCompare(b.date) || a.depotCode.localeCompare(b.depotCode) || a.brand.localeCompare(b.brand) || a.temp.localeCompare(b.temp));
  }
}

/** Fold daily rows into depot x brand x ISO week. `weekOf` is the calendar's own numbering. */
export function weeklyFromDaily(daily: readonly DailyRow[], weekOf: (date: string) => WeekKey): WeeklyRow[] {
  const map = new Map<string, WeeklyRow>();
  for (const d of daily) {
    const wk = weekOf(d.date);
    const key = `${wk.isoYear}|${wk.isoWeek}|${d.depotCode}|${d.brand}`;
    let row = map.get(key);
    if (!row) {
      row = {
        isoYear: wk.isoYear,
        isoWeek: wk.isoWeek,
        depotCode: d.depotCode,
        brand: d.brand,
        totalVolumeM3: 0,
        chilledVolumeM3: 0,
        orderCount: 0,
        deferredCount: 0,
      };
      map.set(key, row);
    }
    row.totalVolumeM3 += d.volumeM3;
    if (d.temp === "chilled") row.chilledVolumeM3 += d.volumeM3;
    row.orderCount += d.orders;
    row.deferredCount += d.deferred;
  }
  return [...map.values()]
    .map((r) => ({ ...r, totalVolumeM3: r3(r.totalVolumeM3), chilledVolumeM3: r3(r.chilledVolumeM3) }))
    .sort((a, b) => a.isoYear - b.isoYear || a.isoWeek - b.isoWeek || a.depotCode.localeCompare(b.depotCode) || a.brand.localeCompare(b.brand));
}

export function seriesFromWeekly(
  weekly: readonly WeeklyRow[],
): Map<string, { depotCode: string; brand: Brand; points: WeeklyPoint[] }> {
  const out = new Map<string, { depotCode: string; brand: Brand; points: WeeklyPoint[] }>();
  for (const w of weekly) {
    const key = `${w.depotCode}|${w.brand}`;
    let s = out.get(key);
    if (!s) {
      s = { depotCode: w.depotCode, brand: w.brand, points: [] };
      out.set(key, s);
    }
    s.points.push({ isoYear: w.isoYear, isoWeek: w.isoWeek, totalM3: w.totalVolumeM3, chilledM3: w.chilledVolumeM3 });
  }
  return out;
}

// --- Service observations --------------------------------------------------------

/**
 * Minutes spent handling ONE order at a stop.
 *
 * Service starts at the later of arrival and the window opening — a vehicle
 * that arrives early waits, and the wait is not handling (the booklet says so
 * in its Task 1 label rules). Handling is charged per order, so a stop that
 * delivered k orders is divided by k to be comparable with the allowance.
 * A negative or absurd span (a data glitch, or a clock that wrapped midnight)
 * is dropped rather than averaged in.
 */
export function legServiceMinutes(
  arrivalTime: string | null,
  leaveOutletTime: string | null,
  windowOpen: string,
  ordersAtStop: number,
): number | null {
  if (!arrivalTime || !leaveOutletTime) return null;
  const start = Math.max(toMin(arrivalTime), toMin(windowOpen));
  const span = toMin(leaveOutletTime) - start;
  if (span < 0 || span > 6 * 60) return null;
  return span / Math.max(1, ordersAtStop);
}

export class ServiceAccumulator {
  private readonly map = new Map<string, { brand: Brand; dockType: DockType; districtName: string; monsoon: boolean; samples: number[] }>();

  add(brand: Brand, dockType: DockType, districtName: string, monsoon: boolean, minutes: number): void {
    const key = `${brand}|${dockType}|${districtName}|${monsoon ? 1 : 0}`;
    let g = this.map.get(key);
    if (!g) {
      g = { brand, dockType, districtName, monsoon, samples: [] };
      this.map.set(key, g);
    }
    g.samples.push(minutes);
  }

  rows(): ServiceRow[] {
    return [...this.map.values()]
      .map((g) => {
        const sorted = [...g.samples].sort((a, b) => a - b);
        // Nearest-rank p90.
        const p90 = sorted[Math.min(sorted.length - 1, Math.ceil(0.9 * sorted.length) - 1)];
        const mean = sorted.reduce((s, x) => s + x, 0) / sorted.length;
        return {
          brand: g.brand,
          dockType: g.dockType,
          districtName: g.districtName,
          monsoon: g.monsoon,
          n: sorted.length,
          meanActualMin: Math.round(mean * 100) / 100,
          p90ActualMin: Math.round(p90 * 100) / 100,
        };
      })
      .sort((a, b) => a.brand.localeCompare(b.brand) || a.dockType.localeCompare(b.dockType) || a.districtName.localeCompare(b.districtName) || Number(a.monsoon) - Number(b.monsoon));
  }
}

// --- The synthetic calendar --------------------------------------------------------

const DOW_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;

/**
 * Public festival dates. The shape of the ramp around each is the fixture
 * calendar's own New Year ramp (0.3 five days out, 1.0 on the day, 0.2 four
 * days after), extended a few days earlier so the build-up is visible.
 */
export const SYNTHETIC_FESTIVALS: readonly { date: string; name: string; closedDays: number }[] = [
  { date: "2024-10-31", name: "Deepavali", closedDays: 1 },
  { date: "2024-12-25", name: "Christmas", closedDays: 1 },
  { date: "2025-01-14", name: "Thai Pongal", closedDays: 1 },
  { date: "2025-04-14", name: "New Year", closedDays: 2 },
  { date: "2025-05-12", name: "Vesak", closedDays: 1 },
  { date: "2025-06-10", name: "Poson", closedDays: 1 },
  { date: "2025-08-08", name: "Esala", closedDays: 1 },
  { date: "2025-10-20", name: "Deepavali", closedDays: 1 },
  { date: "2025-12-25", name: "Christmas", closedDays: 1 },
  { date: "2026-01-15", name: "Thai Pongal", closedDays: 1 },
  { date: "2026-04-14", name: "New Year", closedDays: 1 },
  { date: "2026-05-01", name: "Vesak", closedDays: 1 },
  { date: "2026-05-30", name: "Poson", closedDays: 1 },
];

const RAMP_BY_OFFSET: Record<number, number> = {
  [-8]: 0.1, [-7]: 0.15, [-6]: 0.2, [-5]: 0.3, [-4]: 0.4, [-3]: 0.5, [-2]: 0.6, [-1]: 0.8,
  0: 1, 1: 0.8, 2: 0.5, 3: 0.3, 4: 0.2,
};

/** Months the real calendar flags as monsoon: March-June and October-November. */
const MONSOON_MONTHS = new Set([3, 4, 5, 6, 10, 11]);

function lastDayOfMonth(date: string): string {
  const d = parseIsoDate(date);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
}

function monthDay(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Paydays fall on the 25th and the last day of the month, moved back off a Sunday. */
function isPaydayDate(date: string): boolean {
  const d = parseIsoDate(date);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + 1;
  const back = (target: string): string => {
    const dow = (parseIsoDate(target).getUTCDay() + 6) % 7;
    return dow === 6 ? addDays(target, -1) : target;
  };
  return date === back(monthDay(y, m, 25)) || date === back(lastDayOfMonth(date));
}

/**
 * Calendar rows for a date range, in the fixture CSV's own conventions
 * (dow 1 = Monday, Saturday and Sunday are "weekend", only Sunday and holidays
 * are non-operating). Used only in fixture mode, where calendar.csv covers ten
 * days; in real mode the supplied calendar already spans the history.
 */
export function generateSyntheticCalendar(from: string, to: string): CalendarRow[] {
  const festivalByDate = new Map<string, { name: string; ramp: number }>();
  const closed = new Set<string>();
  for (const f of SYNTHETIC_FESTIVALS) {
    for (let off = -8; off <= 4; off++) {
      const date = addDays(f.date, off);
      const ramp = RAMP_BY_OFFSET[off];
      const prev = festivalByDate.get(date);
      if (!prev || ramp > prev.ramp) festivalByDate.set(date, { name: f.name, ramp });
    }
    for (let k = 0; k < f.closedDays; k++) closed.add(addDays(f.date, k));
  }

  const rows: CalendarRow[] = [];
  for (let date = from; date <= to; date = addDays(date, 1)) {
    const d = parseIsoDate(date);
    const dow0 = (d.getUTCDay() + 6) % 7;
    const wk = isoWeekOfDate(date);
    const fest = festivalByDate.get(date);
    const isHoliday = closed.has(date);
    rows.push({
      date,
      dow: dow0 + 1,
      dowName: DOW_NAMES[dow0],
      isWeekend: dow0 >= 5,
      isoYear: wk.isoYear,
      isoWeek: wk.isoWeek,
      isPayday: isPaydayDate(date),
      festival: fest ? fest.name : null,
      festivalRamp: fest ? fest.ramp : 0,
      isHoliday,
      monsoon: MONSOON_MONTHS.has(d.getUTCMonth() + 1),
      isOperating: dow0 !== 6 && !isHoliday,
    });
  }
  return rows;
}

export function toSignalDay(r: CalendarRow): CalendarSignalDay {
  return {
    date: r.date,
    isoYear: r.isoYear,
    isoWeek: r.isoWeek,
    isOperating: r.isOperating,
    isPayday: r.isPayday,
    isHoliday: r.isHoliday,
    festival: r.festival,
    festivalRamp: r.festivalRamp,
    monsoon: r.monsoon,
  };
}

// --- The synthetic demand ------------------------------------------------------------

export interface SyntheticOutlet {
  id: string;
  brand: Brand;
  depotCode: string;
  districtName: string;
  dockType: DockType;
  windowOpen: string;
  windowClose: string;
  mallWindowOpen: string | null;
  mallWindowClose: string | null;
}

/**
 * Cubic metres an outlet orders on an ordinary operating day, by brand and
 * temperature. Only Fresh orders chilled, as in the real data. The Fresh
 * chilled figure is sized so that the fixture's two Peliyagoda reefers run at
 * roughly 85% of their trip capacity by spring 2026 — tight enough that the
 * festival weeks tip over and the capacity screen has something true to say.
 * The other ratios follow the real brand mix (ambient ~1.65x chilled, Style
 * ~0.4x, Tech ~0.09x). The shape is real; the level is invented.
 */
export const BASE_M3_PER_OUTLET_DAY: Record<string, number> = {
  "Fresh|chilled": 4.0,
  "Fresh|ambient": 6.6,
  "Style|ambient": 1.64,
  "Tech|ambient": 0.37,
};

/** Cubic metres in an average order, per brand. */
export const AVG_M3_PER_ORDER: Record<Brand, number> = { Fresh: 1.84, Style: 9.0, Tech: 3.3 };

/** Monday..Saturday demand rhythm; Thursday and Friday are heavy, Tuesday light. Mean 1.0. */
const DOW_PROFILE = [0.96, 0.8, 0.94, 1.18, 1.12, 1.0];

/** Eight percent a year, anchored so April 2025 is the unit. */
export function growthFactor(date: string): number {
  const years = (parseIsoDate(date).getTime() - parseIsoDate("2025-04-01").getTime()) / (365.25 * 86_400_000);
  return 1 + 0.08 * years;
}

export function generateSyntheticDaily(
  outlets: readonly SyntheticOutlet[],
  calendar: readonly CalendarSignalDay[],
  from: string,
  to: string,
): DailyRow[] {
  const groups = new Map<string, { depotCode: string; brand: Brand; count: number }>();
  for (const o of outlets) {
    const key = `${o.depotCode}|${o.brand}`;
    const g = groups.get(key);
    if (g) g.count++;
    else groups.set(key, { depotCode: o.depotCode, brand: o.brand, count: 1 });
  }

  const rows: DailyRow[] = [];
  for (const day of calendar) {
    if (day.date < from || day.date > to || !day.isOperating) continue;
    const dow0 = (parseIsoDate(day.date).getUTCDay() + 6) % 7;
    const rhythm = DOW_PROFILE[dow0];
    if (rhythm === undefined) continue;

    for (const g of [...groups.values()].sort((a, b) => `${a.depotCode}|${a.brand}`.localeCompare(`${b.depotCode}|${b.brand}`))) {
      const temps: Temp[] = g.brand === "Fresh" ? ["chilled", "ambient"] : ["ambient"];
      for (const temp of temps) {
        const base = BASE_M3_PER_OUTLET_DAY[`${g.brand}|${temp}`] ?? 0;
        const rng = rngFor("daily", day.date, g.depotCode, g.brand, temp);
        const noise = Math.max(0.7, 1 + 0.05 * gaussian(rng));
        const expectedM3 = base * g.count * dayFactor(day) * rhythm * growthFactor(day.date) * noise;
        const expectedOrders = expectedM3 / AVG_M3_PER_ORDER[g.brand];
        // Whole orders: the integer part always, the fraction as a coin flip,
        // so a Tech outlet that orders one day in nine still shows up.
        const orders = Math.floor(expectedOrders) + (rng() < expectedOrders - Math.floor(expectedOrders) ? 1 : 0);
        if (orders === 0) continue;

        let volume = 0;
        for (let i = 0; i < orders; i++) {
          volume += AVG_M3_PER_ORDER[g.brand] * Math.max(0.3, 1 + 0.18 * gaussian(rng));
        }
        // Deferral pressure rises with the festival ramp, as it does when a
        // fleet is stretched; a few orders never run at all.
        const deferP = 0.017 * (1 + 0.8 * day.festivalRamp);
        let deferred = 0;
        let notRun = 0;
        for (let i = 0; i < orders; i++) {
          const u = rng();
          if (u < deferP) deferred++;
          else if (u < deferP + 0.004) notRun++;
        }
        rows.push({
          date: day.date,
          depotCode: g.depotCode,
          brand: g.brand,
          temp,
          orders,
          units: Math.round(volume * 19.9),
          weightKg: r3(volume * 176.9),
          volumeM3: r3(volume),
          deferred,
          notRun,
        });
      }
    }
  }
  return rows;
}

// --- The synthetic legs ---------------------------------------------------------------

export interface SyntheticVehicle {
  id: string;
  depotCode: string;
  temp: "reefer" | "ambient";
}

const WAVE_START: Record<Brand, string> = { Fresh: "03:30", Style: "08:30", Tech: "08:30" };
/** How far into its window the first stop is planned for. Mall windows are narrow, so they run tight. */
const ARRIVAL_FRACTION: Record<Brand, number> = { Fresh: 0.5, Style: 0.8, Tech: 0.8 };

/**
 * Planned vs actual legs for the fixture network, one route per district per
 * brand per depot per operating day. Ids start "SYN-" so a synthetic leg can
 * never be taken for a real one.
 *
 * Planned times come from the same `computeStopSchedule` the planner uses, so
 * the plan side is exactly what the product would have published. The actual
 * side is the plan plus believable friction: a departure delay, travel running
 * a little slow (more in the monsoon), handling a little over the allowance,
 * and now and then a district-wide disruption that makes a whole route late.
 * Departure is set so the first stop is reached part-way through its window,
 * which is also what leaves room for some stops to run late.
 */
export function generateSyntheticLegs(args: {
  outlets: readonly SyntheticOutlet[];
  vehicles: readonly SyntheticVehicle[];
  districts: ReadonlyMap<string, DistrictTravel>;
  allowance: AllowanceTable;
  calendar: readonly CalendarSignalDay[];
  from: string;
  to: string;
}): LegRow[] {
  const outletRefs = new Map<string, OutletRef>();
  for (const o of args.outlets) {
    outletRefs.set(o.id, {
      outletId: o.id,
      brand: o.brand,
      district: o.districtName,
      depot: o.depotCode as DepotCode,
      dockType: o.dockType,
      parkingConstraint: "normal",
      mallWindowOpen: o.mallWindowOpen,
      mallWindowClose: o.mallWindowClose,
      windowOpen: o.windowOpen,
      windowClose: o.windowClose,
    });
  }

  const routeGroups = new Map<string, SyntheticOutlet[]>();
  for (const o of args.outlets) {
    const key = `${o.depotCode}|${o.districtName}|${o.brand}`;
    const list = routeGroups.get(key);
    if (list) list.push(o);
    else routeGroups.set(key, [o]);
  }
  const groupKeys = [...routeGroups.keys()].sort();

  const legs: LegRow[] = [];
  for (const day of args.calendar) {
    if (day.date < args.from || day.date > args.to || !day.isOperating) continue;

    const routeCounterByDepot = new Map<string, number>();
    // Trips each vehicle has run today, so no vehicle is given a third (rule 7).
    const tripsToday = new Map<string, number>();
    for (const key of groupKeys) {
      const group = routeGroups.get(key);
      const [depotCode, districtName, brandRaw] = key.split("|");
      const travel = args.districts.get(districtName);
      if (!group || !travel) continue;
      const brand = brandRaw as Brand;
      const stops = [...group].sort((a, b) => a.id.localeCompare(b.id));

      const n = (routeCounterByDepot.get(depotCode) ?? 0) + 1;
      routeCounterByDepot.set(depotCode, n);
      const routeId = `SYN-${day.date}-${depotCode.slice(0, 3).toUpperCase()}${String(n).padStart(2, "0")}`;

      // Fresh prefers a reefer (it may carry chilled), others take ambient;
      // within the pool, the least-used vehicle goes first.
      const wantReefer = brand === "Fresh";
      const pool = args.vehicles.filter((v) => v.depotCode === depotCode && (wantReefer ? v.temp === "reefer" : v.temp === "ambient"));
      const fallback = args.vehicles.filter((v) => v.depotCode === depotCode);
      const candidates = (pool.length > 0 ? pool : fallback)
        .filter((v) => (tripsToday.get(v.id) ?? 0) < 2)
        .sort((a, b) => (tripsToday.get(a.id) ?? 0) - (tripsToday.get(b.id) ?? 0) || a.id.localeCompare(b.id));
      if (candidates.length === 0) continue;
      const vehicle = candidates[0];
      tripsToday.set(vehicle.id, (tripsToday.get(vehicle.id) ?? 0) + 1);

      const first = outletRefs.get(stops[0].id);
      if (!first) continue;
      const firstWindow = effectiveWindow(first);
      // Plan to reach the first stop part-way through its window, not at the
      // opening: a wave is packed, and a window with no slack is what makes a
      // late arrival possible at all.
      const open = toMin(firstWindow.open);
      const targetArrival = open + ARRIVAL_FRACTION[brand] * (toMin(firstWindow.close) - open);
      const departMin = Math.max(toMin(WAVE_START[brand]), Math.round(targetArrival) - travel.depotToDistrictFreeflowMin);
      const departAt = fromMin(departMin);

      const scheduleStops = stops.map((s) => ({ outletId: s.id, docks: [s.dockType] }));
      const schedule = computeStopSchedule(departAt, travel, brand, scheduleStops, outletRefs, args.allowance);

      const rng = rngFor("legs", routeId);
      const disruptionRng = rngFor("disruption", day.date, districtName);
      const disrupted = disruptionRng() < (day.monsoon ? 0.16 : 0.08);
      // Squared, so most disruptions are modest and a few are severe.
      const shock = disrupted ? 30 + Math.round(200 * disruptionRng() ** 2) : 0;

      let cursorDepart = departMin + Math.max(-3, Math.round(6 + 5 * gaussian(rng))) + shock;
      let plannedDepartMin = departMin;
      for (let i = 0; i < stops.length; i++) {
        const stop = stops[i];
        const sched = schedule[i];
        const plannedTravel = i === 0 ? travel.depotToDistrictFreeflowMin : travel.interStopFreeflowMin;
        const distance = i === 0 ? travel.depotToDistrictKm : travel.interStopKm;
        const slow = 1 + (day.monsoon ? 0.11 : 0.06) + 0.08 * gaussian(rng);
        const actualTravel = Math.max(1, Math.round(plannedTravel * Math.max(0.8, slow)));
        const arrival = cursorDepart + actualTravel;
        const window = effectiveWindow(outletRefs.get(stop.id)!);
        const allowance = args.allowance.get(allowanceKey(brand, stop.dockType)) ?? 15;
        const service = Math.max(5, Math.round(allowance * (1.16 + 0.12 * gaussian(rng))));
        const leave = Math.max(arrival, toMin(window.open)) + service;

        legs.push({
          id: `${routeId}-L${i}`,
          date: day.date,
          routeId,
          vehicleId: vehicle.id,
          districtName,
          brand,
          seq: i,
          fromPoint: i === 0 ? "DEPOT" : stops[i - 1].id,
          outletId: stop.id,
          distanceKm: distance,
          plannedDepart: fromMin(plannedDepartMin),
          plannedArrival: sched.arrival,
          actualDepart: fromMin(cursorDepart),
          arrivalTime: fromMin(arrival),
          leaveOutletTime: fromMin(leave),
          monsoon: day.monsoon,
        });

        plannedDepartMin = toMin(sched.leave);
        // The next leg leaves when this stop is finished, as in the real records.
        cursorDepart = leave;
      }
    }
  }
  return legs;
}

// --- Writing ---------------------------------------------------------------------------

async function chunked<T>(rows: T[], size: number, fn: (batch: T[]) => Promise<unknown>): Promise<number> {
  for (let i = 0; i < rows.length; i += size) await fn(rows.slice(i, i + size));
  return rows.length;
}

const asDate = (date: string): Date => new Date(`${date}T00:00:00.000Z`);

export interface HistoryResult {
  mode: "real" | "synthetic" | "none";
  dataSource: string;
  dailyRows: number;
  weeklyRows: number;
  legs: number;
  serviceObservations: number;
  calendarDaysAdded: number;
  forecastRows: number;
  skippedRows: number;
  notes: string[];
}

async function loadNetwork(prisma: PrismaClient) {
  const [outlets, vehicles, districtRows, allowanceRows] = await Promise.all([
    prisma.outlet.findMany({ orderBy: { id: "asc" } }),
    prisma.vehicle.findMany({ orderBy: { id: "asc" } }),
    prisma.district.findMany(),
    prisma.serviceAllowance.findMany(),
  ]);
  const districts = new Map<string, DistrictTravel>(
    districtRows.map((r) => [
      r.name,
      {
        district: r.name,
        depot: r.depotCode as DepotCode,
        roadClass: r.roadClass,
        freeFlowKmh: r.freeFlowKmh,
        depotToDistrictKm: r.depotToDistrictKm,
        depotToDistrictFreeflowMin: r.depotToDistrictFreeflowMin,
        interStopKm: r.interStopKm,
        interStopFreeflowMin: r.interStopFreeflowMin,
      },
    ]),
  );
  const allowance: AllowanceTable = new Map(allowanceRows.map((r) => [allowanceKey(r.brand, r.dockType), r.minutes]));
  const synthOutlets: SyntheticOutlet[] = outlets.map((o) => ({
    id: o.id,
    brand: o.brand,
    depotCode: o.depotCode,
    districtName: o.districtName,
    dockType: o.dockType,
    windowOpen: o.windowOpen,
    windowClose: o.windowClose,
    mallWindowOpen: o.mallWindowOpen,
    mallWindowClose: o.mallWindowClose,
  }));
  const synthVehicles: SyntheticVehicle[] = vehicles.map((v) => ({ id: v.id, depotCode: v.depotCode, temp: v.temp }));
  return { outlets: synthOutlets, vehicles: synthVehicles, districts, allowance };
}

async function loadCalendar(prisma: PrismaClient): Promise<CalendarSignalDay[]> {
  const rows = await prisma.calendarDay.findMany({ orderBy: { date: "asc" } });
  return rows.map((r) => ({
    date: r.date.toISOString().slice(0, 10),
    isoYear: r.isoYear,
    isoWeek: r.isoWeek,
    isOperating: r.isOperating,
    isPayday: r.isPayday,
    isHoliday: r.isHoliday,
    festival: r.festival,
    festivalRamp: r.festivalRamp,
    monsoon: r.monsoon,
  }));
}

export async function seedHistory(prisma: PrismaClient, source: DataSource): Promise<HistoryResult> {
  const notes: string[] = [];
  const network = await loadNetwork(prisma);

  const deliveriesPath = source.find("deliveriesTrain");
  const legsPath = source.find("routeLegsTrain");
  const real = source.kind === "real";
  const result: HistoryResult = {
    mode: real ? "real" : "synthetic",
    dataSource: real ? "real" : SYNTHETIC_DATA_SOURCE,
    dailyRows: 0,
    weeklyRows: 0,
    legs: 0,
    serviceObservations: 0,
    calendarDaysAdded: 0,
    forecastRows: 0,
    skippedRows: 0,
    notes,
  };

  let daily: DailyRow[] = [];
  let legRows: LegRow[] = [];
  let services: ServiceRow[] = [];
  let syntheticCalendar: CalendarRow[] = [];

  if (real) {
    // --- Real: stream both files --------------------------------------------------
    const stopOrders = new Map<string, number>();
    if (deliveriesPath) {
      const acc = new DailyAccumulator();
      for await (const row of readCsv(deliveriesPath)) {
        const rec = parseDeliveryRow(row);
        if (!rec) {
          result.skippedRows++;
          continue;
        }
        acc.add(rec);
        if (rec.dispatchDate && rec.routeId && rec.seqInRoute !== null) {
          const key = `${rec.dispatchDate}|${rec.routeId}|${rec.seqInRoute}`;
          stopOrders.set(key, (stopOrders.get(key) ?? 0) + 1);
        }
      }
      daily = acc.rows();
    } else {
      notes.push("deliveries_train.csv not found: no demand history.");
    }

    if (legsPath) {
      const outletById = new Map(network.outlets.map((o) => [o.id, o]));
      const svc = new ServiceAccumulator();
      for await (const row of readCsv(legsPath)) {
        const rec = parseLegRow(row);
        if (!rec) {
          result.skippedRows++;
          continue;
        }
        legRows.push(rec);
        const outlet = outletById.get(rec.outletId);
        if (!outlet) continue;
        const window = effectiveWindow({
          outletId: outlet.id,
          brand: outlet.brand,
          district: outlet.districtName,
          depot: outlet.depotCode as DepotCode,
          dockType: outlet.dockType,
          parkingConstraint: "normal",
          mallWindowOpen: outlet.mallWindowOpen,
          mallWindowClose: outlet.mallWindowClose,
          windowOpen: outlet.windowOpen,
          windowClose: outlet.windowClose,
        });
        const minutes = legServiceMinutes(
          rec.arrivalTime,
          rec.leaveOutletTime,
          window.open,
          stopOrders.get(`${rec.date}|${rec.routeId}|${rec.seq}`) ?? 1,
        );
        if (minutes !== null) svc.add(rec.brand, outlet.dockType, rec.districtName, rec.monsoon, minutes);
      }
      services = svc.rows();
    } else {
      notes.push("route_legs_train.csv not found: no historical legs.");
    }
  } else {
    // --- Fixture: generate ---------------------------------------------------------
    const lastForecastDay = addDays(isoWeekStart(addWeeks(FORECAST_FIRST_WEEK, FORECAST_WEEK_COUNT - 1)), 6);
    syntheticCalendar = generateSyntheticCalendar(SYNTHETIC_HISTORY_START, lastForecastDay);
    // The fixture calendar.csv has ten days; keep them (skipDuplicates) and fill
    // around them so every week in the history and the horizon has signals.
    const added = await prisma.calendarDay.createMany({
      data: syntheticCalendar.map((r) => ({ ...r, date: asDate(r.date) })),
      skipDuplicates: true,
    });
    result.calendarDaysAdded = added.count;
  }

  const calendar = await loadCalendar(prisma);
  const calendarByDate = new Map(calendar.map((d) => [d.date, d]));

  if (!real) {
    daily = generateSyntheticDaily(network.outlets, calendar, SYNTHETIC_HISTORY_START, SYNTHETIC_HISTORY_END);
    legRows = generateSyntheticLegs({
      outlets: network.outlets,
      vehicles: network.vehicles,
      districts: network.districts,
      allowance: network.allowance,
      calendar,
      from: SYNTHETIC_LEGS_START,
      to: SYNTHETIC_HISTORY_END,
    });
    const svc = new ServiceAccumulator();
    const outletById = new Map(network.outlets.map((o) => [o.id, o]));
    for (const leg of legRows) {
      const o = outletById.get(leg.outletId);
      if (!o) continue;
      const open = o.mallWindowOpen ?? o.windowOpen;
      const minutes = legServiceMinutes(leg.arrivalTime, leg.leaveOutletTime, open, 1);
      if (minutes !== null) svc.add(leg.brand, o.dockType, leg.districtName, leg.monsoon, minutes);
    }
    services = svc.rows();
  }

  const weekOf = (date: string): WeekKey => {
    const hit = calendarByDate.get(date);
    return hit ? { isoYear: hit.isoYear, isoWeek: hit.isoWeek } : isoWeekOfDate(date);
  };
  const weekly = weeklyFromDaily(daily, weekOf);

  // --- Persist ------------------------------------------------------------------------
  result.dailyRows = await chunked(daily, 2000, (batch) =>
    prisma.dailyDemandHistory.createMany({
      data: batch.map((r) => ({ ...r, date: asDate(r.date) })),
      skipDuplicates: true,
    }),
  );
  result.weeklyRows = await chunked(weekly, 2000, (batch) =>
    prisma.weeklyDemandHistory.createMany({ data: batch, skipDuplicates: true }),
  );
  result.legs = await chunked(legRows, 5000, (batch) =>
    prisma.historicalLeg.createMany({
      data: batch.map((leg) => ({
        id: leg.id,
        date: asDate(leg.date),
        routeId: leg.routeId,
        vehicleId: leg.vehicleId,
        districtName: leg.districtName,
        brand: leg.brand,
        seq: leg.seq,
        fromPoint: leg.fromPoint,
        outletId: leg.outletId,
        distanceKm: leg.distanceKm,
        plannedDepart: leg.plannedDepart,
        plannedArrival: leg.plannedArrival,
        actualDepart: leg.actualDepart,
        arrivalTime: leg.arrivalTime,
        leaveOutletTime: leg.leaveOutletTime,
      })),
      skipDuplicates: true,
    }),
  );
  result.serviceObservations = await chunked(services, 1000, (batch) =>
    prisma.serviceObservation.createMany({ data: batch, skipDuplicates: true }),
  );

  // --- Forecast -------------------------------------------------------------------------
  const series = seriesFromWeekly(weekly);
  if (series.size > 0) {
    const calendarByWeek = groupCalendarByWeek(calendar);
    const lastKnown = weekly.reduce<WeekKey>((a, b) => (weeksBetween(a, b) > 0 ? { isoYear: b.isoYear, isoWeek: b.isoWeek } : a), {
      isoYear: weekly[0].isoYear,
      isoWeek: weekly[0].isoWeek,
    });

    // Real mode honours the organisers' own task2a rows (which depot x brand x
    // week they ask for); fixture mode forecasts every series over the horizon.
    const inputsPath = source.find("forecastInputs");
    let wanted: { depotCode: string; brand: Brand; target: WeekKey }[] | null = null;
    if (real && inputsPath) {
      const rows = await readCsvAll(inputsPath);
      wanted = rows.map((r) => ({
        depotCode: str(r, "depot"),
        brand: str(r, "brand") as Brand,
        target: { isoYear: Math.round(Number(str(r, "iso_year"))), isoWeek: Math.round(Number(str(r, "iso_week"))) },
      }));
    }
    const targets: WeekKey[] = wanted
      ? [...new Map(wanted.map((w) => [weekKeyStr(w.target), w.target])).values()]
      : Array.from({ length: FORECAST_WEEK_COUNT }, (_, i) => addWeeks(FORECAST_FIRST_WEEK, i));

    let rows = buildForecastRows(series, calendarByWeek, targets, (t) => Math.max(1, weeksBetween(lastKnown, t)));
    if (wanted) {
      const keep = new Set(wanted.map((w) => `${weekKeyStr(w.target)}|${w.depotCode}|${w.brand}`));
      rows = rows.filter((r) => keep.has(`${weekKeyStr(r)}|${r.depotCode}|${r.brand}`));
    }

    const method = real
      ? FORECAST_METHOD_ID
      : `SYNTHETIC ${FORECAST_METHOD_ID} on generated fixture history, not competition data`;
    const generatedAt = new Date();
    // Replace the empty "pending" shells for exactly the keys we forecast.
    await prisma.demandForecast.deleteMany({
      where: { OR: rows.map((r) => ({ isoYear: r.isoYear, isoWeek: r.isoWeek, depotCode: r.depotCode, brand: r.brand })) },
    });
    result.forecastRows = (
      await prisma.demandForecast.createMany({
        data: rows.map((r) => ({ ...r, method, generatedAt })),
        skipDuplicates: true,
      })
    ).count;
  } else {
    notes.push("No weekly history, so no forecast was produced.");
    result.mode = "none";
  }

  return result;
}
