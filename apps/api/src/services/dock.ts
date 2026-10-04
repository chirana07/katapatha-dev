import { Prisma, type TripStatus } from "@prisma/client";
import { prisma } from "../lib/db.js";
import type { SessionUser } from "../lib/auth.js";

/**
 * Owner: BE3 (dock)
 *
 * What the loader's dock needs beyond a trip and its load list: which bay each
 * vehicle loads at, when loading started and was sealed, how fast the dock is
 * going, how the last few nights went, and the shift's handover note.
 *
 * Everything here comes from rows the dock itself wrote — load checks, counts
 * in progress, the seal on readiness — never from a guess. The pure functions
 * at the top are unit-tested; the queries below them only feed them.
 */

/** How long a vehicle is expected to sit at a bay before it departs. Used to
 *  spread trips across bays and, with the target below, to say "behind". */
export const BAY_WINDOW_MINUTES = 60;

/** The dock's own target for loading one vehicle, first box to sealed door. */
export const LOAD_TARGET_MINUTES = 45;

/** Colombo is UTC+05:30 all year (no daylight saving). */
const COLOMBO_OFFSET_MINUTES = 330;

// --- Pure helpers -------------------------------------------------------------

export function clockToMinutes(clock: string): number {
  const [h, m] = clock.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

export function minutesToClock(minutes: number): string {
  const wrapped = ((Math.round(minutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(wrapped / 60)).padStart(2, "0")}:${String(wrapped % 60).padStart(2, "0")}`;
}

/** The instant a Colombo wall-clock time happens on a planning day. `day` is
 *  the planning day's date as stored: UTC midnight of the local date. */
export function colomboInstant(day: Date, clock: string): Date {
  return new Date(day.getTime() + (clockToMinutes(clock) - COLOMBO_OFFSET_MINUTES) * 60_000);
}

/** Minutes since Colombo midnight of `day` for an instant (may be negative, or
 *  past 1440, for an instant on another day). */
export function minutesIntoDay(day: Date, at: Date): number {
  return (at.getTime() - day.getTime()) / 60_000 + COLOMBO_OFFSET_MINUTES;
}

export interface BayCandidate {
  id: string;
  plannedDepartAt: string | null;
  dockBay: number | null;
}

/**
 * Spreads a day's trips over the dock's bays.
 *
 * A vehicle holds its bay for BAY_WINDOW_MINUTES before it departs. Trips
 * already given a bay keep it (a bay must never move under a loader); the rest
 * take, in departure order, the lowest-numbered bay that is free when their
 * window opens, or else the one that frees up first. Returns only the trips
 * that need a bay written.
 */
export function assignBays(trips: BayCandidate[], bays: number): Map<string, number> {
  const count = Math.max(1, bays);
  const freeAt = new Array<number>(count).fill(-Infinity);
  const ordered = [...trips].sort((a, b) => {
    const am = a.plannedDepartAt ? clockToMinutes(a.plannedDepartAt) : 1440;
    const bm = b.plannedDepartAt ? clockToMinutes(b.plannedDepartAt) : 1440;
    return am - bm || a.id.localeCompare(b.id);
  });
  const assigned = new Map<string, number>();
  for (const trip of ordered) {
    const depart = trip.plannedDepartAt ? clockToMinutes(trip.plannedDepartAt) : 1440;
    const opens = depart - BAY_WINDOW_MINUTES;
    let bay: number;
    if (trip.dockBay != null && trip.dockBay >= 1 && trip.dockBay <= count) {
      bay = trip.dockBay;
    } else {
      const free = freeAt.findIndex((at) => at <= opens);
      bay = free !== -1 ? free + 1 : freeAt.indexOf(Math.min(...freeAt)) + 1;
      assigned.set(trip.id, bay);
    }
    freeAt[bay - 1] = Math.max(freeAt[bay - 1]!, depart);
  }
  return assigned;
}

export interface SealTiming {
  plannedDepartAt: string | null;
  sealedAt: Date | null;
}

/** Sealed before its slot: the seal (readiness) landed at or before the
 *  planned departure. Null while unsealed or with no departure time. */
export function sealedOnTime(day: Date, trip: SealTiming): boolean | null {
  if (!trip.sealedAt || !trip.plannedDepartAt) return null;
  return trip.sealedAt.getTime() <= colomboInstant(day, trip.plannedDepartAt).getTime();
}

/** Minutes the seal landed after the planned departure; 0 when on time. */
export function sealLateMinutes(day: Date, trip: SealTiming): number | null {
  if (!trip.sealedAt || !trip.plannedDepartAt) return null;
  const late = (trip.sealedAt.getTime() - colomboInstant(day, trip.plannedDepartAt).getTime()) / 60_000;
  return Math.max(0, Math.round(late));
}

/**
 * How many minutes behind the dock's own loading plan a vehicle is at `now`.
 *
 * The plan is linear: loading should start LOAD_TARGET_MINUTES before
 * departure and reach 100% at departure. Behind is the gap between the units
 * that plan expects by now and the units on board, expressed in minutes of
 * that plan. Null when it does not apply (no departure, nothing to load, or
 * the window has not opened yet).
 */
export function minutesBehindPlan(
  departMinutes: number,
  nowMinutes: number,
  loadedUnits: number,
  expectedUnits: number,
): number | null {
  if (expectedUnits <= 0) return null;
  const start = departMinutes - LOAD_TARGET_MINUTES;
  if (nowMinutes <= start) return null;
  const elapsed = Math.min(nowMinutes - start, LOAD_TARGET_MINUTES);
  const done = (Math.min(loadedUnits, expectedUnits) / expectedUnits) * LOAD_TARGET_MINUTES;
  return Math.max(0, Math.round(elapsed - done));
}

export interface UnitEvent {
  at: Date;
  units: number;
}

/**
 * Units loaded per 15 minutes of the day, from the dock's own events. Buckets
 * run from the first event's quarter hour to the last's, so the chart has no
 * long empty tail; an empty input gives no buckets.
 */
export function unitsPerQuarterHour(day: Date, events: UnitEvent[]): { start: string; units: number }[] {
  const inDay = events
    .map((event) => ({ minute: minutesIntoDay(day, event.at), units: event.units }))
    .filter((event) => event.minute >= 0 && event.minute < 1440 && event.units > 0);
  if (inDay.length === 0) return [];
  const first = Math.floor(Math.min(...inDay.map((e) => e.minute)) / 15);
  const last = Math.floor(Math.max(...inDay.map((e) => e.minute)) / 15);
  const buckets = Array.from({ length: last - first + 1 }, (_, i) => ({ start: minutesToClock((first + i) * 15), units: 0 }));
  for (const event of inDay) buckets[Math.floor(event.minute / 15) - first]!.units += event.units;
  return buckets;
}

const AT_DOCK: TripStatus[] = ["PLANNED", "LOADING"];

export interface BayTrip {
  id: string;
  vehicleId: string;
  tripNo: number;
  status: TripStatus;
  plannedDepartAt: string | null;
  dockBay: number | null;
  loadedUnits: number;
  expectedUnits: number;
}

/** What is at each bay now, and who is next there. */
export function bayBoard(trips: BayTrip[], bays: number) {
  return Array.from({ length: Math.max(1, bays) }, (_, i) => {
    const bay = i + 1;
    const here = trips
      .filter((trip) => trip.dockBay === bay && AT_DOCK.includes(trip.status))
      .sort((a, b) => (a.plannedDepartAt ?? "99:99").localeCompare(b.plannedDepartAt ?? "99:99"));
    const current = here.find((trip) => trip.status === "LOADING") ?? null;
    const next = here.find((trip) => trip !== current) ?? null;
    const view = (trip: BayTrip | null) =>
      trip
        ? {
            tripId: trip.id,
            vehicleId: trip.vehicleId,
            tripNo: trip.tripNo,
            plannedDepartAt: trip.plannedDepartAt,
            loadedUnits: trip.loadedUnits,
            expectedUnits: trip.expectedUnits,
          }
        : null;
    return { bay, current: view(current), next: view(next) };
  });
}

// --- Queries ------------------------------------------------------------------

/** A trip's units on board: checked lines count their check, unchecked lines
 *  their count in progress. One query per call, for any number of trips. */
export async function loadedUnitsByTrip(tripIds: string[]) {
  const [checks, progress] = await Promise.all([
    prisma.loadCheck.findMany({ where: { tripId: { in: tripIds } }, select: { tripId: true, orderId: true, loadedUnits: true } }),
    prisma.loadProgress.findMany({ where: { tripId: { in: tripIds } }, select: { tripId: true, orderId: true, loadedUnits: true } }),
  ]);
  const checked = new Set(checks.map((c) => `${c.tripId}:${c.orderId}`));
  const units = new Map<string, number>();
  for (const c of checks) units.set(c.tripId, (units.get(c.tripId) ?? 0) + c.loadedUnits);
  for (const p of progress) {
    if (checked.has(`${p.tripId}:${p.orderId}`)) continue;
    units.set(p.tripId, (units.get(p.tripId) ?? 0) + p.loadedUnits);
  }
  return units;
}

/**
 * Gives every published trip of a depot's day a bay, once. Idempotent: trips
 * that already have one keep it, so calling this on every dock read is cheap
 * after the first and never moves a vehicle.
 */
export async function ensureBays(depotCode: string, day: Date): Promise<void> {
  const trips = await prisma.trip.findMany({
    where: { plan: { status: "PUBLISHED", planningDay: { depotCode, date: day } }, status: { not: "CANCELLED" } },
    select: { id: true, plannedDepartAt: true, dockBay: true },
  });
  if (trips.every((trip) => trip.dockBay != null)) return;
  const depot = await prisma.depot.findUnique({ where: { code: depotCode }, select: { dockBays: true } });
  const assigned = assignBays(trips, depot?.dockBays ?? 6);
  await prisma.$transaction(
    [...assigned].map(([id, dockBay]) => prisma.trip.updateMany({ where: { id, dockBay: null }, data: { dockBay } })),
  );
}

/** The planning days a set of trips belongs to, by trip id, for routes that
 *  need to call ensureBays before reading. */
export async function ensureBaysForDate(depotCode: string, date: string | undefined): Promise<void> {
  if (date) {
    await ensureBays(depotCode, new Date(`${date}T00:00:00.000Z`));
    return;
  }
  const days = await prisma.planningDay.findMany({
    where: { depotCode, plans: { some: { status: "PUBLISHED", trips: { some: { dockBay: null } } } } },
    select: { date: true },
    take: 7,
  });
  for (const day of days) await ensureBays(depotCode, day.date);
}

export interface SwapView {
  id: string;
  fromVehicleId: string;
  toVehicleId: string;
  reason: string;
  previousDepartAt: string;
  newDepartAt: string;
  unloadedUnits: number;
  createdAt: string;
  unloadedAt: string | null;
  unloadedByName: string | null;
  arrivedAt: string | null;
  arrivedByName: string | null;
  acknowledgedAt: string | null;
}

export function swapView(row: {
  id: string;
  fromVehicleId: string;
  toVehicleId: string;
  reason: string;
  previousDepartAt: string;
  newDepartAt: string;
  unloadedUnits: number;
  createdAt: Date;
  unloadedAt: Date | null;
  unloadedByName: string | null;
  arrivedAt: Date | null;
  arrivedByName: string | null;
  acknowledgedAt: Date | null;
}): SwapView {
  return {
    id: row.id,
    fromVehicleId: row.fromVehicleId,
    toVehicleId: row.toVehicleId,
    reason: row.reason,
    previousDepartAt: row.previousDepartAt,
    newDepartAt: row.newDepartAt,
    unloadedUnits: row.unloadedUnits,
    createdAt: row.createdAt.toISOString(),
    unloadedAt: row.unloadedAt?.toISOString() ?? null,
    unloadedByName: row.unloadedByName,
    arrivedAt: row.arrivedAt?.toISOString() ?? null,
    arrivedByName: row.arrivedByName,
    acknowledgedAt: row.acknowledgedAt?.toISOString() ?? null,
  };
}

/** The latest swap on each trip, for the trip views. */
export async function latestSwaps(tripIds: string[]): Promise<Map<string, SwapView>> {
  if (tripIds.length === 0) return new Map();
  const rows = await prisma.vehicleSwap.findMany({
    where: { tripId: { in: tripIds } },
    orderBy: [{ tripId: "asc" }, { createdAt: "desc" }],
    distinct: ["tripId"],
  });
  return new Map(rows.map((row) => [row.tripId, swapView(row)]));
}

/**
 * The dock's shift summary for one day: bays, timeline, pace, the last seven
 * nights, the handover note and who the dispatcher is.
 */
export async function dockShift(user: SessionUser & { depotCode: string }, date: string, now: Date = new Date()) {
  const day = new Date(`${date}T00:00:00.000Z`);
  await ensureBays(user.depotCode, day);

  const [depot, trips, dispatcher, note] = await Promise.all([
    prisma.depot.findUnique({ where: { code: user.depotCode }, select: { dockBays: true } }),
    prisma.trip.findMany({
      where: { plan: { status: "PUBLISHED", planningDay: { depotCode: user.depotCode, date: day } }, status: { not: "CANCELLED" } },
      select: {
        id: true,
        vehicleId: true,
        tripNo: true,
        status: true,
        plannedDepartAt: true,
        dockBay: true,
        loadStartedAt: true,
        loadConfirmedAt: true,
        stops: { select: { orders: { select: { order: { select: { units: true } } } } } },
      },
      orderBy: [{ plannedDepartAt: "asc" }, { vehicleId: "asc" }],
    }),
    prisma.user.findFirst({ where: { role: "DISPATCHER", depotCode: user.depotCode }, select: { name: true }, orderBy: { createdAt: "asc" } }),
    prisma.dockNote.findUnique({ where: { depotCode_date: { depotCode: user.depotCode, date: day } } }),
  ]);
  const bays = depot?.dockBays ?? 6;
  const ids = trips.map((trip) => trip.id);
  const [loaded, checks] = await Promise.all([
    loadedUnitsByTrip(ids),
    prisma.loadCheck.findMany({ where: { tripId: { in: ids } }, select: { checkedAt: true, loadedUnits: true } }),
  ]);

  const rows = trips.map((trip) => {
    const expectedUnits = trip.stops.reduce((sum, stop) => sum + stop.orders.reduce((s, o) => s + o.order.units, 0), 0);
    const sealed = { plannedDepartAt: trip.plannedDepartAt, sealedAt: trip.loadConfirmedAt };
    return {
      tripId: trip.id,
      vehicleId: trip.vehicleId,
      tripNo: trip.tripNo,
      status: trip.status,
      plannedDepartAt: trip.plannedDepartAt,
      dockBay: trip.dockBay,
      loadStartedAt: trip.loadStartedAt?.toISOString() ?? null,
      sealedAt: trip.loadConfirmedAt?.toISOString() ?? null,
      loadMinutes:
        trip.loadStartedAt && trip.loadConfirmedAt
          ? Math.max(0, Math.round((trip.loadConfirmedAt.getTime() - trip.loadStartedAt.getTime()) / 60_000))
          : null,
      sealedOnTime: sealedOnTime(day, sealed),
      lateMinutes: sealLateMinutes(day, sealed),
      loadedUnits: loaded.get(trip.id) ?? 0,
      expectedUnits,
    };
  });

  const nowMinutes = minutesIntoDay(day, now);
  const isToday = nowMinutes >= 0 && nowMinutes < 1440;
  const timing = rows.map((row) => ({
    tripId: row.tripId,
    minutesBehind:
      isToday && AT_DOCK.includes(row.status) && row.plannedDepartAt
        ? minutesBehindPlan(clockToMinutes(row.plannedDepartAt), nowMinutes, row.loadedUnits, row.expectedUnits)
        : null,
  }));

  const loadTimes = rows.map((row) => row.loadMinutes).filter((m): m is number => m != null);

  return {
    date,
    depotCode: user.depotCode,
    dockBays: bays,
    loadTargetMinutes: LOAD_TARGET_MINUTES,
    nowClock: isToday ? minutesToClock(nowMinutes) : null,
    dispatcherName: dispatcher?.name ?? null,
    bays: bayBoard(
      rows.map((row) => ({
        id: row.tripId,
        vehicleId: row.vehicleId,
        tripNo: row.tripNo,
        status: row.status,
        plannedDepartAt: row.plannedDepartAt,
        dockBay: row.dockBay,
        loadedUnits: row.loadedUnits,
        expectedUnits: row.expectedUnits,
      })),
      bays,
    ),
    trips: rows.map((row, i) => ({ ...row, minutesBehind: timing[i]!.minutesBehind })),
    averageLoadMinutes: loadTimes.length > 0 ? Math.round(loadTimes.reduce((a, b) => a + b, 0) / loadTimes.length) : null,
    unitsPerQuarterHour: unitsPerQuarterHour(
      day,
      checks.map((check) => ({ at: check.checkedAt, units: check.loadedUnits })),
    ),
    history: await sealHistory(user.depotCode, day),
    handover: note
      ? { body: note.body, authorName: note.authorName, updatedAt: note.updatedAt.toISOString() }
      : null,
  };
}

/** The last seven published days up to and including `day`: how many vehicles
 *  were sealed, and how many of those before their slot. */
export async function sealHistory(depotCode: string, day: Date) {
  const days = await prisma.planningDay.findMany({
    where: { depotCode, date: { lte: day }, plans: { some: { status: "PUBLISHED" } } },
    orderBy: { date: "desc" },
    take: 7,
    select: {
      date: true,
      plans: {
        where: { status: "PUBLISHED" },
        select: { trips: { where: { status: { not: "CANCELLED" } }, select: { plannedDepartAt: true, loadConfirmedAt: true } } },
      },
    },
  });
  return days
    .map((planningDay) => {
      const trips = planningDay.plans.flatMap((plan) => plan.trips);
      const sealed = trips.filter((trip) => trip.loadConfirmedAt);
      const onTime = sealed.filter((trip) => sealedOnTime(planningDay.date, { plannedDepartAt: trip.plannedDepartAt, sealedAt: trip.loadConfirmedAt }));
      return {
        date: planningDay.date.toISOString().slice(0, 10),
        vehicles: trips.length,
        sealed: sealed.length,
        sealedOnTime: onTime.length,
      };
    })
    .reverse();
}

export async function saveHandover(
  user: SessionUser & { depotCode: string },
  input: { date: string; body: string; authorName: string },
) {
  const date = new Date(`${input.date}T00:00:00.000Z`);
  const row = await prisma.dockNote.upsert({
    where: { depotCode_date: { depotCode: user.depotCode, date } },
    create: { depotCode: user.depotCode, date, body: input.body.trim(), authorName: input.authorName.trim(), authorUserId: user.id },
    update: { body: input.body.trim(), authorName: input.authorName.trim(), authorUserId: user.id },
  });
  return { body: row.body, authorName: row.authorName, updatedAt: row.updatedAt.toISOString() };
}

export type ItemCounts = Record<string, number>;

/** Item counts as stored: only non-negative whole numbers, keyed by sku. */
export function cleanItemCounts(value: unknown): ItemCounts | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const out: ItemCounts = {};
  for (const [sku, count] of Object.entries(value as Record<string, unknown>)) {
    if (typeof count === "number" && Number.isInteger(count) && count >= 0) out[sku] = count;
  }
  return Object.keys(out).length > 0 ? out : null;
}

/** For a Json? column: the counts, or SQL NULL. */
export function itemCountsJson(value: ItemCounts | null): Prisma.InputJsonValue | typeof Prisma.DbNull {
  return value ?? Prisma.DbNull;
}
