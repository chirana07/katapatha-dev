/**
 * Putting a vehicle's trips in order on its day.
 *
 * A vehicle runs at most two trips, and one vehicle cannot be on two roads at
 * once: the second trip may leave only after the first has returned to the depot
 * and the vehicle has been unloaded and reloaded. Each trip has a window in
 * which it may depart (its wave, and the latest departure at which it still
 * makes its stops), and how long it takes depends on when it leaves, because
 * waiting for a window to open is part of it.
 *
 * Trips are described by functions of the departure time, in minutes since
 * midnight, so this module needs to know nothing about roads, windows or brands.
 * `returnAt` must not decrease as the departure gets later, which holds for any
 * schedule that only ever waits and never skips ahead.
 */

export interface VehicleDayTrip {
  id: string;
  /** Earliest the trip may leave, in minutes: the start of its wave. */
  earliest: number;
  /** Latest the trip may leave and still make every stop, in minutes. */
  latest: number;
  /** When the trip is back at the depot if it leaves at `departMin`. */
  returnAt(departMin: number): number;
}

export interface VehicleDay {
  /** Trip ids in the order they run. */
  order: string[];
  departs: ReadonlyMap<string, number>;
  returns: ReadonlyMap<string, number>;
}

/**
 * A departure for each trip so that, in some order, the second leaves at least
 * `reloadMin` after the first returns; or `null` when no order works.
 *
 * Each trip leaves as late as it can. A later departure keeps chilled goods in
 * the depot's cold room rather than idling at a closed outlet, and leaves slack
 * for the other trip, so the choice is the same one the dispatcher wants.
 *
 * When both orders work, the one whose first trip has the earlier wave is used
 * (Fresh before Style and Tech), then the one whose first trip must leave
 * sooner, then the order given, so the answer never depends on input order.
 */
export function scheduleVehicleDay(trips: readonly VehicleDayTrip[], reloadMin: number): VehicleDay | null {
  if (trips.length === 0) return { order: [], departs: new Map(), returns: new Map() };
  const sorted = [...trips].sort((a, b) => a.earliest - b.earliest || a.latest - b.latest || (a.id < b.id ? -1 : 1));

  if (sorted.length === 1) {
    const t = sorted[0]!;
    if (t.earliest > t.latest) return null;
    return {
      order: [t.id],
      departs: new Map([[t.id, t.latest]]),
      returns: new Map([[t.id, t.returnAt(t.latest)]]),
    };
  }
  if (sorted.length > 2) throw new Error("A vehicle runs at most two trips a day.");

  const orders: [VehicleDayTrip, VehicleDayTrip][] = [
    [sorted[0]!, sorted[1]!],
    [sorted[1]!, sorted[0]!],
  ];
  for (const [first, second] of orders) {
    const placed = place(first, second, reloadMin);
    if (placed) return placed;
  }
  return null;
}

function place(first: VehicleDayTrip, second: VehicleDayTrip, reloadMin: number): VehicleDay | null {
  if (first.earliest > first.latest || second.earliest > second.latest) return null;

  // Soonest the second trip could possibly leave: the first goes at its earliest.
  const secondEarliest = Math.max(second.earliest, first.returnAt(first.earliest) + reloadMin);
  if (secondEarliest > second.latest) return null;

  // The second goes as late as it can; the first then goes as late as still
  // leaves time to get back, unload and reload before that.
  const secondDepart = second.latest;
  let low = first.earliest;
  let high = first.latest;
  let firstDepart = first.earliest;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    if (first.returnAt(mid) + reloadMin <= secondDepart) {
      firstDepart = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  return {
    order: [first.id, second.id],
    departs: new Map([
      [first.id, firstDepart],
      [second.id, secondDepart],
    ]),
    returns: new Map([
      [first.id, first.returnAt(firstDepart)],
      [second.id, second.returnAt(secondDepart)],
    ]),
  };
}
