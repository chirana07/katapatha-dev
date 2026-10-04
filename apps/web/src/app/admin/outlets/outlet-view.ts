import type { components } from "@katapatha/contracts/types";
import type { Tone } from "@/components/ui/status-pill";
import { BRANDS, type DockType, type ParkingConstraint } from "./outlet-form";

export type Outlet = components["schemas"]["AdminOutlet"];
export type Directory = components["schemas"]["AdminDirectory"];
type Brand = components["schemas"]["Brand"];

export const OUTLETS_PATH = "/admin/outlets";

export interface OutletFilters {
  /** A depot code, or null for every depot. */
  depot: string | null;
  brand: Brand | "any";
  q: string;
}

type Query = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

/**
 * The page's filters from its search params; anything unrecognised means "no
 * filter". The depot is checked against the directory so a stale link to a
 * depot that is not there shows every outlet rather than an empty tab.
 */
export function parseFilters(query: Query, depotCodes: readonly string[]): OutletFilters {
  const depot = first(query.depot);
  const brand = first(query.brand);
  return {
    depot: depotCodes.includes(depot) ? depot : null,
    brand: (BRANDS as readonly string[]).includes(brand) ? (brand as Brand) : "any",
    q: first(query.q).trim().slice(0, 80),
  };
}

/**
 * The outlets narrowed by the filters. `ignore` lets the depot tab counts apply
 * every filter except the depot, so "Kandy (36)" still says 36 while the
 * Peliyagoda tab is open.
 */
export function filterOutlets(outlets: readonly Outlet[], filters: OutletFilters, ignore?: "depot"): Outlet[] {
  const needle = filters.q.toLowerCase();
  return outlets.filter((outlet) => {
    if (ignore !== "depot" && filters.depot && outlet.depotCode !== filters.depot) return false;
    if (filters.brand !== "any" && outlet.brand !== filters.brand) return false;
    return (
      needle === "" ||
      outlet.id.toLowerCase().includes(needle) ||
      (outlet.displayName ?? "").toLowerCase().includes(needle) ||
      outlet.districtName.toLowerCase().includes(needle)
    );
  });
}

/** How many outlets each depot tab holds, under the other filters. */
export function depotCounts(outlets: readonly Outlet[], filters: OutletFilters, depotCodes: readonly string[]): { all: number; byDepot: Record<string, number> } {
  const rest = filterOutlets(outlets, filters, "depot");
  const byDepot: Record<string, number> = Object.fromEntries(depotCodes.map((code) => [code, 0]));
  for (const outlet of rest) byDepot[outlet.depotCode] = (byDepot[outlet.depotCode] ?? 0) + 1;
  return { all: rest.length, byDepot };
}

/** A link back to the page keeping the filters, with the dialog (if any) the link opens. */
export function outletsHref(filters: OutletFilters, extra?: { edit?: string; add?: boolean }): string {
  const params = new URLSearchParams();
  if (filters.depot) params.set("depot", filters.depot);
  if (filters.brand !== "any") params.set("brand", filters.brand);
  if (filters.q) params.set("q", filters.q);
  if (extra?.edit) params.set("edit", extra.edit);
  if (extra?.add) params.set("add", "1");
  const qs = params.toString();
  return qs ? `${OUTLETS_PATH}?${qs}` : OUTLETS_PATH;
}

const DOCK_LABEL: Record<DockType, string> = { rear_dock: "Rear dock", street: "Street", mall_bay: "Mall bay" };
const PARKING_LABEL: Record<ParkingConstraint, string> = { normal: "Normal", van_only: "Vans only", mall_dock: "Mall dock" };

export function dockLabel(dock: DockType): string {
  return DOCK_LABEL[dock];
}

export function parkingLabel(parking: ParkingConstraint): string {
  return PARKING_LABEL[parking];
}

/** "05:00–08:30", with an en dash: the times stay the strings they arrived as. */
export function windowLabel(open: string, close: string): string {
  return `${open}–${close}`;
}

/** The mall window, when the outlet has one. */
export function mallWindowLabel(outlet: Pick<Outlet, "mallWindowOpen" | "mallWindowClose">): string | null {
  return outlet.mallWindowOpen && outlet.mallWindowClose ? windowLabel(outlet.mallWindowOpen, outlet.mallWindowClose) : null;
}

/** The name an outlet goes by: its own, or its id when it has none. */
export function outletName(outlet: Pick<Outlet, "id" | "displayName">): string {
  return outlet.displayName ?? outlet.id;
}

/**
 * Where the pin came from, in the words a planner cares about. A synthetic
 * position is only near the district centre, so routes to it are guesses —
 * that is the one worth a warning.
 */
export function positionLabel(outlet: Pick<Outlet, "geoSource" | "lat" | "lng">): { label: string; tone: Tone } {
  if (outlet.lat === null || outlet.lng === null || outlet.geoSource === null) return { label: "None", tone: "bad" };
  switch (outlet.geoSource) {
    case "SYNTHETIC":
      return { label: "Approximate", tone: "warn" };
    case "CSV":
      return { label: "From file", tone: "neutral" };
    case "DISPATCHER":
      return { label: "Set by hand", tone: "good" };
  }
}
