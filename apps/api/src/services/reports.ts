import type { Brand, OrderStatus } from "@prisma/client";
import { effectiveWindow } from "@katapatha/core/domain/schedule";
import { percent } from "@katapatha/core/domain/capacity";
import { prisma } from "../lib/db";
import { addDays, isoDateOf, parseIsoDate } from "./forecast";
import { clockMinutes, colomboMinutes } from "./positions";

/**
 * Delivery reports for one depot.
 *
 * A dispatcher is scoped to a depot, so every figure here is that depot's. The
 * design's "all depots" view is a different (and unauthorised) question; the
 * depot a caller asks about is checked against their own, never widened.
 *
 * TWO SOURCES, MERGED BY DAY
 *
 *   live      Order / Trip / TripStop / Shortfall / Problem / ReceiptConfirmation:
 *             what this system recorded itself.
 *   history   DailyDemandHistory and HistoricalLeg: what the field reported
 *             back before the system existed (or, in a development database,
 *             a synthetic stand-in; see `loadProvenance`).
 *
 * A date is LIVE when the depot has any non-cancelled Order requested for it,
 * HISTORY otherwise, and never both: counting a day twice would inflate every
 * total the moment the two overlap, and a day's orders and its stops must come
 * from the same place to be comparable. On-time, orders and exceptions are all
 * computed per source and summed.
 *
 * WHAT "ON TIME" MEANS
 *
 *   A stop is on time when the vehicle ARRIVED no later than the outlet's
 *   delivery window closed (the mall access window where an outlet has one, as
 *   the planner does). That is the competition's own definition of lateness.
 *   Arriving early is not late: the vehicle waits for the window to open.
 *   It is deliberately NOT "compared to the planned arrival" — a plan that
 *   itself landed after the window would otherwise score as on time. The
 *   difference between actual and planned arrival is reported separately as
 *   the average arrival delta (negative is earlier than planned).
 *   Only stops with a recorded arrival count: a stop nobody reached is not
 *   "on time", and a day with no arrivals has on-time null, not 100%.
 *
 * A metric the data cannot honestly support is null with a note, never a
 * plausible number.
 */

// --- Constants ------------------------------------------------------------------

/** The utilisation target shown on the reports (the design's orange marker). */
export const FLEET_UTILISATION_TARGET_PCT = 80;
/** The on-time target line on the daily chart. */
export const ON_TIME_TARGET_PCT = 95;
export const MAX_RANGE_DAYS = 366;

// --- Shapes ----------------------------------------------------------------------

export type DataSourceKind = "live" | "history";

export interface StopObservation {
  date: string;
  source: DataSourceKind;
  outletId: string;
  brand: Brand;
  vehicleId: string | null;
  /** One trip's identity within the window: a live trip, or a historical route. Null when unknown. */
  tripKey: string | null;
  /** Minutes past midnight, Colombo wall clock. */
  arrivalMin: number;
  plannedArrivalMin: number | null;
  windowCloseMin: number;
}

export function isOnTime(s: Pick<StopObservation, "arrivalMin" | "windowCloseMin">): boolean {
  return s.arrivalMin <= s.windowCloseMin;
}

export function arrivalDelta(s: Pick<StopObservation, "arrivalMin" | "plannedArrivalMin">): number | null {
  return s.plannedArrivalMin === null ? null : s.arrivalMin - s.plannedArrivalMin;
}

export interface DayDemand {
  date: string;
  source: DataSourceKind;
  brand: Brand | null;
  planned: number;
  delivered: number;
  deferred: number;
}

export type ExceptionKind =
  | "SHORT_DELIVERY"
  | "LATE_DELIVERY"
  | "DAMAGED_ITEMS"
  | "TEMPERATURE"
  | "WRONG_ITEMS"
  | "OUTLET_CLOSED"
  | "ACCESS_DENIED"
  | "ROAD_BLOCKED"
  | "VEHICLE_BREAKDOWN"
  | "DELIVERY_REFUSED"
  | "OTHER";

export const EXCEPTION_LABELS: Record<ExceptionKind, string> = {
  SHORT_DELIVERY: "Short delivery",
  LATE_DELIVERY: "Late delivery",
  DAMAGED_ITEMS: "Damaged items",
  TEMPERATURE: "Temperature",
  WRONG_ITEMS: "Wrong items",
  OUTLET_CLOSED: "Outlet closed",
  ACCESS_DENIED: "Access denied",
  ROAD_BLOCKED: "Road blocked",
  VEHICLE_BREAKDOWN: "Vehicle breakdown",
  DELIVERY_REFUSED: "Delivery refused",
  OTHER: "Other problem",
};

/**
 * Exceptions that mean the goods themselves were not as ordered. These, per
 * order, are the "discrepancies"; lateness and a closed road are exceptions
 * but not discrepancies — the goods arrived as ordered, or did not travel.
 */
const DISCREPANCY_KINDS: ReadonlySet<ExceptionKind> = new Set([
  "SHORT_DELIVERY",
  "DAMAGED_ITEMS",
  "TEMPERATURE",
  "WRONG_ITEMS",
  "DELIVERY_REFUSED",
]);

export interface ExceptionRecord {
  /** Dedup key: the same order showing up as a shortfall, a bad receipt and a problem counts once per kind. */
  key: string;
  kind: ExceptionKind;
  date: string;
  source: DataSourceKind;
  orderId: string | null;
  orderRef: string | null;
  outletId: string | null;
  at: string | null;
  note: string | null;
}

export interface TripLoad {
  date: string;
  vehicleId: string;
  tripNo: number;
  loadM3: number;
  capM3: number;
  temp: "reefer" | "ambient";
}

export interface LiveOrder {
  id: string;
  ref: string;
  date: string;
  outletId: string;
  brand: Brand;
  status: OrderStatus;
}

// --- Classification (pure) ---------------------------------------------------------

type ShortfallKind = "OK" | "SHORT" | "DAMAGED" | "MISSING";

export interface LiveExceptionInput {
  orders: readonly { id: string; ref: string; date: string; outletId: string; status: OrderStatus }[];
  shortfalls: readonly {
    id: string;
    orderId: string;
    kind: ShortfallKind;
    reasonCode: string | null;
    raisedAt: Date;
    date: string;
    outletId: string | null;
    ref: string | null;
  }[];
  receipts: readonly { orderId: string; matches: boolean; issueKind: string | null; confirmedAt: Date }[];
  problems: readonly {
    id: string;
    kind: string;
    orderId: string | null;
    outletId: string | null;
    occurredAt: Date;
    date: string;
    note: string | null;
  }[];
}

/**
 * Turn the live records into exception records, one per (order, kind).
 *
 * The same underlying event is routinely recorded three times: the loader
 * raises a shortfall, the driver reports damage, the store's receipt says
 * items arrived damaged. Counting each would triple a single bad delivery, so
 * a record is keyed by the order and the kind it resolves to.
 */
export function classifyLiveExceptions(input: LiveExceptionInput): ExceptionRecord[] {
  const out = new Map<string, ExceptionRecord>();
  const orderById = new Map(input.orders.map((o) => [o.id, o]));
  const add = (rec: Omit<ExceptionRecord, "key" | "source"> & { keyScope: string }) => {
    const { keyScope, ...rest } = rec;
    const key = `${keyScope}|${rec.kind}`;
    if (!out.has(key)) out.set(key, { ...rest, key, source: "live" });
  };

  for (const s of input.shortfalls) {
    const kind: ExceptionKind | null =
      s.reasonCode === "NOT_COLD_ENOUGH" ? "TEMPERATURE" : s.kind === "DAMAGED" ? "DAMAGED_ITEMS" : s.kind === "SHORT" || s.kind === "MISSING" ? "SHORT_DELIVERY" : null;
    if (!kind) continue;
    add({ keyScope: s.orderId, kind, date: s.date, orderId: s.orderId, orderRef: s.ref, outletId: s.outletId, at: s.raisedAt.toISOString(), note: null });
  }

  for (const r of input.receipts) {
    if (r.matches) continue;
    const order = orderById.get(r.orderId);
    if (!order) continue;
    const kind: ExceptionKind =
      r.issueKind === "ITEMS_DAMAGED" ? "DAMAGED_ITEMS" : r.issueKind === "ARRIVED_WARM" ? "TEMPERATURE" : r.issueKind === "WRONG_ITEMS" ? "WRONG_ITEMS" : "SHORT_DELIVERY";
    add({ keyScope: r.orderId, kind, date: order.date, orderId: order.id, orderRef: order.ref, outletId: order.outletId, at: r.confirmedAt.toISOString(), note: null });
  }

  for (const o of input.orders) {
    if (o.status === "PART_DELIVERED") {
      add({ keyScope: o.id, kind: "SHORT_DELIVERY", date: o.date, orderId: o.id, orderRef: o.ref, outletId: o.outletId, at: null, note: null });
    }
  }

  for (const p of input.problems) {
    const kind: ExceptionKind =
      p.kind === "GOODS_DAMAGED"
        ? "DAMAGED_ITEMS"
        : (["OUTLET_CLOSED", "ACCESS_DENIED", "ROAD_BLOCKED", "VEHICLE_BREAKDOWN", "DELIVERY_REFUSED"] as const).find((k) => k === p.kind) ?? "OTHER";
    const order = p.orderId ? orderById.get(p.orderId) : undefined;
    add({
      keyScope: p.orderId ?? `problem:${p.id}`,
      kind,
      date: p.date,
      orderId: p.orderId,
      orderRef: order?.ref ?? null,
      outletId: p.outletId ?? order?.outletId ?? null,
      at: p.occurredAt.toISOString(),
      note: p.note,
    });
  }

  return [...out.values()];
}

/** Late stops as exception records, from any source. */
export function lateExceptions(stops: readonly StopObservation[]): ExceptionRecord[] {
  return stops
    .filter((s) => !isOnTime(s))
    .map((s, i) => ({
      key: `late|${s.date}|${s.outletId}|${s.vehicleId ?? ""}|${i}`,
      kind: "LATE_DELIVERY" as const,
      date: s.date,
      source: s.source,
      orderId: null,
      orderRef: null,
      outletId: s.outletId,
      at: null,
      note: `Arrived ${clock(s.arrivalMin)}, window closed ${clock(s.windowCloseMin)}`,
    }));
}

function clock(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
}

/** Distinct orders with a goods problem. A problem with no order counts as its own. */
export function discrepancyCount(exceptions: readonly ExceptionRecord[]): number {
  const ids = new Set<string>();
  for (const e of exceptions) {
    if (!DISCREPANCY_KINDS.has(e.kind)) continue;
    ids.add(e.orderId ?? e.key);
  }
  return ids.size;
}

// --- Aggregation (pure) --------------------------------------------------------------

export interface ReportWindow {
  from: string;
  to: string;
  dates: string[];
}

export function windowOf(from: string, to: string): ReportWindow {
  const dates: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) dates.push(d);
  return { from, to, dates };
}

/** The window of the same length immediately before this one. */
export function previousWindow(w: ReportWindow): ReportWindow {
  const len = w.dates.length;
  return windowOf(addDays(w.from, -len), addDays(w.from, -1));
}

const pct1 = (num: number, den: number): number | null => (den === 0 ? null : Math.round((num / den) * 1000) / 10);

export interface OnTimeStat {
  total: number;
  onTime: number;
  pct: number | null;
  /** Mean of (actual - planned) arrival in minutes; null when no stop carried a plan. */
  avgArrivalDeltaMin: number | null;
}

export function onTimeStat(stops: readonly StopObservation[]): OnTimeStat {
  let onTime = 0;
  let deltaSum = 0;
  let deltaN = 0;
  for (const s of stops) {
    if (isOnTime(s)) onTime++;
    const d = arrivalDelta(s);
    if (d !== null) {
      deltaSum += d;
      deltaN++;
    }
  }
  return {
    total: stops.length,
    onTime,
    pct: pct1(onTime, stops.length),
    avgArrivalDeltaMin: deltaN === 0 ? null : Math.round(deltaSum / deltaN),
  };
}

export interface DemandStat {
  planned: number;
  delivered: number;
  deferred: number;
  /** Planned but neither delivered nor deferred: open, failed, or (history) never run. */
  undelivered: number;
}

export function demandStat(rows: readonly DayDemand[]): DemandStat {
  const planned = rows.reduce((s, r) => s + r.planned, 0);
  const delivered = rows.reduce((s, r) => s + r.delivered, 0);
  const deferred = rows.reduce((s, r) => s + r.deferred, 0);
  return { planned, delivered, deferred, undelivered: Math.max(0, planned - delivered - deferred) };
}

export interface DaySummary {
  date: string;
  source: DataSourceKind | "none";
  planned: number;
  delivered: number;
  deferred: number;
  undelivered: number;
  stops: number;
  onTime: number;
  onTimePct: number | null;
}

/**
 * One row per calendar date in the window, from whichever source owns it.
 * `liveDates` is the authority on ownership; a history row on a live date is
 * ignored rather than added.
 */
export function summariseDays(
  window: ReportWindow,
  liveDates: ReadonlySet<string>,
  demand: readonly DayDemand[],
  stops: readonly StopObservation[],
): DaySummary[] {
  const demandBy = new Map<string, DayDemand[]>();
  for (const d of demand) {
    if (liveDates.has(d.date) !== (d.source === "live")) continue;
    const list = demandBy.get(d.date);
    if (list) list.push(d);
    else demandBy.set(d.date, [d]);
  }
  const stopsBy = new Map<string, StopObservation[]>();
  for (const s of stops) {
    if (liveDates.has(s.date) !== (s.source === "live")) continue;
    const list = stopsBy.get(s.date);
    if (list) list.push(s);
    else stopsBy.set(s.date, [s]);
  }

  return window.dates.map((date) => {
    const rows = demandBy.get(date) ?? [];
    const st = stopsBy.get(date) ?? [];
    const dem = demandStat(rows);
    const ot = onTimeStat(st);
    const source: DaySummary["source"] = liveDates.has(date) ? "live" : rows.length > 0 || st.length > 0 ? "history" : "none";
    return { date, source, ...dem, stops: ot.total, onTime: ot.onTime, onTimePct: ot.pct };
  });
}

export interface OutletStat {
  outletId: string;
  stops: number;
  orders: number | null;
  onTimePct: number | null;
  late: number;
  discrepancies: number | null;
  avgArrivalDeltaMin: number | null;
}

/**
 * Per-outlet performance. `orders` and `discrepancies` exist only for live
 * days: the historical tables are aggregated above outlet level (demand) or
 * record visits rather than orders (legs), so for history-only outlets they
 * are null rather than a visit count dressed up as orders.
 */
export function outletStats(
  stops: readonly StopObservation[],
  liveOrders: readonly LiveOrder[],
  exceptions: readonly ExceptionRecord[],
): OutletStat[] {
  const ids = new Set<string>([...stops.map((s) => s.outletId), ...liveOrders.map((o) => o.outletId)]);
  return [...ids]
    .map((outletId) => {
      const mine = stops.filter((s) => s.outletId === outletId);
      const ot = onTimeStat(mine);
      const liveForOutlet = liveOrders.filter((o) => o.outletId === outletId);
      const isLive = liveForOutlet.length > 0 || mine.some((s) => s.source === "live");
      const mineExceptions = exceptions.filter((e) => e.source === "live" && e.outletId === outletId);
      return {
        outletId,
        stops: ot.total,
        orders: isLive ? liveForOutlet.length : null,
        onTimePct: ot.pct,
        late: ot.total - ot.onTime,
        discrepancies: isLive ? discrepancyCount(mineExceptions) : null,
        avgArrivalDeltaMin: ot.avgArrivalDeltaMin,
      };
    })
    .sort((a, b) => b.stops - a.stops || a.outletId.localeCompare(b.outletId));
}

export function exceptionCounts(exceptions: readonly ExceptionRecord[]): { kind: ExceptionKind; label: string; count: number }[] {
  const counts = new Map<ExceptionKind, number>();
  for (const e of exceptions) counts.set(e.kind, (counts.get(e.kind) ?? 0) + 1);
  return [...counts.entries()]
    .map(([kind, count]) => ({ kind, label: EXCEPTION_LABELS[kind], count }))
    .sort((a, b) => b.count - a.count || a.kind.localeCompare(b.kind));
}

/** Mean load against capacity across trips, as a whole percent. Null with no trips. */
export function utilisationPct(trips: readonly TripLoad[]): number | null {
  if (trips.length === 0) return null;
  const mean = trips.reduce((s, t) => s + (t.capM3 > 0 ? t.loadM3 / t.capM3 : 0), 0) / trips.length;
  return percent(mean, 1);
}

// --- Loading ---------------------------------------------------------------------------

export interface WindowData {
  window: ReportWindow;
  liveDates: Set<string>;
  demand: DayDemand[];
  stops: StopObservation[];
  liveOrders: LiveOrder[];
  exceptions: ExceptionRecord[];
  trips: TripLoad[];
}

const dayOf = (d: Date): string => isoDateOf(d);
const dateOnly = (d: string): Date => parseIsoDate(d);

/** Load and merge both sources for one depot and window. */
export async function loadWindowData(depotCode: string, window: ReportWindow): Promise<WindowData> {
  const range = { gte: dateOnly(window.from), lte: dateOnly(window.to) };

  const [orders, trips, shortfalls, problems, depotOutlets] = await Promise.all([
    prisma.order.findMany({
      where: { depotCode, requestedDate: range, status: { not: "CANCELLED" } },
      select: {
        id: true,
        ref: true,
        outletId: true,
        brand: true,
        status: true,
        requestedDate: true,
        receipt: { select: { matches: true, issueKind: true, confirmedAt: true } },
      },
    }),
    prisma.trip.findMany({
      where: { plan: { status: "PUBLISHED", planningDay: { depotCode, date: range } } },
      select: {
        vehicleId: true,
        tripNo: true,
        sumVolumeM3: true,
        vehicle: { select: { volumeCapM3: true, temp: true } },
        plan: { select: { planningDay: { select: { date: true } } } },
        stops: {
          select: {
            outletId: true,
            plannedArrivalAt: true,
            arrivedAt: true,
            outlet: { select: { brand: true, windowOpen: true, windowClose: true, mallWindowOpen: true, mallWindowClose: true } },
          },
        },
      },
    }),
    prisma.shortfall.findMany({
      where: { trip: { plan: { planningDay: { depotCode, date: range } } } },
      select: { id: true, orderId: true, kind: true, reasonCode: true, raisedAt: true, order: { select: { ref: true, outletId: true, requestedDate: true } } },
    }),
    prisma.problem.findMany({
      where: { OR: [{ trip: { plan: { planningDay: { depotCode, date: range } } } }, { order: { depotCode, requestedDate: range } }] },
      select: {
        id: true,
        kind: true,
        orderId: true,
        note: true,
        occurredAt: true,
        order: { select: { outletId: true, requestedDate: true } },
        tripStop: { select: { outletId: true } },
        trip: { select: { plan: { select: { planningDay: { select: { date: true } } } } } },
      },
    }),
    prisma.outlet.findMany({ where: { depotCode }, select: { id: true, brand: true, windowClose: true, mallWindowClose: true } }),
  ]);

  const liveDates = new Set(orders.map((o) => dayOf(o.requestedDate)));

  const liveOrders: LiveOrder[] = orders.map((o) => ({
    id: o.id,
    ref: o.ref,
    date: dayOf(o.requestedDate),
    outletId: o.outletId,
    brand: o.brand,
    status: o.status,
  }));

  const demand: DayDemand[] = [];
  const byDayBrand = new Map<string, DayDemand>();
  for (const o of liveOrders) {
    const key = `${o.date}|${o.brand}`;
    let row = byDayBrand.get(key);
    if (!row) {
      row = { date: o.date, source: "live", brand: o.brand, planned: 0, delivered: 0, deferred: 0 };
      byDayBrand.set(key, row);
    }
    row.planned++;
    if (o.status === "DELIVERED" || o.status === "PART_DELIVERED") row.delivered++;
    if (o.status === "DEFERRED") row.deferred++;
  }
  demand.push(...byDayBrand.values());

  const stops: StopObservation[] = [];
  const tripLoads: TripLoad[] = [];
  for (const t of trips) {
    const date = dayOf(t.plan.planningDay.date);
    tripLoads.push({
      date,
      vehicleId: t.vehicleId,
      tripNo: t.tripNo,
      loadM3: t.sumVolumeM3,
      capM3: t.vehicle.volumeCapM3,
      temp: t.vehicle.temp,
    });
    for (const s of t.stops) {
      if (!s.arrivedAt) continue;
      const window = effectiveWindow({
        outletId: s.outletId,
        brand: s.outlet.brand,
        district: "",
        depot: depotCode as never,
        dockType: "rear_dock",
        parkingConstraint: "normal",
        mallWindowOpen: s.outlet.mallWindowOpen,
        mallWindowClose: s.outlet.mallWindowClose,
        windowOpen: s.outlet.windowOpen,
        windowClose: s.outlet.windowClose,
      });
      stops.push({
        date,
        source: "live",
        outletId: s.outletId,
        brand: s.outlet.brand,
        vehicleId: t.vehicleId,
        tripKey: `${date}|${t.vehicleId}|${t.tripNo}`,
        arrivalMin: colomboMinutes(s.arrivedAt),
        plannedArrivalMin: clockMinutes(s.plannedArrivalAt),
        windowCloseMin: clockMinutes(window.close),
      });
    }
  }

  const exceptions = classifyLiveExceptions({
    orders: liveOrders,
    shortfalls: shortfalls.map((s) => ({
      id: s.id,
      orderId: s.orderId,
      kind: s.kind,
      reasonCode: s.reasonCode,
      raisedAt: s.raisedAt,
      date: dayOf(s.order.requestedDate),
      outletId: s.order.outletId,
      ref: s.order.ref,
    })),
    receipts: orders.flatMap((o) => (o.receipt ? [{ orderId: o.id, ...o.receipt }] : [])),
    problems: problems.map((p) => ({
      id: p.id,
      kind: p.kind,
      orderId: p.orderId,
      outletId: p.order?.outletId ?? p.tripStop?.outletId ?? null,
      occurredAt: p.occurredAt,
      date: p.order ? dayOf(p.order.requestedDate) : p.trip ? dayOf(p.trip.plan.planningDay.date) : dayOf(p.occurredAt),
      note: p.note,
    })),
  });

  // --- History, for the dates this system has no orders for --------------------
  const outletIds = depotOutlets.map((o) => o.id);
  const closeBy = new Map(
    depotOutlets.map((o) => [o.id, { brand: o.brand, close: clockMinutes(o.mallWindowClose ?? o.windowClose) }]),
  );
  const [dailyRows, legs] = await Promise.all([
    prisma.dailyDemandHistory.findMany({ where: { depotCode, date: range } }),
    outletIds.length === 0
      ? Promise.resolve([])
      : prisma.historicalLeg.findMany({
          where: { date: range, outletId: { in: outletIds } },
          select: { date: true, routeId: true, vehicleId: true, outletId: true, brand: true, plannedArrival: true, arrivalTime: true },
        }),
  ]);

  const historyDemand = new Map<string, DayDemand>();
  for (const r of dailyRows) {
    const date = dayOf(r.date);
    if (liveDates.has(date)) continue;
    const key = `${date}|${r.brand}`;
    let row = historyDemand.get(key);
    if (!row) {
      row = { date, source: "history", brand: r.brand, planned: 0, delivered: 0, deferred: 0 };
      historyDemand.set(key, row);
    }
    // Every order counts, as in the competition's own demand rules. The
    // training data records "attempted" for orders that left the depot on
    // the day, not whether the attempt succeeded, so attempted counts as
    // delivered here; the report says so.
    row.planned += r.orders;
    row.deferred += r.deferred;
    row.delivered += Math.max(0, r.orders - r.deferred - r.notRun);
  }
  demand.push(...historyDemand.values());

  for (const leg of legs) {
    const date = dayOf(leg.date);
    if (liveDates.has(date) || !leg.arrivalTime) continue;
    const outlet = closeBy.get(leg.outletId);
    if (!outlet) continue;
    stops.push({
      date,
      source: "history",
      outletId: leg.outletId,
      brand: leg.brand,
      vehicleId: leg.vehicleId,
      tripKey: `${date}|${leg.routeId}`,
      arrivalMin: clockMinutes(leg.arrivalTime),
      plannedArrivalMin: clockMinutes(leg.plannedArrival),
      windowCloseMin: outlet.close,
    });
  }

  return {
    window,
    liveDates,
    demand,
    stops,
    liveOrders,
    exceptions: [...exceptions, ...lateExceptions(stops)],
    trips: tripLoads,
  };
}

// --- Range defaults and provenance ---------------------------------------------------------

/**
 * The newest date with any data for this depot (a stop a driver arrived at, a
 * historical leg, or a demand-history row). Reports default to the seven days ending
 * here rather than ending today, because a database is a snapshot: a report
 * that defaults to an empty week would look broken, not honest.
 */
export async function latestDataDate(depotCode: string, today: string): Promise<string | null> {
  const upTo = { lte: dateOnly(today) };
  const outlets = await prisma.outlet.findMany({ where: { depotCode }, select: { id: true } });
  const [stop, daily, leg] = await Promise.all([
    // A delivered stop, not an order: a day of queued orders nobody has run yet
    // is not a day there is anything to report on.
    prisma.tripStop.findFirst({
      where: { arrivedAt: { not: null }, trip: { plan: { planningDay: { depotCode, date: upTo } } } },
      orderBy: { trip: { plan: { planningDay: { date: "desc" } } } },
      select: { trip: { select: { plan: { select: { planningDay: { select: { date: true } } } } } } },
    }),
    prisma.dailyDemandHistory.findFirst({ where: { depotCode, date: upTo }, orderBy: { date: "desc" }, select: { date: true } }),
    prisma.historicalLeg.findFirst({
      where: { date: upTo, outletId: { in: outlets.map((o) => o.id) } },
      orderBy: { date: "desc" },
      select: { date: true },
    }),
  ]);
  const candidates = [stop?.trip.plan.planningDay.date, daily?.date, leg?.date].filter((d): d is Date => Boolean(d)).map(dayOf);
  return candidates.length === 0 ? null : (candidates.sort().at(-1) ?? null);
}

export async function resolveRange(
  depotCode: string,
  today: string,
  from?: string,
  to?: string,
): Promise<{ from: string; to: string }> {
  if (from && to) return { from, to };
  if (to) return { from: addDays(to, -6), to };
  if (from) return { from, to: addDays(from, 6) };
  const latest = (await latestDataDate(depotCode, today)) ?? today;
  return { from: addDays(latest, -6), to: latest };
}

export interface Provenance {
  /** "synthetic" when the history was generated for the fixture; "competition" for the real training data. */
  kind: "synthetic" | "competition" | "unknown";
  label: string;
}

/** Says, in the response, where the analytics history came from. Read from SeedMeta. */
export async function loadProvenance(): Promise<Provenance> {
  const meta = await prisma.seedMeta.findUnique({ where: { key: "waypoint" }, select: { dataSource: true } });
  if (!meta) return { kind: "unknown", label: "No seed record; history provenance unknown." };
  if (meta.dataSource === "real") {
    return { kind: "competition", label: "History is the competition training data." };
  }
  return {
    kind: "synthetic",
    label: "History is SYNTHETIC, generated for the development fixture. It is not the competition data.",
  };
}

// --- Report context --------------------------------------------------------------------------

export interface ReportContext {
  depotCode: string;
  provenance: Provenance;
  vehicles: { id: string; type: "truck" | "van"; temp: "reefer" | "ambient"; volumeCapM3: number }[];
  outlets: Map<string, { displayName: string | null; districtName: string; brand: Brand }>;
  /** Days each vehicle was marked in the workshop within the window. */
  workshopDays: Map<string, number>;
}

export async function loadReportContext(depotCode: string, window: ReportWindow): Promise<ReportContext> {
  const [provenance, vehicles, outlets, workshop] = await Promise.all([
    loadProvenance(),
    prisma.vehicle.findMany({ where: { depotCode }, orderBy: { id: "asc" }, select: { id: true, type: true, temp: true, volumeCapM3: true } }),
    prisma.outlet.findMany({ where: { depotCode }, select: { id: true, displayName: true, districtName: true, brand: true } }),
    prisma.vehicleDayStatus.groupBy({
      by: ["vehicleId"],
      where: { status: "IN_WORKSHOP", vehicle: { depotCode }, date: { gte: dateOnly(window.from), lte: dateOnly(window.to) } },
      _count: { _all: true },
    }),
  ]);
  return {
    depotCode,
    provenance,
    vehicles,
    outlets: new Map(outlets.map((o) => [o.id, { displayName: o.displayName, districtName: o.districtName, brand: o.brand }])),
    workshopDays: new Map(workshop.map((w) => [w.vehicleId, w._count._all])),
  };
}

// --- Builders (pure) ------------------------------------------------------------------------------

export interface Coverage {
  liveDays: number;
  historyDays: number;
  emptyDays: number;
}

export function coverageOf(days: readonly DaySummary[]): Coverage {
  return {
    liveDays: days.filter((d) => d.source === "live").length,
    historyDays: days.filter((d) => d.source === "history").length,
    emptyDays: days.filter((d) => d.source === "none").length,
  };
}

function sourceNote(c: Coverage): string | null {
  if (c.historyDays === 0) return null;
  if (c.liveDays === 0) return `All ${c.historyDays} days with data come from historical records, not from deliveries run in this system.`;
  return `${c.historyDays} of ${c.historyDays + c.liveDays} days with data come from historical records; ${c.liveDays} were run in this system.`;
}

const HISTORY_DELIVERED_NOTE =
  "Historical days count orders dispatched on the day as delivered: the training data does not record whether an attempt succeeded.";

export interface ReportHeader {
  depotCode: string;
  from: string;
  to: string;
  historySource: Provenance;
  coverage: Coverage;
}

function header(data: WindowData, ctx: ReportContext, days: DaySummary[]): ReportHeader {
  return {
    depotCode: ctx.depotCode,
    from: data.window.from,
    to: data.window.to,
    historySource: ctx.provenance,
    coverage: coverageOf(days),
  };
}

const delta1 = (a: number | null, b: number | null): number | null => (a === null || b === null ? null : Math.round((a - b) * 10) / 10);

function outletRow(stat: OutletStat, ctx: ReportContext) {
  const info = ctx.outlets.get(stat.outletId);
  return {
    outletId: stat.outletId,
    displayName: info?.displayName ?? null,
    districtName: info?.districtName ?? null,
    brand: info?.brand ?? null,
    stops: stat.stops,
    orders: stat.orders,
    onTimePct: stat.onTimePct,
    late: stat.late,
    discrepancies: stat.discrepancies,
    avgArrivalDeltaMin: stat.avgArrivalDeltaMin,
  };
}

export function buildOverview(cur: WindowData, prev: WindowData, ctx: ReportContext) {
  const days = summariseDays(cur.window, cur.liveDates, cur.demand, cur.stops);
  const coverage = coverageOf(days);
  const prevDays = summariseDays(prev.window, prev.liveDates, prev.demand, prev.stops);

  const ot = onTimeStat(cur.stops);
  const prevOt = onTimeStat(prev.stops);
  const orders = demandStat(cur.demand);
  const util = utilisationPct(cur.trips);

  const liveOrders = cur.liveOrders.length;
  const discrepancies = coverage.liveDays > 0 ? discrepancyCount(cur.exceptions) : null;
  const prevDiscrepancies = prevDays.some((d) => d.source === "live") ? discrepancyCount(prev.exceptions) : null;

  const outlets = outletStats(cur.stops, cur.liveOrders, cur.exceptions);
  const counts = exceptionCounts(cur.exceptions);

  return {
    ...header(cur, ctx, days),
    onTime: {
      pct: ot.pct,
      onTime: ot.onTime,
      total: ot.total,
      targetPct: ON_TIME_TARGET_PCT,
      vsPreviousPts: delta1(ot.pct, prevOt.pct),
      note:
        ot.pct === null
          ? "No arrivals were recorded in this range."
          : sourceNote(coverage),
    },
    orders: {
      ...orders,
      note: coverage.historyDays > 0 ? HISTORY_DELIVERED_NOTE : null,
    },
    utilisation: {
      pct: util,
      targetPct: FLEET_UTILISATION_TARGET_PCT,
      vehicles: ctx.vehicles.length,
      trips: cur.trips.length,
      note:
        util === null
          ? "Vehicle load is recorded only for trips published in this system; there are none in this range, and the historical records carry no load."
          : coverage.historyDays > 0
            ? `Computed over the ${coverage.liveDays} day(s) run in this system; historical days carry no load.`
            : null,
    },
    discrepancies: {
      count: discrepancies,
      pctOfOrders: discrepancies === null ? null : pct1(discrepancies, liveOrders),
      vsPrevious: discrepancies === null || prevDiscrepancies === null ? null : discrepancies - prevDiscrepancies,
      note:
        discrepancies === null
          ? "Shortfalls, receipts and problems are recorded only for days run in this system; none fall in this range."
          : coverage.historyDays > 0
            ? "Counted over the days run in this system; the historical records hold no discrepancies."
            : null,
    },
    onTimeSeries: days.map((d) => ({ date: d.date, source: d.source, onTimePct: d.onTimePct, onTime: d.onTime, total: d.stops })),
    // Own depot only: a dispatcher is depot-scoped, so there is no peer depot to show.
    utilisationByDepot: [
      {
        depotCode: ctx.depotCode,
        vehicles: ctx.vehicles.length,
        utilisationPct: util,
        targetPct: FLEET_UTILISATION_TARGET_PCT,
      },
    ],
    topOutlets: outlets.slice(0, 6).map((o) => outletRow(o, ctx)),
    totalOutlets: outlets.length,
    topExceptions: {
      total: counts.reduce((s, c) => s + c.count, 0),
      items: counts.slice(0, 6),
    },
  };
}

export function buildDeliveries(data: WindowData, ctx: ReportContext) {
  const days = summariseDays(data.window, data.liveDates, data.demand, data.stops);
  const coverage = coverageOf(days);
  const brands: Brand[] = ["Fresh", "Style", "Tech"];
  const ot = onTimeStat(data.stops);
  return {
    ...header(data, ctx, days),
    totals: { ...demandStat(data.demand), stops: ot.total, onTimePct: ot.pct, avgArrivalDeltaMin: ot.avgArrivalDeltaMin },
    days,
    byBrand: brands.map((brand) => {
      const stat = onTimeStat(data.stops.filter((s) => s.brand === brand));
      return {
        brand,
        ...demandStat(data.demand.filter((d) => d.brand === brand)),
        stops: stat.total,
        onTimePct: stat.pct,
        avgArrivalDeltaMin: stat.avgArrivalDeltaMin,
      };
    }),
    notes: [sourceNote(coverage), coverage.historyDays > 0 ? HISTORY_DELIVERED_NOTE : null].filter((n): n is string => n !== null),
  };
}

export function buildFleet(data: WindowData, ctx: ReportContext) {
  const days = summariseDays(data.window, data.liveDates, data.demand, data.stops);
  const coverage = coverageOf(days);

  const vehicles = ctx.vehicles.map((v) => {
    const stops = data.stops.filter((s) => s.vehicleId === v.id);
    const live = data.trips.filter((t) => t.vehicleId === v.id);
    const historyTrips = new Set(stops.filter((s) => s.source === "history" && s.tripKey).map((s) => s.tripKey));
    const ot = onTimeStat(stops);
    return {
      vehicleId: v.id,
      type: v.type,
      temp: v.temp,
      volumeCapM3: v.volumeCapM3,
      trips: live.length + historyTrips.size,
      stops: ot.total,
      onTimePct: ot.pct,
      avgLoadPct: utilisationPct(live),
      workshopDays: ctx.workshopDays.get(v.id) ?? 0,
    };
  });

  const byTemp = (["reefer", "ambient"] as const).map((temp) => {
    const own = vehicles.filter((v) => v.temp === temp);
    return {
      temp,
      vehicles: own.length,
      trips: own.reduce((s, v) => s + v.trips, 0),
      avgLoadPct: utilisationPct(data.trips.filter((t) => t.temp === temp)),
    };
  });

  const util = utilisationPct(data.trips);
  return {
    ...header(data, ctx, days),
    utilisation: {
      pct: util,
      targetPct: FLEET_UTILISATION_TARGET_PCT,
      note:
        util === null
          ? "Vehicle load is recorded only for trips published in this system; there are none in this range."
          : coverage.historyDays > 0
            ? "Load is averaged over trips run in this system; historical trips carry no load."
            : null,
    },
    vehicles,
    byTemp,
    notes: [sourceNote(coverage)].filter((n): n is string => n !== null),
  };
}

export type OutletSort = "stops" | "onTime" | "discrepancies";

export function buildOutlets(data: WindowData, ctx: ReportContext, sort: OutletSort) {
  const days = summariseDays(data.window, data.liveDates, data.demand, data.stops);
  const coverage = coverageOf(days);
  const rows = outletStats(data.stops, data.liveOrders, data.exceptions);
  const sorted = [...rows].sort((a, b) => {
    if (sort === "onTime") {
      // Worst first; an outlet with no arrivals has nothing to rank and goes last.
      const av = a.onTimePct ?? Infinity;
      const bv = b.onTimePct ?? Infinity;
      return av - bv || b.stops - a.stops || a.outletId.localeCompare(b.outletId);
    }
    if (sort === "discrepancies") {
      return (b.discrepancies ?? -1) - (a.discrepancies ?? -1) || b.stops - a.stops || a.outletId.localeCompare(b.outletId);
    }
    return b.stops - a.stops || a.outletId.localeCompare(b.outletId);
  });
  return {
    ...header(data, ctx, days),
    sort,
    outlets: sorted.map((o) => outletRow(o, ctx)),
    notes: [
      sourceNote(coverage),
      "Orders and discrepancies are counted only for days run in this system; for historical days an outlet shows its visits (stops) and on-time share.",
    ].filter((n): n is string => n !== null),
  };
}

export function buildExceptions(data: WindowData, ctx: ReportContext) {
  const days = summariseDays(data.window, data.liveDates, data.demand, data.stops);
  const coverage = coverageOf(days);
  const byDay = new Map<string, number>();
  for (const e of data.exceptions) byDay.set(e.date, (byDay.get(e.date) ?? 0) + 1);
  const recent = [...data.exceptions]
    .sort((a, b) => b.date.localeCompare(a.date) || (b.at ?? "").localeCompare(a.at ?? "") || a.key.localeCompare(b.key))
    .slice(0, 50)
    .map((e) => ({
      kind: e.kind,
      label: EXCEPTION_LABELS[e.kind],
      date: e.date,
      source: e.source,
      at: e.at,
      orderRef: e.orderRef,
      outletId: e.outletId,
      note: e.note,
    }));
  return {
    ...header(data, ctx, days),
    total: data.exceptions.length,
    byKind: exceptionCounts(data.exceptions),
    byDay: data.window.dates.map((date) => ({ date, count: byDay.get(date) ?? 0 })),
    recent,
    notes: [
      sourceNote(coverage),
      coverage.historyDays > 0 ? "Historical days carry only late arrivals as exceptions; shortfalls, receipts and problems exist for days run in this system." : null,
    ].filter((n): n is string => n !== null),
  };
}
