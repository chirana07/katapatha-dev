import type { components } from "@katapatha/contracts/types";

export type Product = components["schemas"]["Product"];
export type { Temp } from "@/lib/temperature";
import type { Temp } from "@/lib/temperature";
/** What the manager has chosen: quantity by product id. Absent means zero. */
export type Basket = Record<string, number>;
export type TempChoice = "all" | Temp;

export const MAX_QUANTITY = 10_000;
/** The API's `items` limit. A catalogue bigger than this would need a smarter picker. */
export const MAX_BASKET_PRODUCTS = 100;

/** A typed or stepped quantity, made safe: whole, at least 0, at most 10,000. */
export function clampQuantity(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(MAX_QUANTITY, Math.max(0, Math.trunc(value)));
}

/** The basket with one product set to a quantity; zero takes it out. */
export function withQuantity(basket: Basket, productId: string, quantity: number): Basket {
  const next = { ...basket };
  const safe = clampQuantity(quantity);
  if (safe === 0) delete next[productId];
  else next[productId] = safe;
  return next;
}

/** Products matching the temperature chip and the search box (name or SKU, any case). */
export function filterProducts(products: readonly Product[], filter: { temp: TempChoice; query: string }): Product[] {
  const needle = filter.query.trim().toLowerCase();
  return products.filter(
    (product) =>
      (filter.temp === "all" || product.tempRequirement === filter.temp) &&
      (needle === "" || product.name.toLowerCase().includes(needle) || product.sku.toLowerCase().includes(needle)),
  );
}

/** Chip counts: how many products the search leaves in each temperature. */
export function countByTemp(products: readonly Product[], query: string): Record<TempChoice, number> {
  const matching = filterProducts(products, { temp: "all", query });
  return {
    all: matching.length,
    ambient: matching.filter((product) => product.tempRequirement === "ambient").length,
    chilled: matching.filter((product) => product.tempRequirement === "chilled").length,
    frozen: matching.filter((product) => product.tempRequirement === "frozen").length,
  };
}

/**
 * A saved or hand-edited basket, reduced to the products that still exist in
 * the catalogue the page loaded. `dropped` counts the rest: a product
 * deactivated since the basket was saved must not be sent, and the manager is
 * told it was taken off.
 */
export function reconcileBasket(basket: Basket, products: readonly Product[]): { basket: Basket; dropped: number } {
  const known = new Set(products.map((product) => product.id));
  const kept: Basket = {};
  let dropped = 0;
  for (const [productId, quantity] of Object.entries(basket)) {
    if (known.has(productId) && clampQuantity(quantity) > 0) kept[productId] = clampQuantity(quantity);
    else dropped += 1;
  }
  return { basket: kept, dropped };
}

/** The body the API wants, in catalogue order so the same basket always serialises the same. */
export function basketItems(basket: Basket, products: readonly Product[]): { productId: string; quantity: number }[] {
  return products.flatMap((product) => {
    const quantity = basket[product.id];
    return quantity && quantity > 0 ? [{ productId: product.id, quantity }] : [];
  });
}

/** What the browser keeps between a reload and the next render: JSON, tolerant of anything. */
export function parseSavedBasket(raw: string | null): Basket {
  if (!raw) return {};
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
    const basket: Basket = {};
    for (const [productId, quantity] of Object.entries(value)) {
      if (typeof quantity === "number" && clampQuantity(quantity) > 0) basket[productId] = clampQuantity(quantity);
    }
    return basket;
  } catch {
    return {};
  }
}

export function serialiseBasket(basket: Basket): string {
  return JSON.stringify(basket);
}
