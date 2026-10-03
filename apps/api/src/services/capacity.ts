import type { Brand, CapacityActionKind, CapacityActionStatus, Prisma } from "@prisma/client";
import { AuthError, type SessionUser } from "../lib/auth";
import { recordDecision } from "../lib/audit";
import { prisma } from "../lib/db";
import {
  actionLabel,
  addWeeks,
  assessReefers,
  AMBIENT_FILL,
  REEFER_FILL,
  SIGNAL_EFFECTS,
  loadPerReeferTripM3,
  backtest as runBacktest,
  fleetCapacityM3,
  groupCalendarByWeek,
  inferFestivalNames,
  isoDateOf,
  isoWeekDates,
  isoWeekOfDate,
  isoWeekStart,
  operatingDaysIn,
  parseIsoDate,
  planRelief,
  weekKeyStr,
  weekSignalLabels,
  weeksBetween,
  type Backtest,
  type CalendarSignalDay,
  type FleetVehicle,
  type ReeferAssessment,
  type WeekKey,
  type WeeklyPoint,
  TRIPS_PER_VEHICLE_DAY,
} from "./forecast";

/**
 * The capacity forecast for one depot, and the actions that follow from it.
 *
 * A dispatcher sees their own depot's reefers against their own depot's
 * forecast demand. The design's "all depots" selector is a wider question than
 * a depot-scoped role may ask, so it is not offered.
 *
 * The forecast itself is read, not recomputed: `DemandForecast` was written by
 * the seed (or a later import) with the method and time recorded on each row.
 * Weeks that already have history are shown as ACTUAL, with their real totals,
 * so the demand chart can show the run-up to the forecast. Only the backtest
 * is computed at read time.
 */

// --- Types ---------------------------------------------------------------------

export interface WeeklyRowLike {
  isoYear: number;
  isoWeek: number;
  depotCode: string;
  brand: Brand;
  totalM3: number;
  chilledM3: number;
}

export interface WeekPlan extends WeekKey {
  kind: "actual" | "forecast";
  startDate: string;
  endDate: string;
  signals: string[];
  operatingDays: number;
  totalM3: number;
  chilledM3: number;
  /** Where the number came from: the stored forecast's method, or null for actuals. */
  method: string | null;
  assessment: ReeferAssessment;
  /** Reefers marked in the workshop on some day of this week, by id. */
  workshopReeferIds: string[];
  /** The dates within the week on which each of those was in the workshop. */
  workshopDates: Record<string, string[]>;
  fleetCapacityM3: number;
  label: string;
}

export interface CapacityData {
  depotCode: string;
  vehicles: FleetVehicle[];
  history: WeeklyRowLike[];
  forecasts: (WeeklyRowLike & { method: string; generatedAt: Date })[];
  calendar: CalendarSignalDay[];
  /** vehicleId -> workshop dates, for reefers only. */
  workshop: { vehicleId: string; date: string }[];
}

// --- Assembling the weeks (pure) ----------------------------------------------------

function sumRows(rows: readonly WeeklyRowLike[], brand: Brand | null): { total: number; chilled: number } {
  let total = 0;
  let chilled = 0;
  for (const r of rows) {
    if (brand && r.brand !== brand) continue;
    total += r.totalM3;
    chilled += r.chilledM3;
  }
  return { total, chilled };
}

/**
 * One plan per requested week. A week with history is `actual`; otherwise a
 * week with a stored forecast is `forecast`; a week with neither is left out
 * rather than shown as zero demand.
 */
export function assemblePlan(data: CapacityData, weeks: readonly WeekKey[], brand: Brand | null): WeekPlan[] {
  const calendarByWeek = groupCalendarByWeek(data.calendar);
  const reefers = data.vehicles.filter((v) => v.temp === "reefer");
  const out: WeekPlan[] = [];

  for (const week of weeks) {
    const key = weekKeyStr(week);
    const hist = data.history.filter((r) => r.isoYear === week.isoYear && r.isoWeek === week.isoWeek);
    const fc = data.forecasts.filter((r) => r.isoYear === week.isoYear && r.isoWeek === week.isoWeek);
    const kind: WeekPlan["kind"] | null = hist.length > 0 ? "actual" : fc.length > 0 ? "forecast" : null;
    if (!kind) continue;
    const source = kind === "actual" ? hist : fc;
    const { total, chilled } = sumRows(source, brand);

    const days = calendarByWeek.get(key);
    const operatingDays = operatingDaysIn(days);

    const dates = new Set(isoWeekDates(week));
    const workshopDates: Record<string, string[]> = {};
    for (const w of data.workshop) {
      if (!dates.has(w.date) || !reefers.some((v) => v.id === w.vehicleId)) continue;
      (workshopDates[w.vehicleId] ??= []).push(w.date);
    }
    // Counted out for the whole week if out on any day: see assessReefers.
    const workshopReeferIds = Object.keys(workshopDates).sort();

    const assessment = assessReefers({
      chilledM3: chilled,
      operatingDays,
      reefers,
      reefersInWorkshop: workshopReeferIds.length,
    });

    out.push({
      ...week,
      kind,
      startDate: isoWeekStart(week),
      endDate: isoWeekDates(week)[5] ?? isoWeekStart(week),
      signals: weekSignalLabels(days),
      operatingDays,
      totalM3: total,
      chilledM3: chilled,
      method: kind === "forecast" ? (fc[0]?.method ?? null) : null,
      assessment,
      workshopReeferIds,
      workshopDates,
      fleetCapacityM3: fleetCapacityM3(data.vehicles, operatingDays),
      label: actionLabel(assessment),
    });
  }
  return out;
}

export function seriesOf(history: readonly WeeklyRowLike[], brand: Brand | null): WeeklyPoint[][] {
  const bySeries = new Map<string, WeeklyPoint[]>();
  for (const r of history) {
    if (brand && r.brand !== brand) continue;
    const key = `${r.depotCode}|${r.brand}`;
    const list = bySeries.get(key) ?? [];
    list.push({ isoYear: r.isoYear, isoWeek: r.isoWeek, totalM3: r.totalM3, chilledM3: r.chilledM3 });
    bySeries.set(key, list);
  }
  return [...bySeries.values()];
}

export interface CapacitySummary {
  peakWeek: { isoYear: number; isoWeek: number; startDate: string; endDate: string; totalM3: number; signals: string[]; vsRecentPct: number | null } | null;
  chilledPeak: { isoYear: number; isoWeek: number; startDate: string; endDate: string; chilledM3: number; vsRecentPct: number | null } | null;
  reeferShortfallWeeks: { count: number; of: number; maxTripsPerDayShort: number };
  /** Mean of the last four known weeks: what "today" means for the "+18% vs today" comparison. */
  recentLevel: { totalM3: number; chilledM3: number } | null;
}

const pctOver = (value: number, base: number): number | null => (base > 0 ? Math.round((value / base - 1) * 100) : null);

export function summarise(weeks: readonly WeekPlan[], data: CapacityData, brand: Brand | null): CapacitySummary {
  const forecast = weeks.filter((w) => w.kind === "forecast");

  // The recent level is built from ALL known history, not just the window.
  const byWeek = new Map<string, { key: WeekKey; total: number; chilled: number }>();
  for (const r of data.history) {
    if (brand && r.brand !== brand) continue;
    const k = weekKeyStr(r);
    const cur = byWeek.get(k) ?? { key: { isoYear: r.isoYear, isoWeek: r.isoWeek }, total: 0, chilled: 0 };
    cur.total += r.totalM3;
    cur.chilled += r.chilledM3;
    byWeek.set(k, cur);
  }
  const latest = [...byWeek.values()].sort((a, b) => weeksBetween(b.key, a.key)).slice(-4);
  const recent =
    latest.length === 0
      ? null
      : {
          totalM3: latest.reduce((s, w) => s + w.total, 0) / latest.length,
          chilledM3: latest.reduce((s, w) => s + w.chilled, 0) / latest.length,
        };

  const peak = forecast.reduce<WeekPlan | null>((a, b) => (a === null || b.totalM3 > a.totalM3 ? b : a), null);
  const chilledPeak = forecast.reduce<WeekPlan | null>((a, b) => (a === null || b.chilledM3 > a.chilledM3 ? b : a), null);
  const short = forecast.filter((w) => w.assessment.shortfallTripsPerDay > 0);

  return {
    peakWeek: peak && {
      isoYear: peak.isoYear,
      isoWeek: peak.isoWeek,
      startDate: peak.startDate,
      endDate: peak.endDate,
      totalM3: peak.totalM3,
      signals: peak.signals,
      vsRecentPct: recent ? pctOver(peak.totalM3, recent.totalM3) : null,
    },
    chilledPeak: chilledPeak && {
      isoYear: chilledPeak.isoYear,
      isoWeek: chilledPeak.isoWeek,
      startDate: chilledPeak.startDate,
      endDate: chilledPeak.endDate,
      chilledM3: chilledPeak.chilledM3,
      vsRecentPct: recent ? pctOver(chilledPeak.chilledM3, recent.chilledM3) : null,
    },
    reeferShortfallWeeks: {
      count: short.length,
      of: forecast.length,
      maxTripsPerDayShort: short.reduce((m, w) => Math.max(m, w.assessment.shortfallTripsPerDay), 0),
    },
    recentLevel: recent,
  };
}

/**
 * Backtest the method over the last eight known weeks, at the real horizon:
 * the gap between the newest known week and the first forecast week. A
 * one-step-ahead backtest would flatter a forecast that is actually made
 * months out.
 */
export function backtestFor(data: CapacityData, brand: Brand | null): Backtest {
  const series = seriesOf(data.history, brand);
  const known = data.history.map((r) => ({ isoYear: r.isoYear, isoWeek: r.isoWeek }));
  const newest = known.reduce<WeekKey | null>((a, b) => (a === null || weeksBetween(a, b) > 0 ? b : a), null);
  const firstForecast = data.forecasts.reduce<WeekKey | null>(
    (a, b) => (a === null || weeksBetween(b, a) > 0 ? { isoYear: b.isoYear, isoWeek: b.isoWeek } : a),
    null,
  );
  const lead = newest && firstForecast ? Math.max(1, weeksBetween(newest, firstForecast)) : 1;
  return runBacktest(series, groupCalendarByWeek(data.calendar), { weeks: 8, leadWeeks: lead });
}

// --- Proposals (pure) ------------------------------------------------------------------

export interface FuelBind {
  vehicleId: string;
  quotaL: number;
  usedL: number;
}

export interface ProposalDraft {
  isoYear: number;
  isoWeek: number;
  depotCode: string;
  brand: Brand | null;
  kind: CapacityActionKind;
  params: Record<string, unknown>;
  expectedRelief: Record<string, unknown>;
  appliesFromDate: string;
}

/** Assumed share of a week's chilled volume that moves when stores order a day early. */
export const PRE_BUILD_SHARE = 0.15;
/** Assumed share that moves when Fresh's chilled delivery day itself is moved. */
export const SHIFT_SHARE = 0.25;
/** A shortfall of this many trips a day is more than pre-building alone can plausibly absorb. */
export const SHIFT_FROM_SHORTFALL = 2;
/** Fuel counts as binding once this share of the weekly quota is committed or used. */
export const FUEL_BINDING_SHARE = 0.9;
/** Headroom added when proposing a higher quota. */
export const FUEL_HEADROOM = 1.1;

export interface ProposalContext {
  depotCode: string;
  /** Heaviest and lightest weekday for Fresh chilled, from recent history; null with none. */
  weekdays: { heaviest: string; lightest: string } | null;
  fuelBinds: ReadonlyMap<string, FuelBind[]>;
}

/**
 * Proposals for the forecast weeks, a pure function of the plan so that
 * reading twice proposes the same things.
 *
 *   - A reefer that is only in the workshop is recalled before anything is
 *     hired: it is the cheapest relief and the only one the system can do.
 *   - Hiring covers what remains after the recall.
 *   - Any shortfall also proposes asking Fresh stores to order chilled a day
 *     early; a larger one proposes moving the delivery day.
 *   - Fuel is proposed independently, for weeks whose reefer fuel is already
 *     at the binding share of its quota in the ledger.
 */
export function deriveProposals(weeks: readonly WeekPlan[], ctx: ProposalContext): ProposalDraft[] {
  const drafts: ProposalDraft[] = [];
  for (const w of weeks) {
    if (w.kind !== "forecast") continue;
    const a = w.assessment;
    const base = { isoYear: w.isoYear, isoWeek: w.isoWeek, depotCode: ctx.depotCode, appliesFromDate: w.startDate };

    if (a.shortfallTripsPerDay > 0) {
      const { recallReefers, hireReefers } = planRelief(a);

      if (recallReefers > 0) {
        const ids = w.workshopReeferIds.slice(0, recallReefers);
        drafts.push({
          ...base,
          brand: null,
          kind: "RECALL_FROM_WORKSHOP",
          params: {
            vehicleIds: ids,
            dates: [...new Set(ids.flatMap((id) => w.workshopDates[id] ?? []))].sort(),
            count: ids.length,
          },
          expectedRelief: {
            tripsPerDay: ids.length * TRIPS_PER_VEHICLE_DAY,
            basis: `${ids.length} reefer${ids.length > 1 ? "s" : ""} back in service, two trips a day each`,
            estimate: false,
          },
        });
      }

      if (hireReefers > 0) {
        drafts.push({
          ...base,
          brand: null,
          kind: "HIRE_RELIEF_VEHICLE",
          params: {
            count: hireReefers,
            vehicleTemp: "reefer",
            fromDate: w.startDate,
            toDate: w.endDate,
            shortfallTripsPerDay: a.shortfallTripsPerDay,
          },
          expectedRelief: {
            tripsPerDay: hireReefers * TRIPS_PER_VEHICLE_DAY,
            basis: `${hireReefers} hired reefer${hireReefers > 1 ? "s" : ""}, two trips a day each`,
            estimate: false,
          },
        });
      }

      drafts.push({
        ...base,
        brand: "Fresh",
        kind: "PRE_BUILD_ORDERS",
        params: { brand: "Fresh", daysEarly: 1, assumedShiftPct: Math.round(PRE_BUILD_SHARE * 100) },
        expectedRelief: {
          tripsPerDay: Math.min(a.shortfallTripsPerDay, Math.ceil(a.tripsNeededPerDay * PRE_BUILD_SHARE)),
          basis: `Assumes ${Math.round(PRE_BUILD_SHARE * 100)}% of the week's chilled volume moves a day earlier`,
          estimate: true,
        },
      });

      if (a.shortfallTripsPerDay >= SHIFT_FROM_SHORTFALL && ctx.weekdays) {
        drafts.push({
          ...base,
          brand: "Fresh",
          kind: "SHIFT_BRAND_DAY",
          params: {
            brand: "Fresh",
            fromDay: ctx.weekdays.heaviest,
            toDay: ctx.weekdays.lightest,
            assumedShiftPct: Math.round(SHIFT_SHARE * 100),
          },
          expectedRelief: {
            tripsPerDay: Math.min(a.shortfallTripsPerDay, Math.ceil(a.tripsNeededPerDay * SHIFT_SHARE)),
            basis: `Assumes ${Math.round(SHIFT_SHARE * 100)}% of the week's chilled volume moves off ${ctx.weekdays.heaviest}`,
            estimate: true,
          },
        });
      }
    }

    const binds = ctx.fuelBinds.get(weekKeyStr(w)) ?? [];
    if (binds.length > 0) {
      const vehicles = binds.map((b) => ({
        vehicleId: b.vehicleId,
        quotaL: b.quotaL,
        usedL: b.usedL,
        // Rounded before the ceiling: 400 x 1.1 is 440.00000000000006 in floating point.
        proposedQuotaL: Math.ceil(Math.round(b.usedL * FUEL_HEADROOM * 1000) / 1000),
      }));
      drafts.push({
        ...base,
        brand: null,
        kind: "RAISE_FUEL_QUOTA",
        params: { vehicles },
        expectedRelief: {
          litres: vehicles.reduce((s, v) => s + Math.max(0, v.proposedQuotaL - v.quotaL), 0),
          basis: "Quota raised to the litres already committed or used, plus 10%",
          estimate: false,
        },
      });
    }
  }
  return drafts;
}

export function draftKey(d: { isoYear: number; isoWeek: number; kind: string; brand: string | null }): string {
  return `${d.isoYear}|${d.isoWeek}|${d.kind}|${d.brand ?? ""}`;
}

// --- Describing an action for people --------------------------------------------------------------

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function dateRangeLabel(start: string, end: string): string {
  const a = parseIsoDate(start);
  const b = parseIsoDate(end);
  const am = MONTHS[a.getUTCMonth()];
  const bm = MONTHS[b.getUTCMonth()];
  return am === bm ? `${a.getUTCDate()}–${b.getUTCDate()} ${bm}` : `${a.getUTCDate()} ${am} – ${b.getUTCDate()} ${bm}`;
}

const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

export interface ActionRow {
  id: string;
  isoYear: number;
  isoWeek: number;
  depotCode: string;
  brand: Brand | null;
  kind: CapacityActionKind;
  params: Prisma.JsonValue | null;
  expectedRelief: Prisma.JsonValue | null;
  status: CapacityActionStatus;
  decidedByUserId: string | null;
  decidedAt: Date | null;
  reasonCode: string | null;
  note: string | null;
  appliesFromDate: Date | null;
  createdAt: Date;
}

function asRecord(v: Prisma.JsonValue | null): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

export function describeAction(row: Pick<ActionRow, "kind" | "isoYear" | "isoWeek" | "depotCode" | "params" | "expectedRelief">): { title: string; detail: string } {
  const p = asRecord(row.params);
  const wk = `W${String(row.isoWeek).padStart(2, "0")}`;
  const range = dateRangeLabel(isoWeekStart(row), isoWeekDates(row)[5] ?? isoWeekStart(row));
  const relief = asRecord(row.expectedRelief);
  const tripsRelief = typeof relief.tripsPerDay === "number" ? relief.tripsPerDay : null;

  switch (row.kind) {
    case "HIRE_RELIEF_VEHICLE": {
      const count = Number(p.count ?? 0);
      const short = Number(p.shortfallTripsPerDay ?? 0);
      return {
        title: `Hire ${plural(count, "reefer")} for ${range}`,
        detail: `${row.depotCode} · covers ${Math.min(tripsRelief ?? count * TRIPS_PER_VEHICLE_DAY, short)} of the ${plural(short, "short trip")} a day in ${wk}`,
      };
    }
    case "RECALL_FROM_WORKSHOP": {
      const ids = Array.isArray(p.vehicleIds) ? p.vehicleIds.map(String) : [];
      return {
        title: `Recall ${ids.join(", ") || "a reefer"} from the workshop for ${range}`,
        detail: `${row.depotCode} · frees ${plural(tripsRelief ?? 0, "trip")} a day in ${wk}`,
      };
    }
    case "PRE_BUILD_ORDERS":
      return {
        title: "Ask Fresh stores to order chilled a day early",
        detail: `Spreads ${wk} chilled volume across the days before · relief is an estimate`,
      };
    case "SHIFT_BRAND_DAY":
      return {
        title: `Move Fresh chilled deliveries from ${String(p.fromDay ?? "the heaviest day")} to ${String(p.toDay ?? "the lightest day")}`,
        detail: `${wk} · relief is an estimate`,
      };
    case "RAISE_FUEL_QUOTA": {
      const n = Array.isArray(p.vehicles) ? p.vehicles.length : 0;
      return {
        title: `Raise the fuel quota for ${plural(n, "reefer")} in ${wk}`,
        detail: `${row.depotCode} · reefer fuel is at ${Math.round(FUEL_BINDING_SHARE * 100)}% of quota or more`,
      };
    }
    case "SPLIT_LARGE_ORDER":
      return { title: "Split a large order", detail: `${row.depotCode} · ${wk}` };
  }
}

export function availableDecisions(status: CapacityActionStatus): ("APPROVE" | "REJECT" | "APPLY")[] {
  if (status === "PROPOSED") return ["APPROVE", "REJECT"];
  if (status === "APPROVED") return ["APPLY", "REJECT"];
  return [];
}

export async function toActionItems(rows: readonly ActionRow[], currentKeys?: ReadonlySet<string>) {
  const ids = [...new Set(rows.map((r) => r.decidedByUserId).filter((id): id is string => Boolean(id)))];
  const users = ids.length === 0 ? [] : await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } });
  const nameById = new Map(users.map((u) => [u.id, u.name]));
  return rows.map((r) => ({
    id: r.id,
    isoYear: r.isoYear,
    isoWeek: r.isoWeek,
    depotCode: r.depotCode,
    brand: r.brand,
    kind: r.kind,
    ...describeAction(r),
    params: asRecord(r.params),
    expectedRelief: asRecord(r.expectedRelief),
    status: r.status,
    // An open proposal the forecast no longer calls for (the week is covered now).
    stale: r.status === "PROPOSED" && currentKeys !== undefined && !currentKeys.has(draftKey(r)),
    availableDecisions: availableDecisions(r.status),
    decidedBy: r.decidedByUserId ? (nameById.get(r.decidedByUserId) ?? null) : null,
    decidedAt: r.decidedAt ? r.decidedAt.toISOString() : null,
    reasonCode: r.reasonCode,
    note: r.note,
    appliesFromDate: r.appliesFromDate ? isoDateOf(r.appliesFromDate) : null,
    createdAt: r.createdAt.toISOString(),
  }));
}

// --- Loading ----------------------------------------------------------------------------------------

function weekRange(weeks: readonly WeekKey[]): { from: string; to: string } {
  const starts = weeks.map((w) => isoWeekStart(w)).sort();
  const first = starts[0] ?? isoWeekStart({ isoYear: 2000, isoWeek: 1 });
  const lastStart = starts[starts.length - 1] ?? first;
  return { from: first, to: isoWeekDates(isoWeekOfDate(lastStart))[6] ?? lastStart };
}

/** Reefers marked in the workshop on any day of the given weeks. */
async function loadWorkshop(depotCode: string, weeks: readonly WeekKey[]): Promise<CapacityData["workshop"]> {
  if (weeks.length === 0) return [];
  const range = weekRange(weeks);
  const rows = await prisma.vehicleDayStatus.findMany({
    where: {
      status: "IN_WORKSHOP",
      vehicle: { depotCode, temp: "reefer" },
      date: { gte: parseIsoDate(range.from), lte: parseIsoDate(range.to) },
    },
    select: { vehicleId: true, date: true },
  });
  return rows.map((w) => ({ vehicleId: w.vehicleId, date: isoDateOf(w.date) }));
}

/**
 * Everything the capacity screen reads, for the weeks `pickWeeks` chooses.
 * The weeks may depend on what forecast exists, so they are chosen after the
 * demand tables are loaded and the workshop is then read for just those weeks.
 */
export async function loadCapacityData(
  depotCode: string,
  pickWeeks: (data: CapacityData) => WeekKey[],
): Promise<{ data: CapacityData; weeks: WeekKey[] }> {
  const [vehicles, history, forecasts, calendar] = await Promise.all([
    prisma.vehicle.findMany({ where: { depotCode }, orderBy: { id: "asc" }, select: { id: true, temp: true, volumeCapM3: true } }),
    prisma.weeklyDemandHistory.findMany({ where: { depotCode } }),
    prisma.demandForecast.findMany({ where: { depotCode }, orderBy: [{ isoYear: "asc" }, { isoWeek: "asc" }, { brand: "asc" }] }),
    prisma.calendarDay.findMany({ orderBy: { date: "asc" } }),
  ]);

  const data: CapacityData = {
    depotCode,
    vehicles: vehicles.map((v) => ({ id: v.id, temp: v.temp, volumeCapM3: v.volumeCapM3 })),
    history: history.map((r) => ({
      isoYear: r.isoYear,
      isoWeek: r.isoWeek,
      depotCode: r.depotCode,
      brand: r.brand,
      totalM3: r.totalVolumeM3,
      chilledM3: r.chilledVolumeM3,
    })),
    forecasts: forecasts.map((r) => ({
      isoYear: r.isoYear,
      isoWeek: r.isoWeek,
      depotCode: r.depotCode,
      brand: r.brand,
      totalM3: r.predTotalVolumeM3,
      chilledM3: r.predChilledVolumeM3,
      method: r.method,
      generatedAt: r.generatedAt,
    })),
    calendar: inferFestivalNames(calendar.map((r) => ({
      date: isoDateOf(r.date),
      isoYear: r.isoYear,
      isoWeek: r.isoWeek,
      isOperating: r.isOperating,
      isPayday: r.isPayday,
      isHoliday: r.isHoliday,
      festival: r.festival,
      festivalRamp: r.festivalRamp,
      monsoon: r.monsoon,
    }))),
    workshop: [],
  };
  const weeks = pickWeeks(data);
  data.workshop = await loadWorkshop(depotCode, weeks);
  return { data, weeks };
}

const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

/** Heaviest and lightest weekday for chilled demand over roughly the last eight weeks of history. */
export async function loadWeekdayProfile(depotCode: string): Promise<ProposalContext["weekdays"]> {
  const newest = await prisma.dailyDemandHistory.findFirst({
    where: { depotCode, temp: "chilled" },
    orderBy: { date: "desc" },
    select: { date: true },
  });
  if (!newest) return null;
  const since = new Date(newest.date.getTime() - 56 * 86_400_000);
  const rows = await prisma.dailyDemandHistory.findMany({
    where: { depotCode, temp: "chilled", date: { gte: since } },
    select: { date: true, volumeM3: true },
  });
  const sums = new Map<number, { total: number; days: Set<string> }>();
  for (const r of rows) {
    const dow = (r.date.getUTCDay() + 6) % 7;
    const e = sums.get(dow) ?? { total: 0, days: new Set<string>() };
    e.total += r.volumeM3;
    e.days.add(isoDateOf(r.date));
    sums.set(dow, e);
  }
  const means = [...sums.entries()].map(([dow, e]) => ({ dow, mean: e.total / e.days.size }));
  if (means.length < 2) return null;
  means.sort((a, b) => b.mean - a.mean || a.dow - b.dow);
  return { heaviest: WEEKDAYS[means[0].dow], lightest: WEEKDAYS[means[means.length - 1].dow] };
}

/** Reefers whose ledger shows fuel already at the binding share of quota, by week. */
export async function loadFuelBinds(depotCode: string, weeks: readonly WeekKey[]): Promise<Map<string, FuelBind[]>> {
  if (weeks.length === 0) return new Map();
  const ledgers = await prisma.fuelLedger.findMany({
    where: {
      vehicle: { depotCode, temp: "reefer" },
      OR: weeks.map((w) => ({ isoYear: w.isoYear, isoWeek: w.isoWeek })),
    },
    orderBy: { vehicleId: "asc" },
  });
  const out = new Map<string, FuelBind[]>();
  for (const l of ledgers) {
    const used = l.committedL + l.consumedL;
    if (l.quotaL <= 0 || used < FUEL_BINDING_SHARE * l.quotaL) continue;
    const key = weekKeyStr(l);
    const list = out.get(key) ?? [];
    list.push({ vehicleId: l.vehicleId, quotaL: l.quotaL, usedL: Math.round(used * 10) / 10 });
    out.set(key, list);
  }
  return out;
}

/** The weeks the depot has a stored forecast for, earliest first. */
export function forecastWeeksOf(data: CapacityData): WeekKey[] {
  const seen = new Map<string, WeekKey>();
  for (const f of data.forecasts) seen.set(weekKeyStr(f), { isoYear: f.isoYear, isoWeek: f.isoWeek });
  return [...seen.values()].sort((a, b) => weeksBetween(b, a));
}

/**
 * Persist the proposals for these weeks once, however often this is called.
 *
 * Idempotent by (week, kind, brand): a key that already has a row — in any
 * status — is left alone, so a decision already taken is never reopened and
 * a second read never duplicates. The advisory lock serialises concurrent
 * first reads for one depot; without a unique index in the schema, two
 * requests racing past the existence check would otherwise both insert.
 */
export async function ensureProposals(
  depotCode: string,
  weeks: readonly WeekKey[],
  drafts: readonly ProposalDraft[],
): Promise<{ rows: ActionRow[]; currentKeys: Set<string> }> {
  const currentKeys = new Set(drafts.map(draftKey));
  if (weeks.length === 0) return { rows: [], currentKeys };
  const weekFilter = weeks.map((w) => ({ isoYear: w.isoYear, isoWeek: w.isoWeek }));

  const rows = await prisma.$transaction(async (tx) => {
    // Postgres advisory locks take a bigint; a 31-bit hash of the depot is plenty.
    const lockId = [...`capacity:${depotCode}`].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) | 0, 7) >>> 1;
    // Selected in a subquery because the function returns void, which Prisma cannot read back.
    await tx.$queryRaw`SELECT 1 AS locked FROM (SELECT pg_advisory_xact_lock(${lockId})) AS l`;

    const existing = await tx.capacityAction.findMany({ where: { depotCode, OR: weekFilter } });
    const byKey = new Map(existing.map((r) => [draftKey(r), r]));

    const missing: ProposalDraft[] = [];
    for (const d of drafts) {
      const row = byKey.get(draftKey(d));
      if (!row) {
        missing.push(d);
        continue;
      }
      // A proposal nobody has decided on tracks the forecast: if the week's
      // numbers moved (a reefer went into the workshop, a hire now covers
      // less), the open proposal moves with them. A decided one is a record
      // of what was decided against what was known then, and is never touched.
      if (row.status === "PROPOSED" && (canon(row.params) !== canon(d.params) || canon(row.expectedRelief) !== canon(d.expectedRelief))) {
        await tx.capacityAction.update({
          where: { id: row.id },
          data: { params: d.params as Prisma.InputJsonValue, expectedRelief: d.expectedRelief as Prisma.InputJsonValue },
        });
      }
    }
    if (missing.length > 0) {
      await tx.capacityAction.createMany({
        data: missing.map((d) => ({
          isoYear: d.isoYear,
          isoWeek: d.isoWeek,
          depotCode: d.depotCode,
          brand: d.brand,
          kind: d.kind,
          params: d.params as Prisma.InputJsonValue,
          expectedRelief: d.expectedRelief as Prisma.InputJsonValue,
          appliesFromDate: parseIsoDate(d.appliesFromDate),
        })),
      });
    }
    return tx.capacityAction.findMany({
      where: { depotCode, OR: weekFilter },
      orderBy: [{ isoYear: "asc" }, { isoWeek: "asc" }, { createdAt: "asc" }, { id: "asc" }],
    });
  });
  return { rows, currentKeys };
}

/** Key-order-independent JSON, so a refreshed proposal is only written when it really differs. */
function canon(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canon).join(",")}]`;
  if (v && typeof v === "object") {
    return `{${Object.entries(v as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, x]) => `${JSON.stringify(k)}:${canon(x)}`)
      .join(",")}}`;
  }
  return JSON.stringify(v ?? null);
}

/** Derive and persist proposals for the given weeks of one depot, then return every row for them. */
export async function proposalsFor(
  depotCode: string,
  data: CapacityData,
  weeks: readonly WeekKey[],
): Promise<{ rows: ActionRow[]; currentKeys: Set<string> }> {
  // Always derived from the whole depot, never from a brand-filtered view:
  // an action is a decision about the depot, and the same week must propose
  // the same things however the screen is filtered.
  const plan = assemblePlan(data, weeks, null);
  const forecastWeeks = plan.filter((w) => w.kind === "forecast");
  const [weekdays, fuelBinds] = await Promise.all([loadWeekdayProfile(depotCode), loadFuelBinds(depotCode, forecastWeeks)]);
  const drafts = deriveProposals(plan, { depotCode, weekdays, fuelBinds });
  return ensureProposals(depotCode, weeks, drafts);
}

// --- Decisions -----------------------------------------------------------------------------------------

export type Decision = "APPROVE" | "REJECT" | "APPLY";

/** An illegal transition, or a state that changed under the caller. Becomes a 409. */
export class CapacityActionConflict extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const TRANSITIONS: Record<Decision, { from: CapacityActionStatus[]; to: CapacityActionStatus }> = {
  APPROVE: { from: ["PROPOSED"], to: "APPROVED" },
  REJECT: { from: ["PROPOSED", "APPROVED"], to: "REJECTED" },
  APPLY: { from: ["APPROVED"], to: "APPLIED" },
};

const AUDIT_ACTION: Record<Decision, string> = {
  APPROVE: "capacityAction.approve",
  REJECT: "capacityAction.reject",
  APPLY: "capacityAction.apply",
};

/** What a decision does when nothing beyond recording it can honestly be done. */
const RECORD_ONLY: Partial<Record<CapacityActionKind, string>> = {
  HIRE_RELIEF_VEHICLE:
    "Recorded only. This system does not book or register a hired vehicle: nothing else changes, and the forecast still shows the shortfall until a vehicle is added to the fleet.",
  SHIFT_BRAND_DAY:
    "Recorded only. This system does not move any store's delivery day: nothing else changes. Tell the stores yourself.",
  PRE_BUILD_ORDERS:
    "Recorded only. This system does not message stores or change any order: nothing else changes. Tell the stores yourself.",
  SPLIT_LARGE_ORDER: "Recorded only. No order was split: nothing else changes.",
};

type Tx = Prisma.TransactionClient;

async function applyEffects(tx: Tx, row: ActionRow, user: SessionUser): Promise<string[]> {
  const p = asRecord(row.params);

  if (row.kind === "RECALL_FROM_WORKSHOP") {
    const ids = Array.isArray(p.vehicleIds) ? p.vehicleIds.map(String) : [];
    if (ids.length === 0) return ["No vehicles were named on this action, so nothing was cleared."];
    const dates = isoWeekDates(row);

    // A published day's fleet is locked (the dock owns it from then on), so
    // those days are left alone, exactly as the fleet screen refuses to edit them.
    const published = await tx.planningDay.findMany({
      where: { depotCode: row.depotCode, status: "PUBLISHED", date: { in: dates.map(parseIsoDate) } },
      select: { date: true },
    });
    const locked = new Set(published.map((d) => isoDateOf(d.date)));
    const open = dates.filter((d) => !locked.has(d));

    const rows = await tx.vehicleDayStatus.findMany({
      where: {
        vehicleId: { in: ids },
        vehicle: { depotCode: row.depotCode },
        status: "IN_WORKSHOP",
        date: { in: open.map(parseIsoDate) },
      },
      select: { vehicleId: true, date: true },
      orderBy: [{ date: "asc" }],
    });
    if (rows.length > 0) {
      await tx.vehicleDayStatus.updateMany({
        where: {
          vehicleId: { in: ids },
          vehicle: { depotCode: row.depotCode },
          status: "IN_WORKSHOP",
          date: { in: open.map(parseIsoDate) },
        },
        data: { status: "AVAILABLE", note: `Recalled from the workshop (capacity action ${row.id})`, setByUserId: user.id, setAt: new Date() },
      });
      await tx.capacityAction.update({ where: { id: row.id }, data: { appliesFromDate: rows[0].date } });
    }

    const out: string[] = [];
    if (rows.length === 0) {
      out.push("No workshop entries were left to clear for these vehicles in this week.");
    } else {
      const names = [...new Set(rows.map((r) => r.vehicleId))].join(", ");
      out.push(`Cleared ${plural(rows.length, "workshop day")} for ${names}; they now count as available.`);
      out.push("Draft plans already built for those days are not re-run: run auto-plan again to use the vehicle.");
    }
    if (locked.size > 0) {
      out.push(`Left unchanged: ${[...locked].sort().join(", ")} (plan already published).`);
    }
    return out;
  }

  if (row.kind === "RAISE_FUEL_QUOTA") {
    const entries = Array.isArray(p.vehicles) ? (p.vehicles as Record<string, unknown>[]) : [];
    const wanted = entries
      .map((e) => ({ vehicleId: String(e.vehicleId ?? ""), proposedQuotaL: Number(e.proposedQuotaL) }))
      .filter((e) => e.vehicleId && Number.isFinite(e.proposedQuotaL));
    if (wanted.length === 0) return ["No vehicles were named on this action, so no quota was changed."];

    // Only this depot's own vehicles, whatever the stored params say.
    const own = await tx.vehicle.findMany({
      where: { depotCode: row.depotCode, id: { in: wanted.map((w) => w.vehicleId) } },
      select: { id: true },
    });
    const ownIds = new Set(own.map((v) => v.id));
    const lines: string[] = [];
    for (const w of wanted) {
      if (!ownIds.has(w.vehicleId)) continue;
      const ledger = await tx.fuelLedger.findUnique({
        where: { vehicleId_isoYear_isoWeek: { vehicleId: w.vehicleId, isoYear: row.isoYear, isoWeek: row.isoWeek } },
      });
      // Never lowers a quota: raising is the action's whole meaning.
      const next = Math.max(ledger?.quotaL ?? 0, w.proposedQuotaL);
      await tx.fuelLedger.upsert({
        where: { vehicleId_isoYear_isoWeek: { vehicleId: w.vehicleId, isoYear: row.isoYear, isoWeek: row.isoWeek } },
        create: { vehicleId: w.vehicleId, isoYear: row.isoYear, isoWeek: row.isoWeek, quotaL: next },
        update: { quotaL: next },
      });
      lines.push(`${w.vehicleId} ${ledger?.quotaL ?? 0} → ${next} L`);
    }
    if (lines.length === 0) return ["None of the named vehicles belong to this depot, so no quota was changed."];
    return [
      `Raised the weekly fuel quota for W${String(row.isoWeek).padStart(2, "0")}: ${lines.join("; ")}.`,
      "Only this week's ledger changed; each vehicle's standing quota is unchanged.",
    ];
  }

  return [RECORD_ONLY[row.kind] ?? "Recorded only: nothing else changes."];
}

export interface DecisionResult {
  row: ActionRow;
  consequences: string[];
}

/**
 * Take one decision on a capacity action.
 *
 * The status change is a conditional update (`status IN from`), so two
 * dispatchers deciding at once cannot both win, and APPLY's effects run in the
 * same transaction as its status change: an action is never APPLIED without
 * its effect, nor effected without being APPLIED.
 */
export async function decideAction(
  user: SessionUser,
  id: string,
  decision: Decision,
  input: { reasonCode?: string; note?: string },
): Promise<DecisionResult> {
  const depotCode = user.depotCode;
  // A record in another depot answers as one that does not exist.
  if (!depotCode) throw new AuthError("You do not have access to this record", 403);
  const current = await prisma.capacityAction.findFirst({ where: { id, depotCode } });
  if (!current) throw new AuthError("You do not have access to this record", 403);

  const rule = TRANSITIONS[decision];
  if (!rule.from.includes(current.status)) {
    throw new CapacityActionConflict(
      decision === "APPLY" && current.status === "PROPOSED" ? "ACTION_NOT_APPROVED" : "ACTION_STATE_CONFLICT",
      decision === "APPLY" && current.status === "PROPOSED"
        ? "Approve this action before applying it."
        : `This action is ${current.status.toLowerCase()}; it cannot be ${decision === "APPROVE" ? "approved" : decision === "REJECT" ? "rejected" : "applied"}.`,
    );
  }

  const now = new Date();
  const consequences: string[] = [];
  await prisma.$transaction(async (tx) => {
    const claimed = await tx.capacityAction.updateMany({
      where: { id, depotCode, status: { in: rule.from } },
      data: {
        status: rule.to,
        decidedByUserId: user.id,
        decidedAt: now,
        ...(input.reasonCode !== undefined ? { reasonCode: input.reasonCode } : {}),
        ...(input.note !== undefined ? { note: input.note } : {}),
      },
    });
    if (claimed.count === 0) {
      throw new CapacityActionConflict("ACTION_STATE_CONFLICT", "This action was decided by someone else a moment ago. Reload to see where it stands.");
    }
    if (decision === "APPLY") consequences.push(...(await applyEffects(tx, current, user)));
  });

  if (decision === "APPROVE") consequences.push("Approved. Nothing has changed yet; apply it when you are ready.");
  if (decision === "REJECT") consequences.push("Rejected. Nothing was changed.");

  const row = await prisma.capacityAction.findUnique({ where: { id } });
  // Audited after the transaction commits, as the decision log expects.
  await recordDecision({
    actor: user,
    action: AUDIT_ACTION[decision],
    entityType: "CapacityAction",
    entityId: id,
    reasonCode: input.reasonCode,
    note: input.note,
    before: { status: current.status },
    after: { status: rule.to, kind: current.kind, isoYear: current.isoYear, isoWeek: current.isoWeek },
  });

  return { row: row ?? { ...current, status: rule.to }, consequences };
}

// --- The forecast screen ---------------------------------------------------------------------------------

const MAX_WEEKS = 53;

export interface CapacityQuery {
  from?: string;
  to?: string;
  brand?: Brand | null;
}

/** The weeks a request covers: the range given, else eight weeks around the start of the stored forecast. */
export function resolveWeeks(data: CapacityData, from?: string, to?: string): WeekKey[] {
  if (from || to) {
    const start = isoWeekOfDate(from ?? to ?? "");
    const end = isoWeekOfDate(to ?? from ?? "");
    const count = Math.min(MAX_WEEKS, Math.max(1, weeksBetween(start, end) + 1));
    return Array.from({ length: count }, (_, i) => addWeeks(start, i));
  }
  const first = forecastWeeksOf(data)[0];
  if (!first) return [];
  // Two weeks of actuals before the forecast, so the chart shows the run-up.
  const start = addWeeks(first, -2);
  return Array.from({ length: 8 }, (_, i) => addWeeks(start, i));
}

export async function loadCapacityForecast(depotCode: string, query: CapacityQuery) {
  const { data, weeks } = await loadCapacityData(depotCode, (d) => resolveWeeks(d, query.from, query.to));
  const brand = query.brand ?? null;

  const plan = assemblePlan(data, weeks, brand);
  const summary = summarise(plan, data, brand);
  const bt = backtestFor(data, brand);

  const forecastWeeks = plan.filter((w) => w.kind === "forecast");
  const proposals = forecastWeeks.length === 0 ? { rows: [], currentKeys: new Set<string>() } : await proposalsFor(depotCode, data, forecastWeeks);
  const items = await toActionItems(proposals.rows, proposals.currentKeys);
  const itemsByWeek = new Map<string, typeof items>();
  for (const it of items) {
    const k = weekKeyStr(it);
    itemsByWeek.set(k, [...(itemsByWeek.get(k) ?? []), it]);
  }

  const reefers = data.vehicles.filter((v) => v.temp === "reefer");
  const loadPerTrip = loadPerReeferTripM3(reefers);
  const standardWeek = 6;
  const firstForecast = data.forecasts[0];
  const methods = [...new Set(data.forecasts.map((f) => f.method))];

  const weekItems = plan.map((w) => ({
    isoYear: w.isoYear,
    isoWeek: w.isoWeek,
    startDate: w.startDate,
    endDate: w.endDate,
    kind: w.kind,
    signals: w.signals,
    operatingDays: w.operatingDays,
    totalM3: round1(w.totalM3),
    chilledM3: round1(w.chilledM3),
    ambientM3: round1(Math.max(0, w.totalM3 - w.chilledM3)),
    reeferTripsPerDay: {
      needed: w.assessment.tripsNeededPerDay,
      capacity: w.assessment.tripsCapacityPerDay,
      shortfall: w.assessment.shortfallTripsPerDay,
    },
    reefersInWorkshop: w.assessment.reefersInWorkshop,
    chilledCapacityM3: round1(w.assessment.chilledCapacityM3),
    fleetCapacityM3: round1(w.fleetCapacityM3),
    level: w.assessment.level,
    action: w.label,
    actions: (itemsByWeek.get(weekKeyStr(w)) ?? []).map((a) => ({ id: a.id, kind: a.kind, status: a.status })),
  }));

  const recommended = items
    .filter((a) => a.status !== "REJECTED" && !a.stale)
    .sort((a, b) => reliefOf(b) - reliefOf(a) || a.isoWeek - b.isoWeek || a.kind.localeCompare(b.kind))
    .slice(0, 8);

  const first = plan[0];
  const last = plan[plan.length - 1];
  return {
    depotCode,
    brand,
    from: first?.startDate ?? query.from ?? null,
    to: last ? isoWeekDates(last)[6] ?? last.endDate : (query.to ?? null),
    forecastMethod: methods.length === 1 ? methods[0] : methods.length > 1 ? methods.join("; ") : null,
    forecastGeneratedAt: firstForecast ? firstForecast.generatedAt.toISOString() : null,
    weeks: weekItems,
    reeferCount: reefers.length,
    fleetCapacityM3: round1(fleetCapacityM3(data.vehicles, standardWeek)),
    reeferCapacityM3: round1(reefers.length * TRIPS_PER_VEHICLE_DAY * standardWeek * loadPerTrip),
    loadPerReeferTripM3: round1(loadPerTrip),
    peakWeek: summary.peakWeek && { ...summary.peakWeek, totalM3: round1(summary.peakWeek.totalM3) },
    chilledPeak: summary.chilledPeak && { ...summary.chilledPeak, chilledM3: round1(summary.chilledPeak.chilledM3) },
    reeferShortfallWeeks: summary.reeferShortfallWeeks,
    forecastError: {
      mapePct: bt.mapeTotalPct,
      chilledMapePct: bt.mapeChilledPct,
      weeksTested: bt.weeks.length,
      leadWeeks: bt.leadWeeks,
      note:
        bt.mapeTotalPct === null
          ? "Not enough history to test the method."
          : `Mean absolute error of the same method re-run on the last ${bt.weeks.length} known weeks, forecasting ${bt.leadWeeks} week${bt.leadWeeks === 1 ? "" : "s"} ahead, on the depot's total volume.`,
    },
    forecastErrorPct: bt.mapeTotalPct,
    recommendedActions: recommended,
    assumptions: [
      `A reefer trip is planned to carry ${Math.round(REEFER_FILL * 100)}% of its volume capacity (${Math.round(AMBIENT_FILL * 100)}% for ambient vehicles), the loading observed in the competition training data. At this depot that is ${round1(loadPerTrip)} m\u00b3 per reefer trip.`,
      `Each vehicle runs at most ${TRIPS_PER_VEHICLE_DAY} trips a day, so ${reefers.length} reefer${reefers.length === 1 ? "" : "s"} give ${reefers.length * TRIPS_PER_VEHICLE_DAY} trips a day.`,
      "A reefer marked in the workshop on any day of a week is counted out for that whole week.",
      `Calendar effects on demand: payday +${Math.round(SIGNAL_EFFECTS.paydayUplift * 100)}%, festival ramp +${Math.round(SIGNAL_EFFECTS.festivalUplift * 100)}% x ramp, monsoon ${Math.round(SIGNAL_EFFECTS.monsoonEffect * 100)}%.`,
      "Forecast figures are demand for the depot (all orders requested that week), not deliveries completed.",
    ],
  };
}

const round1 = (n: number): number => Math.round(n * 10) / 10;

function reliefOf(a: { expectedRelief: Record<string, unknown> }): number {
  const t = a.expectedRelief.tripsPerDay;
  return typeof t === "number" ? t : 0;
}
