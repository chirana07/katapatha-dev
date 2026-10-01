import type { components } from "@katapatha/contracts/types";

type OrderLine = components["schemas"]["PlaceOrdersRequest"]["lines"][number];
type IssueKind = NonNullable<components["schemas"]["ReceiptRequest"]["issueKind"]>;

export const ISSUE_KINDS = ["ITEMS_MISSING", "ITEMS_DAMAGED", "ARRIVED_WARM", "WRONG_ITEMS"] as const;

export type ValidationResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

function unitsFrom(value: FormDataEntryValue | null, maximum?: number): number | null {
  if (typeof value !== "string" || value.trim() === "") return 0;
  const units = Number(value);
  return Number.isInteger(units) && units >= 0 && (maximum === undefined || units <= maximum)
    ? units
    : null;
}

export function validateOrderQuantities(
  ambientValue: FormDataEntryValue | null,
  chilledValue: FormDataEntryValue | null,
): ValidationResult<OrderLine[]> {
  const ambient = unitsFrom(ambientValue, 10_000);
  const chilled = unitsFrom(chilledValue, 10_000);
  if (ambient === null || chilled === null) {
    return { ok: false, error: "Enter whole-number quantities between 0 and 10,000 units." };
  }
  if (ambient + chilled === 0) {
    return { ok: false, error: "Enter at least one ambient or chilled unit before placing the order." };
  }

  const lines: OrderLine[] = [];
  if (ambient > 0) lines.push({ tempRequirement: "ambient", units: ambient });
  if (chilled > 0) lines.push({ tempRequirement: "chilled", units: chilled });
  return { ok: true, data: lines };
}

export function validateReceipt(
  unitsValue: FormDataEntryValue | null,
  matchesValue: FormDataEntryValue | null,
  issueValue: FormDataEntryValue | null,
): ValidationResult<{ unitsReceived: number; matches: boolean; issueKind: IssueKind | null }> {
  const unitsReceived = unitsFrom(unitsValue);
  if (unitsReceived === null) {
    return { ok: false, error: "Enter the whole number of units received." };
  }

  const matches = matchesValue === "yes";
  const issueKind: IssueKind | null =
    typeof issueValue === "string" && ISSUE_KINDS.includes(issueValue as IssueKind)
      ? (issueValue as IssueKind)
      : null;
  if (!matches && !issueKind) {
    return { ok: false, error: "Choose what was wrong with the delivery before confirming receipt." };
  }
  return { ok: true, data: { unitsReceived, matches, issueKind: matches ? null : issueKind } };
}
