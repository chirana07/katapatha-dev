/**
 * A trip's wall-clock schedule over the road network.
 *
 * `schedule.ts` walks a trip using the organisers' district table: one figure
 * for the way out and one for each hop. That is the metric their checker
 * applies, and it stays the compliance measure. This module walks the same trip
 * over real road legs between the depot and each outlet, in the order the stops
 * are given, so it can say when a vehicle really reaches each stop, whether it
 * makes the windows, how far it drives, and when it is back at the depot.
 *
 * Re-ordering stops cannot change the organisers' trip minutes (they charge per
 * order and have no geography), but it changes everything here, which is why
 * sequence is decided from this schedule and never from the district table.
 *
 * Legs are rounded up to whole minutes. Clock times in this system are whole
 * minutes, so rounding up keeps every arrival an honest "no earlier than" and
 * every window check conservative rather than optimistic.
 */

import { effectiveWindow, windowIsEmpty, type ScheduledStop } from "./schedule";
import { addMin, fromMin, toMin } from "./time";
import { depotKey, leg, outletKey, type TravelMatrix } from "./travel";
import { lookupAllowance, type AllowanceTable } from "./tripTime";
import type { Brand, ClockTime, DepotCode, DockType, OutletRef } from "./types";

export interface RoadStopInput {
  outletId: string;
  /** One dock entry per ORDER at this stop; handling is charged per order. */
  docks: DockType[];
}

export interface RoadScheduledStop extends ScheduledStop {
  /** Road minutes and kilometres of the leg that reaches this stop. */
  legMin: number;
  legKm: number;
  /** Minutes after the Fresh deadline this stop is reached; 0 when on time or not a Fresh trip. */
  freshLateByMin: number;
}

export interface RoadSchedule {
  stops: RoadScheduledStop[];
  returnAt: ClockTime;
  /** Absolute minutes since midnight at the depot, for sequencing a vehicle's day. */
  returnMin: number;
  /** Depot to depot, return leg included: fuel is burned on the way back too. */
  roadKm: number;
  /** Departure to return, waiting included. */
  roadMin: number;
  waitMin: number;
  /** Every stop is reached inside its window and, for Fresh, by the deadline. */
  feasible: boolean;
}

export interface RoadScheduleOptions {
  /** Fresh trips must reach every stop by this time. `null` or absent: no deadline. */
  freshDeadline?: ClockTime | null;
}

/** Whole minutes, rounded up, ignoring floating-point dust just above an integer. */
const wholeMin = (minutes: number): number => Math.ceil(minutes - 1e-9);

/** Whether the matrix can answer for a depot and every one of these outlets. */
export function matrixCovers(matrix: TravelMatrix, depot: DepotCode | string, outletIds: readonly string[]): boolean {
  return matrix.index.has(depotKey(depot)) && outletIds.every((id) => matrix.index.has(outletKey(id)));
}

/** Depot to every stop in order and back, in kilometres. */
export function roadKmOf(depot: DepotCode | string, outletIds: readonly string[], matrix: TravelMatrix): number {
  if (outletIds.length === 0) return 0;
  let km = 0;
  let at = depotKey(depot);
  for (const id of outletIds) {
    const to = outletKey(id);
    km += leg(matrix, at, to).km;
    at = to;
  }
  return km + leg(matrix, at, depotKey(depot)).km;
}

/**
 * Walk a trip's stops over the road network from a departure time. Stops are
 * taken in the order given; this function never reorders them.
 */
export function computeRoadSchedule(
  departAt: ClockTime,
  depot: DepotCode | string,
  brand: Brand,
  stops: readonly RoadStopInput[],
  outlets: ReadonlyMap<string, OutletRef>,
  matrix: TravelMatrix,
  allowance: AllowanceTable,
  options: RoadScheduleOptions = {},
): RoadSchedule {
  const deadline = brand === "Fresh" && options.freshDeadline ? toMin(options.freshDeadline) : null;
  const out: RoadScheduledStop[] = [];
  const departMin = toMin(departAt);
  let cursor = departMin;
  let at = depotKey(depot);
  let roadKm = 0;
  let waitMin = 0;
  let feasible = true;

  for (const stop of stops) {
    const outlet = outlets.get(stop.outletId);
    if (!outlet) throw new Error(`Unknown outlet in schedule: ${stop.outletId}`);

    const to = outletKey(stop.outletId);
    const hop = leg(matrix, at, to);
    const legMin = wholeMin(hop.min);
    roadKm += hop.km;

    const win = effectiveWindow(outlet);
    const arrival = cursor + legMin;
    const serviceStart = Math.max(arrival, toMin(win.open));
    const wait = serviceStart - arrival;
    const handling = stop.docks.reduce((sum, dock) => sum + lookupAllowance(allowance, brand, dock), 0);
    const leave = serviceStart + handling;
    // From service start, so a window that has no room in it is never met.
    const lateByMin = Math.max(0, serviceStart - toMin(win.close));
    const freshLateByMin = deadline === null ? 0 : Math.max(0, arrival - deadline);
    if (lateByMin > 0 || freshLateByMin > 0 || windowIsEmpty(outlet)) feasible = false;
    waitMin += wait;

    out.push({
      outletId: stop.outletId,
      arrival: fromMin(arrival),
      serviceStart: fromMin(serviceStart),
      leave: fromMin(leave),
      waitMin: wait,
      lateByMin,
      windowOpen: win.open,
      windowClose: win.close,
      isMallWindow: win.isMallWindow,
      legMin,
      legKm: hop.km,
      freshLateByMin,
    });

    cursor = leave;
    at = to;
  }

  // The way home. A trip with no stops goes nowhere.
  let returnMin = departMin;
  if (out.length > 0) {
    const home = leg(matrix, at, depotKey(depot));
    roadKm += home.km;
    returnMin = cursor + wholeMin(home.min);
  }

  return {
    stops: out,
    returnAt: fromMin(returnMin),
    returnMin,
    roadKm,
    roadMin: returnMin - departMin,
    waitMin,
    feasible,
  };
}

/**
 * The latest departure in [earliest, latest] at which every stop is reached
 * inside its window (and, for Fresh, by the deadline), or `null` when none is.
 *
 * Leaving later never makes a stop earlier, so feasibility is monotone in the
 * departure time and the latest feasible one is a binary search.
 */
export function latestRoadDeparture(
  depot: DepotCode | string,
  brand: Brand,
  stops: readonly RoadStopInput[],
  outlets: ReadonlyMap<string, OutletRef>,
  matrix: TravelMatrix,
  allowance: AllowanceTable,
  earliest: ClockTime,
  latest: ClockTime,
  options: RoadScheduleOptions = {},
): ClockTime | null {
  const lo = toMin(earliest);
  const hi = toMin(latest);
  if (stops.length === 0 || lo > hi) return null;

  const feasible = (departMin: number): boolean =>
    computeRoadSchedule(addMin("00:00", departMin), depot, brand, stops, outlets, matrix, allowance, options).feasible;

  if (!feasible(lo)) return null;

  let best = lo;
  let low = lo;
  let high = hi;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    if (feasible(mid)) {
      best = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return addMin("00:00", best);
}

