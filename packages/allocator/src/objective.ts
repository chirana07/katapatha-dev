/**
 * What "better" means for a plan.
 *
 *   J = - wServe   * sum over served orders of (1 + priority / 1000)
 *       + lambdaKm * road kilometres
 *       + lambdaTrip * trips
 *       + lambdaWait * minutes spent waiting for windows to open
 *       + lambdaScarce * orders on a vehicle more capable than they need
 *
 * Lower is better. The serve weight dwarfs everything else, so a plan that
 * serves one more order always beats one that merely drives less, and among
 * plans that serve the same orders, fewer kilometres (which is fuel) wins, then
 * fewer trips, then less waiting. Stating it as one number is what lets the
 * improvement pass compare any two plans the same way, and lets the dispatcher
 * be shown what the plan bought rather than told it is optimised.
 */

import type { OrderRef } from "@katapatha/core/domain/types";
import { priorityScore, type PriorityContext } from "./prioritise";
import { scarcity } from "./construct";
import { ordersOf, type Context, type StopBuild } from "./state";
import type { AllocatorVehicle, ObjectiveBreakdown, ObjectiveWeights } from "./types";

export function priorityContextOf(ctx: Context): PriorityContext {
  return { outlets: ctx.outlets, maxVolumeCapM3: Math.max(0, ...ctx.input.vehicles.map((v) => v.volumeCapM3)) };
}

/** What serving this order is worth: 1, plus up to 1.4 more for how overdue it is. */
export const servedWeightOf = (order: OrderRef, pctx: PriorityContext): number => 1 + priorityScore(order, pctx) / 1000;

/** The cost of a trip that does not depend on how many orders are served. */
export function tripCost(
  ctx: Context,
  vehicle: AllocatorVehicle,
  stops: readonly StopBuild[],
  roadKm: number,
  waitMin: number,
): number {
  const w = ctx.config.objective;
  let waste = 0;
  for (const stop of stops) {
    const outlet = ctx.outlets.get(stop.outletId)!;
    for (const order of stop.orders) waste += scarcity(vehicle, order, outlet);
  }
  return w.lambdaKm * roadKm + w.lambdaWait * waitMin + w.lambdaScarce * waste;
}

/** The plan as it stands, scored and itemised. */
export function objectiveOf(ctx: Context): ObjectiveBreakdown {
  const w: ObjectiveWeights = ctx.config.objective;
  const pctx = priorityContextOf(ctx);
  let servedWeight = 0;
  let roadKm = 0;
  let waitMin = 0;
  let waste = 0;
  for (const trip of ctx.trips) {
    roadKm += trip.roadKm;
    waitMin += trip.road.waitMin;
    for (const stop of trip.stops) {
      const outlet = ctx.outlets.get(stop.outletId)!;
      for (const order of stop.orders) {
        servedWeight += servedWeightOf(order, pctx);
        waste += scarcity(trip.vehicle, order, outlet);
      }
    }
  }
  const trips = ctx.trips.filter((t) => ordersOf(t).length > 0).length;
  const value =
    -w.wServe * servedWeight + w.lambdaKm * roadKm + w.lambdaTrip * trips + w.lambdaWait * waitMin + w.lambdaScarce * waste;
  return {
    value: Math.round(value * 1e6) / 1e6,
    servedWeight: Math.round(servedWeight * 1e6) / 1e6,
    roadKm: Math.round(roadKm * 100) / 100,
    trips,
    waitMin,
    scarcity: waste,
  };
}
