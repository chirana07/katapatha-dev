import type { Tone } from "@/components/ui/status-pill";
import { isLoaded, type LoadCondition, type DockTrip, type LoadLine } from "./dock-model";
import { resolutionLabel, shortfallState, type ShortfallState } from "./line-state";

/**
 * What the loader's Reports page may honestly say about a day.
 *
 * Everything is a count over trips and their load checks. There is deliberately
 * no "loaded on time", no average load time and no per-bay timeline: the API
 * gives a load check no timestamp and a trip no bay, so those figures would have
 * to be invented. Whether a reported shortage is still open is the
 * dispatcher's record, not the dock's, so shortages are counted as *reported*
 * and never split into open and resolved.
 */

export type ShortageRow = {
  tripId: string;
  vehicleId: string;
  tripNo: number;
  orderRef: string;
  outletId: string;
  condition: Exclude<LoadCondition, "OK">;
  expectedUnits: number;
  loadedUnits: number;
  shortBy: number;
  state: ShortfallState;
  /** What to say about the dispatcher's side of it. */
  outcome: string;
};

export type LogRow = {
  trip: DockTrip;
  result: { label: string; tone: Tone };
};

export type DayReport = {
  vehicles: { total: number; released: number };
  lines: { total: number; checked: number };
  units: { expected: number; loaded: number; percent: number };
  shortages: ShortageRow[];
  shortageUnits: number;
  /** Reported orders the dispatcher has not decided yet. */
  waiting: number;
  log: LogRow[];
};

function outcomeOf(line: LoadLine): string {
  switch (shortfallState(line)) {
    case "waiting":
      return "Waiting on the dispatcher";
    case "cleared":
      return resolutionLabel(line.shortfall?.resolution);
    default:
      return "Reported to the dispatcher";
  }
}

function shortageRows(trip: DockTrip): ShortageRow[] {
  return trip.lines
    .filter((line): line is LoadLine & { condition: Exclude<LoadCondition, "OK">; loadedUnits: number } => {
      return line.condition != null && line.condition !== "OK" && line.loadedUnits != null;
    })
    .map((line) => ({
      tripId: trip.id,
      vehicleId: trip.vehicleId,
      tripNo: trip.tripNo,
      orderRef: line.orderRef,
      outletId: line.outletId,
      condition: line.condition,
      expectedUnits: line.expectedUnits,
      loadedUnits: line.loadedUnits,
      shortBy: Math.max(line.expectedUnits - line.loadedUnits, 0),
      state: shortfallState(line),
      outcome: outcomeOf(line),
    }));
}

export function resultFor(trip: DockTrip): { label: string; tone: Tone } {
  const load = trip.load;
  if (!load) return { label: "Load list unavailable", tone: "neutral" };
  if (isLoaded(trip.status)) {
    // A vehicle can be released with no checks on record (the seeded departed
    // trips are); "loaded in full" would be a claim nothing backs.
    if (load.checked < load.lines) {
      return {
        label: load.checked === 0 ? "Released · no checks recorded" : `Released · ${load.checked} of ${load.lines} checked`,
        tone: "neutral",
      };
    }
    if (load.flagged === 0) return { label: "Loaded in full", tone: "good" };
    return {
      label: load.shortUnits > 0 ? `Released ${load.shortUnits} short` : `Released with ${load.flagged} reported`,
      tone: "warn",
    };
  }
  if (load.checked === 0) return { label: "Not started", tone: "neutral" };
  return { label: `Loading · ${load.checked} of ${load.lines} checked`, tone: "info" };
}

export function buildReport(trips: DockTrip[]): DayReport {
  const live = trips.filter((trip) => trip.status !== "CANCELLED");
  const lines = live.reduce(
    (sum, trip) => ({ total: sum.total + (trip.load?.lines ?? 0), checked: sum.checked + (trip.load?.checked ?? 0) }),
    { total: 0, checked: 0 },
  );
  const expected = live.reduce((sum, trip) => sum + (trip.load?.expectedUnits ?? 0), 0);
  const loaded = live.reduce((sum, trip) => sum + (trip.load?.loadedUnits ?? 0), 0);
  const shortages = live.flatMap(shortageRows);

  return {
    vehicles: { total: live.length, released: live.filter((trip) => isLoaded(trip.status)).length },
    lines,
    units: { expected, loaded, percent: expected > 0 ? Math.round((loaded / expected) * 100) : 0 },
    shortages,
    shortageUnits: shortages.reduce((sum, row) => sum + row.shortBy, 0),
    waiting: shortages.filter((row) => row.state === "waiting").length,
    log: live.map((trip) => ({ trip, result: resultFor(trip) })),
  };
}
