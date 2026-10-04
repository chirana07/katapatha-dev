/**
 * Every hard constraint on a trip, in one place.
 *
 * Nothing that grows a plan (opening a trip, inserting a stop, swapping an
 * order in) decides for itself whether the result is allowed. It builds the
 * candidate trip and asks `checkTrip`, which is the only code that knows the
 * rules, so they cannot drift apart between the places that apply them. The
 * validator then checks the finished plan against the same rules from the other
 * side.
 *
 * Checks run in a fixed order and stop at the first failure, so the ledger
 * records one clear reason per candidate. The order is cheapest first and
 * position-independent first: capacity, then the organisers' time budget, then
 * fuel, then the things that depend on where in the trip a stop sits (the
 * windows, then the vehicle's whole day).
 *
 * Constraint, and where it is enforced:
 *   chilled and frozen only on a reefer; van-only outlets only on a van; the
 *   home depot; availability     the callers' `canHost`, before a trip exists
 *   at most two trips a day      `openTrip`, before a trip exists
 *   volume and weight            here
 *   the 270 / 480 minute waves   here, on the organisers' district table
 *   weekly fuel, from the road   here
 *   windows, mall windows, and Fresh in before 08:00, on the road   here
 *   trip two after trip one returns, with time to reload            here
 */

import {
  computeRoadSchedule,
  latestRoadDeparture,
  roadKmOf,
  type RoadSchedule,
  type RoadStopInput,
} from "@katapatha/core/domain/roadSchedule";
import { fromMin, toMin } from "@katapatha/core/domain/time";
import { tripMinutes } from "@katapatha/core/domain/tripTime";
import type { Brand, DistrictTravel, TripNo, Wave } from "@katapatha/core/domain/types";
import { scheduleVehicleDay, type VehicleDayTrip } from "@katapatha/core/domain/vehicleDay";
import {
  dockOf,
  over,
  tripsOf,
  waveBudget,
  waveEnd,
  waveStart,
  type Context,
  type StopBuild,
  type TripBuild,
} from "./state";
import type { AllocatorVehicle, Rejection } from "./types";

/** A trip as it would be, before it exists: who drives it and what it visits, in order. */
export interface TripSpec {
  vehicle: AllocatorVehicle;
  brand: Brand;
  district: string;
  wave: Wave;
  travel: DistrictTravel;
  stops: readonly StopBuild[];
}

export interface TripFigures {
  minutes: number;
  fuelL: number;
  roadKm: number;
  volumeM3: number;
  weightKg: number;
  latestDepartMin: number;
  road: RoadSchedule;
}

export interface Failure {
  rejection: Rejection;
  /** How far down the checks it got. A higher stage is a closer miss. */
  stage: number;
}

export type Check = { ok: true; figures: TripFigures } | { ok: false; failure: Failure };

const fail = (stage: number, rejection: Rejection): Check => ({ ok: false, failure: { stage, rejection } });

export const roadStopsOf = (ctx: Context, stops: readonly StopBuild[]): RoadStopInput[] =>
  stops.map((s) => ({ outletId: s.outletId, docks: s.orders.map(() => dockOf(ctx, s.outletId)!) }));

/** A trip as the vehicle-day sequencer sees it: a window to leave in, and a way home that depends on when. */
function dayTrip(
  ctx: Context,
  id: string,
  vehicle: AllocatorVehicle,
  brand: Brand,
  wave: Wave,
  stops: readonly StopBuild[],
  latestDepartMin: number,
): VehicleDayTrip {
  const roadStops = roadStopsOf(ctx, stops);
  return {
    id,
    earliest: toMin(waveStart(ctx.config, wave)),
    latest: latestDepartMin,
    returnAt: (departMin) =>
      computeRoadSchedule(fromMin(departMin), vehicle.depot, brand, roadStops, ctx.outlets, ctx.matrix, ctx.allowance, {
        freshDeadline: ctx.config.freshDeadline,
      }).returnMin,
  };
}

export const dayTripOfBuild = (ctx: Context, t: TripBuild) =>
  dayTrip(ctx, String(t.id), t.vehicle, t.brand, t.wave, t.stops, t.latestDepartMin);

/**
 * Whether `spec` is a trip this vehicle may run, given the vehicle's other
 * trips. `replacing` is the existing trip the candidate would take the place
 * of (an order added to it, a stop moved within it), so it is not counted twice.
 */
export function checkTrip(ctx: Context, spec: TripSpec, replacing: TripBuild | null): Check {
  ctx.evaluations += 1;
  const { vehicle: v, brand, wave, travel, stops } = spec;
  const id = v.vehicleId;
  const orders = stops.flatMap((s) => s.orders);

  const volumeM3 = orders.reduce((n, o) => n + o.volumeM3, 0);
  if (over(volumeM3, v.volumeCapM3)) {
    return fail(0, {
      code: "VOLUME_CAP_EXCEEDED",
      vehicleId: id,
      metric: { name: "volume", have: volumeM3, limit: v.volumeCapM3, unit: "m3" },
    });
  }
  const weightKg = orders.reduce((n, o) => n + o.weightKg, 0);
  if (over(weightKg, v.weightCapKg)) {
    return fail(1, {
      code: "WEIGHT_CAP_EXCEEDED",
      vehicleId: id,
      metric: { name: "weight", have: weightKg, limit: v.weightCapKg, unit: "kg" },
    });
  }

  // The organisers' measure of how long the trip takes, from their district
  // table. It is what their checker applies, so it stays the budget test.
  const docks = stops.flatMap((s) => s.orders.map(() => dockOf(ctx, s.outletId)!));
  const minutes = tripMinutes(travel, brand, docks, ctx.allowance);
  const others = tripsOf(ctx, id, replacing);
  const waveUsed = others.filter((t) => t.wave === wave).reduce((n, t) => n + t.minutes, 0) + minutes;
  const budget = waveBudget(ctx.config, wave);
  if (over(waveUsed, budget)) {
    return fail(2, {
      code: wave === "PREDAWN" ? "PREDAWN_BUDGET_EXCEEDED" : "DAYTIME_BUDGET_EXCEEDED",
      vehicleId: id,
      metric: { name: "minutes", have: waveUsed, limit: budget, unit: "min" },
    });
  }

  // Fuel is burned on the road, so it is the road's distance, the way home included.
  const outletIds = stops.map((s) => s.outletId);
  const roadKm = roadKmOf(v.depot, outletIds, ctx.matrix);
  const fuelL = roadKm / v.kmPerL;
  if (ctx.config.enforceFuelQuota) {
    const s = ctx.vehicleState.get(id)!;
    const week = s.committedOtherDaysL + others.reduce((n, t) => n + t.fuelL, 0) + fuelL;
    if (over(week, s.quotaL)) {
      return fail(3, {
        code: "FUEL_QUOTA_EXCEEDED",
        vehicleId: id,
        metric: { name: "fuel", have: week, limit: s.quotaL, unit: "L" },
      });
    }
  }

  // Every stop inside its window (the overlap of an outlet's own and its
  // mall's), and Fresh in before stores open, with the stops in this order.
  const roadStops = roadStopsOf(ctx, stops);
  const latest = latestRoadDeparture(
    v.depot,
    brand,
    roadStops,
    ctx.outlets,
    ctx.matrix,
    ctx.allowance,
    waveStart(ctx.config, wave),
    waveEnd(ctx.config, wave),
    { freshDeadline: ctx.config.freshDeadline },
  );
  if (latest === null) return fail(4, { code: "WINDOW_UNREACHABLE", vehicleId: id });
  const latestDepartMin = toMin(latest);

  // One vehicle cannot be on two roads at once. The trips it already has, and
  // this one, must fit end to end with time to unload and reload between.
  const day = scheduleVehicleDay(
    [...others.map((t) => dayTripOfBuild(ctx, t)), dayTrip(ctx, "candidate", v, brand, wave, stops, latestDepartMin)],
    ctx.config.reloadMin,
  );
  if (day === null) return fail(5, { code: "TRIP_SEQUENCE_CONFLICT", vehicleId: id });

  const road = computeRoadSchedule(latest, v.depot, brand, roadStops, ctx.outlets, ctx.matrix, ctx.allowance, {
    freshDeadline: ctx.config.freshDeadline,
  });
  return { ok: true, figures: { minutes, fuelL, roadKm, volumeM3, weightKg, latestDepartMin, road } };
}

/** Make a trip be what `spec` says, with the figures `checkTrip` worked out. */
export function applyToTrip(trip: TripBuild, spec: TripSpec, figures: TripFigures): void {
  trip.vehicle = spec.vehicle;
  trip.stops = spec.stops.map((s) => ({ outletId: s.outletId, orders: [...s.orders] }));
  trip.minutes = figures.minutes;
  trip.fuelL = figures.fuelL;
  trip.roadKm = figures.roadKm;
  trip.volumeM3 = figures.volumeM3;
  trip.weightKg = figures.weightKg;
  trip.latestDepartMin = figures.latestDepartMin;
  trip.departAt = fromMin(figures.latestDepartMin);
  trip.road = figures.road;
}

/**
 * Fix each vehicle's actual departures once the plan is built.
 *
 * While building, a trip only knows the latest it could leave. Now each
 * vehicle's trips are laid end to end on its day, each as late as it can go
 * with time to reload between, and numbered 1 and 2 in the order they run. The
 * checks above guarantee this succeeds; if it somehow did not, trips keep their
 * own latest departure and the validator reports the overlap rather than the
 * plan being quietly wrong.
 */
export function assignDepartures(ctx: Context): void {
  const byVehicle = new Map<string, TripBuild[]>();
  for (const t of ctx.trips) {
    const list = byVehicle.get(t.vehicle.vehicleId) ?? [];
    list.push(t);
    byVehicle.set(t.vehicle.vehicleId, list);
  }

  for (const trips of byVehicle.values()) {
    const day = scheduleVehicleDay(trips.map((t) => dayTripOfBuild(ctx, t)), ctx.config.reloadMin);
    const order = day ? day.order : trips.map((t) => String(t.id));
    for (const trip of trips) {
      const departMin = day?.departs.get(String(trip.id)) ?? trip.latestDepartMin;
      trip.tripNo = (order.indexOf(String(trip.id)) + 1) as TripNo;
      trip.departAt = fromMin(departMin);
      trip.road = computeRoadSchedule(
        trip.departAt,
        trip.vehicle.depot,
        trip.brand,
        roadStopsOf(ctx, trip.stops),
        ctx.outlets,
        ctx.matrix,
        ctx.allowance,
        { freshDeadline: ctx.config.freshDeadline },
      );
    }
  }
}
