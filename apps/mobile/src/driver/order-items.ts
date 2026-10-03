/**
 * What an order contains, as the driver reads it.
 *
 * The breakdown is READ-ONLY CONTEXT. A delivery is still counted in units per
 * order (the stop-event model has no per-product count), so nothing here counts,
 * compares or warns about products. In particular a breakdown whose quantities do
 * not add up to the units on the vehicle is not an error: it is what the store
 * ordered, and the dock may have sent the order short. We say "as ordered" then
 * and never show a mismatch.
 */

export type CachedItem = {
  sku: string;
  name: string;
  quantity: number;
  unitLabel: string;
};

/** How many lines a compact breakdown shows before "+N more". */
export const COMPACT_ITEM_LINES = 3;

/** "bag" -> "bags", "box" -> "boxes", "pantry" -> "pantries". Labels are short nouns. */
export function pluralUnitLabel(label: string, quantity: number): string {
  if (quantity === 1) return label;
  if (/(s|x|z|ch|sh)$/i.test(label)) return `${label}es`;
  if (/[^aeiou]y$/i.test(label)) return `${label.slice(0, -1)}ies`;
  return `${label}s`;
}

/** "White Rice 5 kg · 12 bags". */
export function itemLine(item: CachedItem): string {
  return `${item.name} · ${item.quantity} ${pluralUnitLabel(item.unitLabel, item.quantity)}`;
}

export type ItemsView = {
  lines: string[];
  /** Lines left out of a collapsed view. */
  hidden: number;
  /** "+2 more", or null when nothing is hidden. */
  moreLabel: string | null;
  /** Whether a toggle should be offered at all. */
  canToggle: boolean;
};

/**
 * The lines to show. Collapsed, a long order shows its first `limit` lines and
 * "+N more" so it cannot push the stepper off a small screen. An order at or one
 * over the limit shows everything, with no toggle.
 */
export function itemsView(
  items: readonly CachedItem[] | null | undefined,
  expanded: boolean,
  limit: number = COMPACT_ITEM_LINES,
): ItemsView {
  const all = (items ?? []).map(itemLine);
  // Hiding a single line behind "+1 more" saves no height (the toggle is a line
  // itself), so a breakdown one over the limit is shown whole.
  const canToggle = all.length > limit + 1;
  if (!canToggle || expanded) {
    return { lines: all, hidden: 0, moreLabel: null, canToggle };
  }
  const hidden = all.length - limit;
  return { lines: all.slice(0, limit), hidden, moreLabel: `+${hidden} more`, canToggle };
}

/** The toggle's words: "+2 more" collapsed, "Show fewer" expanded. */
export function toggleLabel(view: ItemsView, expanded: boolean): string {
  return expanded ? "Show fewer" : (view.moreLabel ?? "");
}

export function itemsTotal(items: readonly CachedItem[] | null | undefined): number {
  return (items ?? []).reduce((sum, item) => sum + item.quantity, 0);
}

/**
 * "As ordered" when the breakdown describes more than is on the vehicle (the
 * dock sent the order short), so a driver does not read it as the load. Null
 * otherwise, and always null with no breakdown. Never a warning, never a count.
 */
export function asOrderedNote(order: {
  expectedUnits: number;
  orderedUnits?: number | null;
  items?: readonly CachedItem[] | null;
}): string | null {
  if (!order.items || order.items.length === 0) return null;
  const orderedShort =
    typeof order.orderedUnits === "number" && order.orderedUnits > order.expectedUnits;
  return orderedShort || itemsTotal(order.items) > order.expectedUnits
    ? "Listed as ordered; fewer units are on the vehicle"
    : null;
}

/** "3 products", for a collapsed cue. Null with no breakdown. */
export function productCountLabel(items: readonly CachedItem[] | null | undefined): string | null {
  const n = items?.length ?? 0;
  if (n === 0) return null;
  return n === 1 ? "1 product" : `${n} products`;
}
