import type { components } from "@katapatha/contracts/types";
import { api } from "@/lib/api";

export type ShortfallReason = string;

type LoadCondition = NonNullable<components["schemas"]["LoadCheck"]["condition"]>;

export const CONDITION_LABEL: Record<LoadCondition, string> = {
  OK: "Loaded correctly",
  SHORT: "Short quantity",
  DAMAGED: "Damaged on dock",
  MISSING: "Missing from pick",
};

export const CONDITION_HINT: Record<LoadCondition, string> = {
  OK: "Expected and loaded units match.",
  SHORT: "Fewer units loaded than ordered.",
  DAMAGED: "Units arrived unfit to deliver.",
  MISSING: "Units were not on the dock when checked.",
};

export const DISCREPANCY_CONDITIONS: LoadCondition[] = ["SHORT", "DAMAGED", "MISSING"];

export function conditionNeedsReason(condition: LoadCondition): boolean {
  return condition !== "OK";
}

// Fallback used when the vocabularies endpoint is unreachable. The server
// vocabulary is authoritative when it loads, so this list is only a lifeline,
// not a hardcoded replacement for product copy.
export const FALLBACK_SHORTFALL_REASONS: ShortfallReason[] = [
  "MISSING",
  "DAMAGED",
  "SHORT_QUANTITY",
  "NOT_COLD_ENOUGH",
];

export const SHORTFALL_REASON_LABEL: Record<string, string> = {
  MISSING: "Missing from stock",
  DAMAGED: "Damaged goods",
  SHORT_QUANTITY: "Short quantity",
  NOT_COLD_ENOUGH: "Not cold enough",
};

export function labelFor(reason: string): string {
  return SHORTFALL_REASON_LABEL[reason] ?? reason;
}

export async function fetchShortfallReasons(): Promise<{ reasons: ShortfallReason[]; fallback: boolean }> {
  const client = await api();
  const result = await client.GET("/reference/vocabularies", {});
  if (result.error || !result.data || !Array.isArray(result.data.shortfallReasons)) {
    return { reasons: FALLBACK_SHORTFALL_REASONS, fallback: true };
  }
  return { reasons: result.data.shortfallReasons, fallback: false };
}
