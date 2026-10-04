/**
 * Turning the working state into the allocator's answer: trips, meters, the
 * validator's self-check, and the fingerprint.
 */

import { validatePlan } from "@katapatha/core/validation/rules";
import { DEFAULT_PLAN_CONFIG, type PlanSnapshot } from "@katapatha/core/validation/types";
import { ordersOf, round, tripsOf, type Context, type TripBuild } from "./state";
import type { AllocatedStop, AllocatedTrip, DeferredOrder, VehicleMeter } from "./types";
import type { OrderRef } from "@katapatha/core/domain/types";

const stopRefs = (orders: readonly OrderRef[]) => orders.map((o) => o.ref).sort();

export function toAllocatedTrip(ctx: Context, trip: TripBuild): AllocatedTrip {
  const stops: AllocatedStop[] = trip.stops.map((s, i) => {
    const at = trip.road.stops[i]!;
    return {
      seq: i,
      outletId: s.outletId,
      orderRefs: stopRefs(s.orders),
      plannedArrival: at.arrival,
      serviceStart: at.serviceStart,
      leave: at.leave,
      legKm: round(at.legKm),
      legMinutes: at.legMin,
    };
  });

  return {
    vehicleId: trip.vehicle.vehicleId,
    tripNo: trip.tripNo,
    brand: trip.brand,
    district: trip.district,
    wave: trip.wave,
    departAt: trip.departAt,
    minutes: round(trip.minutes),
    distanceKm: round(trip.roadKm),
    fuelL: round(trip.fuelL),
    volumeM3: round(trip.volumeM3, 3),
    weightKg: round(trip.weightKg),
    roadMinutes: trip.road.roadMin,
    returnAt: trip.road.returnAt,
    travelSource: ctx.matrix.source,
    stops,
  };
}

export function toMeters(ctx: Context): VehicleMeter[] {
  return [...ctx.vehicleState.values()]
    .map((s) => {
      const trips = tripsOf(ctx, s.vehicle.vehicleId);
      const used = (wave: "PREDAWN" | "DAYTIME") =>
        trips.filter((t) => t.wave === wave).reduce((n, t) => n + t.minutes, 0);
      return {
        vehicleId: s.vehicle.vehicleId,
        tripsUsed: trips.length,
        predawnUsedMin: round(used("PREDAWN")),
        predawnBudgetMin: ctx.config.predawnBudget,
        daytimeUsedMin: round(used("DAYTIME")),
        daytimeBudgetMin: ctx.config.daytimeBudget,
        fuelCommittedL: round(s.committedOtherDaysL + trips.reduce((n, t) => n + t.fuelL, 0)),
        fuelQuotaL: s.quotaL,
      };
    })
    .sort((a, b) => a.vehicleId.localeCompare(b.vehicleId));
}

/**
 * The shared validator over our own output. It judges on the same road legs the
 * plan was built from, so a plan that passes here passes the road rules as well
 * as the organisers' own.
 */
export function selfCheck(ctx: Context, deferred: readonly OrderRef[]) {
  const snapshot: PlanSnapshot = {
    date: ctx.input.date,
    depot: ctx.input.depot,
    config: {
      ...DEFAULT_PLAN_CONFIG,
      predawnBudget: ctx.config.predawnBudget,
      daytimeBudget: ctx.config.daytimeBudget,
      maxTripsPerVehicle: ctx.config.maxTripsPerVehicle,
      enforceFuelQuota: ctx.config.enforceFuelQuota ? "error" : "off",
      freshDeadline: ctx.config.freshDeadline,
      reloadMin: ctx.config.reloadMin,
    },
    reference: {
      vehicles: new Map(ctx.input.vehicles.map((v) => [v.vehicleId, v])),
      outlets: ctx.outlets,
      districts: ctx.districts,
      allowance: ctx.allowance,
      vehicleStatus: new Map(
        ctx.input.vehicles.map((v) => [v.vehicleId, v.available ? ("AVAILABLE" as const) : ("IN_WORKSHOP" as const)]),
      ),
      fuel: new Map(
        [...ctx.vehicleState.values()].map((s) => [
          s.vehicle.vehicleId,
          { quotaL: s.quotaL, committedOtherDaysL: s.committedOtherDaysL },
        ]),
      ),
      travel: ctx.matrix,
    },
    orders: new Map(ctx.input.orders.map((o) => [o.ref, o])),
    trips: ctx.trips
      .filter((t) => ordersOf(t).length > 0)
      .map((t) => ({
        vehicleId: t.vehicle.vehicleId,
        tripNo: t.tripNo,
        departAt: t.departAt,
        stops: t.stops.map((s, i) => ({ seq: i, outletId: s.outletId, orderRefs: stopRefs(s.orders) })),
      })),
    deferred: deferred.map((o) => ({ orderRef: o.ref, reasonCode: "PENDING" })),
  };
  return validatePlan(snapshot, { stage: "draft" });
}

/**
 * A stable fingerprint of an allocation. Two runs over the same input must
 * produce the same string; the determinism test relies on it.
 */
export function hashAllocation(trips: readonly AllocatedTrip[], deferred: readonly DeferredOrder[]): string {
  const parts: string[] = [];
  for (const t of trips) {
    parts.push(
      `${t.vehicleId}#${t.tripNo}@${t.departAt}:${t.stops.map((s) => `${s.outletId}(${s.orderRefs.join("+")})`).join(">")}`,
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
