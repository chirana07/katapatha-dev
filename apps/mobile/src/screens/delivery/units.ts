/**
 * The unit counts on the Check items step, and what the summary cards say.
 * The count is in UNITS per order, so there is one row per order. An order placed
 * from products also carries a breakdown ("White Rice 5 kg · 12 bags"); it is shown
 * under the row as context and is never counted or compared.
 */

import type { CachedItem } from "../../driver/order-items";

export type CountOrder = {
  orderId: string;
  orderRef: string;
  /** What is on the vehicle for this order (the run payload's expectedUnits). */
  expectedUnits: number;
  /**
   * What the store ordered, when the app knows it. If it is more than
   * expectedUnits the dock sent the order short; the row says so rather than
   * letting "69 / 69" read as "everything the store asked for".
   */
  orderedUnits?: number | null;
  /** What the order contains: display context, never counted (see order-items.ts). */
  items?: readonly CachedItem[];
};

export type Counts = Record<string, number>;

/** Counts default to what was expected: a full delivery is the common case. */
export function defaultCounts(orders: readonly CountOrder[]): Counts {
  return Object.fromEntries(orders.map((order) => [order.orderId, order.expectedUnits]));
}

export type OrderRow = {
  orderId: string;
  orderRef: string;
  expected: number;
  counted: number;
  /** Units missing against what is on the vehicle (never negative). */
  short: number;
  /** What the store ordered, when known. */
  ordered: number | null;
  /** Units the dock did not load, when known and positive; else 0. */
  dockShort: number;
};

export type UnitsSummary = {
  rows: OrderRow[];
  expected: number;
  counted: number;
  short: number;
  /** Orders with a short count. */
  shortOrders: number;
  /** Every order counted in full. */
  complete: boolean;
};

export function summariseUnits(orders: readonly CountOrder[], counts: Counts): UnitsSummary {
  const rows = orders.map((order): OrderRow => {
    const counted = counts[order.orderId] ?? order.expectedUnits;
    const ordered = order.orderedUnits;
    return {
      orderId: order.orderId,
      orderRef: order.orderRef,
      expected: order.expectedUnits,
      counted,
      short: Math.max(0, order.expectedUnits - counted),
      ordered: typeof ordered === "number" ? ordered : null,
      dockShort:
        typeof ordered === "number" && ordered > order.expectedUnits
          ? ordered - order.expectedUnits
          : 0,
    };
  });
  const expected = rows.reduce((sum, row) => sum + row.expected, 0);
  const counted = rows.reduce((sum, row) => sum + row.counted, 0);
  const short = rows.reduce((sum, row) => sum + row.short, 0);
  return {
    rows,
    expected,
    counted,
    short,
    shortOrders: rows.filter((row) => row.short > 0).length,
    complete: short === 0,
  };
}

const units = (n: number) => `${n} ${n === 1 ? "unit" : "units"}`;
const orders = (n: number) => `${n} ${n === 1 ? "order" : "orders"}`;

/** The sentence under "Count with the store". */
export function countSubtitle(orderCount: number, expected: number, refLabel: string): string {
  return `Tap − if units are missing or refused. ${orders(orderCount)} · ${units(expected)} on ${refLabel}.`;
}

/** The card under the rows: a tone, a headline, a line of support. */
export function countSummaryCard(
  summary: UnitsSummary,
  outletId: string,
): { tone: "good" | "warn"; title: string; body: string } {
  if (summary.complete) {
    return {
      tone: "good",
      title: `${summary.counted} / ${summary.expected} units counted`,
      body: `Matches the loading list for ${outletId}`,
    };
  }
  return {
    tone: "warn",
    title: `${units(summary.short)} short`,
    body: "Will be recorded as a part delivery",
  };
}

/** The units card on the Receipt step. */
export function receiptUnitsCard(summary: UnitsSummary): {
  tone: "good" | "warn";
  title: string;
  body: string;
} {
  if (summary.complete) {
    return {
      tone: "good",
      title: `${summary.counted} / ${summary.expected} units checked`,
      body: "No shortages recorded",
    };
  }
  return {
    tone: "warn",
    title: `${summary.short} short`,
    body: "Recorded as a part delivery",
  };
}

/** "of 24", plus "· ordered 30" when the dock sent the order short. */
export function rowOfLabel(row: OrderRow): string {
  const base = `of ${row.expected} ${row.expected === 1 ? "unit" : "units"}`;
  return row.dockShort > 0 && row.ordered !== null ? `${base} · ${row.ordered} ordered` : base;
}

/** The access note's first segment ("Rear dock. Van only." -> "Rear dock"), or null. */
export function firstSegment(note: string | null | undefined): string | null {
  if (!note) return null;
  const part = note
    .split(/[.·;\n]/)
    .map((piece) => piece.trim())
    .find((piece) => piece.length > 0);
  return part ?? null;
}

/** "S1-082" for one order, "3 orders" for several, null for none. */
export function orderRefLabel(refs: readonly string[]): string | null {
  if (refs.length === 0) return null;
  return refs.length === 1 ? refs[0] : `${refs.length} orders`;
}

/**
 * The StepHeader subline: "Rear dock · S1-082 · 69 units", leaving out what is not
 * known. With several orders the ref is left out (the header has room for one line
 * beside the badge, and the order count is in the step's own subtitle).
 */
export function stopSubline(input: {
  accessNote: string | null | undefined;
  orderRefs: readonly string[];
  expectedUnits: number;
}): string {
  const parts = [
    firstSegment(input.accessNote),
    input.orderRefs.length === 1 ? input.orderRefs[0] : null,
    input.orderRefs.length > 0 ? units(input.expectedUnits) : null,
  ];
  return parts.filter((part): part is string => !!part).join(" · ");
}
