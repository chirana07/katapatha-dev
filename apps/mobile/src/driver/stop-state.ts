import type { components } from "@katapatha/contracts/types";

/**
 * The driver stop state machine.
 *
 * Copied from apps/web/src/app/driver/stop-state.ts so the native app and the
 * web console cannot disagree about what a status means or which action comes
 * next. The duplication is deliberate and temporary: promoting this into
 * @katapatha/core is a later move-only PR, because docs/CONVENTIONS.md bounces a
 * PR that both moves and changes code, and packages/core is BE1-owned.
 *
 * The one intended difference from the web copy: STOP_STATUS_STYLE held Tailwind
 * class strings, which mean nothing in React Native. It is replaced by
 * STOP_STATUS_TONE, a semantic union the StatusDot component maps to tokens.
 */
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

/**
 * Semantic tone, not a colour. StatusDot turns this into a token and always
 * renders a label beside the dot, because docs/DESIGN.md forbids conveying
 * status by colour alone.
 */
export type StatusTone = "neutral" | "active" | "good" | "bad";

export const STOP_STATUS_TONE: Record<StopStatus, StatusTone> = {
  PENDING: "neutral",
  ARRIVED: "active",
  UNLOADING: "active",
  DONE: "good",
  SKIPPED: "neutral",
  FAILED: "bad",
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
