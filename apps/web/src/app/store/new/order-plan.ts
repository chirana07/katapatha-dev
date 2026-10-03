import type { components } from "@katapatha/contracts/types";
import type { Basket, Product, Temp } from "./basket";

type OrderLimits = components["schemas"]["OrderLimits"];

export interface PlanLine {
  product: Product;
  quantity: number;
}

/** One temperature's share of the basket: it becomes one order. */
export interface PlanGroup {
  temp: Temp;
  lines: PlanLine[];
  units: number;
  /** Real figures from the catalogue's per-unit sizes, not an estimate. */
  weightKg: number;
  volumeM3: number;
  /** No vehicle at the depot can carry this temperature to the outlet. */
  blocked: boolean;
}

export interface OrderPlan {
  /** Only the temperatures with something in them, ambient first. */
  groups: PlanGroup[];
  lines: PlanLine[];
  totalUnits: number;
  weightKg: number;
  volumeM3: number;
  blocked: boolean;
}

/**
 * What placing this basket would do, as the API will do it: products are
 * grouped by their own temperature into one order each, an order's units are
 * the sum of its quantities, and its weight and volume are the sum of each
 * product's catalogue size times its quantity.
 *
 * Whether an order is too large for one vehicle is NOT decided here. That
 * depends on the blended size of the products in it, which only the API sees
 * the whole fleet for, and it answers `ORDER_TOO_LARGE` with the limit. The
 * only thing `limits` can say in advance is the size-independent case: no
 * vehicle at all can carry that temperature to this outlet.
 */
export function planBasket(products: readonly Product[], basket: Basket, limits: OrderLimits | null): OrderPlan {
  const lines: PlanLine[] = products.flatMap((product) => {
    const quantity = basket[product.id];
    return quantity && quantity > 0 ? [{ product, quantity }] : [];
  });

  const groups: PlanGroup[] = (["ambient", "chilled"] as const).flatMap((temp) => {
    const own = lines.filter((line) => line.product.tempRequirement === temp);
    if (own.length === 0) return [];
    const limit = limits?.[temp];
    return [
      {
        temp,
        lines: own,
        units: own.reduce((sum, line) => sum + line.quantity, 0),
        weightKg: own.reduce((sum, line) => sum + line.quantity * line.product.kgPerUnit, 0),
        volumeM3: own.reduce((sum, line) => sum + line.quantity * line.product.m3PerUnit, 0),
        blocked: limit != null && limit.maxUnitsPerOrder <= 0,
      },
    ];
  });

  return {
    groups,
    lines,
    totalUnits: groups.reduce((sum, group) => sum + group.units, 0),
    weightKg: groups.reduce((sum, group) => sum + group.weightKg, 0),
    volumeM3: groups.reduce((sum, group) => sum + group.volumeM3, 0),
    blocked: groups.some((group) => group.blocked),
  };
}
