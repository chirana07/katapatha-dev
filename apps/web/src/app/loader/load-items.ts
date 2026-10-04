import type { LoadLine } from "./dock-model";

/**
 * Item-level loading: what the steppers count, how a report spreads over the
 * stops, and the "By category" roll-up.
 *
 * An order placed from products has items, and the dock counts each one; an
 * order placed as plain units (the competition's orders) has none, so it gets
 * one pseudo-item — the order itself — and the same steppers count its units.
 * Either way the counts add up to the order's units, which is what the load
 * check records.
 */

/** The key of the pseudo-item for an order with no products. */
export const UNITS_KEY = "__units";

export type LoadItem = {
  /** sku, or UNITS_KEY for a units-only order. */
  key: string;
  sku: string | null;
  name: string;
  unitLabel: string;
  quantity: number;
};

export type Counts = Record<string, number>;

export function itemsOf(line: Pick<LoadLine, "items" | "orderRef" | "expectedUnits">): LoadItem[] {
  const items = line.items ?? [];
  if (items.length === 0) {
    return [{ key: UNITS_KEY, sku: null, name: line.orderRef, unitLabel: "units", quantity: line.expectedUnits }];
  }
  return items.map((item) => ({ key: item.sku, sku: item.sku, name: item.name, unitLabel: item.unitLabel, quantity: item.quantity }));
}

/**
 * Where the steppers start for a line.
 *
 * A checked line shows what the check said: its item counts when it carried
 * them; a line loaded correctly, everything; otherwise the shortfall is spread
 * from the last item back, since a check without item counts never said which
 * item was short. An unchecked line shows its count in progress, or zero.
 */
export function initialCounts(line: LoadLine): Counts {
  const items = itemsOf(line);
  const checked = line.condition != null && line.loadedUnits != null;
  const stored = checked ? line.itemCounts : line.progress?.itemCounts;
  if (stored && items.every((item) => item.sku != null)) {
    return Object.fromEntries(items.map((item) => [item.key, Math.min(item.quantity, stored[item.key] ?? 0)]));
  }
  const units = checked ? line.loadedUnits! : (line.progress?.loadedUnits ?? 0);
  return fillInOrder(items, units);
}

/** `units` laid over the items in list order, each up to its quantity. */
export function fillInOrder(items: LoadItem[], units: number): Counts {
  let left = Math.max(0, units);
  const counts: Counts = {};
  for (const item of items) {
    const take = Math.min(item.quantity, left);
    counts[item.key] = take;
    left -= take;
  }
  return counts;
}

export function sumCounts(counts: Counts): number {
  return Object.values(counts).reduce((sum, n) => sum + n, 0);
}

/** Counts as the API takes them: per sku, or null for a units-only order. */
export function apiItemCounts(counts: Counts): Record<string, number> | null {
  if (UNITS_KEY in counts) return null;
  return { ...counts };
}

export type ProductOnTrip = {
  key: string;
  sku: string | null;
  name: string;
  unitLabel: string;
  /** Units of it across the trip. */
  required: number;
  loaded: number;
  /** The orders carrying it, in loading order. */
  orders: { orderId: string; orderRef: string; seq: number; outletId: string; quantity: number }[];
};

/**
 * Every product on the trip with its total required and loaded, in the order
 * it first comes up on the loading list. A units-only order is its own row.
 */
export function productsOnTrip(lines: LoadLine[], counts: Record<string, Counts>): ProductOnTrip[] {
  const byKey = new Map<string, ProductOnTrip>();
  for (const line of lines) {
    for (const item of itemsOf(line)) {
      const key = item.sku ?? `${UNITS_KEY}:${line.orderId}`;
      const row =
        byKey.get(key) ??
        ({ key, sku: item.sku, name: item.name, unitLabel: item.unitLabel, required: 0, loaded: 0, orders: [] } satisfies ProductOnTrip);
      row.required += item.quantity;
      row.loaded += counts[line.orderId]?.[item.key] ?? 0;
      row.orders.push({ orderId: line.orderId, orderRef: line.orderRef, seq: line.seq, outletId: line.outletId, quantity: item.quantity });
      byKey.set(key, row);
    }
  }
  return [...byKey.values()];
}

/**
 * Which stops a shortfall of `short` units of one product falls on.
 *
 * The dock loads in list order (last stop first), so stock that runs out runs
 * out on the orders loaded last. The short is laid from the end of the
 * loading list backwards, each order short at most what it ordered of the
 * product. The dispatcher still decides what happens to each; this only says
 * where the dock came up short.
 */
export function spreadShort(product: ProductOnTrip, short: number): { orderId: string; orderRef: string; seq: number; outletId: string; quantity: number; short: number }[] {
  let left = Math.max(0, Math.min(short, product.required));
  const out: { orderId: string; orderRef: string; seq: number; outletId: string; quantity: number; short: number }[] = [];
  for (const order of [...product.orders].reverse()) {
    if (left <= 0) break;
    const take = Math.min(order.quantity, left);
    out.push({ ...order, short: take });
    left -= take;
  }
  return out.reverse();
}

/** "White Rice 5 kg" from "White Rice 5 kg (12 per carton)", for tight rows. */
export function shortName(name: string): string {
  return name.replace(/\s*\([^)]*\)\s*$/, "");
}

/** "12 per carton" from the same, when the name carries a pack size. */
export function packOf(item: Pick<LoadItem, "name" | "unitLabel">): string {
  const pack = /\(([^)]*)\)\s*$/.exec(item.name)?.[1];
  return pack ?? item.unitLabel;
}
