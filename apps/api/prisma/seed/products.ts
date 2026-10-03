/**
 * The demo product catalogue, and a deterministic breakdown of the fixture
 * orders into it.
 *
 * The competition CSVs carry no products at all, so this catalogue is DEMO
 * DATA in both seed modes: plausible Sri Lankan retail lines with believable
 * per-unit sizes, invented here. The seed says so in its log, and nothing in
 * the product presents the catalogue as Waypoint's own.
 *
 * There is no stock or price on a product, and none is invented here either.
 */

import type { Brand, PrismaClient, TempRequirement } from "@prisma/client";
import { hashString } from "./history";

export interface CatalogueEntry {
  sku: string;
  name: string;
  /** Null = every brand. */
  brand: Brand | null;
  tempRequirement: TempRequirement;
  unitLabel: string;
  kgPerUnit: number;
  m3PerUnit: number;
}

// Sizes are for one unit of the label, packaging included (a carton of twelve
// 1 kg packs weighs a little over 12 kg). Volumes are the outer carton, not the
// goods.
export const PRODUCT_CATALOGUE: readonly CatalogueEntry[] = [
  // --- Fresh, ambient --------------------------------------------------------
  { sku: "FA001", name: "White Rice 5 kg", brand: "Fresh", tempRequirement: "ambient", unitLabel: "bag", kgPerUnit: 5.1, m3PerUnit: 0.007 },
  { sku: "FA002", name: "Red Rice 5 kg", brand: "Fresh", tempRequirement: "ambient", unitLabel: "bag", kgPerUnit: 5.1, m3PerUnit: 0.007 },
  { sku: "FA003", name: "Wheat Flour 1 kg (12 per carton)", brand: "Fresh", tempRequirement: "ambient", unitLabel: "carton", kgPerUnit: 12.4, m3PerUnit: 0.018 },
  { sku: "FA004", name: "White Sugar 1 kg (10 per carton)", brand: "Fresh", tempRequirement: "ambient", unitLabel: "carton", kgPerUnit: 10.4, m3PerUnit: 0.014 },
  { sku: "FA005", name: "Red Dhal 1 kg (10 per carton)", brand: "Fresh", tempRequirement: "ambient", unitLabel: "carton", kgPerUnit: 10.3, m3PerUnit: 0.013 },
  { sku: "FA006", name: "Coconut Oil 1 L (12 per carton)", brand: "Fresh", tempRequirement: "ambient", unitLabel: "carton", kgPerUnit: 11.8, m3PerUnit: 0.016 },
  { sku: "FA007", name: "Ceylon Tea Leaves 400 g (20 per carton)", brand: "Fresh", tempRequirement: "ambient", unitLabel: "carton", kgPerUnit: 8.6, m3PerUnit: 0.021 },
  { sku: "FA008", name: "Cream Crackers 190 g (24 per carton)", brand: "Fresh", tempRequirement: "ambient", unitLabel: "carton", kgPerUnit: 5.2, m3PerUnit: 0.03 },
  // --- Fresh, chilled --------------------------------------------------------
  { sku: "FC001", name: "Fresh Milk 1 L (12 per crate)", brand: "Fresh", tempRequirement: "chilled", unitLabel: "crate", kgPerUnit: 12.6, m3PerUnit: 0.02 },
  { sku: "FC002", name: "Set Yoghurt 80 g (24 per tray)", brand: "Fresh", tempRequirement: "chilled", unitLabel: "tray", kgPerUnit: 2.3, m3PerUnit: 0.006 },
  { sku: "FC003", name: "Curd 500 ml (10 per crate)", brand: "Fresh", tempRequirement: "chilled", unitLabel: "crate", kgPerUnit: 5.4, m3PerUnit: 0.012 },
  { sku: "FC004", name: "Butter 200 g (20 per carton)", brand: "Fresh", tempRequirement: "chilled", unitLabel: "carton", kgPerUnit: 4.2, m3PerUnit: 0.007 },
  { sku: "FC005", name: "Whole Chicken (10 kg crate)", brand: "Fresh", tempRequirement: "chilled", unitLabel: "crate", kgPerUnit: 10.8, m3PerUnit: 0.022 },
  { sku: "FC006", name: "Fresh Tuna (10 kg box)", brand: "Fresh", tempRequirement: "chilled", unitLabel: "box", kgPerUnit: 11.5, m3PerUnit: 0.02 },
  { sku: "FC007", name: "Mixed Vegetables (10 kg crate)", brand: "Fresh", tempRequirement: "chilled", unitLabel: "crate", kgPerUnit: 10.5, m3PerUnit: 0.03 },
  // --- Style, ambient --------------------------------------------------------
  { sku: "ST001", name: "Cotton T-Shirt (10 per pack)", brand: "Style", tempRequirement: "ambient", unitLabel: "pack", kgPerUnit: 2.4, m3PerUnit: 0.02 },
  { sku: "ST002", name: "Denim Jeans (5 per pack)", brand: "Style", tempRequirement: "ambient", unitLabel: "pack", kgPerUnit: 3.6, m3PerUnit: 0.025 },
  // --- Tech, ambient ---------------------------------------------------------
  { sku: "TE001", name: "USB-C Charger 20 W (20 per carton)", brand: "Tech", tempRequirement: "ambient", unitLabel: "carton", kgPerUnit: 4.0, m3PerUnit: 0.012 },
  { sku: "TE002", name: "Wireless Earbuds (10 per carton)", brand: "Tech", tempRequirement: "ambient", unitLabel: "carton", kgPerUnit: 2.2, m3PerUnit: 0.008 },
  // --- Every brand -----------------------------------------------------------
  { sku: "WG001", name: "Reusable Shopping Bags (100 per carton)", brand: null, tempRequirement: "ambient", unitLabel: "carton", kgPerUnit: 3.2, m3PerUnit: 0.04 },
];

/**
 * Add the catalogue, leaving anything already there alone.
 *
 * `update: {}` is deliberate: a dispatcher may have renamed, re-sized or
 * deactivated a product since the first seed, and re-running a top-up must not
 * quietly undo that. Returns how many products were new.
 */
export async function seedProducts(prisma: PrismaClient): Promise<{ total: number; added: number }> {
  const before = await prisma.product.count();
  for (const [index, p] of PRODUCT_CATALOGUE.entries()) {
    await prisma.product.upsert({
      where: { sku: p.sku },
      update: {},
      create: { ...p, sortOrder: (index + 1) * 10 },
    });
  }
  const total = await prisma.product.count();
  return { total, added: total - before };
}

export interface BreakdownProduct {
  id: string;
  sku: string;
  name: string;
  unitLabel: string;
  kgPerUnit: number;
  m3PerUnit: number;
  brand: Brand | null;
  tempRequirement: TempRequirement;
  sortOrder: number;
}

export interface BreakdownLine {
  productId: string;
  quantity: number;
}

/**
 * Split one order's units across two or three products it could plausibly
 * contain: the order's temperature, and its outlet's brand or no brand.
 *
 * Deterministic in the order ref alone, so reseeding gives the same demo. The
 * quantities always sum to `units` exactly; the order's own units, weight and
 * volume are never touched, because those are what the allocator planned.
 */
export function breakdownFor(
  order: { ref: string; units: number; brand: Brand; tempRequirement: TempRequirement },
  catalogue: readonly BreakdownProduct[],
): BreakdownLine[] {
  const fits = catalogue
    .filter((p) => p.tempRequirement === order.tempRequirement && (p.brand === null || p.brand === order.brand))
    .sort((a, b) => a.sortOrder - b.sortOrder || a.sku.localeCompare(b.sku));
  // The brand's own lines make the believable basket; the every-brand lines
  // (shopping bags) only fill in where a brand has too few to split across.
  const own = fits.filter((p) => p.brand !== null);
  const eligible = own.length >= 2 ? own : fits;
  if (eligible.length === 0 || order.units <= 0) return [];

  const hash = hashString(order.ref);
  const count = Math.min(eligible.length, order.units, 2 + (hash % 2));
  const start = hash % eligible.length;
  const picked = Array.from({ length: count }, (_, i) => eligible[(start + i) % eligible.length]!);

  // 3:2:1, so the first product dominates the way a real basket does.
  const weights = [3, 2, 1].slice(0, count);
  const weightSum = weights.reduce((a, b) => a + b, 0);
  const quantities = weights.map((w) => Math.max(1, Math.floor((order.units * w) / weightSum)));
  // Rounding and the floor of one can leave the total off; settle it on the
  // largest line, which can absorb it without going below one.
  quantities[0] = quantities[0]! + (order.units - quantities.reduce((a, b) => a + b, 0));

  return picked.map((p, i) => ({ productId: p.id, quantity: quantities[i]! }));
}

/**
 * Give the fixture's synthetic orders a breakdown. Only orders that have none
 * yet, so it is safe to run again, and only the fixture's own DEMO- orders —
 * anything a store placed from products already has lines, and anything else is
 * competition data we do not invent contents for.
 */
export async function seedFixtureOrderLines(prisma: PrismaClient): Promise<{ orders: number; lines: number }> {
  const products = await prisma.product.findMany({ where: { active: true } });
  const orders = await prisma.order.findMany({
    where: { ref: { startsWith: "DEMO-" }, lines: { none: {} } },
    select: { id: true, ref: true, units: true, brand: true, tempRequirement: true },
    orderBy: { ref: "asc" },
  });

  let lines = 0;
  let ordersWithLines = 0;
  for (const order of orders) {
    const picked = breakdownFor(order, products);
    if (picked.length === 0) continue;
    const byId = new Map(products.map((p) => [p.id, p]));
    await prisma.orderLine.createMany({
      data: picked.map((line) => {
        const p = byId.get(line.productId)!;
        return {
          orderId: order.id,
          productId: p.id,
          sku: p.sku,
          productName: p.name,
          unitLabel: p.unitLabel,
          kgPerUnit: p.kgPerUnit,
          m3PerUnit: p.m3PerUnit,
          quantity: line.quantity,
        };
      }),
    });
    lines += picked.length;
    ordersWithLines += 1;
  }
  return { orders: ordersWithLines, lines };
}
