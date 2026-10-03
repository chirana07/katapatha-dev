/**
 * Imports are relative: vitest has no "@/" alias and this module is tested.
 */
import type { components } from "@katapatha/contracts/types";
import type { BarCategory } from "../charts/bar-chart";
import { compactNumber } from "../charts/chart-math";
import { weekDatesText, weekLabel } from "../report-format";

type Schemas = components["schemas"];
export type CapacityWeek = Schemas["CapacityWeek"];
export type CapacityAction = Schemas["CapacityAction"];
export type CapacityLevel = Schemas["CapacityLevel"];
export type CapacityStatus = Schemas["CapacityActionStatus"];
export type CapacityDecision = Schemas["CapacityDecision"];

type Tone = "neutral" | "good" | "warn" | "bad" | "info";

/** `?week=2026-16`, the plan-by-week row whose decisions are shown. */
export function weekParam(week: { isoYear: number; isoWeek: number }): string {
  return `${week.isoYear}-${week.isoWeek}`;
}

export function parseWeekParam(value: string | string[] | undefined): { isoYear: number; isoWeek: number } | null {
  const text = Array.isArray(value) ? value[0] : value;
  const match = /^(20\d{2})-(\d{1,2})$/.exec(text ?? "");
  if (!match) return null;
  const isoWeek = Number(match[2]);
  return isoWeek >= 1 && isoWeek <= 53 ? { isoYear: Number(match[1]), isoWeek } : null;
}

export function levelTone(level: CapacityLevel): Tone {
  return level === "over" ? "bad" : level === "near" ? "warn" : "good";
}

/** "5 of 4": trips a day the week needs, of the trips the available reefers can run. */
export function reeferTripsText(week: CapacityWeek): string {
  return `${week.reeferTripsPerDay.needed} of ${week.reeferTripsPerDay.capacity}`;
}

/** The weeks as stacked bars: chilled under ambient. Over-capacity weeks are flagged in words too. */
export function demandCategories(weeks: readonly CapacityWeek[]): BarCategory[] {
  return weeks.map((week) => ({
    label: weekLabel(week.isoWeek),
    sublabel: week.level === "over" ? "over" : week.kind === "forecast" ? "forecast" : undefined,
    values: [week.chilledM3, week.ambientM3],
    alert: week.level === "over",
    forecast: week.kind === "forecast",
    alt: `${weekLabel(week.isoWeek)}, ${weekDatesText(week.startDate, week.endDate)}${week.kind === "forecast" ? " (forecast)" : ""}: total ${compactNumber(week.totalM3)} m³, of which chilled ${compactNumber(week.chilledM3)} and ambient ${compactNumber(week.ambientM3)}; fleet capacity ${compactNumber(week.fleetCapacityM3)} m³`,
  }));
}

/**
 * Chilled volume against what the available reefers can carry. A week is
 * flagged by the API's own reefer shortfall (trips needed above trips
 * available), the same figure the table and the KPI use; comparing the two
 * volumes here would disagree with them at the margin, where the trip count is
 * rounded up.
 */
export function chilledCategories(weeks: readonly CapacityWeek[]): BarCategory[] {
  return weeks.map((week) => {
    const over = week.reeferTripsPerDay.shortfall > 0;
    return {
      label: weekLabel(week.isoWeek),
      sublabel: over ? "over" : week.kind === "forecast" ? "forecast" : undefined,
      values: [week.chilledM3],
      alert: over,
      forecast: week.kind === "forecast",
      alt: `${weekLabel(week.isoWeek)}${week.kind === "forecast" ? " (forecast)" : ""}: chilled ${compactNumber(week.chilledM3)} m³; reefer capacity ${compactNumber(week.chilledCapacityM3)} m³${over ? `, short by ${week.reeferTripsPerDay.shortfall} reefer ${week.reeferTripsPerDay.shortfall === 1 ? "trip" : "trips"} a day` : ""}`,
    };
  });
}

export const STATUS_LABEL: Record<CapacityStatus, string> = {
  PROPOSED: "Proposed",
  APPROVED: "Approved",
  APPLIED: "Applied",
  REJECTED: "Rejected",
};

export const STATUS_TONE: Record<CapacityStatus, Tone> = {
  PROPOSED: "neutral",
  APPROVED: "info",
  APPLIED: "good",
  REJECTED: "neutral",
};

export const DECISION_LABEL: Record<CapacityDecision, string> = {
  APPROVE: "Approve",
  REJECT: "Reject",
  APPLY: "Apply",
};

/**
 * What APPLY can really do, before it is pressed. From the API's contract: two
 * kinds change something in this system, the rest are a record only. After the
 * decision the API's own `consequences` replace this, and are what to trust.
 */
export function applyCaption(kind: Schemas["CapacityActionKind"]): string {
  switch (kind) {
    case "RECALL_FROM_WORKSHOP":
      return "Apply clears the reefer's workshop days in that week, except days whose plan is already published.";
    case "RAISE_FUEL_QUOTA":
      return "Apply raises that week's fuel quota in the ledger. It never lowers one.";
    default:
      return "Apply records the decision only. This system does not book vehicles, move delivery days or message stores.";
  }
}

/** The relief line: "Frees about 2 trips a day (estimate) · 1 hired reefer, two trips a day each". */
export function reliefText(action: Pick<CapacityAction, "expectedRelief">): string | null {
  const relief = action.expectedRelief as { tripsPerDay?: unknown; litres?: unknown; basis?: unknown; estimate?: unknown };
  const amount =
    typeof relief.tripsPerDay === "number"
      ? `${relief.tripsPerDay} reefer ${relief.tripsPerDay === 1 ? "trip" : "trips"} a day`
      : typeof relief.litres === "number"
        ? `${compactNumber(relief.litres)} L of fuel quota`
        : null;
  const basis = typeof relief.basis === "string" ? relief.basis : null;
  if (!amount && !basis) return null;
  const head = amount ? `Frees about ${amount}${relief.estimate === true ? " (an estimate)" : ""}` : null;
  return [head, basis].filter(Boolean).join(" · ");
}

/** What a failed decision means for the dispatcher. The API words its own 409s and 422s. */
export function capacityFailure(status: number, code: string | null, message: string | null) {
  if (status === 409 && code === "ACTION_NOT_APPROVED") {
    return { title: "Approve it first", detail: message ?? "Only an approved action can be applied.", outcome: "failed" as const, refresh: false };
  }
  if (status === 409) {
    return {
      title: "That action has already changed",
      detail: `${message ?? "Another decision landed first."} Nothing of yours was applied; the card now shows where it stands.`,
      outcome: "failed" as const,
      refresh: true,
    };
  }
  if (status === 403 || status === 404) {
    return { title: "That action is not available to you", detail: "It may belong to another depot or no longer exist. Nothing was changed.", outcome: "failed" as const, refresh: true };
  }
  if (status === 422) {
    return { title: "The server refused this", detail: message ?? "Review the note and try again.", outcome: "failed" as const, refresh: false };
  }
  if (status >= 400 && status < 500) {
    return { title: "The server refused this", detail: "Nothing was changed.", outcome: "failed" as const, refresh: false };
  }
  return {
    title: "We could not confirm that",
    detail: "Katapatha did not answer, so the decision may or may not have been saved. Reload and check this card before deciding again.",
    outcome: "unknown" as const,
    refresh: false,
  };
}
