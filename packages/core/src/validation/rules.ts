/**
 * The one validator.
 *
 * Four callers, one implementation:
 *   1. the allocator's self-check, so auto-plan output is never trusted blindly
 *   2. the drag-and-drop API, and the plan board CLIENT-SIDE for instant feedback
 *   3. publish, which requires zero errors
 *   4. the submission CSV export, which re-validates before emitting
 *
 * It is pure and isomorphic — no Prisma, no I/O, no `Date.now()` — which is
 * exactly what lets it run in all four places.
 *
 * Where this mirrors `check_allocation.py` it does so deliberately and
 * literally, down to the 1e-6 comparison slack. A plan that passes here must
 * pass there; the `verify:organiser` script proves that end to end rather than
 * taking our word for it.
 */

import { computeRoadSchedule, matrixCovers, roadKmOf, type RoadSchedule } from "../domain/roadSchedule";
import { computeStopSchedule, effectiveWindow, windowIsEmpty, type ScheduledStop } from "../domain/schedule";
import { toMin } from "../domain/time";
import { tripFuelLitres, tripMinutes } from "../domain/tripTime";
import {
  MAX_TRIPS_PER_VEHICLE,
  needsReefer,
  PREDAWN_START,
  TOLERANCE,
  waveForBrand,
  type Brand,
  type DockType,
  type TripNo,
} from "../domain/types";
import { OVERRIDABLE_CODES, type RuleCode } from "./codes";
import type { PlanSnapshot, TripSnapshot, ValidateOptions, Violation } from "./types";

// ---------------------------------------------------------------------------

function v(
  code: RuleCode,
  message: string,
  extra: Omit<Violation, "code" | "message" | "severity" | "overridable"> & {
    severity?: Violation["severity"];
  } = {},
): Violation {
  const { severity, ...rest } = extra;
  return {
    code,
    severity: severity ?? "error",
    message,
    overridable: OVERRIDABLE_CODES.has(code),
    ...rest,
  };
}

/** `a > b` allowing the organisers' 1e-6 slack, so exactly-at-cap passes. */
function exceeds(have: number, limit: number): boolean {
  return have > limit + TOLERANCE;
}

const fmt = (n: number, dp = 1) =>
  Number.isInteger(n) ? String(n) : n.toFixed(dp);

/** A trip resolved against reference data, with its derived brand and district. */
interface ResolvedTrip {
  trip: TripSnapshot;
  orderRefs: string[];
  brands: Set<Brand>;
  districts: Set<string>;
  depots: Set<string>;
  docks: DockType[];
  totalVolumeM3: number;
  totalWeightKg: number;
  hasChilled: boolean;
  vanOnlyOutletIds: string[];
  unknownOutletIds: string[];
  /** The trip walked over the road network; set only when road travel times were supplied. */
  road?: RoadSchedule;
}

// ---------------------------------------------------------------------------

export function validatePlan(
  snapshot: PlanSnapshot,
  options: ValidateOptions = {},
): Violation[] {
  const { orders, reference, config } = snapshot;
  const stage = options.stage ?? "draft";
  const only = options.only ? new Set<RuleCode>(options.only) : null;
  const found: Violation[] = [];

  const wants = (code: RuleCode) => !only || only.has(code);
  const push = (violation: Violation) => {
    if (wants(violation.code)) found.push(violation);
  };

  // --- Pass 1: resolve every trip against reference data --------------------

  const resolved: ResolvedTrip[] = [];
  /** orderRef -> the trips it appears on (to catch splits and duplicates). */
  const placements = new Map<string, { vehicleId: string; tripNo: TripNo }[]>();

  for (const trip of snapshot.trips) {
    const vehicle = reference.vehicles.get(trip.vehicleId);

    if (!trip.vehicleId) {
      push(
        v("SERVED_WITHOUT_VEHICLE", "A trip has no vehicle assigned.", {
          tripNo: trip.tripNo,
        }),
      );
      continue;
    }
    if (!vehicle) {
      push(
        v("UNKNOWN_VEHICLE", `${trip.vehicleId} is not a vehicle in the fleet.`, {
          vehicleId: trip.vehicleId,
          tripNo: trip.tripNo,
        }),
      );
      continue;
    }
    if (trip.tripNo !== 1 && trip.tripNo !== 2) {
      push(
        v("TRIP_ID_RANGE", `${trip.vehicleId} has a trip numbered ${trip.tripNo}; a trip is 1 or 2.`, {
          vehicleId: trip.vehicleId,
        }),
      );
      continue;
    }

    const r: ResolvedTrip = {
      trip,
      orderRefs: [],
      brands: new Set(),
      districts: new Set(),
      depots: new Set(),
      docks: [],
      totalVolumeM3: 0,
      totalWeightKg: 0,
      hasChilled: false,
      vanOnlyOutletIds: [],
      unknownOutletIds: [],
    };

    for (const stop of trip.stops) {
      const outlet = reference.outlets.get(stop.outletId);
      if (!outlet) {
        r.unknownOutletIds.push(stop.outletId);
        continue;
      }
      if (outlet.parkingConstraint === "van_only") {
        r.vanOnlyOutletIds.push(outlet.outletId);
      }

      for (const ref of stop.orderRefs) {
        const order = orders.get(ref);
        if (!order) {
          push(
            v("UNKNOWN_ORDER", `${ref} is assigned to ${trip.vehicleId} but is not in the day's queue.`, {
              vehicleId: trip.vehicleId,
              tripNo: trip.tripNo,
              orderRefs: [ref],
            }),
          );
          continue;
        }
        r.orderRefs.push(ref);
        r.brands.add(order.brand);
        r.districts.add(order.district);
        r.depots.add(order.depot);
        r.docks.push(outlet.dockType);
        r.totalVolumeM3 += order.volumeM3;
        r.totalWeightKg += order.weightKg;
        if (needsReefer(order.tempRequirement)) r.hasChilled = true;

        const list = placements.get(ref) ?? [];
        list.push({ vehicleId: trip.vehicleId, tripNo: trip.tripNo });
        placements.set(ref, list);
      }
    }

    if (r.unknownOutletIds.length > 0) {
      push(
        v("UNKNOWN_OUTLET", `${trip.vehicleId} trip ${trip.tripNo} stops at ${r.unknownOutletIds.join(", ")}, which is not a known outlet.`, {
          vehicleId: trip.vehicleId,
          tripNo: trip.tripNo,
          outletIds: r.unknownOutletIds,
        }),
      );
    }

    resolved.push(r);
  }

  // --- Pass 2: per-trip rules ----------------------------------------------

  for (const r of resolved) {
    const { trip } = r;
    const vehicle = reference.vehicles.get(trip.vehicleId)!;
    const where = { vehicleId: trip.vehicleId, tripNo: trip.tripNo };
    if (r.orderRefs.length === 0) continue;

    // Rule 1 — one brand, one district.
    if (r.brands.size > 1) {
      push(
        v("MIXED_BRAND_IN_TRIP", `${trip.vehicleId} trip ${trip.tripNo} mixes ${[...r.brands].sort().join(" and ")}. A trip carries one brand.`, {
          ...where,
          orderRefs: r.orderRefs,
        }),
      );
    }
    if (r.districts.size > 1) {
      push(
        v("MIXED_DISTRICT_IN_TRIP", `${trip.vehicleId} trip ${trip.tripNo} mixes ${[...r.districts].sort().join(" and ")}. A trip serves one district.`, {
          ...where,
          orderRefs: r.orderRefs,
        }),
      );
    }

    // Rule 2 — chilled and frozen need a reefer. (The code keeps its
    // organiser-facing name; `hasChilled` means "needs a reefer".)
    if (r.hasChilled && vehicle.temp !== "reefer") {
      push(
        v("CHILLED_ON_NON_REEFER", `${trip.vehicleId} is not refrigerated and cannot carry the chilled or frozen orders on trip ${trip.tripNo}.`, {
          ...where,
          orderRefs: r.orderRefs.filter((ref) => needsReefer(orders.get(ref)?.tempRequirement ?? "ambient")),
        }),
      );
    }

    // Rule 3 — van-only outlets need a van.
    if (r.vanOnlyOutletIds.length > 0 && vehicle.type !== "van") {
      push(
        v("VAN_ONLY_OUTLET_NEEDS_VAN", `${r.vanOnlyOutletIds.join(", ")} cannot be reached by a ${vehicle.type}. ${trip.vehicleId} trip ${trip.tripNo} needs a van.`, {
          ...where,
          outletIds: r.vanOnlyOutletIds,
        }),
      );
    }

    // Rule 4 — home depot.
    const foreign = [...r.depots].filter((d) => d !== vehicle.depot);
    if (foreign.length > 0) {
      push(
        v("DEPOT_MISMATCH", `${trip.vehicleId} is based at ${vehicle.depot} but trip ${trip.tripNo} carries orders for ${foreign.join(", ")}.`, {
          ...where,
          orderRefs: r.orderRefs,
        }),
      );
    }

    // Vehicle availability.
    if (reference.vehicleStatus.get(trip.vehicleId) === "IN_WORKSHOP") {
      push(
        v("VEHICLE_IN_WORKSHOP", `${trip.vehicleId} is in the workshop on ${snapshot.date}.`, where),
      );
    }

    // Rule 6 — both caps, summed per trip.
    if (exceeds(r.totalVolumeM3, vehicle.volumeCapM3)) {
      push(
        v("VOLUME_CAP_EXCEEDED", `${trip.vehicleId} trip ${trip.tripNo} carries ${fmt(r.totalVolumeM3, 2)} m3 against a ${fmt(vehicle.volumeCapM3, 1)} m3 capacity.`, {
          ...where,
          orderRefs: r.orderRefs,
          metric: { name: "volume", have: r.totalVolumeM3, limit: vehicle.volumeCapM3, unit: "m3" },
        }),
      );
    }
    if (exceeds(r.totalWeightKg, vehicle.weightCapKg)) {
      push(
        v("WEIGHT_CAP_EXCEEDED", `${trip.vehicleId} trip ${trip.tripNo} carries ${fmt(r.totalWeightKg, 0)} kg against a ${fmt(vehicle.weightCapKg, 0)} kg capacity.`, {
          ...where,
          orderRefs: r.orderRefs,
          metric: { name: "weight", have: r.totalWeightKg, limit: vehicle.weightCapKg, unit: "kg" },
        }),
      );
    }

    // An outlet whose own window and its mall's never overlap cannot be served
    // at any time of day, so no schedule can be right for it.
    const unservable = new Set<string>();
    for (const stop of trip.stops) {
      const outlet = reference.outlets.get(stop.outletId);
      if (!outlet || stop.orderRefs.length === 0 || !windowIsEmpty(outlet) || unservable.has(outlet.outletId)) continue;
      unservable.add(outlet.outletId);
      push(
        v("NO_COMMON_WINDOW", `${outlet.outletId} asks for ${outlet.windowOpen}-${outlet.windowClose} but its mall only allows ${outlet.mallWindowOpen}-${outlet.mallWindowClose}. The two never overlap, so it cannot be delivered to.`, {
          ...where,
          outletIds: [outlet.outletId],
          orderRefs: trip.stops.filter((s) => s.outletId === outlet.outletId).flatMap((s) => s.orderRefs),
        }),
      );
    }

    // Delivery windows. Skipped when the trip has no departure time, because
    // without one there are no arrivals to check.
    if (trip.departAt && r.brands.size === 1 && r.districts.size === 1) {
      const brand = [...r.brands][0];
      const district = [...r.districts][0];
      const travel = reference.districts.get(district);
      const scheduleStops = trip.stops
        .filter((s) => reference.outlets.has(s.outletId) && s.orderRefs.length > 0)
        .map((s) => ({
          outletId: s.outletId,
          docks: s.orderRefs.map(() => reference.outlets.get(s.outletId)!.dockType),
        }));

      // On the road when the road is known, else on the organisers' district
      // table. Either way the stops are taken in the order they are given.
      const road =
        reference.travel && scheduleStops.length > 0 && matrixCovers(reference.travel, vehicle.depot, scheduleStops.map((s) => s.outletId))
          ? computeRoadSchedule(trip.departAt, vehicle.depot, brand, scheduleStops, reference.outlets, reference.travel, reference.allowance, {
              freshDeadline: config.freshDeadline,
            })
          : null;
      r.road = road ?? undefined;

      const schedule: Array<ScheduledStop & { freshLateByMin?: number }> | null = road
        ? road.stops
        : travel
          ? computeStopSchedule(trip.departAt, travel, brand, scheduleStops, reference.outlets, reference.allowance)
          : null;

      for (const s of schedule ?? []) {
        // Already reported once as unservable; a late arrival is beside the point.
        if (unservable.has(s.outletId)) continue;
        const outlet = reference.outlets.get(s.outletId)!;
        if (s.lateByMin > 0) {
          const win = effectiveWindow(outlet);
          const isFresh = outlet.brand === "Fresh";
          const code: RuleCode = win.isMallWindow
            ? "MALL_WINDOW_MISSED"
            : isFresh
              ? "WINDOW_CLOSE_MISSED"
              : "NON_FRESH_WINDOW_MISSED";
          const severity =
            code === "NON_FRESH_WINDOW_MISSED" && config.enforceNonFreshWindows === "warn"
              ? "warning"
              : "error";
          push(
            v(code, `${s.outletId} is reached at ${s.arrival}, ${s.lateByMin} min after its window closes at ${s.windowClose}.`, {
              ...where,
              outletIds: [s.outletId],
              severity,
              metric: { name: "late", have: s.lateByMin, limit: 0, unit: "min" },
            }),
          );
        } else if ((s.freshLateByMin ?? 0) > 0) {
          // The window would have allowed it; the rule that Fresh is in before
          // stores open does not.
          push(
            v("FRESH_AFTER_0800", `${s.outletId} is reached at ${s.arrival}, ${s.freshLateByMin} min after Fresh deliveries must be in (stores open at ${config.freshDeadline}).`, {
              ...where,
              outletIds: [s.outletId],
              metric: { name: "late", have: s.freshLateByMin!, limit: 0, unit: "min" },
            }),
          );
        }
      }
    }
  }

  // --- Pass 3: per-vehicle-day rules ---------------------------------------

  const byVehicle = new Map<string, ResolvedTrip[]>();
  for (const r of resolved) {
    const list = byVehicle.get(r.trip.vehicleId) ?? [];
    list.push(r);
    byVehicle.set(r.trip.vehicleId, list);
  }

  for (const [vehicleId, trips] of byVehicle) {
    const vehicle = reference.vehicles.get(vehicleId)!;
    const tripNos = new Set(trips.map((t) => t.trip.tripNo));

    // Rule 7 — at most two trips.
    const maxTrips = config.maxTripsPerVehicle ?? MAX_TRIPS_PER_VEHICLE;
    if (tripNos.size > maxTrips) {
      push(
        v("TOO_MANY_TRIPS", `${vehicleId} is given ${tripNos.size} trips; a vehicle runs at most ${maxTrips} a day.`, {
          vehicleId,
          metric: { name: "trips", have: tripNos.size, limit: maxTrips, unit: "trips" },
        }),
      );
    }

    // One vehicle cannot be on two roads at once: the second trip leaves only
    // after the first is home and the vehicle is unloaded and reloaded.
    const timed = trips
      .filter((t): t is ResolvedTrip & { road: RoadSchedule } => t.road !== undefined && t.trip.departAt !== undefined)
      .sort((a, b) => toMin(a.trip.departAt!) - toMin(b.trip.departAt!) || a.trip.tripNo - b.trip.tripNo);
    for (let i = 1; i < timed.length; i += 1) {
      const before = timed[i - 1]!;
      const after = timed[i]!;
      const gap = toMin(after.trip.departAt!) - before.road.returnMin;
      if (gap >= config.reloadMin) continue;
      push(
        v(
          "TRIPS_OVERLAP",
          gap < 0
            ? `${vehicleId} leaves on trip ${after.trip.tripNo} at ${after.trip.departAt} but trip ${before.trip.tripNo} is not back until ${before.road.returnAt}.`
            : `${vehicleId} leaves on trip ${after.trip.tripNo} at ${after.trip.departAt}, only ${gap} min after trip ${before.trip.tripNo} is back at ${before.road.returnAt}; it needs ${config.reloadMin} min to unload and reload.`,
          {
            vehicleId,
            tripNo: after.trip.tripNo,
            metric: { name: "turnaround", have: gap, limit: config.reloadMin, unit: "min" },
          },
        ),
      );
    }

    // Wave budgets. Fresh trips share the pre-dawn budget; Style and Tech
    // share the daytime one. They are separate windows, which is exactly why
    // a vehicle can run one of each but not three of anything.
    let predawnUsed = 0;
    let daytimeUsed = 0;
    let fuelL = 0;

    for (const r of trips) {
      if (r.brands.size !== 1 || r.districts.size !== 1) continue; // already reported
      const brand = [...r.brands][0];
      const district = [...r.districts][0];
      const travel = reference.districts.get(district);
      if (!travel) continue;

      const minutes = tripMinutes(travel, brand, r.docks, reference.allowance);
      if (waveForBrand(brand) === "PREDAWN") predawnUsed += minutes;
      else daytimeUsed += minutes;

      // Litres are burned on the road, so the road's distance is used when it is
      // known: the real legs, the way home included.
      const servedOutletIds = r.trip.stops.filter((s) => s.orderRefs.length > 0).map((s) => s.outletId);
      fuelL +=
        reference.travel && servedOutletIds.length > 0 && matrixCovers(reference.travel, vehicle.depot, servedOutletIds)
          ? roadKmOf(vehicle.depot, servedOutletIds, reference.travel) / vehicle.kmPerL
          : tripFuelLitres(travel, r.orderRefs.length, vehicle.kmPerL);
    }

    if (exceeds(predawnUsed, config.predawnBudget)) {
      push(
        v("PREDAWN_BUDGET_EXCEEDED", `${vehicleId} uses ${fmt(predawnUsed, 0)} min of Fresh time against a ${config.predawnBudget} min pre-dawn window.`, {
          vehicleId,
          metric: { name: "predawn", have: predawnUsed, limit: config.predawnBudget, unit: "min" },
        }),
      );
    }
    if (exceeds(daytimeUsed, config.daytimeBudget)) {
      push(
        v("DAYTIME_BUDGET_EXCEEDED", `${vehicleId} uses ${fmt(daytimeUsed, 0)} min of Style and Tech time against a ${config.daytimeBudget} min trading day.`, {
          vehicleId,
          metric: { name: "daytime", have: daytimeUsed, limit: config.daytimeBudget, unit: "min" },
        }),
      );
    }

    // Weekly fuel quota — stated in the brief, absent from the organisers'
    // checker, so we enforce it ourselves.
    if (config.enforceFuelQuota !== "off") {
      const position = reference.fuel.get(vehicleId);
      if (position) {
        const weekTotal = position.committedOtherDaysL + fuelL;
        if (exceeds(weekTotal, position.quotaL)) {
          push(
            v("FUEL_QUOTA_EXCEEDED", `${vehicleId} would use ${fmt(weekTotal, 0)} L this week against a ${fmt(position.quotaL, 0)} L quota.`, {
              vehicleId,
              severity: config.enforceFuelQuota === "warn" ? "warning" : "error",
              metric: { name: "fuel", have: weekTotal, limit: position.quotaL, unit: "L" },
            }),
          );
        }
      }
    }
  }

  // --- Pass 4: whole orders, and every order decided exactly once -----------

  for (const [ref, spots] of placements) {
    if (spots.length <= 1) continue;
    const distinctTrips = new Set(spots.map((s) => `${s.vehicleId}#${s.tripNo}`));
    if (distinctTrips.size > 1) {
      // Rule 5 — whole orders.
      push(
        v("ORDER_SPLIT_ACROSS_TRIPS", `${ref} is spread across ${[...distinctTrips].join(", ")}. An order travels whole, on one vehicle and one trip.`, {
          orderRefs: [ref],
        }),
      );
    } else {
      push(
        v("DUPLICATE_ASSIGNMENT", `${ref} appears twice on ${[...distinctTrips][0]}.`, {
          orderRefs: [ref],
        }),
      );
    }
  }

  const deferredRefs = new Set(snapshot.deferred.map((d) => d.orderRef));
  for (const d of snapshot.deferred) {
    if (!orders.has(d.orderRef)) {
      push(
        v("UNKNOWN_ORDER", `${d.orderRef} is deferred but is not in the day's queue.`, {
          orderRefs: [d.orderRef],
        }),
      );
    }
    if (placements.has(d.orderRef)) {
      push(
        v("DUPLICATE_ASSIGNMENT", `${d.orderRef} is both served and deferred.`, {
          orderRefs: [d.orderRef],
        }),
      );
    }
  }

  if (stage === "publish") {
    const undecided = [...orders.keys()].filter(
      (ref) => !placements.has(ref) && !deferredRefs.has(ref),
    );
    if (undecided.length > 0) {
      push(
        v("EVERY_ORDER_DECIDED", `${undecided.length} order${undecided.length === 1 ? "" : "s"} still have no decision. Every order is served or deferred.`, {
          orderRefs: undecided.slice(0, 20),
          metric: { name: "undecided", have: undecided.length, limit: 0, unit: "orders" },
        }),
      );
    }

    const unreasoned = snapshot.deferred.filter((d) => !d.reasonCode);
    if (unreasoned.length > 0) {
      push(
        v("DEFERRED_WITHOUT_REASON", `${unreasoned.length} deferral${unreasoned.length === 1 ? " has" : "s have"} no reason recorded. A deferral that cannot be explained cannot be counted.`, {
          orderRefs: unreasoned.slice(0, 20).map((d) => d.orderRef),
        }),
      );
    }

    const openShortfalls = snapshot.openShortfallOrderRefs ?? [];
    if (openShortfalls.length > 0) {
      push(
        v("OPEN_SHORTFALL_AT_PUBLISH", `${openShortfalls.length} loading shortfall${openShortfalls.length === 1 ? "" : "s"} still await a decision.`, {
          orderRefs: openShortfalls.slice(0, 20),
          severity: "warning",
        }),
      );
    }
  }

  // The fairness guard. The brief names this failure directly: decisions made
  // under pressure "can leave the same outlet unserved on consecutive runs".
  for (const d of snapshot.deferred) {
    const order = orders.get(d.orderRef);
    if (!order) continue;
    if (order.deferredYesterday) {
      push(
        v("HIGH_PRIORITY_DEFERRED", `${order.outletId} was already skipped yesterday and would be skipped again (${d.orderRef}).`, {
          orderRefs: [d.orderRef],
          outletIds: [order.outletId],
          severity: "warning",
        }),
      );
    }
  }

  return found;
}

/** Convenience: does this plan have anything that blocks a publish? */
export function hasBlockingErrors(violations: readonly Violation[]): boolean {
  return violations.some((x) => x.severity === "error");
}

/** The rules a single drag touches, so the board can revalidate cheaply. */
export function rulesTouchedByMove(): RuleCode[] {
  return [
    "MIXED_BRAND_IN_TRIP",
    "MIXED_DISTRICT_IN_TRIP",
    "CHILLED_ON_NON_REEFER",
    "VAN_ONLY_OUTLET_NEEDS_VAN",
    "DEPOT_MISMATCH",
    "VEHICLE_IN_WORKSHOP",
    "VOLUME_CAP_EXCEEDED",
    "WEIGHT_CAP_EXCEEDED",
    "TOO_MANY_TRIPS",
    "PREDAWN_BUDGET_EXCEEDED",
    "DAYTIME_BUDGET_EXCEEDED",
    "FUEL_QUOTA_EXCEEDED",
    "WINDOW_CLOSE_MISSED",
    "MALL_WINDOW_MISSED",
    "NON_FRESH_WINDOW_MISSED",
    "FRESH_AFTER_0800",
    "TRIPS_OVERLAP",
    "NO_COMMON_WINDOW",
    "ORDER_SPLIT_ACROSS_TRIPS",
    "DUPLICATE_ASSIGNMENT",
  ];
}

export { PREDAWN_START };
