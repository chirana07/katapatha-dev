import type { components } from "@katapatha/contracts/types";
import type { Tone } from "../../../components/ui/status-pill";
import { ageLabel } from "../../../lib/format";

type VehicleRow = components["schemas"]["VehicleRow"];
type FleetSummary = components["schemas"]["FleetSummary"];
type VehicleDayState = components["schemas"]["VehicleDayState"];
type Chiller = components["schemas"]["ChillerReadingView"];
type Trip = components["schemas"]["VehicleTripSummary"];

export type VehicleTab = "all" | "available" | "on-route" | "workshop";

export const TAB_ORDER: { key: VehicleTab; label: string }[] = [
  { key: "all", label: "All" },
  { key: "available", label: "Available" },
  { key: "on-route", label: "On route" },
  { key: "workshop", label: "Workshop" },
];

/** An unknown `?tab=` is the full list, never an error page. */
export function parseTab(value: string | string[] | undefined): VehicleTab {
  const first = Array.isArray(value) ? value[0] : value;
  return TAB_ORDER.some((tab) => tab.key === first) ? (first as VehicleTab) : "all";
}

export const STATUS_VIEW: Record<VehicleDayState, { label: string; tone: Tone }> = {
  AVAILABLE: { label: "Available", tone: "good" },
  LOADING: { label: "Loading", tone: "warn" },
  ON_ROUTE: { label: "On route", tone: "info" },
  RETURNED: { label: "Returned", tone: "neutral" },
  IN_WORKSHOP: { label: "In workshop", tone: "bad" },
};

/**
 * "Available" is the same set as the KPI above it: every vehicle that can run
 * today, which includes the ones already loading, out or back. A tab that
 * counted only idle vehicles would disagree with the "Available today" card
 * beside it, so the idle count is shown as a footnote on the card instead.
 */
export function matchesTab(row: VehicleRow, tab: VehicleTab): boolean {
  switch (tab) {
    case "all":
      return true;
    case "available":
      return row.status !== "IN_WORKSHOP";
    case "on-route":
      return row.status === "ON_ROUTE";
    case "workshop":
      return row.status === "IN_WORKSHOP";
  }
}

/** Vehicle id or driver name, case-insensitive; blank matches everything. */
export function matchesQuery(row: VehicleRow, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return row.vehicleId.toLowerCase().includes(needle) || (row.driverName ?? "").toLowerCase().includes(needle);
}

export function filterVehicles(rows: VehicleRow[], tab: VehicleTab, query: string): VehicleRow[] {
  return rows.filter((row) => matchesTab(row, tab) && matchesQuery(row, query));
}

/** The tab counts come from the API's summary so they never depend on the search box. */
export function tabCounts(summary: FleetSummary): Record<VehicleTab, number> {
  return {
    all: summary.total,
    available: summary.available,
    "on-route": summary.onRoute,
    workshop: summary.inWorkshop,
  };
}

export function typeLabel(row: Pick<VehicleRow, "temp">): "Refrigerated" | "Ambient" {
  return row.temp === "reefer" ? "Refrigerated" : "Ambient";
}

export function vehicleKind(row: Pick<VehicleRow, "type">): string {
  return row.type === "van" ? "Van" : "Truck";
}

/** "30 m³ · 5 t" — tonnes drop a trailing zero, so 4800 kg reads "4.8 t". */
export function capacityLabel(row: Pick<VehicleRow, "volumeCapM3" | "weightCapKg">): string {
  const tonnes = Math.round(row.weightCapKg / 100) / 10;
  return `${row.volumeCapM3} m³ · ${tonnes} t`;
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0]![0]!;
  const last = parts.length > 1 ? parts[parts.length - 1]![0]! : "";
  return (first + last).toUpperCase();
}

export const TRIP_STATUS_VIEW: Record<Trip["status"], { label: string; tone: Tone }> = {
  PLANNED: { label: "Planned", tone: "neutral" },
  LOADING: { label: "Loading", tone: "warn" },
  READY: { label: "Ready", tone: "warn" },
  DEPARTED: { label: "On route", tone: "info" },
  COMPLETED: { label: "Completed", tone: "good" },
  CANCELLED: { label: "Cancelled", tone: "neutral" },
};

/**
 * A chiller reading, worded as what it is: a person's reading of a gauge.
 * The caller prints `headline` and `byline` on separate lines.
 */
export function chillerSummary(chiller: Chiller): {
  headline: string;
  target: string;
  inRange: boolean;
  byline: string;
} {
  const where = chiller.source === "LOADER_AT_BAY" ? "at the bay" : "on arrival";
  const who = chiller.recordedByName ?? "someone";
  return {
    headline: `${chiller.tempC} °C`,
    target: `Target ${chiller.targetMinC}–${chiller.targetMaxC} °C`,
    inRange: chiller.inRange,
    byline: `A reading, by ${who} ${where}, ${ageLabel(chiller.ageSeconds)}`,
  };
}
