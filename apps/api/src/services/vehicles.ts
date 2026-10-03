import type { ChillerSource, Role, StopStatus, TripStatus, Vehicle } from "@prisma/client";
import { isInRange } from "@katapatha/core/domain/chiller";
import { prisma } from "../lib/db";
import {
  ageSecondsOf,
  estimatedArrival,
  lateMinutes,
  latestPositions,
  type VehiclePosition,
} from "./positions";

/**
 * Vehicles, as the dispatcher sees them: a day's fleet, one vehicle, and the
 * map.
 *
 * Every state shown here is derived from rows the system really holds — the
 * workshop flag, the published plan's trips, the driver's own stop records, and
 * whatever the driver's phone last reported. Nothing is measured from the
 * vehicle itself, so nothing here is presented as live (DOMAIN.md, "What the
 * product may claim, and how"). The pure functions come first so the rules can
 * be tested without a database; the loaders below only gather inputs for them.
 */

// ---------------------------------------------------------------------------
// Fleet-day status
// ---------------------------------------------------------------------------

export type VehicleDayState = "AVAILABLE" | "LOADING" | "ON_ROUTE" | "RETURNED" | "IN_WORKSHOP";

/**
 * Where a vehicle is in its day, from the workshop flag and the day's trips.
 *
 * A trip that has actually departed beats the workshop flag: the flag is only
 * editable before publication, so a flagged vehicle that is out on the road is
 * a vehicle that is out on the road, and showing it as "In workshop" would
 * hide a live delivery. Cancelled trips are ignored — they carry no goods.
 *
 *   any trip DEPARTED                          -> ON_ROUTE
 *   workshop flag                              -> IN_WORKSHOP
 *   any trip READY or LOADING                  -> LOADING
 *   at least one trip, every one COMPLETED     -> RETURNED
 *   anything else (no trips, or only PLANNED
 *   trips left, even after a completed one)    -> AVAILABLE
 *
 * "Returned" therefore means done for the day. A van back from trip 1 with
 * trip 2 still to load is available again, not returned.
 */
export function deriveVehicleState(
  dayStatus: "AVAILABLE" | "IN_WORKSHOP",
  tripStatuses: TripStatus[],
): VehicleDayState {
  const live = tripStatuses.filter((s) => s !== "CANCELLED");
  if (live.includes("DEPARTED")) return "ON_ROUTE";
  if (dayStatus === "IN_WORKSHOP") return "IN_WORKSHOP";
  if (live.some((s) => s === "LOADING" || s === "READY")) return "LOADING";
  if (live.length > 0 && live.every((s) => s === "COMPLETED")) return "RETURNED";
  return "AVAILABLE";
}

export interface TripLoad {
  sumVolumeM3: number;
  sumWeightKg: number;
}

/** How full one trip is: whichever of volume or weight binds first. */
export function tripFill(trip: TripLoad, caps: { volumeCapM3: number; weightCapKg: number }): number {
  const volume = caps.volumeCapM3 > 0 ? trip.sumVolumeM3 / caps.volumeCapM3 : 0;
  const weight = caps.weightCapKg > 0 ? trip.sumWeightKg / caps.weightCapKg : 0;
  return Math.max(volume, weight);
}

/**
 * The vehicle's utilisation for the day: the mean over its non-cancelled
 * published-plan trips of max(volume used / volume cap, weight used / weight
 * cap), as a whole percentage clamped to 0–100. Zero when it has no trips.
 *
 * Mean rather than peak, so a van that runs one full trip and one nearly empty
 * one reads as middling — which is what the day's use of it was. Clamped
 * because a trip published over capacity by an override should not draw a bar
 * wider than its track.
 */
export function utilisationPct(
  trips: TripLoad[],
  caps: { volumeCapM3: number; weightCapKg: number },
): number {
  if (trips.length === 0) return 0;
  const mean = trips.reduce((sum, t) => sum + tripFill(t, caps), 0) / trips.length;
  return Math.min(100, Math.max(0, Math.round(mean * 100)));
}

export interface FleetSummary {
  total: number;
  refrigerated: number;
  ambient: number;
  /** Vehicles that can run today: everything not in the workshop, so including those already out or back. */
  available: number;
  /** Vehicles whose status is AVAILABLE: free, with nothing loading or out. */
  idle: number;
  onRoute: number;
  loading: number;
  returned: number;
  inWorkshop: number;
}

export function summariseFleet(vehicles: { temp: "reefer" | "ambient"; status: VehicleDayState }[]): FleetSummary {
  const count = (state: VehicleDayState) => vehicles.filter((v) => v.status === state).length;
  const inWorkshop = count("IN_WORKSHOP");
  return {
    total: vehicles.length,
    refrigerated: vehicles.filter((v) => v.temp === "reefer").length,
    ambient: vehicles.filter((v) => v.temp === "ambient").length,
    available: vehicles.length - inWorkshop,
    idle: count("AVAILABLE"),
    onRoute: count("ON_ROUTE"),
    loading: count("LOADING"),
    returned: count("RETURNED"),
    inWorkshop,
  };
}

// ---------------------------------------------------------------------------
// The map
// ---------------------------------------------------------------------------

/** Behind plan by this much or more is "late"; a few minutes' slip is normal at a dock. */
export const LATE_AFTER_MINUTES = 5;

export type MapState = "ON_TIME" | "LATE" | "RETURNING" | "LAMP" | "NOT_STARTED";

/** A stop that no longer needs the driver: delivered, skipped, or failed. */
export function isStopFinished(status: StopStatus): boolean {
  return status === "DONE" || status === "SKIPPED" || status === "FAILED";
}

/**
 * The map state of a vehicle's current trip.
 *
 * Precedence, strongest first: LAMP > LATE > RETURNING > ON_TIME.
 *  - LAMP: the vehicle has departed and either never reported or its last
 *    report is older than LAMP_AFTER_MINUTES. It outranks everything because
 *    when the report is stale every other state is a guess.
 *  - LATE: lateMinutes >= LATE_AFTER_MINUTES.
 *  - RETURNING: no stop left to serve.
 *  - ON_TIME: otherwise.
 * A trip that has not departed (READY or LOADING) is NOT_STARTED whatever its
 * phone says: it is at the dock, and a missing report there is not an alarm.
 */
export function mapStateOf(input: {
  tripStatus: TripStatus;
  stopStatuses: StopStatus[];
  lateMinutes: number;
  position: Pick<VehiclePosition, "lamp"> | null;
}): MapState {
  if (input.tripStatus !== "DEPARTED") return "NOT_STARTED";
  if (input.position === null || input.position.lamp) return "LAMP";
  if (input.lateMinutes >= LATE_AFTER_MINUTES) return "LATE";
  if (input.stopStatuses.every(isStopFinished)) return "RETURNING";
  return "ON_TIME";
}

const MAP_TRIP_PRIORITY: Partial<Record<TripStatus, number>> = { DEPARTED: 0, READY: 1, LOADING: 2 };

/**
 * Which of a vehicle's trips the map shows: the one out on the road, else the
 * one sealed and waiting, else the one still loading. Completed and planned
 * trips are not on the map.
 */
export function pickMapTrip<T extends { status: TripStatus; tripNo: number }>(trips: T[]): T | null {
  const candidates = trips
    .filter((t) => MAP_TRIP_PRIORITY[t.status] !== undefined)
    .sort(
      (a, b) =>
        (MAP_TRIP_PRIORITY[a.status] ?? 9) - (MAP_TRIP_PRIORITY[b.status] ?? 9) || a.tripNo - b.tripNo,
    );
  return candidates[0] ?? null;
}

/**
 * The trip a driver's ping is filed against: the departed one, else the one
 * sealed and ready, else the one loading, else none.
 *
 * Only the most recent plan day among the candidates counts. A trip left
 * DEPARTED by a day nobody closed out must not outrank today's trip that is
 * merely loading — the ping would be filed against a run that ended days ago.
 */
export function pickPingTrip<T extends { status: TripStatus; planDate: string }>(trips: T[]): T | null {
  const rank: Partial<Record<TripStatus, number>> = { DEPARTED: 0, READY: 1, LOADING: 2 };
  const newest = trips.reduce((max, t) => (t.planDate > max ? t.planDate : max), "");
  const candidates = trips
    .filter((t) => t.planDate === newest && rank[t.status] !== undefined)
    .sort((a, b) => (rank[a.status] ?? 9) - (rank[b.status] ?? 9));
  return candidates[0] ?? null;
}

/** The first stop the driver still has to serve — including the one they are standing at. */
export function nextStopOf<T extends { status: StopStatus; seq: number }>(stops: T[]): T | null {
  return [...stops].sort((a, b) => a.seq - b.seq).find((s) => !isStopFinished(s.status)) ?? null;
}

// ---------------------------------------------------------------------------
// Telemetry rules
// ---------------------------------------------------------------------------

/** A phone clock a little ahead is normal; this far ahead it is wrong, and a wrong timestamp would read as "just now". */
export const FUTURE_TOLERANCE_MINUTES = 5;

export function isTooFarAhead(recordedAt: Date, now: Date): boolean {
  return recordedAt.getTime() > now.getTime() + FUTURE_TOLERANCE_MINUTES * 60_000;
}

/**
 * Who may record which kind of reading. The source says where the gauge was
 * read, so it has to match who was standing there: the bay is the loader's
 * (a dispatcher may stand in for one), arrival is the driver's.
 */
export function chillerSourceAllowed(role: Role, source: ChillerSource): boolean {
  if (source === "LOADER_AT_BAY") return role === "LOADER" || role === "DISPATCHER";
  return role === "DRIVER";
}

export interface ChillerReadingRow {
  tempC: number;
  targetMinC: number;
  targetMaxC: number;
  source: ChillerSource;
  recordedByName: string | null;
  recordedAt: Date;
}

/** A reading as the API shows it. In range is judged against the band stored on the row, not today's policy. */
export function chillerView(row: ChillerReadingRow, now: Date) {
  return {
    tempC: row.tempC,
    targetMinC: row.targetMinC,
    targetMaxC: row.targetMaxC,
    inRange: isInRange(row.tempC, { minC: row.targetMinC, maxC: row.targetMaxC }),
    source: row.source,
    recordedByName: row.recordedByName,
    recordedAt: row.recordedAt.toISOString(),
    ageSeconds: ageSecondsOf(row.recordedAt, now),
  };
}

export function positionView(p: VehiclePosition) {
  return {
    lat: p.lat,
    lng: p.lng,
    accuracyM: p.accuracyM,
    recordedAt: p.recordedAt.toISOString(),
    ageSeconds: p.ageSeconds,
    lamp: p.lamp,
  };
}

// ---------------------------------------------------------------------------
// Loaders
// ---------------------------------------------------------------------------

export function routeLabel(depotCode: string, districtName: string): string {
  return `${depotCode} → ${districtName}`;
}

type DayStatus = "AVAILABLE" | "IN_WORKSHOP";

function vehicleRow(
  vehicle: Pick<Vehicle, "id" | "type" | "temp" | "depotCode" | "volumeCapM3" | "weightCapKg">,
  dayStatus: { status: DayStatus; note: string | null } | undefined,
  trips: (TripLoad & { status: TripStatus })[],
  driverName: string | null,
) {
  const live = trips.filter((t) => t.status !== "CANCELLED");
  return {
    vehicleId: vehicle.id,
    type: vehicle.type,
    temp: vehicle.temp,
    depotCode: vehicle.depotCode,
    volumeCapM3: vehicle.volumeCapM3,
    weightCapKg: vehicle.weightCapKg,
    driverName,
    tripsToday: live.length,
    utilisationPct: utilisationPct(live, vehicle),
    status: deriveVehicleState(
      dayStatus?.status ?? "AVAILABLE",
      live.map((t) => t.status),
    ),
    note: dayStatus?.note ?? null,
  };
}

/** The driver on a vehicle is whoever picked it at the dock: the user whose default vehicle it is. */
async function driverNames(vehicleIds: string[]): Promise<Map<string, string>> {
  const drivers = await prisma.user.findMany({
    where: { role: "DRIVER", defaultVehicleId: { in: vehicleIds } },
    select: { name: true, defaultVehicleId: true },
    orderBy: { name: "asc" },
  });
  const byVehicle = new Map<string, string>();
  for (const d of drivers) {
    if (d.defaultVehicleId && !byVehicle.has(d.defaultVehicleId)) byVehicle.set(d.defaultVehicleId, d.name);
  }
  return byVehicle;
}

const PUBLISHED_FOR = (date: Date, depotCode: string) =>
  ({ status: "PUBLISHED", planningDay: { date, depotCode } }) as const;

export async function loadFleetDay(depotCode: string, date: Date) {
  const [vehicles, statuses, trips] = await Promise.all([
    prisma.vehicle.findMany({ where: { depotCode }, orderBy: { id: "asc" } }),
    prisma.vehicleDayStatus.findMany({ where: { date, vehicle: { depotCode } } }),
    prisma.trip.findMany({
      where: { plan: PUBLISHED_FOR(date, depotCode), status: { not: "CANCELLED" } },
      select: { vehicleId: true, status: true, sumVolumeM3: true, sumWeightKg: true },
    }),
  ]);
  const drivers = await driverNames(vehicles.map((v) => v.id));
  const statusOf = new Map(statuses.map((s) => [s.vehicleId, s]));

  const rows = vehicles.map((v) =>
    vehicleRow(
      v,
      statusOf.get(v.id),
      trips.filter((t) => t.vehicleId === v.id),
      drivers.get(v.id) ?? null,
    ),
  );
  return { depotCode, summary: summariseFleet(rows), vehicles: rows };
}

export async function loadVehicleDetail(
  vehicle: Pick<Vehicle, "id" | "type" | "temp" | "depotCode" | "volumeCapM3" | "weightCapKg">,
  date: Date,
  now: Date,
) {
  const [dayStatus, trips, drivers, reading, positions] = await Promise.all([
    prisma.vehicleDayStatus.findUnique({ where: { date_vehicleId: { date, vehicleId: vehicle.id } } }),
    prisma.trip.findMany({
      where: {
        vehicleId: vehicle.id,
        plan: PUBLISHED_FOR(date, vehicle.depotCode),
        status: { not: "CANCELLED" },
      },
      orderBy: { tripNo: "asc" },
      select: {
        id: true,
        tripNo: true,
        districtName: true,
        plannedDepartAt: true,
        status: true,
        wave: true,
        sumVolumeM3: true,
        sumWeightKg: true,
        stops: { select: { _count: { select: { orders: true } } } },
      },
    }),
    driverNames([vehicle.id]),
    vehicle.temp === "reefer"
      ? prisma.chillerReading.findFirst({
          where: { vehicleId: vehicle.id },
          orderBy: { recordedAt: "desc" },
        })
      : Promise.resolve(null),
    latestPositions([vehicle.id], now),
  ]);
  const position = positions.get(vehicle.id);

  return {
    ...vehicleRow(vehicle, dayStatus ?? undefined, trips, drivers.get(vehicle.id) ?? null),
    trips: trips.map((t) => ({
      tripId: t.id,
      tripNo: t.tripNo,
      route: routeLabel(vehicle.depotCode, t.districtName),
      plannedDepartAt: t.plannedDepartAt,
      stops: t.stops.length,
      orders: t.stops.reduce((sum, s) => sum + s._count.orders, 0),
      status: t.status,
      wave: t.wave,
    })),
    chiller: reading ? chillerView(reading, now) : null,
    position: position ? positionView(position) : null,
  };
}

export async function loadFleetPositions(depotCode: string, date: Date, now: Date) {
  const trips = await prisma.trip.findMany({
    where: {
      plan: PUBLISHED_FOR(date, depotCode),
      status: { in: ["DEPARTED", "READY", "LOADING"] },
    },
    include: {
      stops: {
        orderBy: { seq: "asc" },
        include: { outlet: { select: { id: true, displayName: true, windowOpen: true, windowClose: true } } },
      },
    },
  });

  const byVehicle = new Map<string, typeof trips>();
  for (const trip of trips) byVehicle.set(trip.vehicleId, [...(byVehicle.get(trip.vehicleId) ?? []), trip]);
  const vehicleIds = [...byVehicle.keys()].sort();

  const [drivers, positions] = await Promise.all([driverNames(vehicleIds), latestPositions(vehicleIds, now)]);

  const entries = vehicleIds.flatMap((vehicleId) => {
    const trip = pickMapTrip(byVehicle.get(vehicleId) ?? []);
    if (!trip) return [];
    const position = positions.get(vehicleId) ?? null;
    const next = nextStopOf(trip.stops);
    // Lateness is the slip at the last stop the driver reached. Once nothing
    // is left to serve it describes the past, so a vehicle on its way home is
    // returning, not late.
    const late = next ? lateMinutes(trip.stops) : 0;
    return [
      {
        vehicleId,
        driverName: drivers.get(vehicleId) ?? null,
        state: mapStateOf({
          tripStatus: trip.status,
          stopStatuses: trip.stops.map((s) => s.status),
          lateMinutes: late,
          position,
        }),
        lateMinutes: late,
        trip: { tripId: trip.id, tripNo: trip.tripNo, districtName: trip.districtName },
        position: position ? positionView(position) : null,
        nextStop: next
          ? {
              outletId: next.outletId,
              outletName: next.outlet.displayName ?? next.outlet.id,
              // seq is zero-based (the allocator numbers stops from 0); the person reads "stop 1 of 4".
              stopNumber: trip.stops.indexOf(next) + 1,
              totalStops: trip.stops.length,
              deliveredStops: trip.stops.filter((s) => s.status === "DONE").length,
              eta: estimatedArrival(next.plannedArrivalAt, late),
              windowOpen: next.outlet.windowOpen,
              windowClose: next.outlet.windowClose,
            }
          : null,
      },
    ];
  });

  return {
    date: date.toISOString().slice(0, 10),
    depotCode,
    updatedAt: now.toISOString(),
    summary: {
      all: entries.length,
      late: entries.filter((e) => e.state === "LATE").length,
      lamp: entries.filter((e) => e.state === "LAMP").length,
    },
    vehicles: entries,
  };
}
