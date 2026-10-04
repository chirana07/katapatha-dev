import { checkPhoto, checkQueueHeadroom, checkSignature } from "../../pod/size";
import { MAX_POD_PAGES } from "../../outbox/intents";
import { pagesBytes, type PageList } from "./pages";
import type { CountOrder } from "./units";

/**
 * What stops "Complete delivery", in the order the driver should fix it, worded
 * for a person standing at a loading dock. The recipient and the unit rules are
 * the web console's server action rules exactly, so the two clients cannot
 * disagree about what a valid delivery is.
 */

export const RECIPIENT_MIN_CHARS = 2;

export const RECIPIENT_PROBLEM =
  "Type the recipient's name before saving. Every delivery is signed off to a real person at the outlet.";

/** Only the lines the screen needs to validate: the typed counts keyed by order. */
export type CountsInput = Record<string, number | string>;

/**
 * Why the unit counts cannot be saved, or null. Counts normally come from the
 * Stepper (whole numbers within bounds), but this is the last line before a
 * delivery is queued, so it checks again: whole, safe, never more than expected.
 */
export function countsProblem(orders: readonly CountOrder[], counts: CountsInput): string | null {
  for (const order of orders) {
    const raw = counts[order.orderId] ?? order.expectedUnits;
    const text = String(raw).trim();
    if (!/^\d+$/.test(text)) return "Delivered units must be whole numbers, zero or more.";
    const delivered = Number(text);
    if (!Number.isSafeInteger(delivered)) {
      return "Delivered quantities are too large to save safely. Check the figures.";
    }
    if (delivered > order.expectedUnits) {
      return `${delivered} is more than the ${order.expectedUnits} units on ${order.orderRef}. Check the figure before saving.`;
    }
  }
  return null;
}

/** Each page against its own cap: a receipt photo <= 400 KB, an on-phone signature <= 64 KB. */
export function pagesSizeProblem(list: PageList): string | null {
  for (const page of list.pages) {
    const verdict = page.kind === "SIGNATURE" ? checkSignature(page.data) : checkPhoto(page.data);
    if (!verdict.ok) return verdict.message;
  }
  return null;
}

/**
 * The pages plus what is already queued must fit what the phone is willing to
 * hold. `extraBytes` is a page about to be added (a retake passes the list
 * without the page it replaces).
 */
export function headroomProblem(queuedBytes: number, list: PageList, extraBytes = 0): string | null {
  const verdict = checkQueueHeadroom(queuedBytes, pagesBytes(list) + extraBytes);
  return verdict.ok ? null : verdict.message;
}

export type DraftInput = {
  recipient: string;
  orders: readonly CountOrder[];
  counts: CountsInput;
  pages: PageList;
};

/**
 * The first reason this draft cannot be completed, or null. Order: recipient,
 * unit counts, pages (the same order the old screen used, with pages where the
 * signature was). Queue headroom needs a database read, so it is checked by the
 * caller with headroomProblem().
 */
export function draftProblem(input: DraftInput): string | null {
  if (input.recipient.trim().length < RECIPIENT_MIN_CHARS) return RECIPIENT_PROBLEM;
  const counts = countsProblem(input.orders, input.counts);
  if (counts) return counts;
  if (input.pages.pages.length === 0) {
    return "Add a photo of the receipt, or sign on the phone, before completing.";
  }
  if (input.pages.pages.length > MAX_POD_PAGES) {
    return `A delivery can carry at most ${MAX_POD_PAGES} pages.`;
  }
  return pagesSizeProblem(input.pages);
}

/**
 * The short line above the bar while "Complete delivery" is disabled: what is
 * missing, as words (the disabled button alone would be colour only). Null when
 * nothing is missing. Only the two things the driver must supply are listed.
 */
export function requirementNote(input: { recipient: string; pages: PageList }): string | null {
  const needsPage = input.pages.pages.length === 0;
  const needsName = input.recipient.trim().length < RECIPIENT_MIN_CHARS;
  if (needsPage && needsName) {
    return "To complete: add a receipt photo (or sign on the phone) and type who received the goods.";
  }
  if (needsPage) return "To complete: add a receipt photo, or sign on the phone.";
  if (needsName) return "To complete: type who received the goods.";
  return null;
}
