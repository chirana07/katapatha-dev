import type { components } from "@katapatha/contracts/types";
import type { Tone } from "@/components/ui/status-pill";

export type StopStatus = components["schemas"]["StopStatus"];

export const STOP_STATUS_LABEL: Record<StopStatus, string> = {
  PENDING: "Not arrived",
  ARRIVED: "On site",
  UNLOADING: "Unloading",
  DONE: "Delivered",
  SKIPPED: "Skipped",
  FAILED: "Failed",
};

export const STOP_STATUS_HINT: Record<StopStatus, string> = {
  PENDING: "Tap Record arrival when you reach the outlet.",
  ARRIVED: "On the dock. Tap Start unload when the hand-off begins.",
  UNLOADING: "Hand-off in progress. Complete the delivery when every line is off.",
  DONE: "Delivery recorded.",
  SKIPPED: "Skipped. Reason attached to the event.",
  FAILED: "Problem reported. Reason attached to the event.",
};

/** Tone for the shared StatusPill. Colour never carries the meaning alone: the label is always shown. */
export const STOP_STATUS_TONE: Record<StopStatus, Tone> = {
  PENDING: "neutral",
  ARRIVED: "warn",
  UNLOADING: "warn",
  DONE: "good",
  SKIPPED: "neutral",
  FAILED: "bad",
};

/**
 * The words on a stop's pill in the run list. An unstarted stop is "Next stop"
 * when it is the one the driver should do now and "Upcoming" otherwise; every
 * other status uses its own label.
 */
export function stopPillLabel(status: StopStatus, isNext: boolean): string {
  if (status === "PENDING") return isNext ? "Next stop" : "Upcoming";
  return STOP_STATUS_LABEL[status];
}

export type NextAction =
  | { kind: "arrive"; label: string }
  | { kind: "unload"; label: string }
  | { kind: "complete"; label: string }
  | { kind: "problem"; label: string }
  | { kind: "none"; label: string };

export function primaryAction(status: StopStatus): NextAction {
  switch (status) {
    case "PENDING":
      return { kind: "arrive", label: "Record arrival" };
    case "ARRIVED":
      return { kind: "unload", label: "Start unload" };
    case "UNLOADING":
      return { kind: "complete", label: "Complete delivery" };
    case "DONE":
      return { kind: "none", label: "Delivered" };
    case "SKIPPED":
    case "FAILED":
      return { kind: "none", label: STOP_STATUS_LABEL[status] };
  }
}

export function isTerminal(status: StopStatus): boolean {
  return status === "DONE" || status === "SKIPPED" || status === "FAILED";
}

export function stopsProgress(stops: { status: StopStatus }[]): {
  done: number;
  total: number;
  remaining: number;
  nextIndex: number | null;
} {
  const total = stops.length;
  const done = stops.filter((stop) => isTerminal(stop.status)).length;
  const nextIndex = stops.findIndex((stop) => !isTerminal(stop.status));
  return {
    done,
    total,
    remaining: total - done,
    nextIndex: nextIndex === -1 ? null : nextIndex,
  };
}

/**
 * Which trip the run page shows: the one asked for (`?trip=2`), else the first
 * trip that still has an open stop, else the last. A driver opening the page
 * between trips lands on the work in front of them, not on a finished trip.
 */
export function selectTrip<T extends { tripNo: number; stops: { status: StopStatus }[] }>(
  trips: T[],
  requested: number | null,
): T | null {
  if (trips.length === 0) return null;
  const asked = requested === null ? undefined : trips.find((trip) => trip.tripNo === requested);
  if (asked) return asked;
  return trips.find((trip) => trip.stops.some((stop) => !isTerminal(stop.status))) ?? trips[trips.length - 1]!;
}
