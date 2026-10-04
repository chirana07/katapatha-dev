import type { components } from "@katapatha/contracts/types";

export type ShortfallReason = string;

type LoadCondition = NonNullable<components["schemas"]["LoadCheck"]["condition"]>;

export const CONDITION_LABEL: Record<LoadCondition, string> = {
  OK: "Loaded correctly",
  SHORT: "Short quantity",
  DAMAGED: "Damaged on dock",
  MISSING: "Missing from pick",
};

// Fallback used when the vocabularies endpoint is unreachable. The server
// vocabulary is authoritative when it loads, so this list is only a lifeline,
// not a hardcoded replacement for product copy.
export const FALLBACK_SHORTFALL_REASONS: ShortfallReason[] = [
  "MISSING",
  "DAMAGED",
  "SHORT_QUANTITY",
  "NOT_COLD_ENOUGH",
  "WRONG_ITEM",
];

export const SHORTFALL_REASON_LABEL: Record<string, string> = {
  MISSING: "Missing from stock",
  DAMAGED: "Damaged goods",
  SHORT_QUANTITY: "Short quantity",
  NOT_COLD_ENOUGH: "Not cold enough",
  WRONG_ITEM: "Wrong item picked",
};

export function labelFor(reason: string): string {
  return SHORTFALL_REASON_LABEL[reason] ?? reason;
}
