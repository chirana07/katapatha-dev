/**
 * Building a plan: screening, ordering the queue, and placing orders.
 *
 * A deterministic greedy. Orders are taken in priority order and each goes where
 * it costs the least road, subject to `checkTrip`. It never decides for itself
 * whether a placement is allowed.
 */

import { latestRoadDeparture } from "@katapatha/core/domain/roadSchedule";
import { windowIsEmpty } from "@katapatha/core/domain/schedule";
import { fromMin } from "@katapatha/core/domain/time";
import { tripMinutes } from "@katapatha/core/domain/tripTime";
import { needsReefer, waveForBrand, type OrderRef, type OutletRef } from "@katapatha/core/domain/types";
import { applyToTrip, checkTrip, type Failure, type TripFigures, type TripSpec } from "./feasibility";
import { byPriority, type PriorityContext } from "./prioritise";
import {
  dockOf,
  ordersOf,
  over,
  tripsOf,
  waveBudget,
  waveEnd,
  waveStart,
  type Context,
  type StopBuild,
  type TripBuild,
} from "./state";
import type { AllocatorVehicle, RejectionCode } from "./types";

// ---------------------------------------------------------------------------
// Phase 0 - structural screening
//
// Separate "nothing you could do today" from "the fleet ran out". A dispatcher
// needs that distinction: the first is a conversation with the brand, the
// second is a conversation about capacity.
// ---------------------------------------------------------------------------

export function screenOrders(ctx: Context): { screened: OrderRef[]; permanentlyDeferred: OrderRef[] } {
  const { input, config, outlets, districts, allowance, ledger } = ctx;
  const screened: OrderRef[] = [];
  const permanentlyDeferred: OrderRef[] = [];

  for (const order of input.orders) {
    const outlet = outlets.get(order.outletId);
    const travel = districts.get(order.district);
    const dock = dockOf(ctx, order.outletId);

    // An order for another depot cannot be planned in this depot's run.
    if (!outlet || !travel || !dock || order.depot !== input.depot) {
      ledger.record(order.ref, { code: "WRONG_DEPOT" });
      permanentlyDeferred.push(order);
      continue;
    }

    // Which vehicles could ever take this, ignoring today's availability?
    const compatible = input.vehicles.filter(
      (v) =>
        v.depot === order.depot &&
        (!needsReefer(order.tempRequirement) || v.temp === "reefer") &&
        (outlet.parkingConstraint !== "van_only" || v.type === "van"),
    );

    if (compatible.length === 0) {
      const code: RejectionCode = needsReefer(order.tempRequirement)
        ? "NO_REEFER_IN_FLEET"
        : outlet.parkingConstraint === "van_only"
          ? "NO_VAN_IN_FLEET"
          : "WRONG_DEPOT";
      ledger.record(order.ref, { code });
      permanentlyDeferred.push(order);
      continue;
    }

    const biggestVolume = Math.max(...compatible.map((v) => v.volumeCapM3));
    const biggestWeight = Math.max(...compatible.map((v) => v.weightCapKg));
    if (over(order.volumeM3, biggestVolume) || over(order.weightKg, biggestWeight)) {
      ledger.record(order.ref, {
        code: "ORDER_EXCEEDS_FLEET_CAPACITY",
        metric: over(order.volumeM3, biggestVolume)
          ? { name: "volume", have: order.volumeM3, limit: biggestVolume, unit: "m3" }
          : { name: "weight", have: order.weightKg, limit: biggestWeight, unit: "kg" },
      });
      permanentlyDeferred.push(order);
      continue;
    }

    // Even alone on an empty vehicle, can this district be served in the wave?
    const soloMinutes = tripMinutes(travel, order.brand, [dock], allowance);
    const wave = waveForBrand(order.brand);
    const budget = waveBudget(config, wave);
    if (over(soloMinutes, budget)) {
      ledger.record(order.ref, {
        code: "DISTRICT_UNREACHABLE_IN_BUDGET",
        metric: { name: "minutes", have: soloMinutes, limit: budget, unit: "min" },
      });
      permanentlyDeferred.push(order);
      continue;
    }

    // An outlet whose own window and its mall's never overlap is never open.
    if (windowIsEmpty(outlet)) {
      ledger.record(order.ref, { code: "NO_COMMON_WINDOW" });
      permanentlyDeferred.push(order);
      continue;
    }

    // Alone on the road, leaving as early as the wave allows, can the vehicle
    // reach it inside its window, and for Fresh before stores open? If not, no
    // day and no arrangement can serve it.
    const solo = [{ outletId: order.outletId, docks: [dock] }];
    const reach = (freshDeadline: typeof config.freshDeadline) =>
      latestRoadDeparture(input.depot, order.brand, solo, outlets, ctx.matrix, allowance, waveStart(config, wave), waveEnd(config, wave), {
        freshDeadline,
      });
    if (reach(config.freshDeadline) === null) {
      const withoutDeadline = reach(null);
      ledger.record(order.ref, {
        code: withoutDeadline === null ? "OUTLET_UNREACHABLE_IN_WINDOW" : "FRESH_DEADLINE_UNREACHABLE",
      });
      permanentlyDeferred.push(order);
      continue;
    }

    // Availability is a today problem, not a structural one: note it for the
    // explanation, but let the order compete.
    const availableCompatible = compatible.filter((v) => v.available);
    if (availableCompatible.length === 0) {
      for (const v of compatible) ledger.record(order.ref, { code: "VEHICLE_IN_WORKSHOP", vehicleId: v.vehicleId });
      ledger.record(order.ref, {
        code: needsReefer(order.tempRequirement)
          ? "NO_REEFER_AVAILABLE"
          : outlet.parkingConstraint === "van_only"
            ? "NO_VAN_AVAILABLE"
            : "NO_TRIP_SLOT",
      });
      permanentlyDeferred.push(order);
      continue;
    }

    screened.push(order);
  }

  return { screened, permanentlyDeferred };
}

// ---------------------------------------------------------------------------
// Phases 1 and 2 - the queue
// ---------------------------------------------------------------------------

/**
 * The order in which orders are placed.
 *
 *  1. Priority band. An outlet that was deferred yesterday, or has gone three
 *     days or more unserved, is placed before everyone else. Scarce vehicles
 *     must never be spent in a way that locks such an outlet out, and the
 *     fairness policy is written to say it comes first.
 *  2. Within a band, constrained goods first, across every lane. Peliyagoda has
 *     three reefer trucks and one reefer van on the hero day; if a lane of
 *     ambient Fresh work happens to grab a reefer first, the chilled orders that
 *     can go nowhere else are locked out. Chilled and frozen ahead of ambient,
 *     and van-only ahead of the rest, spends the scarce vehicles on the work
 *     only they can do.
 *  3. Then the priority score, which is the lane and size order inside each tier.
 *
 * Rule 1 (one brand, one district per trip) makes a lane the unit a trip is
 * built from, so orders are first grouped into lanes and ranked within them.
 */
export function orderQueue(ctx: Context, screened: readonly OrderRef[]): OrderRef[] {
  const maxVolumeCapM3 = Math.max(0, ...ctx.input.vehicles.map((v) => v.volumeCapM3));
  const priorityCtx: PriorityContext = { outlets: ctx.outlets, maxVolumeCapM3 };
  const compare = byPriority(priorityCtx);

  const lanes = new Map<string, OrderRef[]>();
  for (const order of screened) {
    const key = `${order.brand}|${order.district}`;
    const list = lanes.get(key);
    if (list) list.push(order);
    else lanes.set(key, [order]);
  }
  for (const list of lanes.values()) list.sort(compare);
  const laneOrder = [...lanes.entries()].sort((a, b) => {
    const diff = compare(a[1][0]!, b[1][0]!);
    return diff !== 0 ? diff : a[0].localeCompare(b[0]);
  });

  const queue: OrderRef[] = [];
  for (const [, laneOrders] of laneOrder) queue.push(...laneOrders);

  const needsVan = (o: OrderRef) => ctx.outlets.get(o.outletId)?.parkingConstraint === "van_only";
  const tier = (o: OrderRef): number => {
    const cold = needsReefer(o.tempRequirement);
    const van = needsVan(o);
    if (cold && van) return 0; // only a reefer van will do
    if (cold) return 1;
    if (van) return 2;
    return 3;
  };
  const band = (o: OrderRef): number => (o.deferredYesterday ? 2 : 0) + (o.daysSinceLastServed >= 3 ? 1 : 0);

  // A stable sort keeps the lane and priority ordering inside each band and tier.
  return [...queue].sort((a, b) => band(b) - band(a) || tier(a) - tier(b));
}

// ---------------------------------------------------------------------------
// Phases 3 and 4 - placing
// ---------------------------------------------------------------------------

export const specOf = (trip: TripBuild, stops: readonly StopBuild[]): TripSpec => ({
  vehicle: trip.vehicle,
  brand: trip.brand,
  district: trip.district,
  wave: trip.wave,
  travel: trip.travel,
  stops,
});

/**
 * Every way to put `order` into a trip's stops. At an outlet the trip already
 * visits it joins that stop (a stop is where an outlet is served, whatever the
 * number of orders); otherwise it can go at any of the n + 1 places in the route.
 */
function stopOptions(stops: readonly StopBuild[], order: OrderRef): StopBuild[][] {
  return insertStop(stops, { outletId: order.outletId, orders: [order] });
}

/** The same for a whole stop (an outlet and all its orders on a trip), as when one is moved. */
export function insertStop(stops: readonly StopBuild[], stop: StopBuild): StopBuild[][] {
  const at = stops.findIndex((s) => s.outletId === stop.outletId);
  if (at >= 0) {
    return [stops.map((s, i) => (i === at ? { outletId: s.outletId, orders: [...s.orders, ...stop.orders] } : s))];
  }
  const options: StopBuild[][] = [];
  for (let i = 0; i <= stops.length; i += 1) {
    options.push([...stops.slice(0, i), { outletId: stop.outletId, orders: [...stop.orders] }, ...stops.slice(i)]);
  }
  return options;
}

interface Insertion {
  spec: TripSpec;
  figures: TripFigures;
}

/**
 * The best place in `trip` for `order`: the feasible position that adds the
 * fewest road kilometres, then the least waiting, then the earliest position.
 * When none is feasible, the failure that got furthest through the checks.
 */
function bestInsertion(ctx: Context, trip: TripBuild, order: OrderRef): Insertion | { failure: Failure } {
  let best: Insertion | null = null;
  let furthest: Failure | null = null;

  stopOptions(trip.stops, order).forEach((stops) => {
    const spec = specOf(trip, stops);
    const check = checkTrip(ctx, spec, trip);
    if (!check.ok) {
      if (!furthest || check.failure.stage > furthest.stage) furthest = check.failure;
      return;
    }
    const f = check.figures;
    const better =
      !best ||
      f.roadKm < best.figures.roadKm - 1e-9 ||
      (Math.abs(f.roadKm - best.figures.roadKm) <= 1e-9 && f.road.waitMin < best.figures.road.waitMin);
    if (better) best = { spec, figures: f };
  });

  return best ?? { failure: furthest! };
}

/**
 * How wasteful it would be to give this order to this vehicle. Lower is
 * better. A reefer carrying ambient goods, or a van carrying a load any truck
 * could take, burns capacity that something else genuinely needs.
 */
export function scarcity(v: AllocatorVehicle, order: OrderRef, outlet: OutletRef): number {
  let cost = 0;
  if (v.temp === "reefer" && !needsReefer(order.tempRequirement)) cost += 2;
  if (v.type === "van" && outlet.parkingConstraint !== "van_only") cost += 1;
  return cost;
}

/** Cheap compatibility gate, before any arithmetic. */
function canHost(ctx: Context, v: AllocatorVehicle, order: OrderRef, outlet: OutletRef): boolean {
  if (v.depot !== order.depot) {
    ctx.ledger.record(order.ref, { code: "WRONG_DEPOT", vehicleId: v.vehicleId });
    return false;
  }
  // Compatibility before availability: a vehicle that could never carry this
  // order is not part of its story, so its workshop status must not appear in
  // the explanation (an ambient van "in the workshop" is noise for a chilled order).
  if (needsReefer(order.tempRequirement) && v.temp !== "reefer") return false;
  if (outlet.parkingConstraint === "van_only" && v.type !== "van") return false;
  if (!v.available) {
    ctx.ledger.record(order.ref, { code: "VEHICLE_IN_WORKSHOP", vehicleId: v.vehicleId });
    return false;
  }
  return true;
}

function addToTrip(ctx: Context, trip: TripBuild, order: OrderRef, outlet: OutletRef): boolean {
  const v = trip.vehicle;
  if (needsReefer(order.tempRequirement) && v.temp !== "reefer") return false;
  if (outlet.parkingConstraint === "van_only" && v.type !== "van") return false;

  const found = bestInsertion(ctx, trip, order);
  if ("failure" in found) {
    ctx.ledger.record(order.ref, found.failure.rejection);
    return false;
  }
  applyToTrip(trip, found.spec, found.figures);
  return true;
}

function openTrip(ctx: Context, v: AllocatorVehicle, order: OrderRef, travel: TripBuild["travel"]): boolean {
  const existing = tripsOf(ctx, v.vehicleId);
  if (existing.length >= ctx.config.maxTripsPerVehicle) {
    ctx.ledger.record(order.ref, { code: "NO_TRIP_SLOT", vehicleId: v.vehicleId });
    return false;
  }

  const spec: TripSpec = {
    vehicle: v,
    brand: order.brand,
    district: order.district,
    wave: waveForBrand(order.brand),
    travel,
    stops: [{ outletId: order.outletId, orders: [order] }],
  };
  const check = checkTrip(ctx, spec, null);
  if (!check.ok) {
    ctx.ledger.record(order.ref, check.failure.rejection);
    return false;
  }

  const f = check.figures;
  ctx.trips.push({
    id: ctx.nextTripId++,
    vehicle: v,
    tripNo: (existing.length + 1) as TripBuild["tripNo"],
    brand: spec.brand,
    district: spec.district,
    wave: spec.wave,
    travel,
    stops: spec.stops.map((s) => ({ outletId: s.outletId, orders: [...s.orders] })),
    minutes: f.minutes,
    fuelL: f.fuelL,
    roadKm: f.roadKm,
    volumeM3: f.volumeM3,
    weightKg: f.weightKg,
    latestDepartMin: f.latestDepartMin,
    departAt: fromMin(f.latestDepartMin),
    road: f.road,
  });
  return true;
}

/** Try to add `order` to an existing trip, then to open a new one. */
export function tryPlace(ctx: Context, order: OrderRef): boolean {
  const outlet = ctx.outlets.get(order.outletId);
  const travel = ctx.districts.get(order.district);
  if (!outlet || !travel) return false;

  // Existing trips in the same lane, tightest remaining volume first:
  // consolidating saves the whole fixed outbound leg, the biggest single win
  // available to a greedy allocator.
  const sameLane = ctx.trips
    .filter((t) => t.brand === order.brand && t.district === order.district)
    .sort(
      (a, b) =>
        scarcity(a.vehicle, order, outlet) - scarcity(b.vehicle, order, outlet) ||
        a.vehicle.volumeCapM3 - a.volumeM3 - (b.vehicle.volumeCapM3 - b.volumeM3) ||
        a.vehicle.vehicleId.localeCompare(b.vehicle.vehicleId) ||
        a.id - b.id,
    );
  for (const trip of sameLane) {
    if (addToTrip(ctx, trip, order, outlet)) return true;
  }

  // Otherwise open a new trip on the best candidate.
  const compatible = ctx.input.vehicles.filter((v) => canHost(ctx, v, order, outlet));
  const candidates = [...compatible].sort((a, b) => {
    // Never spend a scarce vehicle on work an ordinary one can do.
    const scarceA = scarcity(a, order, outlet);
    const scarceB = scarcity(b, order, outlet);
    if (scarceA !== scarceB) return scarceA - scarceB;

    // Tightest fit next, so the 38 m3 trucks stay free for the big lanes, then
    // whichever has the most fuel headroom left this week.
    const fitA = a.volumeCapM3 - order.volumeM3;
    const fitB = b.volumeCapM3 - order.volumeM3;
    if (Math.abs(fitA - fitB) > 1e-9) return fitA - fitB;
    const fuelA = fuelLeft(ctx, a.vehicleId);
    const fuelB = fuelLeft(ctx, b.vehicleId);
    if (Math.abs(fuelA - fuelB) > 1e-9) return fuelB - fuelA;
    return a.vehicleId.localeCompare(b.vehicleId);
  });
  for (const vehicle of candidates) {
    if (openTrip(ctx, vehicle, order, travel)) return true;
  }

  // Nothing took it. Say which scarce resource ran out, rather than leaving the
  // explanation to whichever capacity check happened to fire last.
  if (compatible.length > 0) {
    if (needsReefer(order.tempRequirement)) ctx.ledger.record(order.ref, { code: "NO_REEFER_AVAILABLE" });
    else if (outlet.parkingConstraint === "van_only") ctx.ledger.record(order.ref, { code: "NO_VAN_AVAILABLE" });
  }
  return false;
}

/** Litres a vehicle has left this week, counting what its trips so far will burn. */
function fuelLeft(ctx: Context, vehicleId: string): number {
  const s = ctx.vehicleState.get(vehicleId)!;
  return s.quotaL - s.committedOtherDaysL - tripsOf(ctx, vehicleId).reduce((n, t) => n + t.fuelL, 0);
}

// ---------------------------------------------------------------------------
// Phase 5b - the fairness swap
// ---------------------------------------------------------------------------

/**
 * Give a previously-skipped order someone else's place: find a served order in
 * the same lane that was served yesterday and is no smaller, drop it, and put
 * this one in. The displaced order inherits a clear reason. The swapped trip
 * must pass every check a newly built one would, fuel and the vehicle's day
 * included.
 */
export function trySwapIn(ctx: Context, order: OrderRef): OrderRef | null {
  if (!ctx.outlets.get(order.outletId)) return null;

  const sameLane = ctx.trips.filter((t) => t.brand === order.brand && t.district === order.district);
  for (const trip of sameLane) {
    const victims = ordersOf(trip)
      .filter(
        (o) =>
          !o.deferredYesterday &&
          o.daysSinceLastServed <= 1 &&
          o.volumeM3 + 1e-9 >= order.volumeM3 &&
          o.weightKg + 1e-9 >= order.weightKg &&
          o.outletId !== order.outletId,
      )
      .sort((a, b) => a.volumeM3 - b.volumeM3 || a.ref.localeCompare(b.ref));

    for (const victim of victims) {
      const kept = trip.stops
        .map((s) => ({ outletId: s.outletId, orders: s.orders.filter((o) => o.ref !== victim.ref) }))
        .filter((s) => s.orders.length > 0);

      let best: { spec: TripSpec; figures: TripFigures } | null = null;
      for (const stops of stopOptions(kept, order)) {
        const spec = specOf(trip, stops);
        const check = checkTrip(ctx, spec, trip);
        if (!check.ok) continue;
        if (!best || check.figures.roadKm < best.figures.roadKm - 1e-9) best = { spec, figures: check.figures };
      }
      if (!best) continue;

      applyToTrip(trip, best.spec, best.figures);
      ctx.ledger.clear(order.ref);
      ctx.ledger.record(victim.ref, { code: "YIELDED_TO_HIGHER_PRIORITY", vehicleId: trip.vehicle.vehicleId });
      return victim;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// The whole of construction
// ---------------------------------------------------------------------------

/** Phases 3 to 5: place the queue, repair, and try the fairness swap. */
export function buildPlan(ctx: Context, queue: readonly OrderRef[]): OrderRef[] {
  const unplaced: OrderRef[] = [];
  for (const order of queue) {
    if (!tryPlace(ctx, order)) unplaced.push(order);
  }

  // 5a. A trip built later in a lane may have room an earlier rejection missed.
  const stillUnplaced: OrderRef[] = [];
  for (const order of unplaced) {
    if (tryPlace(ctx, order)) ctx.ledger.clear(order.ref);
    else stillUnplaced.push(order);
  }

  // 5b. The fairness swap. Without this the priority policy is decorative: the
  // greedy first pass has already consumed the capacity by the time a
  // previously-skipped order is found to be unplaceable.
  const finalUnplaced: OrderRef[] = [];
  if (ctx.config.enableFairnessSwap) {
    for (const order of stillUnplaced) {
      if (!order.deferredYesterday) {
        finalUnplaced.push(order);
        continue;
      }
      const victim = trySwapIn(ctx, order);
      if (victim) finalUnplaced.push(victim);
      else finalUnplaced.push(order);
    }
  } else {
    finalUnplaced.push(...stillUnplaced);
  }
  return finalUnplaced;
}

