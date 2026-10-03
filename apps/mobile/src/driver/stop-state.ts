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
 * Intended differences from the web copy: STOP_STATUS_STYLE held Tailwind class
 * strings, which mean nothing in React Native, so it is replaced by
 * STOP_STATUS_TONE, a semantic union the components map to tokens; and the web's
 * primaryAction (record arrival, then start unload, then complete) is not carried
 * over, because "Start delivery" records arrival and unload together here
 * (driver/start-delivery.ts).
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
