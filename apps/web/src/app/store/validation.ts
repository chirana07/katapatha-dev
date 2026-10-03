import type { components } from "@katapatha/contracts/types";

type OrderLine = components["schemas"]["PlaceOrdersRequest"]["lines"][number];
type IssueKind = NonNullable<components["schemas"]["ReceiptRequest"]["issueKind"]>;
type CreateIssue = components["schemas"]["CreateIssueRequest"];

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

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PROBLEM_KINDS: readonly string[] = ["GOODS_DAMAGED", "ACCESS_DENIED", "OUTLET_CLOSED", "DELIVERY_REFUSED", "OTHER"];
const ISSUE_REASONS: readonly string[] = ["ITEMS_MISSING", "ITEMS_DAMAGED", "ARRIVED_WARM", "WRONG_ITEMS"];
export const ISSUE_NOTE_LIMIT = 500;

/**
 * The report-an-issue form, as the API's request. `choice` is the tile the
 * manager picked: a kind, or `GOODS_DAMAGED:<reason>` for the goods problems.
 * The API still checks units against the order, which only it can see.
 */
export function validateIssue(fields: {
  orderId: FormDataEntryValue | null;
  choice: FormDataEntryValue | null;
  units: FormDataEntryValue | null;
  note: FormDataEntryValue | null;
  clientRequestId: FormDataEntryValue | null;
}): ValidationResult<CreateIssue> {
  if (typeof fields.orderId !== "string" || fields.orderId === "") {
    return { ok: false, error: "Choose which delivery this is about." };
  }
  if (typeof fields.choice !== "string" || fields.choice === "") {
    return { ok: false, error: "Choose what happened." };
  }
  const [kind, reason] = fields.choice.split(":");
  if (!kind || !PROBLEM_KINDS.includes(kind) || (reason !== undefined && !ISSUE_REASONS.includes(reason))) {
    return { ok: false, error: "Choose what happened from the list." };
  }
  if (typeof fields.clientRequestId !== "string" || !UUID.test(fields.clientRequestId)) {
    return { ok: false, error: "This report is no longer valid. Reload the page and try again." };
  }

  let units: number | undefined;
  if (typeof fields.units === "string" && fields.units.trim() !== "") {
    const parsed = Number(fields.units);
    if (!Number.isInteger(parsed) || parsed < 1) {
      return { ok: false, error: "Enter the number of units affected as a whole number, 1 or more." };
    }
    units = parsed;
  }

  const note = typeof fields.note === "string" ? fields.note.trim() : "";
  if (note.length > ISSUE_NOTE_LIMIT) {
    return { ok: false, error: `Keep the details to ${ISSUE_NOTE_LIMIT} characters or fewer.` };
  }

  const request: CreateIssue = {
    orderId: fields.orderId,
    kind: kind as CreateIssue["kind"],
    clientRequestId: fields.clientRequestId,
  };
  if (reason) request.reasonCode = reason as CreateIssue["reasonCode"];
  if (units !== undefined) request.units = units;
  if (note) request.note = note;
  return { ok: true, data: request };
}

/**
 * Where a form sends the manager back to. It arrives as a hidden field, so it
 * is only followed when it stays inside the store workspace — anything else
 * (another origin, a protocol-relative `//host`) falls back to Today.
 */
export function safeStorePath(value: FormDataEntryValue | null, fallback = "/store"): string {
  if (typeof value !== "string") return fallback;
  if (!value.startsWith("/store") || value.startsWith("//") || value.includes("\\")) return fallback;
  if (value.length > 1 && value !== "/store" && !/^\/store[/?#]/.test(value)) return fallback;
  return value;
}
