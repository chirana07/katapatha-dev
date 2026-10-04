import type { components } from "@katapatha/contracts/types";
import { isDateOnly } from "@/lib/dates";

type DepotRow = components["schemas"]["AdminDepotRow"];
type Role = components["schemas"]["Role"];

export const OVERVIEW_PATH = "/admin";

/** On-time and utilisation targets, the same ones the depot reports show. */
export const ON_TIME_TARGET_PCT = 95;
export const UTILISATION_TARGET_PCT = 80;

export const ROLE_LABEL: Record<Role, string> = {
  DISPATCHER: "Dispatchers",
  LOADER: "Loaders",
  DRIVER: "Drivers",
  STORE_MANAGER: "Store managers",
  ADMIN: "Admins",
};

type Params = Record<string, string | string[] | undefined>;

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

/**
 * `?from=&to=`, passing on only real calendar days. A typo in the URL falls
 * back to the API's default week rather than a 422 on the page.
 */
export function parseRange(params: Params): { from?: string; to?: string } {
  const from = first(params.from);
  const to = first(params.to);
  return { ...(isDateOnly(from) ? { from } : {}), ...(isDateOnly(to) ? { to } : {}) };
}

/** "91.2%", or an em dash where nothing was recorded to compute it from. */
export function pctText(value: number | null): string {
  return value === null ? "—" : `${Number.isInteger(value) ? value : value.toFixed(1)}%`;
}

/** Whether a figure misses its target; null figures are not judged. */
export function belowTarget(value: number | null, target: number): boolean {
  return value !== null && value < target;
}

/**
 * Waypoint-wide figures from the depot rows. On-time is weighted by stops,
 * not averaged across depots, so a depot with three arrivals cannot move the
 * whole company's figure as much as one with three hundred.
 */
export function combine(rows: readonly DepotRow[]) {
  const stops = rows.reduce((sum, r) => sum + r.stops, 0);
  const onTimeStops = rows.reduce((sum, r) => sum + (r.onTimePct === null ? 0 : (r.onTimePct / 100) * r.stops), 0);
  const measured = rows.filter((r) => r.discrepancies !== null);
  return {
    onTimePct: stops === 0 ? null : Math.round((onTimeStops / stops) * 1000) / 10,
    stops,
    orders: rows.reduce((sum, r) => sum + r.orders, 0),
    delivered: rows.reduce((sum, r) => sum + r.delivered, 0),
    deferred: rows.reduce((sum, r) => sum + r.deferred, 0),
    discrepancies: measured.length === 0 ? null : measured.reduce((sum, r) => sum + (r.discrepancies ?? 0), 0),
  };
}
