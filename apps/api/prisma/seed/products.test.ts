/**
 * The fixture breakdown is pure, so it is tested without a database. What
 * matters: the quantities always add back to the order's units (the order is
 * the allocation truth and the breakdown must never disagree with it), it only
 * uses products the order could contain, and it is the same on every run.
 */

import { describe, expect, it } from "vitest";
import { PRODUCT_CATALOGUE, breakdownFor, type BreakdownProduct } from "./products";

const catalogue: BreakdownProduct[] = PRODUCT_CATALOGUE.map((p, i) => ({
  ...p,
  id: `p-${p.sku}`,
  sortOrder: (i + 1) * 10,
}));

describe("the demo catalogue", () => {
  it("has unique upper-case SKUs and positive sizes", () => {
    const skus = PRODUCT_CATALOGUE.map((p) => p.sku);
    expect(new Set(skus).size).toBe(skus.length);
    for (const p of PRODUCT_CATALOGUE) {
      expect(p.sku).toBe(p.sku.toUpperCase());
      expect(p.kgPerUnit).toBeGreaterThan(0);
      expect(p.m3PerUnit).toBeGreaterThan(0);
    }
  });

  it("covers every brand and both temperatures", () => {
    expect(new Set(PRODUCT_CATALOGUE.map((p) => p.brand))).toEqual(new Set(["Fresh", "Style", "Tech", null]));
    expect(new Set(PRODUCT_CATALOGUE.map((p) => p.tempRequirement))).toEqual(new Set(["chilled", "ambient"]));
  });
});

describe("breakdownFor", () => {
  it("always adds up to the order's units, with no empty line", () => {
    for (const brand of ["Fresh", "Style", "Tech"] as const) {
      for (const tempRequirement of ["ambient", "chilled"] as const) {
        for (let units = 1; units <= 500; units++) {
          const lines = breakdownFor({ ref: `X-${units}`, units, brand, tempRequirement }, catalogue);
          if (lines.length === 0) {
            // No Style or Tech chilled products exist: nothing to invent.
            expect(tempRequirement === "chilled" && brand !== "Fresh").toBe(true);
            continue;
          }
          expect(lines.reduce((n, l) => n + l.quantity, 0)).toBe(units);
          expect(lines.every((l) => l.quantity >= 1)).toBe(true);
          expect(new Set(lines.map((l) => l.productId)).size).toBe(lines.length);
        }
      }
    }
  });

  it("only uses products of the order's temperature and brand (or no brand)", () => {
    const byId = new Map(catalogue.map((p) => [p.id, p]));
    const lines = breakdownFor({ ref: "DEMO-006", units: 45, brand: "Fresh", tempRequirement: "chilled" }, catalogue);
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      const p = byId.get(line.productId)!;
      expect(p.tempRequirement).toBe("chilled");
      expect(p.brand === "Fresh" || p.brand === null).toBe(true);
    }
  });

  it("is deterministic in the order ref", () => {
    const order = { ref: "DEMO-011", units: 80, brand: "Fresh" as const, tempRequirement: "ambient" as const };
    expect(breakdownFor(order, catalogue)).toEqual(breakdownFor(order, catalogue));
  });
});
