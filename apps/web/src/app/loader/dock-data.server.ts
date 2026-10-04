import "server-only";
import { cache } from "react";
import type { components } from "@katapatha/contracts/types";
import { api } from "@/lib/api";
import { byDeparture, tallyLines, type DockTrip, type LoadLine } from "./dock-model";
import type { Trip } from "./wave";

/**
 * The day's trips, joined with what the dock needs to judge them.
 *
 * There is no endpoint that returns a trip's progress, so progress is the load
 * list read once per trip. They are fetched together and `cache`d per request,
 * so the Dock, Loading progress and Reports pages — and the panel beside the
 * queue — never read the same list twice in one render.
 *
 * The two reference reads (vehicles, outlets) only decorate the board: a
 * "Refrigerated" tag and a district under each outlet id. If either fails the
 * board still works, so their failure is swallowed rather than surfaced.
 */

export type Vehicle = components["schemas"]["Vehicle"];
export type DockShift = components["schemas"]["DockShift"];

export type DockDay =
  | { ok: true; trips: DockTrip[]; districts: Record<string, string>; vehicles: Record<string, Vehicle> }
  | { ok: false; status: number };

async function reference() {
  const client = await api();
  const [vehicles, outlets] = await Promise.all([
    client.GET("/reference/vehicles").catch(() => null),
    client.GET("/reference/outlets").catch(() => null),
  ]);
  const byId: Record<string, Vehicle> = {};
  for (const vehicle of vehicles?.data ?? []) byId[vehicle.id] = vehicle;
  const districts: Record<string, string> = {};
  for (const outlet of outlets?.data ?? []) districts[outlet.id] = outlet.districtName;
  return { vehicles: byId, districts };
}

export const loadDock = cache(async (date: string): Promise<DockDay> => {
  const client = await api();
  const [result, refs] = await Promise.all([
    client.GET("/trips", { params: { query: { date } } }),
    reference(),
  ]);
  if (result.error || !result.data) return { ok: false, status: result.response.status };

  const live = result.data.filter((trip) => trip.status !== "CANCELLED").sort(byDeparture);
  const trips = await Promise.all(
    live.map(async (trip): Promise<DockTrip> => {
      const lines = await readLines(trip.id);
      return {
        ...trip,
        lines: lines ?? [],
        load: lines ? tallyLines(lines) : null,
        refrigerated: refs.vehicles[trip.vehicleId]?.temp === "reefer",
      };
    }),
  );
  return { ok: true, trips, districts: refs.districts, vehicles: refs.vehicles };
});

async function readLines(tripId: string): Promise<LoadLine[] | null> {
  try {
    const client = await api();
    const result = await client.GET("/trips/{tripId}/load-list", { params: { path: { tripId } } });
    return result.error || !result.data ? null : result.data.lines;
  } catch {
    return null;
  }
}

/**
 * One trip, for the loading-list page, which does not need every other trip's
 * list. `GET /trips/{id}` carries the vehicle, route, day, `blocked` and the
 * latest chiller reading, so the page works from a bare link with no `?date=`.
 * `trip` is null only if that read fails while the load list succeeded; the
 * lines still show, under a plain title.
 */
export type TripView =
  | {
      ok: true;
      trip: Trip | null;
      vehicle: Vehicle | null;
      status: Trip["status"];
      lines: LoadLine[];
      districts: Record<string, string>;
    }
  | { ok: false; status: number };

export async function loadTripView(tripId: string): Promise<TripView> {
  const client = await api();
  const [list, trip, refs] = await Promise.all([
    client.GET("/trips/{tripId}/load-list", { params: { path: { tripId } } }),
    client.GET("/trips/{tripId}", { params: { path: { tripId } } }).catch(() => null),
    reference(),
  ]);
  if (list.error || !list.data) return { ok: false, status: list.response.status };
  const found = trip?.data ?? null;
  return {
    ok: true,
    trip: found,
    vehicle: found ? (refs.vehicles[found.vehicleId] ?? null) : null,
    status: list.data.status,
    lines: list.data.lines,
    districts: refs.districts,
  };
}

/**
 * The dock's shift: bays, load timing, pace, the last seven nights and the
 * handover note. Null when it cannot be read — every panel that uses it has a
 * plain fallback, so a failed read hides the panel rather than the page.
 */
export const loadShift = cache(async (date: string): Promise<DockShift | null> => {
  try {
    const client = await api();
    const result = await client.GET("/dock/shift", { params: { query: { date } } });
    return result.error || !result.data ? null : result.data;
  } catch {
    return null;
  }
});
