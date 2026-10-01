import type { components } from "@katapatha/contracts/types";

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

export const STOP_STATUS_STYLE: Record<StopStatus, { pill: string; dot: string }> = {
  PENDING: { pill: "border border-line bg-raised text-ink", dot: "bg-muted" },
  ARRIVED: { pill: "border border-amber-300 bg-amber-50 text-amber-900", dot: "bg-action" },
  UNLOADING: { pill: "border border-amber-300 bg-amber-50 text-amber-900", dot: "bg-action" },
  DONE: { pill: "border border-emerald-200 bg-emerald-50 text-emerald-800", dot: "bg-emerald-600" },
  SKIPPED: { pill: "border border-line bg-raised text-muted", dot: "bg-muted" },
  FAILED: { pill: "border border-red-300 bg-red-50 text-critical", dot: "bg-critical" },
};

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
