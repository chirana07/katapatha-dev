import type { components } from "@katapatha/contracts/types";

export type OrderItem = components["schemas"]["OrderItem"];

/**
 * "bag" → "bags", "box" → "boxes", "pantry" → "pantries". Unit labels are
 * free text a dispatcher types ("bag", "carton", "crate"), so this only has to
 * be right for ordinary English nouns; anything odd still reads acceptably.
 */
export function pluraliseLabel(label: string): string {
  const word = label.trim();
  if (/(s|x|z|ch|sh)$/i.test(word)) return `${word}es`;
  if (/[^aeiou]y$/i.test(word)) return `${word.slice(0, -1)}ies`;
  return `${word}s`;
}

/** "20 bags", "1 carton": a quantity with its unit label. */
export function quantityLabel(quantity: number, unitLabel: string): string {
  return `${quantity.toLocaleString("en-GB")} ${quantity === 1 ? unitLabel : pluraliseLabel(unitLabel)}`;
}

/** "White Rice 5 kg × 20 bags" */
export function itemLine(item: Pick<OrderItem, "name" | "quantity" | "unitLabel">): string {
  return `${item.name} × ${quantityLabel(item.quantity, item.unitLabel)}`;
}

/** Orders placed as units only, and the competition's, carry no items. */
export function hasItems(items: readonly OrderItem[] | null | undefined): items is readonly OrderItem[] {
  return Array.isArray(items) && items.length > 0;
}

/** "3 products", for a collapsed summary or a one-line cue. */
export function productCount(items: readonly Pick<OrderItem, "sku">[] | null | undefined): string {
  const count = new Set((items ?? []).map((item) => item.sku)).size;
  return `${count} ${count === 1 ? "product" : "products"}`;
}
