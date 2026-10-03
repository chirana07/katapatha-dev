import type { components } from "@katapatha/contracts/types";

export type Trip = components["schemas"]["Trip"];
export type Wave = components["schemas"]["Wave"];
export type TripStatus = components["schemas"]["TripStatus"];

export const WAVE_ORDER: Wave[] = ["PREDAWN", "DAYTIME"];

export const WAVE_LABEL: Record<Wave, string> = {
  PREDAWN: "Predawn wave",
  DAYTIME: "Daytime wave",
};

export const WAVE_WINDOW: Record<Wave, string> = {
  PREDAWN: "Fresh · from 03:30",
  DAYTIME: "Style and Tech · from 08:30",
};

export const TRIP_STATUS_LABEL: Record<TripStatus, string> = {
  PLANNED: "Planned",
  LOADING: "Loading",
  READY: "Ready",
  DEPARTED: "Departed",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
};

export function groupByWave<T extends Trip>(trips: T[]): { wave: Wave; trips: T[] }[] {
  const buckets = new Map<Wave, T[]>();
  for (const wave of WAVE_ORDER) buckets.set(wave, []);
  for (const trip of trips) {
    const list = buckets.get(trip.wave) ?? [];
    list.push(trip);
    buckets.set(trip.wave, list);
  }
  for (const list of buckets.values()) list.sort(compareTrips);
  return WAVE_ORDER.map((wave) => ({ wave, trips: buckets.get(wave) ?? [] })).filter(
    (group) => group.trips.length > 0,
  );
}

function compareTrips(a: Trip, b: Trip): number {
  const aTime = a.plannedDepartAt ?? "99:99";
  const bTime = b.plannedDepartAt ?? "99:99";
  if (aTime !== bTime) return aTime < bTime ? -1 : 1;
  if (a.tripNo !== b.tripNo) return a.tripNo - b.tripNo;
  return a.vehicleId.localeCompare(b.vehicleId);
}
