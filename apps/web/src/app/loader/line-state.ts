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

export type ReadinessContext = {
  total: number;
  checked: number;
  openDiscrepancies: number;
  status: TripStatus;
};

export function canMarkReady(ctx: ReadinessContext): boolean {
  return (
    ctx.status === "PLANNED" &&
    ctx.total > 0 &&
    ctx.checked === ctx.total &&
    ctx.openDiscrepancies === 0
  );
}

export function readinessDisabledReason(ctx: ReadinessContext): string {
  if (ctx.status !== "PLANNED") {
    return `Trip is already ${TRIP_STATUS_LABEL[ctx.status].toLowerCase()} — readiness is not the loader's gate right now.`;
  }
  if (ctx.total === 0) return "No lines on this trip to check.";
  const unchecked = ctx.total - ctx.checked;
  if (unchecked > 0 && ctx.openDiscrepancies > 0) {
    return `${unchecked} of ${ctx.total} lines are still unchecked and ${ctx.openDiscrepancies} discrepancy ${
      ctx.openDiscrepancies === 1 ? "is" : "are"
    } open.`;
  }
  if (unchecked > 0) return `${unchecked} of ${ctx.total} lines are still unchecked.`;
  if (ctx.openDiscrepancies > 0) {
    return `${ctx.openDiscrepancies} discrepancy ${
      ctx.openDiscrepancies === 1 ? "is" : "are"
    } open — resolve or send short before releasing the vehicle.`;
  }
  return "";
}
