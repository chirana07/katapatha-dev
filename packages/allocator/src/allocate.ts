/**
 * The allocator.
 *
 * Deterministic greedy, priority-first, best-fit within a lane. It never
 * trusts itself: phase 6 runs the shared validator over its own output, so
 * auto-plan output that reaches a dispatcher has already been checked against
 * the same rules the organisers check.
 *
 * Complexity is comfortable — at most 36 lanes (12 districts x 3 brands),
 * roughly 85 to 160 orders and 38 vehicles, so a few tens of thousands of
 * predicate evaluations. It runs in single-digit milliseconds, which is why
 * re-running it can be an ordinary button rather than a background job.
 */

import { latestFeasibleDeparture, computeStopSchedule } from "@katapatha/core/domain/schedule";
import { toMin } from "@katapatha/core/domain/time";
import { tripDistanceKm, tripMinutes } from "@katapatha/core/domain/tripTime";
import {
  TOLERANCE,
  budgetForWave,
  waveForBrand,
  type Brand,
  type ClockTime,
  type DistrictTravel,
  type DockType,
  type OrderRef,
  type OutletRef,
  type TripNo,
  type Wave,
} from "@katapatha/core/domain/types";
import { validatePlan } from "@katapatha/core/validation/rules";
import { DEFAULT_PLAN_CONFIG, type PlanSnapshot } from "@katapatha/core/validation/types";
import { byPriority, type PriorityContext } from "./prioritise";
import { RejectionLedger } from "./rejection";
import {
  DEFAULT_ALLOCATOR_CONFIG,
  type AllocatedStop,
  type AllocatedTrip,
  type AllocatorConfig,
  type AllocatorInput,
  type AllocatorOutput,
  type AllocatorVehicle,
  type DeferredOrder,
  type RejectionCode,
  type VehicleMeter,
} from "./types";

// ---------------------------------------------------------------------------
// Mutable working state
// ---------------------------------------------------------------------------

interface TripBuild {
  vehicle: AllocatorVehicle;
  tripNo: TripNo;
  brand: Brand;
  district: string;
  wave: Wave;
  travel: DistrictTravel;
  orders: OrderRef[];
  minutes: number;
  fuelL: number;
  volumeM3: number;
  weightKg: number;
  departAt: ClockTime;
}

interface VehicleState {
  vehicle: AllocatorVehicle;
  tripsUsed: number;
  predawnMin: number;
  daytimeMin: number;
  fuelL: number;
  quotaL: number;
  committedOtherDaysL: number;
}

/** `a > b` with the organisers' slack, so exactly-at-cap fits. */
const over = (have: number, limit: number) => have > limit + TOLERANCE;

// ---------------------------------------------------------------------------

export function allocate(input: AllocatorInput): AllocatorOutput {
  const config: AllocatorConfig = { ...DEFAULT_ALLOCATOR_CONFIG, ...input.config };
  const { outlets, districts, allowance } = input;
  const ledger = new RejectionLedger();

  const maxVolumeCapM3 = Math.max(0, ...input.vehicles.map((v) => v.volumeCapM3));
  const priorityCtx: PriorityContext = { outlets, maxVolumeCapM3 };

  const state = new Map<string, VehicleState>();
  for (const v of input.vehicles) {
    const fuel = input.fuel.get(v.vehicleId);
    state.set(v.vehicleId, {
      vehicle: v,
      tripsUsed: 0,
      predawnMin: 0,
      daytimeMin: 0,
      fuelL: 0,
      quotaL: fuel?.quotaL ?? v.weeklyFuelQuotaL,
      committedOtherDaysL: fuel?.committedOtherDaysL ?? 0,
    });
  }

  const dockOf = (outletId: string): DockType | null =>
    outlets.get(outletId)?.dockType ?? null;

  // =========================================================================
  // Phase 0 — structural screening
  //
  // Separate "nothing you could do today" from "the fleet ran out". A
  // dispatcher needs that distinction: the first is a conversation with the
  // brand, the second is a conversation about capacity.
  // =========================================================================

  const screened: OrderRef[] = [];
  const permanentlyDeferred: OrderRef[] = [];

  for (const order of input.orders) {
    const outlet = outlets.get(order.outletId);
    const travel = districts.get(order.district);
    const dock = dockOf(order.outletId);

    if (!outlet || !travel || !dock) {
      ledger.record(order.ref, { code: "WRONG_DEPOT" });
      permanentlyDeferred.push(order);
      continue;
    }

    // Which vehicles could ever take this, ignoring today's availability?
    const compatible = input.vehicles.filter(
      (v) =>
        v.depot === order.depot &&
        (order.tempRequirement !== "chilled" || v.temp === "reefer") &&
        (outlet.parkingConstraint !== "van_only" || v.type === "van"),
    );

    if (compatible.length === 0) {
      const code: RejectionCode =
        order.tempRequirement === "chilled"
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
    const budget =
      wave === "PREDAWN" ? config.predawnBudget : config.daytimeBudget;
    if (over(soloMinutes, budget)) {
      ledger.record(order.ref, {
        code: "DISTRICT_UNREACHABLE_IN_BUDGET",
        metric: { name: "minutes", have: soloMinutes, limit: budget, unit: "min" },
      });
      permanentlyDeferred.push(order);
      continue;
    }

    // Availability is a today problem, not a structural one — note it for the
    // explanation, but let the order compete.
    const availableCompatible = compatible.filter((v) => v.available);
    if (availableCompatible.length === 0) {
      for (const v of compatible) {
        ledger.record(order.ref, { code: "VEHICLE_IN_WORKSHOP", vehicleId: v.vehicleId });
      }
      ledger.record(order.ref, {
        code:
          order.tempRequirement === "chilled"
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

  // =========================================================================
  // Phase 1 — lane formation. Rule 1 (one brand, one district per trip) makes
  // a lane the atomic unit of a trip, so this is not an optimisation but the
  // shape of the problem.
  // =========================================================================

  const lanes = new Map<string, OrderRef[]>();
  for (const order of screened) {
    const key = `${order.brand}|${order.district}`;
    const list = lanes.get(key);
    if (list) list.push(order);
    else lanes.set(key, [order]);
  }

  // Phase 2 — priority, within a lane and between lanes.
  const compare = byPriority(priorityCtx);
  for (const list of lanes.values()) list.sort(compare);

  const laneOrder = [...lanes.entries()].sort((a, b) => {
    const aTop = a[1][0];
    const bTop = b[1][0];
    const diff = compare(aTop, bTop);
    return diff !== 0 ? diff : a[0].localeCompare(b[0]);
  });

  // =========================================================================
  // Phases 3 and 4 — build trips, lane by lane.
  // =========================================================================

  const trips: TripBuild[] = [];
  const unplaced: OrderRef[] = [];

  // Constrained goods first, ACROSS every lane rather than within one.
  //
  // This matters more than it looks. Peliyagoda has three reefer trucks and a
  // single reefer van available on the hero day. If a lane of ambient Fresh
  // work is processed first and happens to grab a reefer, the chilled orders
  // that physically cannot go anywhere else are already locked out. Ordering
  // chilled ahead of ambient globally — and van-only ahead of the rest —
  // spends the scarce vehicles on the work only they can do.
  const queue: OrderRef[] = [];
  for (const [, laneOrders] of laneOrder) queue.push(...laneOrders);

  const needsVan = (o: OrderRef) =>
    outlets.get(o.outletId)?.parkingConstraint === "van_only";
  const tier = (o: OrderRef): number => {
    const chilled = o.tempRequirement === "chilled";
    const van = needsVan(o);
    if (chilled && van) return 0; // only a reefer van will do
    if (chilled) return 1;
    if (van) return 2;
    return 3;
  };

  // A stable sort by tier keeps the lane and priority ordering inside each tier.
  for (const order of [...queue].sort((a, b) => tier(a) - tier(b))) {
    if (!tryPlace(order)) unplaced.push(order);
  }

  // =========================================================================
  // Phase 5 — repair.
  // =========================================================================

  // 5a. A trip built later in a lane may have room an earlier rejection missed.
  const stillUnplaced: OrderRef[] = [];
  for (const order of unplaced) {
    if (tryPlace(order)) ledger.clear(order.ref);
    else stillUnplaced.push(order);
  }

  // 5b. The fairness swap. Without this the priority policy is decorative:
  // the greedy first pass has already consumed the capacity by the time a
  // previously-skipped order is found to be unplaceable.
  const finalUnplaced: OrderRef[] = [];
  if (config.enableFairnessSwap) {
    for (const order of stillUnplaced) {
      if (!order.deferredYesterday || !trySwapIn(order)) finalUnplaced.push(order);
    }
  } else {
    finalUnplaced.push(...stillUnplaced);
  }

  // =========================================================================
  // Assemble output
  // =========================================================================

  const allocatedTrips = trips
    .filter((t) => t.orders.length > 0)
    .map(toAllocatedTrip)
    .sort(
      (a, b) =>
        a.vehicleId.localeCompare(b.vehicleId) || a.tripNo - b.tripNo,
    );

  const deferred: DeferredOrder[] = [...permanentlyDeferred, ...finalUnplaced]
    .map((o) => ledger.explain(o))
    .sort((a, b) => a.orderRef.localeCompare(b.orderRef));

  const meters: VehicleMeter[] = [...state.values()]
    .map((s) => ({
      vehicleId: s.vehicle.vehicleId,
      tripsUsed: s.tripsUsed,
      predawnUsedMin: round(s.predawnMin),
      predawnBudgetMin: config.predawnBudget,
      daytimeUsedMin: round(s.daytimeMin),
      daytimeBudgetMin: config.daytimeBudget,
      fuelCommittedL: round(s.committedOtherDaysL + s.fuelL),
      fuelQuotaL: s.quotaL,
    }))
    .sort((a, b) => a.vehicleId.localeCompare(b.vehicleId));

  const selfCheck = validatePlan(buildSnapshot(), { stage: "draft" });

  const served = allocatedTrips.reduce(
    (n, t) => n + t.stops.reduce((m, s) => m + s.orderRefs.length, 0),
    0,
  );

  return {
    trips: allocatedTrips,
    deferred,
    meters,
    selfCheck,
    stats: {
      orders: input.orders.length,
      served,
      deferred: deferred.length,
      tripsBuilt: allocatedTrips.length,
      hash: hashAllocation(allocatedTrips, deferred),
    },
  };

  // =========================================================================
  // Helpers, closed over the working state.
  // =========================================================================

  /** Stops for a set of orders: merged by outlet, ordered by window close. */
  function stopsFor(orders: readonly OrderRef[]): {
    outletId: string;
    orderRefs: string[];
    docks: DockType[];
  }[] {
    const byOutlet = new Map<string, OrderRef[]>();
    for (const o of orders) {
      const list = byOutlet.get(o.outletId);
      if (list) list.push(o);
      else byOutlet.set(o.outletId, [o]);
    }

    return [...byOutlet.entries()]
      .map(([outletId, list]) => ({
        outletId,
        orderRefs: list.map((o) => o.ref).sort(),
        docks: list.map(() => dockOf(outletId)!),
        close: toMin(outlets.get(outletId)!.windowClose),
      }))
      .sort((a, b) => a.close - b.close || a.outletId.localeCompare(b.outletId))
      .map(({ outletId, orderRefs, docks }) => ({ outletId, orderRefs, docks }));
  }

  function recompute(
    travel: DistrictTravel,
    brand: Brand,
    orders: readonly OrderRef[],
    kmPerL: number,
  ) {
    const stops = stopsFor(orders);
    const docks = stops.flatMap((s) => s.docks);
    const minutes = tripMinutes(travel, brand, docks, allowance);
    const distanceKm = tripDistanceKm(travel, orders.length);
    return { stops, minutes, distanceKm, fuelL: distanceKm / kmPerL };
  }

  /** The latest departure that still meets every window, or null. */
  function feasibleDeparture(
    travel: DistrictTravel,
    brand: Brand,
    stops: { outletId: string; docks: DockType[] }[],
    wave: Wave,
  ): ClockTime | null {
    const earliest = wave === "PREDAWN" ? config.predawnStart : config.daytimeStart;
    const latest = wave === "PREDAWN" ? config.predawnEnd : config.daytimeEnd;
    return latestFeasibleDeparture(
      travel,
      brand,
      stops,
      outlets,
      allowance,
      earliest,
      latest,
    );
  }

  /** Try to add `order` to an existing trip, then to open a new one. */
  function tryPlace(order: OrderRef): boolean {
    const outlet = outlets.get(order.outletId);
    const travel = districts.get(order.district);
    if (!outlet || !travel) return false;

    // Existing trips in the same lane, tightest remaining volume first —
    // consolidating saves the whole fixed outbound leg, the biggest single win
    // available to this allocator.
    const sameLane = trips
      .filter((t) => t.brand === order.brand && t.district === order.district)
      .sort(
        (a, b) =>
          scarcity(a.vehicle, order, outlet) - scarcity(b.vehicle, order, outlet) ||
          a.vehicle.volumeCapM3 - a.volumeM3 - (b.vehicle.volumeCapM3 - b.volumeM3) ||
          a.vehicle.vehicleId.localeCompare(b.vehicle.vehicleId),
      );

    for (const trip of sameLane) {
      if (addToTrip(trip, order, outlet)) return true;
    }

    // Otherwise open a new trip on the best candidate.
    const compatible = input.vehicles.filter((v) => canHost(v, order, outlet));
    const candidates = [...compatible].sort((a, b) => {
      // Never spend a scarce vehicle on work an ordinary one can do.
      const scarceA = scarcity(a, order, outlet);
      const scarceB = scarcity(b, order, outlet);
      if (scarceA !== scarceB) return scarceA - scarceB;

      const sa = state.get(a.vehicleId)!;
      const sb = state.get(b.vehicleId)!;
      // Tightest fit next, so the 38 m3 trucks stay free for the big lanes,
      // then whichever has the most fuel headroom left this week.
      const fitA = a.volumeCapM3 - order.volumeM3;
      const fitB = b.volumeCapM3 - order.volumeM3;
      if (Math.abs(fitA - fitB) > 1e-9) return fitA - fitB;
      const fuelA = sa.quotaL - sa.committedOtherDaysL - sa.fuelL;
      const fuelB = sb.quotaL - sb.committedOtherDaysL - sb.fuelL;
      if (Math.abs(fuelA - fuelB) > 1e-9) return fuelB - fuelA;
      return a.vehicleId.localeCompare(b.vehicleId);
    });

    for (const vehicle of candidates) {
      if (openTrip(vehicle, order, travel)) return true;
    }

    // Nothing took it. Say which scarce resource ran out, rather than leaving
    // the explanation to whichever capacity check happened to fire last.
    if (compatible.length > 0) {
      if (order.tempRequirement === "chilled") {
        ledger.record(order.ref, { code: "NO_REEFER_AVAILABLE" });
      } else if (outlet.parkingConstraint === "van_only") {
        ledger.record(order.ref, { code: "NO_VAN_AVAILABLE" });
      }
    }

    return false;
  }

  /**
   * How wasteful it would be to give this order to this vehicle. Lower is
   * better. A reefer carrying ambient goods, or a van carrying a load any
   * truck could take, burns capacity that something else genuinely needs.
   */
  function scarcity(
    v: AllocatorVehicle,
    order: OrderRef,
    outlet: OutletRef,
  ): number {
    let cost = 0;
    if (v.temp === "reefer" && order.tempRequirement !== "chilled") cost += 2;
    if (v.type === "van" && outlet.parkingConstraint !== "van_only") cost += 1;
    return cost;
  }

  /** Cheap compatibility gate, before any arithmetic. */
  function canHost(
    v: AllocatorVehicle,
    order: OrderRef,
    outlet: OutletRef,
  ): boolean {
    if (v.depot !== order.depot) {
      ledger.record(order.ref, { code: "WRONG_DEPOT", vehicleId: v.vehicleId });
      return false;
    }
    if (!v.available) {
      ledger.record(order.ref, { code: "VEHICLE_IN_WORKSHOP", vehicleId: v.vehicleId });
      return false;
    }
    if (order.tempRequirement === "chilled" && v.temp !== "reefer") return false;
    if (outlet.parkingConstraint === "van_only" && v.type !== "van") return false;
    return true;
  }

  function addToTrip(trip: TripBuild, order: OrderRef, outlet: OutletRef): boolean {
    const v = trip.vehicle;
    const id = v.vehicleId;

    if (order.tempRequirement === "chilled" && v.temp !== "reefer") return false;
    if (outlet.parkingConstraint === "van_only" && v.type !== "van") return false;

    const nextVolume = trip.volumeM3 + order.volumeM3;
    if (over(nextVolume, v.volumeCapM3)) {
      ledger.record(order.ref, {
        code: "VOLUME_CAP_EXCEEDED",
        vehicleId: id,
        metric: { name: "volume", have: nextVolume, limit: v.volumeCapM3, unit: "m3" },
      });
      return false;
    }

    const nextWeight = trip.weightKg + order.weightKg;
    if (over(nextWeight, v.weightCapKg)) {
      ledger.record(order.ref, {
        code: "WEIGHT_CAP_EXCEEDED",
        vehicleId: id,
        metric: { name: "weight", have: nextWeight, limit: v.weightCapKg, unit: "kg" },
      });
      return false;
    }

    const candidateOrders = [...trip.orders, order];
    const next = recompute(trip.travel, trip.brand, candidateOrders, v.kmPerL);
    const s = state.get(id)!;

    const waveUsed =
      (trip.wave === "PREDAWN" ? s.predawnMin : s.daytimeMin) - trip.minutes + next.minutes;
    const budget = trip.wave === "PREDAWN" ? config.predawnBudget : config.daytimeBudget;
    if (over(waveUsed, budget)) {
      ledger.record(order.ref, {
        code:
          trip.wave === "PREDAWN" ? "PREDAWN_BUDGET_EXCEEDED" : "DAYTIME_BUDGET_EXCEEDED",
        vehicleId: id,
        metric: { name: "minutes", have: waveUsed, limit: budget, unit: "min" },
      });
      return false;
    }

    if (config.enforceFuelQuota) {
      const fuel = s.committedOtherDaysL + s.fuelL - trip.fuelL + next.fuelL;
      if (over(fuel, s.quotaL)) {
        ledger.record(order.ref, {
          code: "FUEL_QUOTA_EXCEEDED",
          vehicleId: id,
          metric: { name: "fuel", have: fuel, limit: s.quotaL, unit: "L" },
        });
        return false;
      }
    }

    const departAt = feasibleDeparture(trip.travel, trip.brand, next.stops, trip.wave);
    if (!departAt) {
      ledger.record(order.ref, { code: "WINDOW_UNREACHABLE", vehicleId: id });
      return false;
    }

    // Commit.
    if (trip.wave === "PREDAWN") s.predawnMin += next.minutes - trip.minutes;
    else s.daytimeMin += next.minutes - trip.minutes;
    s.fuelL += next.fuelL - trip.fuelL;

    trip.orders = candidateOrders;
    trip.minutes = next.minutes;
    trip.fuelL = next.fuelL;
    trip.volumeM3 = nextVolume;
    trip.weightKg = nextWeight;
    trip.departAt = departAt;
    return true;
  }

  function openTrip(
    v: AllocatorVehicle,
    order: OrderRef,
    travel: DistrictTravel,
  ): boolean {
    const s = state.get(v.vehicleId)!;
    const id = v.vehicleId;

    if (s.tripsUsed >= config.maxTripsPerVehicle) {
      ledger.record(order.ref, { code: "NO_TRIP_SLOT", vehicleId: id });
      return false;
    }

    if (over(order.volumeM3, v.volumeCapM3)) {
      ledger.record(order.ref, {
        code: "VOLUME_CAP_EXCEEDED",
        vehicleId: id,
        metric: { name: "volume", have: order.volumeM3, limit: v.volumeCapM3, unit: "m3" },
      });
      return false;
    }
    if (over(order.weightKg, v.weightCapKg)) {
      ledger.record(order.ref, {
        code: "WEIGHT_CAP_EXCEEDED",
        vehicleId: id,
        metric: { name: "weight", have: order.weightKg, limit: v.weightCapKg, unit: "kg" },
      });
      return false;
    }

    const wave = waveForBrand(order.brand);
    const next = recompute(travel, order.brand, [order], v.kmPerL);
    const budget = wave === "PREDAWN" ? config.predawnBudget : config.daytimeBudget;
    const waveUsed = (wave === "PREDAWN" ? s.predawnMin : s.daytimeMin) + next.minutes;

    if (over(waveUsed, budget)) {
      ledger.record(order.ref, {
        code: wave === "PREDAWN" ? "PREDAWN_BUDGET_EXCEEDED" : "DAYTIME_BUDGET_EXCEEDED",
        vehicleId: id,
        metric: { name: "minutes", have: waveUsed, limit: budget, unit: "min" },
      });
      return false;
    }

    if (config.enforceFuelQuota) {
      const fuel = s.committedOtherDaysL + s.fuelL + next.fuelL;
      if (over(fuel, s.quotaL)) {
        ledger.record(order.ref, {
          code: "FUEL_QUOTA_EXCEEDED",
          vehicleId: id,
          metric: { name: "fuel", have: fuel, limit: s.quotaL, unit: "L" },
        });
        return false;
      }
    }

    const departAt = feasibleDeparture(travel, order.brand, next.stops, wave);
    if (!departAt) {
      ledger.record(order.ref, { code: "WINDOW_UNREACHABLE", vehicleId: id });
      return false;
    }

    s.tripsUsed += 1;
    if (wave === "PREDAWN") s.predawnMin += next.minutes;
    else s.daytimeMin += next.minutes;
    s.fuelL += next.fuelL;

    trips.push({
      vehicle: v,
      tripNo: s.tripsUsed as TripNo,
      brand: order.brand,
      district: order.district,
      wave,
      travel,
      orders: [order],
      minutes: next.minutes,
      fuelL: next.fuelL,
      volumeM3: order.volumeM3,
      weightKg: order.weightKg,
      departAt,
    });
    return true;
  }

  /**
   * Give a previously-skipped order someone else's place: find a served order
   * in the same lane that was served yesterday and is no smaller, drop it, and
   * put this one in. The displaced order inherits a clear reason.
   */
  function trySwapIn(order: OrderRef): boolean {
    const outlet = outlets.get(order.outletId);
    if (!outlet) return false;

    const sameLane = trips.filter(
      (t) => t.brand === order.brand && t.district === order.district,
    );

    for (const trip of sameLane) {
      const victims = trip.orders
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
        const kept = trip.orders.filter((o) => o.ref !== victim.ref);
        const candidate = [...kept, order];
        const next = recompute(trip.travel, trip.brand, candidate, trip.vehicle.kmPerL);

        const volume = candidate.reduce((s, o) => s + o.volumeM3, 0);
        const weight = candidate.reduce((s, o) => s + o.weightKg, 0);
        if (over(volume, trip.vehicle.volumeCapM3)) continue;
        if (over(weight, trip.vehicle.weightCapKg)) continue;

        const s = state.get(trip.vehicle.vehicleId)!;
        const waveUsed =
          (trip.wave === "PREDAWN" ? s.predawnMin : s.daytimeMin) -
          trip.minutes +
          next.minutes;
        if (over(waveUsed, budgetForWave(trip.wave))) continue;

        const departAt = feasibleDeparture(trip.travel, trip.brand, next.stops, trip.wave);
        if (!departAt) continue;

        // Commit the swap.
        if (trip.wave === "PREDAWN") s.predawnMin += next.minutes - trip.minutes;
        else s.daytimeMin += next.minutes - trip.minutes;
        s.fuelL += next.fuelL - trip.fuelL;

        trip.orders = candidate;
        trip.minutes = next.minutes;
        trip.fuelL = next.fuelL;
        trip.volumeM3 = volume;
        trip.weightKg = weight;
        trip.departAt = departAt;

        ledger.clear(order.ref);
        ledger.record(victim.ref, {
          code: "YIELDED_TO_HIGHER_PRIORITY",
          vehicleId: trip.vehicle.vehicleId,
        });
        finalUnplacedPush(victim);
        return true;
      }
    }
    return false;
  }

  function finalUnplacedPush(order: OrderRef): void {
    finalUnplaced.push(order);
  }

  function toAllocatedTrip(trip: TripBuild): AllocatedTrip {
    const stops = stopsFor(trip.orders);
    const schedule = computeStopSchedule(
      trip.departAt,
      trip.travel,
      trip.brand,
      stops,
      outlets,
      allowance,
    );
    const allocatedStops: AllocatedStop[] = stops.map((s, i) => ({
      seq: i,
      outletId: s.outletId,
      orderRefs: s.orderRefs,
      plannedArrival: schedule[i].arrival,
    }));

    return {
      vehicleId: trip.vehicle.vehicleId,
      tripNo: trip.tripNo,
      brand: trip.brand,
      district: trip.district,
      wave: trip.wave,
      departAt: trip.departAt,
      minutes: round(trip.minutes),
      distanceKm: round(tripDistanceKm(trip.travel, trip.orders.length)),
      fuelL: round(trip.fuelL),
      volumeM3: round(trip.volumeM3, 3),
      weightKg: round(trip.weightKg),
      stops: allocatedStops,
    };
  }

  function buildSnapshot(): PlanSnapshot {
    return {
      date: input.date,
      depot: input.depot,
      config: {
        ...DEFAULT_PLAN_CONFIG,
        predawnBudget: config.predawnBudget,
        daytimeBudget: config.daytimeBudget,
        maxTripsPerVehicle: config.maxTripsPerVehicle,
        enforceFuelQuota: config.enforceFuelQuota ? "error" : "off",
      },
      reference: {
        vehicles: new Map(input.vehicles.map((v) => [v.vehicleId, v])),
        outlets,
        districts,
        allowance,
        vehicleStatus: new Map(
          input.vehicles.map((v) => [
            v.vehicleId,
            v.available ? ("AVAILABLE" as const) : ("IN_WORKSHOP" as const),
          ]),
        ),
        fuel: new Map(
          [...state.values()].map((s) => [
            s.vehicle.vehicleId,
            { quotaL: s.quotaL, committedOtherDaysL: s.committedOtherDaysL },
          ]),
        ),
      },
      orders: new Map(input.orders.map((o) => [o.ref, o])),
      trips: trips
        .filter((t) => t.orders.length > 0)
        .map((t) => ({
          vehicleId: t.vehicle.vehicleId,
          tripNo: t.tripNo,
          departAt: t.departAt,
          stops: stopsFor(t.orders).map((s, i) => ({
            seq: i,
            outletId: s.outletId,
            orderRefs: s.orderRefs,
          })),
        })),
      deferred: [...permanentlyDeferred, ...finalUnplaced].map((o) => ({
        orderRef: o.ref,
        reasonCode: "PENDING",
      })),
    };
  }
}

// ---------------------------------------------------------------------------

function round(n: number, dp = 2): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

/**
 * A stable fingerprint of an allocation. Two runs over the same input must
 * produce the same string; the determinism test relies on it.
 */
function hashAllocation(
  trips: readonly AllocatedTrip[],
  deferred: readonly DeferredOrder[],
): string {
  const parts: string[] = [];
  for (const t of trips) {
    parts.push(
      `${t.vehicleId}#${t.tripNo}@${t.departAt}:${t.stops
        .map((s) => `${s.outletId}(${s.orderRefs.join("+")})`)
        .join(">")}`,
    );
  }
  for (const d of deferred) parts.push(`!${d.orderRef}=${d.reasonCode}`);

  const payload = parts.join("|");
  // FNV-1a, 32-bit. Not cryptographic; it only has to be stable and cheap.
  let h = 0x811c9dc5;
  for (let i = 0; i < payload.length; i++) {
    h ^= payload.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}
