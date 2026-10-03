import type { components } from "@katapatha/contracts/types";
import { TRIP_STATUS_LABEL, type TripStatus } from "./wave";

export type LineLike = {
  loadedUnits?: number | null;
  condition?: components["schemas"]["LoadCheck"]["condition"] | null;
};

export type LineState = "unchecked" | "ok" | "discrepancy" | "blocked";

export function lineState(line: LineLike): LineState {
  if (line.condition == null) return "unchecked";
  if (line.condition === "OK") return "ok";
  if (line.condition === "MISSING") return "blocked";
  return "discrepancy";
}

export type LineShortfall = { status: "OPEN" | "RESOLVED"; resolution?: string | null } | null | undefined;

export type ShortfallState = "none" | "waiting" | "cleared" | "reported";

/**
 * Where a reported line stands with the dispatcher. `waiting` is an open
 * shortfall holding the trip; `cleared` is one the dispatcher has decided
 * (a line sent short keeps its SHORT condition, so the condition alone cannot
 * say). `reported` is a non-OK line the API sent no shortfall for — unknown, so
 * it is not called either.
 */
export function shortfallState(line: LineLike & { shortfall?: LineShortfall }): ShortfallState {
  if (line.condition == null || line.condition === "OK") return "none";
  if (!line.shortfall) return "reported";
  return line.shortfall.status === "OPEN" ? "waiting" : "cleared";
}

const RESOLUTION_WORDS: Record<string, string> = {
  SEND_SHORT: "Sent short \u2014 dispatcher approved",
  HOLD_ORDER: "Order held by the dispatcher",
  MOVE_TO_TRIP_2: "Moved to trip 2 by the dispatcher",
  CANCEL_LINE: "Line cancelled by the dispatcher",
};

export function resolutionLabel(resolution: string | null | undefined): string {
  return (resolution && RESOLUTION_WORDS[resolution]) || "Cleared by the dispatcher";
}

export type ReadinessContext = {
  total: number;
  checked: number;
  /**
   * Lines recorded as short, damaged or missing. Informational: a line the
   * dispatcher has cleared keeps its SHORT condition, so this count must never
   * gate a release. `blocked` is what does.
   */
  flagged: number;
  /** An open shortfall is holding the trip (the API's `blocked`). The server's
   *  409 stays the real gate; this only stops the button promising what it
   *  cannot deliver. */
  blocked?: boolean;
  status: TripStatus;
};

/** A trip the loader can still release: nothing has sealed or left it yet. The
 *  first load check moves PLANNED to LOADING, so both count. */
export function isReleasable(status: TripStatus): boolean {
  return status === "PLANNED" || status === "LOADING";
}

export function canMarkReady(ctx: ReadinessContext): boolean {
  return isReleasable(ctx.status) && ctx.total > 0 && ctx.checked === ctx.total && !ctx.blocked;
}

export function readinessDisabledReason(ctx: ReadinessContext): string {
  if (!isReleasable(ctx.status)) {
    return `Trip is already ${TRIP_STATUS_LABEL[ctx.status].toLowerCase()} — readiness is not the loader's gate right now.`;
  }
  if (ctx.total === 0) return "No lines on this trip to check.";
  const unchecked = ctx.total - ctx.checked;
  if (unchecked > 0) return `${unchecked} of ${ctx.total} lines are still unchecked.`;
  if (ctx.blocked) return "Waiting on the dispatcher: a reported shortage still holds this vehicle.";
  return "";
}
