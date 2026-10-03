import type { components } from "@katapatha/contracts/types";
import type { Tone } from "../../../components/ui/status-pill";
import { ageLabel, clockTime } from "../../../lib/format";

export type MapVehicle = components["schemas"]["MapVehicle"];
type MapState = components["schemas"]["MapState"];
type Summary = components["schemas"]["FleetPositions"]["summary"];

export type MapFilter = "all" | "late" | "lamp";

export const FILTERS: { key: MapFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "late", label: "Late" },
  { key: "lamp", label: "Lamp Mode" },
];

export function parseFilter(value: string | string[] | undefined): MapFilter {
  const first = Array.isArray(value) ? value[0] : value;
  return FILTERS.some((f) => f.key === first) ? (first as MapFilter) : "all";
}

/**
 * How each state is drawn. Colour is never the only carrier: every state has a
 * label, and Lamp Mode is also hollow and dashed, so it reads in greyscale and
 * for anyone who cannot tell green from amber. The class strings are written out
 * in full because Tailwind only generates utilities it can find in the source.
 */
export const STATE_VIEW: Record<
  MapState,
  { label: string; tone: Tone; fill: string; stroke: string; leg: string; iconTile: string }
> = {
  ON_TIME: { label: "On time", tone: "good", fill: "fill-good", stroke: "stroke-good", leg: "stroke-good", iconTile: "border border-good/25 bg-good-surface text-good-ink" },
  LATE: { label: "Late", tone: "warn", fill: "fill-warn", stroke: "stroke-warn", leg: "stroke-warn", iconTile: "border border-warn/30 bg-warn-surface text-warn-ink" },
  RETURNING: { label: "Returning", tone: "info", fill: "fill-info", stroke: "stroke-info", leg: "stroke-info", iconTile: "border border-info/25 bg-info-surface text-info-ink" },
  LAMP: { label: "Lamp Mode", tone: "warn", fill: "fill-surface", stroke: "stroke-warn", leg: "stroke-warn", iconTile: "border border-dashed border-warn bg-surface text-warn-ink" },
  NOT_STARTED: { label: "At the dock", tone: "neutral", fill: "fill-muted", stroke: "stroke-muted", leg: "stroke-muted", iconTile: "border border-line bg-raised text-muted" },
};

/** "Late 12 min" for a late vehicle, the plain state label otherwise. */
export function stateLabel(vehicle: Pick<MapVehicle, "state" | "lateMinutes">): string {
  return vehicle.state === "LATE" ? `Late ${vehicle.lateMinutes} min` : STATE_VIEW[vehicle.state].label;
}

export function matchesFilter(vehicle: MapVehicle, filter: MapFilter): boolean {
  if (filter === "late") return vehicle.state === "LATE";
  if (filter === "lamp") return vehicle.state === "LAMP";
  return true;
}

/** Vehicle id, driver, district, or the outlet it is heading for. */
export function matchesQuery(vehicle: MapVehicle, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return [
    vehicle.vehicleId,
    vehicle.driverName ?? "",
    vehicle.trip.districtName,
    vehicle.nextStop?.outletId ?? "",
    vehicle.nextStop?.outletName ?? "",
  ].some((field) => field.toLowerCase().includes(needle));
}

export function filterMapVehicles(vehicles: MapVehicle[], filter: MapFilter, query: string): MapVehicle[] {
  return vehicles.filter((v) => matchesFilter(v, filter) && matchesQuery(v, query));
}

/** Chip counts come from the API summary so they never depend on the search box. */
export function filterCounts(summary: Summary): Record<MapFilter, number> {
  return { all: summary.all, late: summary.late, lamp: summary.lamp };
}

/** Vehicles that have a position to draw. A never-reported vehicle is listed, not placed. */
export function plottable(vehicles: MapVehicle[]): (MapVehicle & { position: NonNullable<MapVehicle["position"]> })[] {
  return vehicles.filter((v): v is MapVehicle & { position: NonNullable<MapVehicle["position"]> } => v.position !== null);
}

/** "06:42" — the clock time the phone took the fix, Colombo time. */
export function reportedAt(position: NonNullable<MapVehicle["position"]>): string {
  return clockTime(position.recordedAt);
}

/**
 * The line under a vehicle in the list: what its last report says, with its
 * age. Lamp Mode names the last *reliable* update; a vehicle at the dock that
 * has not reported is not an alarm, and one on the road that has not reported
 * says so plainly.
 */
export function reportLine(vehicle: MapVehicle): string {
  const { position } = vehicle;
  if (!position) return vehicle.state === "NOT_STARTED" ? "At the dock" : "No position reported yet";
  const age = ageLabel(position.ageSeconds);
  return vehicle.state === "LAMP" ? `Last reliable update ${age}` : `Reported ${age}`;
}

/** The estimate, worded as one: an ETA is a guess, and under Lamp Mode a weaker one. */
export function etaLabel(vehicle: Pick<MapVehicle, "state" | "nextStop">): string | null {
  if (!vehicle.nextStop) return null;
  return vehicle.state === "LAMP" ? `about ${vehicle.nextStop.eta}, estimated` : `${vehicle.nextStop.eta}, estimated`;
}

/** "Stop 2 of 4" for a vehicle with stops left, "Returning · all stops done" otherwise. */
export function progressLine(vehicle: MapVehicle): string {
  const stop = vehicle.nextStop;
  if (!stop) return vehicle.state === "NOT_STARTED" ? "Not yet departed" : "All stops done";
  return `Stop ${stop.stopNumber} of ${stop.totalStops}`;
}
