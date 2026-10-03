import type { components } from "@katapatha/contracts/types";
import type { Tone } from "@/components/ui/status-pill";
import { storeState } from "./order-state";
import { STORE_ISSUE_REASONS, STORE_PROBLEM_KINDS } from "@katapatha/core/domain/reasons";

type Issue = components["schemas"]["Issue"];
type IssueKind = components["schemas"]["IssueKind"];
type IssueReason = components["schemas"]["IssueReason"];

export interface IssueChoice {
  /** Unique across the grid: the kind, or kind:reason for the goods problems. */
  key: string;
  kind: IssueKind;
  reasonCode?: IssueReason;
  label: string;
  hint: string;
}

const KIND_LABEL = new Map<string, string>(STORE_PROBLEM_KINDS.map((k) => [k.code, k.label]));
const REASON_LABEL = new Map<string, string>(STORE_ISSUE_REASONS.map((r) => [r.code, r.label]));

const REASON_HINT: Record<string, string> = {
  ITEMS_MISSING: "Fewer items than ordered",
  ITEMS_DAMAGED: "Broken, crushed or leaking",
  ARRIVED_WARM: "Chilled goods not cold",
  WRONG_ITEMS: "Different product or size",
};

// Only where the label does not already say it; a hint that repeats its label is noise.
const KIND_HINT: Record<string, string> = {
  OTHER: "Tell us in the details",
};

/**
 * The "What happened?" tiles.
 *
 * The API takes a kind, and for goods problems a reason as well. The designs
 * show one flat grid, so the goods kind is expanded into one tile per reason;
 * the other kinds are one tile each. Both lists come from
 * `/reference/vocabularies`, so a code added server-side appears here without
 * a deploy — a code this build has no label for shows as itself, readably.
 */
export function issueChoices(kinds: readonly string[], reasons: readonly string[]): IssueChoice[] {
  const choices: IssueChoice[] = [];
  for (const kind of kinds) {
    if (kind === "GOODS_DAMAGED") {
      for (const reason of reasons) {
        choices.push({
          key: `${kind}:${reason}`,
          kind: kind as IssueKind,
          reasonCode: reason as IssueReason,
          label: REASON_LABEL.get(reason) ?? humanise(reason),
          hint: REASON_HINT[reason] ?? "",
        });
      }
    } else {
      choices.push({
        key: kind,
        kind: kind as IssueKind,
        label: KIND_LABEL.get(kind) ?? humanise(kind),
        hint: KIND_HINT[kind] ?? "",
      });
    }
  }
  return choices;
}

/** The fallback when the vocabularies endpoint cannot be read. */
export const DEFAULT_KINDS: readonly string[] = STORE_PROBLEM_KINDS.map((k) => k.code);
export const DEFAULT_REASONS: readonly string[] = STORE_ISSUE_REASONS.map((r) => r.code);

export function describeIssue(issue: Pick<Issue, "kind" | "reasonCode">): string {
  if (issue.reasonCode) return REASON_LABEL.get(issue.reasonCode) ?? humanise(issue.reasonCode);
  return KIND_LABEL.get(issue.kind) ?? humanise(issue.kind);
}

export function issueStatusLabel(status: Issue["status"]): string {
  return status === "NEW" ? "Open" : status === "ACKNOWLEDGED" ? "Dispatch has it" : "Resolved";
}

export function issueStatusTone(status: Issue["status"]): Tone {
  return status === "RESOLVED" ? "good" : status === "ACKNOWLEDGED" ? "info" : "warn";
}

/**
 * Orders an issue can be raised about: delivered, or on the way. The rest have
 * nothing to report yet — a queued order has not met an outlet.
 */
export function reportableOrders<T extends Parameters<typeof storeState>[0]>(orders: readonly T[]): T[] {
  return orders.filter((order) => {
    const state = storeState(order);
    return state === "delivered" || state === "on_the_way";
  });
}

function humanise(code: string): string {
  const words = code.replaceAll("_", " ").toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** The reasons as picker options, with the vocabularies' codes and our labels. */
export function reasonOptions(codes: readonly string[]): { code: string; label: string }[] {
  return codes.map((code) => ({ code, label: REASON_LABEL.get(code) ?? humanise(code) }));
}
