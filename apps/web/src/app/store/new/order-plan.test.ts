import { describe, expect, it } from "vitest";
import {
  basketItems,
  clampQuantity,
  countByTemp,
  filterProducts,
  parseSavedBasket,
  reconcileBasket,
  serialiseBasket,
  withQuantity,
  type Product,
} from "./basket";
import { planBasket } from "./order-plan";

function product(overrides: Partial<Product> & Pick<Product, "id" | "sku" | "name" | "tempRequirement">): Product {
  return {
    brand: null,
    unitLabel: "bag",
    kgPerUnit: 1,
    m3PerUnit: 0.001,
    active: true,
    sortOrder: 0,
    createdAt: "2026-10-04T00:00:00Z",
    updatedAt: "2026-10-04T00:00:00Z",
    ...overrides,
  };
}

const rice = product({ id: "p1", sku: "FA001", name: "White Rice 5 kg", tempRequirement: "ambient", kgPerUnit: 5.1, m3PerUnit: 0.007 });
const flour = product({ id: "p2", sku: "FA003", name: "Wheat Flour 1 kg", tempRequirement: "ambient", kgPerUnit: 12.5, m3PerUnit: 0.02, unitLabel: "carton" });
const milk = product({ id: "p3", sku: "FC001", name: "Fresh Milk 1 L", tempRequirement: "chilled", kgPerUnit: 12.6, m3PerUnit: 0.02, unitLabel: "crate" });
const catalogue = [rice, flour, milk];

const limits = {
  ambient: { m3PerUnit: 0.1, kgPerUnit: 10, maxUnitsPerOrder: 300 },
  chilled: { m3PerUnit: 0.09, kgPerUnit: 8, maxUnitsPerOrder: 0 },
};

describe("quantities", () => {
  it("keeps typed quantities whole and inside 0..10,000", () => {
    expect(clampQuantity(12.9)).toBe(12);
    expect(clampQuantity(-4)).toBe(0);
    expect(clampQuantity(Number.NaN)).toBe(0);
    expect(clampQuantity(99_999)).toBe(10_000);
  });

  it("takes a product out of the basket at zero", () => {
    const basket = withQuantity(withQuantity({}, "p1", 5), "p2", 3);
    expect(basket).toEqual({ p1: 5, p2: 3 });
    expect(withQuantity(basket, "p1", 0)).toEqual({ p2: 3 });
  });
});

describe("filtering", () => {
  it("matches name or SKU in any case and narrows by temperature", () => {
    expect(filterProducts(catalogue, { temp: "all", query: "rice" })).toEqual([rice]);
    expect(filterProducts(catalogue, { temp: "all", query: "fc001" })).toEqual([milk]);
    expect(filterProducts(catalogue, { temp: "chilled", query: "" })).toEqual([milk]);
    expect(filterProducts(catalogue, { temp: "chilled", query: "rice" })).toEqual([]);
    expect(filterProducts(catalogue, { temp: "all", query: "  " })).toHaveLength(3);
  });

  it("counts each temperature under the current search", () => {
    expect(countByTemp(catalogue, "")).toEqual({ all: 3, ambient: 2, chilled: 1 });
    expect(countByTemp(catalogue, "f")).toEqual({ all: 3, ambient: 2, chilled: 1 });
    expect(countByTemp(catalogue, "milk")).toEqual({ all: 1, ambient: 0, chilled: 1 });
  });
});

describe("planBasket", () => {
  it("groups by the product's temperature, ambient first, with real sizes", () => {
    const plan = planBasket(catalogue, { p3: 10, p1: 20, p2: 4 }, limits);
    expect(plan.groups.map((group) => group.temp)).toEqual(["ambient", "chilled"]);
    const [ambient, chilled] = plan.groups;
    expect(ambient!.units).toBe(24);
    expect(ambient!.weightKg).toBeCloseTo(20 * 5.1 + 4 * 12.5);
    expect(ambient!.volumeM3).toBeCloseTo(20 * 0.007 + 4 * 0.02);
    expect(chilled!.units).toBe(10);
    expect(plan.totalUnits).toBe(34);
    expect(plan.weightKg).toBeCloseTo(102 + 50 + 126);
    expect(plan.lines.map((line) => line.product.id)).toEqual(["p1", "p2", "p3"]);
  });

  it("lists only the temperatures that have something in them", () => {
    const plan = planBasket(catalogue, { p1: 1 }, limits);
    expect(plan.groups.map((group) => group.temp)).toEqual(["ambient"]);
  });

  it("ignores basket entries that are not in the catalogue", () => {
    expect(planBasket(catalogue, { gone: 5 }, limits).totalUnits).toBe(0);
  });

  it("flags a temperature no vehicle can carry to this outlet, and nothing else", () => {
    expect(planBasket(catalogue, { p3: 5 }, limits).blocked).toBe(true);
    expect(planBasket(catalogue, { p1: 5000 }, limits).blocked).toBe(false);
  });

  it("does not guess when limits could not be read", () => {
    expect(planBasket(catalogue, { p3: 5 }, null).blocked).toBe(false);
  });
});

describe("basket persistence and the request body", () => {
  it("sends items in catalogue order, however the basket was built", () => {
    expect(basketItems({ p3: 2, p1: 7 }, catalogue)).toEqual([
      { productId: "p1", quantity: 7 },
      { productId: "p3", quantity: 2 },
    ]);
  });

  it("round-trips a saved basket and survives garbage", () => {
    expect(parseSavedBasket(serialiseBasket({ p1: 4 }))).toEqual({ p1: 4 });
    expect(parseSavedBasket(null)).toEqual({});
    expect(parseSavedBasket("not json")).toEqual({});
    expect(parseSavedBasket("[1,2]")).toEqual({});
    expect(parseSavedBasket('{"p1":"4","p2":-1,"p3":2.9}')).toEqual({ p3: 2 });
  });

  it("drops products the catalogue no longer offers and says how many", () => {
    expect(reconcileBasket({ p1: 3, gone: 9 }, catalogue)).toEqual({ basket: { p1: 3 }, dropped: 1 });
  });
});
