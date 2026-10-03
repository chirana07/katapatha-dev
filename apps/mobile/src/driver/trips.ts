import { isTerminal, type StopStatus } from "./stop-state";

/**
 * Trips over the flat, projected stop list.
 *
 * `snapshot.stops` stays flat (ordered trip then seq); the Trip screen asks for
 * the stops of one trip. Status is the PROJECTED one, so a stop the driver has
 * just completed with no signal already counts as done here, exactly as it does
 * on the stop card.
 */

type TripStop = {
  tripId: string;
  tripNo: number;
  projection: { status: StopStatus };
};

export type Trip<T extends TripStop> = {
  tripId: string;
  tripNo: number;
  stops: T[];
};

/** Groups stops by trip, ordered by trip number; stop order within a trip is kept. */
export function tripsOf<T extends TripStop>(stops: readonly T[]): Trip<T>[] {
  const byTrip = new Map<string, Trip<T>>();
  for (const stop of stops) {
    const trip = byTrip.get(stop.tripId) ?? { tripId: stop.tripId, tripNo: stop.tripNo, stops: [] };
    trip.stops.push(stop);
    byTrip.set(stop.tripId, trip);
  }
  return [...byTrip.values()].sort((a, b) => a.tripNo - b.tripNo);
}

/**
 * The trip to show: the one holding the next unfinished stop (the first, in trip
 * order), else the last trip. 0 for an empty list, so `trips[index]` is simply
 * undefined and the caller shows its empty state.
 */
export function activeTripIndex<T extends TripStop>(trips: readonly Trip<T>[]): number {
  const open = trips.findIndex((trip) =>
    trip.stops.some((stop) => !isTerminal(stop.projection.status)),
  );
  if (open !== -1) return open;
  return Math.max(0, trips.length - 1);
}

export function tripProgress<T extends TripStop>(
  trip: Trip<T>,
): { done: number; total: number; percent: number } {
  const total = trip.stops.length;
  const done = trip.stops.filter((stop) => isTerminal(stop.projection.status)).length;
  return { done, total, percent: total === 0 ? 0 : Math.round((done / total) * 100) };
}
