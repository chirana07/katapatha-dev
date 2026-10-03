import type { components } from "@katapatha/contracts/types";
import type { Tone } from "@/components/ui/status-pill";
import { shortDay } from "@katapatha/core/domain/deferral";

type Issue = components["schemas"]["Issue"];

export interface OutcomeFacts {
  state: string;
  units: number;
  /** What the driver recorded. Null or undefined when it was never read. */
  deliveredUnits?: number | null;
  /** Undefined means "not looked up", which is different from "no". */
  receiptConfirmed?: boolean;
  deferral?: { rolledToDate?: string | null } | null;
  issues?: readonly Pick<Issue, "status">[];
}

export interface Outcome {
  label: string;
  tone: Tone;
  /** Lines under the label: what is still open, or where an order went. */
  notes: string[];
}

/**
 * How an order ended, in one pill and a few words.
 *
 * Shortfall outranks everything else for a delivered order because it is the
 * thing the manager has to do something about; the receipt and issue states
 * follow as notes. "Delivered" alone is only ever shown when we could not look
 * up the receipt, so it never claims a receipt exists.
 */
export function historyOutcome(facts: OutcomeFacts): Outcome {
  const { state } = facts;

  if (state === "deferred") {
    return {
      label: "Deferred",
      tone: "warn",
      notes: [facts.deferral?.rolledToDate ? `Moved to ${shortDay(facts.deferral.rolledToDate)}` : "No new date yet"],
    };
  }
  if (state === "cancelled") return { label: "Cancelled", tone: "neutral", notes: [] };
  if (state === "failed") return { label: "Failed", tone: "bad", notes: [] };
  if (state !== "delivered") return { label: state, tone: "neutral", notes: [] };

  const notes: string[] = [];
  const short =
    facts.deliveredUnits != null && facts.deliveredUnits < facts.units ? facts.units - facts.deliveredUnits : 0;
  const open = (facts.issues ?? []).filter((issue) => issue.status !== "RESOLVED").length;
  const resolved = (facts.issues ?? []).length - open;

  if (open > 0) notes.push(open === 1 ? "Issue open" : `${open} issues open`);
  if (resolved > 0) notes.push(resolved === 1 ? "Issue resolved" : `${resolved} issues resolved`);

  if (short > 0) {
    if (facts.receiptConfirmed === false) notes.push("Receipt not confirmed");
    return { label: `Short ${short}`, tone: "bad", notes };
  }
  if (facts.receiptConfirmed === false) return { label: "Confirm receipt", tone: "warn", notes };
  if (open > 0) return { label: "Issue open", tone: "warn", notes: notes.filter((note) => note !== "Issue open") };
  if (facts.receiptConfirmed) return { label: "Received", tone: "good", notes };
  return { label: "Delivered", tone: "good", notes };
}

/** "58 / 60": what the driver recorded against what was ordered. */
export function recordedAgainstOrdered(deliveredUnits: number | null | undefined, units: number): string {
  return deliveredUnits == null ? `— / ${units}` : `${deliveredUnits} / ${units}`;
}

export const HISTORY_RANGES = [
  { value: "30", label: "Last 30 days", days: 30 },
  { value: "90", label: "Last 90 days", days: 90 },
  { value: "365", label: "Last 12 months", days: 365 },
  { value: "all", label: "All time", days: null },
] as const;

export type HistoryRange = (typeof HISTORY_RANGES)[number]["value"];

/** Defaults to all time: an outlet's history is short, and a silent cut-off hides orders. */
export function parseRange(value: string | string[] | undefined): HistoryRange {
  const first = Array.isArray(value) ? value[0] : value;
  return HISTORY_RANGES.find((range) => range.value === first)?.value ?? "all";
}

/** The earliest requested date a range includes, or null for no limit. */
export function rangeStart(range: HistoryRange, today: string): string | null {
  const days = HISTORY_RANGES.find((r) => r.value === range)?.days;
  if (!days) return null;
  const [y, m, d] = today.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d! - days)).toISOString().slice(0, 10);
}

export const RESULT_FILTERS = [
  { value: "all", label: "All results" },
  { value: "received", label: "Received" },
  { value: "attention", label: "Needs attention" },
] as const;

export type ResultFilter = (typeof RESULT_FILTERS)[number]["value"];

export function parseResult(value: string | string[] | undefined): ResultFilter {
  const first = Array.isArray(value) ? value[0] : value;
  return RESULT_FILTERS.find((f) => f.value === first)?.value ?? "all";
}

/** Whether an outcome belongs under a result filter. */
export function matchesResult(outcome: Pick<Outcome, "tone">, filter: ResultFilter): boolean {
  if (filter === "all") return true;
  if (filter === "received") return outcome.tone === "good";
  return outcome.tone === "warn" || outcome.tone === "bad";
}
