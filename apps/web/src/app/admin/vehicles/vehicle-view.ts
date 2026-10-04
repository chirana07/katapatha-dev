import type { components } from "@katapatha/contracts/types";
import { plural } from "@/lib/format";
import { VEHICLE_TEMPS, VEHICLE_TYPES, type VehicleTemp, type VehicleType } from "./vehicle-form";

export type AdminVehicle = components["schemas"]["AdminVehicle"];
export type Depot = components["schemas"]["AdminDirectory"]["depots"][number];

export const VEHICLES_PATH = "/admin/vehicles";

export interface VehicleFilters {
  /** A depot code, or null for every depot. */
  depot: string | null;
  temp: VehicleTemp | null;
  type: VehicleType | null;
}

type Query = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

/**
 * The page's filters from its search params; anything unrecognised means "no
 * filter". A depot is only kept when it is one the page knows, so a stale link
 * to a renamed depot shows the whole fleet rather than an empty tab.
 */
export function parseFilters(query: Query, depotCodes: readonly string[]): VehicleFilters {
  const depot = first(query.depot);
  const temp = first(query.temp);
  const type = first(query.type);
  return {
    depot: depotCodes.includes(depot) ? depot : null,
    temp: (VEHICLE_TEMPS as readonly string[]).includes(temp) ? (temp as VehicleTemp) : null,
    type: (VEHICLE_TYPES as readonly string[]).includes(type) ? (type as VehicleType) : null,
  };
}

/** "Refrigerated" or "Ambient": what the vehicle can carry, in the words dispatch uses. */
export function vehicleTempLabel(temp: VehicleTemp): string {
  return temp === "reefer" ? "Refrigerated" : "Ambient";
}

export function vehicleTypeLabel(type: VehicleType): string {
  return type === "truck" ? "Truck" : "Van";
}

/**
 * Every depot a tab or a select should offer: the directory's, plus any depot
 * a vehicle names that the directory did not (or the directory could not be
 * read), so no vehicle is ever unreachable by tab.
 */
export function knownDepots(directory: readonly Depot[] | null, vehicles: readonly AdminVehicle[]): Depot[] {
  const depots = [...(directory ?? [])];
  for (const vehicle of vehicles) {
    if (!depots.some((depot) => depot.code === vehicle.depotCode)) depots.push({ code: vehicle.depotCode, name: vehicle.depotCode });
  }
  return depots;
}

/**
 * The fleet narrowed by the filters. `ignore` lets the depot tab counts apply
 * every filter except the depot, so "Kandy (4)" still says 4 while another
 * depot's tab is open.
 */
export function filterFleet(vehicles: readonly AdminVehicle[], filters: VehicleFilters, ignore?: "depot"): AdminVehicle[] {
  return vehicles.filter((vehicle) => {
    if (ignore !== "depot" && filters.depot && vehicle.depotCode !== filters.depot) return false;
    if (filters.temp && vehicle.temp !== filters.temp) return false;
    if (filters.type && vehicle.type !== filters.type) return false;
    return true;
  });
}

/** Counts per depot code, plus `all`, under the other filters. */
export function depotCounts(vehicles: readonly AdminVehicle[], filters: VehicleFilters): { all: number; byDepot: Record<string, number> } {
  const rest = filterFleet(vehicles, filters, "depot");
  const byDepot: Record<string, number> = {};
  for (const vehicle of rest) byDepot[vehicle.depotCode] = (byDepot[vehicle.depotCode] ?? 0) + 1;
  return { all: rest.length, byDepot };
}

const trimmed = (value: number, digits: number) =>
  value.toLocaleString("en-GB", { minimumFractionDigits: 0, maximumFractionDigits: digits });

/** "4,000 kg · 18 m³" — a vehicle's capacity, as the allocator reads it. */
export function capacityLabel(vehicle: Pick<AdminVehicle, "weightCapKg" | "volumeCapM3">): string {
  return `${trimmed(vehicle.weightCapKg, 0)} kg · ${trimmed(vehicle.volumeCapM3, 1)} m³`;
}

/** "diesel · 8.5 km/L · 300 L a week". */
export function fuelLabel(vehicle: Pick<AdminVehicle, "fuelType" | "kmPerL" | "weeklyFuelQuotaL">): string {
  return `${vehicle.fuelType} · ${trimmed(vehicle.kmPerL, 1)} km/L · ${trimmed(vehicle.weeklyFuelQuotaL, 0)} L a week`;
}

/**
 * The line under the table: "7 vehicles · 3 refrigerated · total 156 m³", or
 * "3 of 7 vehicles · …" when filtered. The totals are for the rows shown, so
 * the line always describes what is on screen.
 */
export function fleetSummary(rows: readonly AdminVehicle[], total: number): string {
  const count = rows.length === total ? plural(total, "vehicle") : `${rows.length} of ${plural(total, "vehicle")}`;
  const reefers = rows.filter((vehicle) => vehicle.temp === "reefer").length;
  const volume = rows.reduce((sum, vehicle) => sum + vehicle.volumeCapM3, 0);
  return `${count} · ${reefers} refrigerated · total ${trimmed(volume, 1)} m³`;
}

/** A link back to the page keeping the filters, with the dialog (if any) the link opens. */
export function vehiclesHref(filters: VehicleFilters, extra?: { edit?: string; add?: boolean }): string {
  const params = new URLSearchParams();
  if (filters.depot) params.set("depot", filters.depot);
  if (filters.temp) params.set("temp", filters.temp);
  if (filters.type) params.set("type", filters.type);
  if (extra?.edit) params.set("edit", extra.edit);
  if (extra?.add) params.set("add", "1");
  const qs = params.toString();
  return qs ? `${VEHICLES_PATH}?${qs}` : VEHICLES_PATH;
}
