import type { Brand, Prisma, TempRequirement } from "@prisma/client";

/**
 * The product catalogue's shared pieces: how a product and an order's contents
 * are read and shown, who may see which products, and the arithmetic that turns
 * a basket into orders.
 *
 * There is no stock or price in any of this. A product listed here is one that
 * can be ordered; nothing says it is available.
 */

/**
 * The `items` array every order read model carries. Shared rather than copied
 * into five route files because it is one shape in the contract (OrderItem) and
 * the serialiser strips whatever a response schema forgets to declare.
 */
export const ORDER_ITEMS_SCHEMA = {
  type: "array",
  items: {
    type: "object",
    additionalProperties: false,
    required: ["sku", "name", "quantity", "unitLabel"],
    properties: {
      sku: { type: "string" },
      name: { type: "string" },
      quantity: { type: "integer" },
      unitLabel: { type: "string" },
    },
  },
} as const;

/** What an order read must select to show its contents; spread into `include`. */
export const ORDER_LINES_INCLUDE = {
  orderBy: { sku: "asc" },
  select: { sku: true, productName: true, unitLabel: true, quantity: true },
} satisfies Prisma.Order$linesArgs;

export interface OrderItem {
  sku: string;
  name: string;
  quantity: number;
  unitLabel: string;
}

/**
 * An order's contents, from its lines. Always an array: an order placed as
 * units only, or one of the competition's, has none, and a client should not
 * have to tell "absent" from "empty". Tolerates `undefined` so a read that did
 * not ask for lines still serialises.
 */
export function itemsOf(
  lines: ReadonlyArray<{ sku: string; productName: string; unitLabel: string; quantity: number }> | null | undefined,
): OrderItem[] {
  return (lines ?? []).map((line) => ({
    sku: line.sku,
    name: line.productName,
    quantity: line.quantity,
    unitLabel: line.unitLabel,
  }));
}

export interface ProductRow {
  id: string;
  sku: string;
  name: string;
  brand: Brand | null;
  tempRequirement: TempRequirement;
  unitLabel: string;
  kgPerUnit: number;
  m3PerUnit: number;
  active: boolean;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
}

export function toProductView(row: ProductRow) {
  return {
    id: row.id,
    sku: row.sku,
    name: row.name,
    brand: row.brand,
    tempRequirement: row.tempRequirement,
    unitLabel: row.unitLabel,
    kgPerUnit: row.kgPerUnit,
    m3PerUnit: row.m3PerUnit,
    active: row.active,
    sortOrder: row.sortOrder,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** The fields that make up a product's decision-log snapshot. */
export function productSnapshot(row: ProductRow) {
  return {
    sku: row.sku,
    name: row.name,
    brand: row.brand,
    tempRequirement: row.tempRequirement,
    unitLabel: row.unitLabel,
    kgPerUnit: row.kgPerUnit,
    m3PerUnit: row.m3PerUnit,
    active: row.active,
    sortOrder: row.sortOrder,
  };
}

/** A product a store may order: for its own brand, or for every brand. */
export function orderableBy(product: { brand: Brand | null }, outletBrand: Brand): boolean {
  return product.brand === null || product.brand === outletBrand;
}

export interface BasketProduct {
  id: string;
  sku: string;
  name: string;
  unitLabel: string;
  kgPerUnit: number;
  m3PerUnit: number;
  tempRequirement: TempRequirement;
}

export interface BasketLine {
  productId: string;
  quantity: number;
}

export interface BasketOrder {
  tempRequirement: TempRequirement;
  units: number;
  weightKg: number;
  volumeM3: number;
  lines: Array<{
    productId: string;
    sku: string;
    productName: string;
    unitLabel: string;
    kgPerUnit: number;
    m3PerUnit: number;
    quantity: number;
  }>;
}

/** Fixed, so a mixed basket always comes back chilled first and replays the same way. */
const TEMPERATURE_ORDER: readonly TempRequirement[] = ["chilled", "ambient"];

/**
 * A basket as the orders it becomes: one per temperature, because an order has
 * exactly one temperature requirement and travels whole on one vehicle.
 *
 * Units are the sum of quantities; weight and volume are the real sums of each
 * product's size times its quantity. Weight is kept to two decimals and volume
 * to four, rather than the one and two the units-only path uses: a pack of
 * 0.007 m3 times three would otherwise round to 0.02 and lose a third of itself.
 */
export function groupBasket(
  items: readonly BasketLine[],
  products: ReadonlyMap<string, BasketProduct>,
): BasketOrder[] {
  const byTemp = new Map<TempRequirement, BasketOrder>();
  for (const item of items) {
    const product = products.get(item.productId);
    if (!product) continue;
    let order = byTemp.get(product.tempRequirement);
    if (!order) {
      order = { tempRequirement: product.tempRequirement, units: 0, weightKg: 0, volumeM3: 0, lines: [] };
      byTemp.set(product.tempRequirement, order);
    }
    order.units += item.quantity;
    order.weightKg += product.kgPerUnit * item.quantity;
    order.volumeM3 += product.m3PerUnit * item.quantity;
    order.lines.push({
      productId: product.id,
      sku: product.sku,
      productName: product.name,
      unitLabel: product.unitLabel,
      kgPerUnit: product.kgPerUnit,
      m3PerUnit: product.m3PerUnit,
      quantity: item.quantity,
    });
  }
  return TEMPERATURE_ORDER.flatMap((temp) => {
    const order = byTemp.get(temp);
    if (!order) return [];
    return [
      {
        ...order,
        weightKg: Number(order.weightKg.toFixed(2)),
        volumeM3: Number(order.volumeM3.toFixed(4)),
      },
    ];
  });
}

/**
 * The size of one unit of a basket order, for the Rule 5 check: its blended
 * average, since an order of rice and flour is neither. Weight and volume are
 * what the vehicle actually has to hold, so the check uses the totals, not the
 * estimate for the outlet.
 */
export function blendedUnitSize(order: Pick<BasketOrder, "units" | "weightKg" | "volumeM3">) {
  return { kgPerUnit: order.weightKg / order.units, m3PerUnit: order.volumeM3 / order.units };
}
