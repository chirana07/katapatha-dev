import type { components } from "@katapatha/contracts/types";
import type { Tone } from "@/components/ui/status-pill";
import { shortfallState } from "./line-state";
import { formatTemp } from "./shortage";
import { TRIP_STATUS_LABEL, type Trip, type TripStatus } from "./wave";

/**
 * What the dock screens derive from trips and their load lists.
 *
 * Everything here is pure so the three pages (Dock, Loading progress, Reports)
 * agree on what "loaded", "checked" and "needs attention" mean — they used to
 * each count their own way.
 */

export type LoadLine = components["schemas"]["LoadList"]["lines"][number];
export type LoadCondition = NonNullable<LoadLine["condition"]>;

export type LoadTally = {
  lines: number;
  /** Lines with a recorded check (units and condition both present). */
  checked: number;
  /** Lines recorded as short, damaged or missing. */
  flagged: number;
  /** Units on the load list. */
  expectedUnits: number;
  /** Units the dock has recorded as loaded, over checked lines only. */
  loadedUnits: number;
  /** Units missing on flagged lines: ordered minus loaded, never negative. */
  shortUnits: number;
  /** Flagged lines whose shortfall is still open with the dispatcher. */
  awaiting: number;
  /** Units missing on those lines only. */
  awaitingUnits: number;
  /** Distinct delivery stops (a stop can carry several orders). */
  stops: number;
};

export function tallyLines(lines: LoadLine[]): LoadTally {
  let checked = 0;
  let flagged = 0;
  let expectedUnits = 0;
  let loadedUnits = 0;
  let shortUnits = 0;
  let awaiting = 0;
  let awaitingUnits = 0;
  for (const line of lines) {
    expectedUnits += line.expectedUnits;
    if (line.condition == null || line.loadedUnits == null) continue;
    checked += 1;
    loadedUnits += line.loadedUnits;
    if (line.condition !== "OK") {
      flagged += 1;
      const missing = Math.max(line.expectedUnits - line.loadedUnits, 0);
      shortUnits += missing;
      if (shortfallState(line) === "waiting") {
        awaiting += 1;
        awaitingUnits += missing;
      }
    }
  }
  return {
    lines: lines.length,
    checked,
    flagged,
    expectedUnits,
    loadedUnits,
    shortUnits,
    awaiting,
    awaitingUnits,
    stops: new Set(lines.map((line) => line.seq)).size,
  };
}

/** A trip with what the dock knows about it. `load` is null when its load list
 *  could not be read, so a page shows "unknown" rather than a confident zero. */
export type DockTrip = Trip & {
  load: LoadTally | null;
  lines: LoadLine[];
  refrigerated: boolean;
};

/** Sealed for the road: the vehicle is released or already gone. */
export function isLoaded(status: TripStatus): boolean {
  return status === "READY" || status === "DEPARTED" || status === "COMPLETED";
}

/** Departure order across waves; trips with no time go last. */
export function byDeparture(a: Trip, b: Trip): number {
  const aTime = a.plannedDepartAt ?? "99:99";
  const bTime = b.plannedDepartAt ?? "99:99";
  if (aTime !== bTime) return aTime < bTime ? -1 : 1;
  if (a.tripNo !== b.tripNo) return a.tripNo - b.tripNo;
  return a.vehicleId.localeCompare(b.vehicleId);
}

export function statusTone(status: TripStatus): Tone {
  switch (status) {
    case "LOADING":
      return "info";
    case "READY":
      return "good";
    case "CANCELLED":
      return "bad";
    default:
      return "neutral";
  }
}

export type DockCounts = {
  total: number;
  loaded: number;
  loading: number;
  planned: number;
  loadedPercent: number;
};

export function dockCounts(trips: Pick<Trip, "status">[]): DockCounts {
  const live = trips.filter((trip) => trip.status !== "CANCELLED");
  const loaded = live.filter((trip) => isLoaded(trip.status)).length;
  return {
    total: live.length,
    loaded,
    loading: live.filter((trip) => trip.status === "LOADING").length,
    planned: live.filter((trip) => trip.status === "PLANNED").length,
    loadedPercent: live.length > 0 ? Math.round((loaded / live.length) * 100) : 0,
  };
}

/** Whole-number percentage of units on board, 0 when there is nothing to load. */
export function unitsPercent(tally: LoadTally | null): number {
  if (!tally || tally.expectedUnits <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((tally.loadedUnits / tally.expectedUnits) * 100)));
}

export type Attention =
  | { kind: "shortage"; flagged: number; shortUnits: number }
  | { kind: "chiller"; tempC: number }
  | { kind: "overdue" }
  | { kind: "departing-soon"; minutes: number; unchecked: number };

/** How close to departure counts as "soon" for a vehicle that is not loaded. */
export const DEPARTING_SOON_MINUTES = 30;

export type DockClock = {
  /** The day being viewed, as YYYY-MM-DD. */
  date: string;
  /** Today in Colombo. Time-based checks only make sense when they match. */
  today: string;
  /** Minutes since Colombo midnight. */
  minutesNow: number;
};

function clockMinutes(clock: string): number {
  const [h, m] = clock.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

/**
 * Why a trip that is still at the dock deserves a second look.
 *
 * A shortage is state-based and true on any day. The two timing checks apply
 * only to today: on a past day every departure time has gone and flagging all
 * of them would be noise, and on a future day nothing is late yet. There is no
 * loading-rate data (load checks carry no timestamps in the API), so "behind"
 * is never inferred from pace — only from the clock against the planned
 * departure.
 */
export function attentionFor(trip: DockTrip, clock: DockClock): Attention[] {
  if (trip.status !== "PLANNED" && trip.status !== "LOADING") return [];
  const found: Attention[] = [];
  const load = trip.load;
  // The API's `blocked` is the authority on whether a shortfall holds the trip;
  // the per-line tally is only a fallback if it is absent. Lines the dispatcher
  // has already cleared are not a reason to look again.
  const held = trip.blocked ?? (load ? load.awaiting > 0 : false);
  if (held && load) {
    found.push({
      kind: "shortage",
      flagged: Math.max(load.awaiting, 1),
      shortUnits: load.awaitingUnits,
    });
  }
  if (trip.refrigerated && trip.chiller && !trip.chiller.inRange) {
    found.push({ kind: "chiller", tempC: trip.chiller.tempC });
  }
  if (clock.date === clock.today && trip.plannedDepartAt) {
    const minutes = clockMinutes(trip.plannedDepartAt) - clock.minutesNow;
    const unchecked = load ? load.lines - load.checked : 0;
    if (minutes < 0) found.push({ kind: "overdue" });
    else if (minutes <= DEPARTING_SOON_MINUTES && unchecked > 0) {
      found.push({ kind: "departing-soon", minutes, unchecked });
    }
  }
  return found;
}

export function attentionLabel(item: Attention): string {
  switch (item.kind) {
    case "shortage":
      return item.shortUnits > 0 ? `Short ${item.shortUnits} \u00b7 waiting` : "Issue \u00b7 waiting";
    case "chiller":
      return `Chiller ${formatTemp(item.tempC)}`;
    case "overdue":
      return "Past departure time";
    case "departing-soon":
      return `Departs in ${item.minutes} min`;
  }
}

/** The lead status for a queue row: the first thing that needs attention, else
 *  the trip's own status. Tone follows severity, label always says it in words. */
export function queueStatus(trip: DockTrip, attention: Attention[]): { label: string; tone: Tone } {
  const first = attention[0];
  if (first?.kind === "shortage" || first?.kind === "chiller") return { label: attentionLabel(first), tone: "bad" };
  if (first) return { label: attentionLabel(first), tone: "warn" };
  return { label: TRIP_STATUS_LABEL[trip.status], tone: statusTone(trip.status) };
}

/** The first trip the loader should open next: loading beats planned, then
 *  departure order. Null when everything is released. */
export function nextToLoad(trips: DockTrip[]): DockTrip | null {
  const open = trips.filter((trip) => trip.status === "LOADING" || trip.status === "PLANNED");
  const loading = open.filter((trip) => trip.status === "LOADING").sort(byDeparture);
  return loading[0] ?? open.sort(byDeparture)[0] ?? null;
}

export type StopGroup = {
  /** Delivery sequence, zero-based, as the API sends it. */
  seq: number;
  outletId: string;
  /** 1 for the stop to load first. */
  loadOrder: number;
  lines: LoadLine[];
  tally: LoadTally;
  state: "done" | "partial" | "untouched";
};

/**
 * The load list as the dock works it: one group per delivery stop, in the
 * order they go onto the vehicle. The API already returns lines in reverse
 * delivery order, so first appearance of a stop is its loading order; this
 * relies on that and does not re-sort, because the order is part of the
 * contract, not a client decision.
 */
export function groupByStop(lines: LoadLine[]): StopGroup[] {
  const groups = new Map<number, LoadLine[]>();
  for (const line of lines) {
    const bucket = groups.get(line.seq);
    if (bucket) bucket.push(line);
    else groups.set(line.seq, [line]);
  }
  return [...groups.entries()].map(([seq, stopLines], index) => {
    const tally = tallyLines(stopLines);
    return {
      seq,
      outletId: stopLines[0]!.outletId,
      loadOrder: index + 1,
      lines: stopLines,
      tally,
      state: tally.checked === tally.lines ? "done" : tally.checked === 0 ? "untouched" : "partial",
    };
  });
}

const ORDINAL = ["first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth"];

/** "Load first" … "Load last". A lone stop is simply "Only stop". */
export function loadOrderLabel(loadOrder: number, stops: number): string {
  if (stops === 1) return "Only stop";
  if (loadOrder === stops) return "Load last";
  return `Load ${ORDINAL[loadOrder - 1] ?? `${loadOrder}th`}`;
}

/** Minutes since midnight on the Colombo wall clock. */
export function colomboMinutes(now: Date = new Date()): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Colombo",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  return get("hour") * 60 + get("minute");
}

/** Released with checks missing — true of the seeded departed trips, and of a
 *  vehicle released from another terminal. Its 0% is "not recorded", not "empty". */
export function checksMissing(trip: Pick<DockTrip, "status" | "load">): boolean {
  return isLoaded(trip.status) && trip.load != null && trip.load.checked < trip.load.lines;
}
