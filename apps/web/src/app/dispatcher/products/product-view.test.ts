import { describe, expect, it } from "vitest";
import { filterCatalogue, parseFilters, productsHref, safeProductsPath, tempCounts, type Product } from "./product-view";

const make = (sku: string, o: Partial<Product>): Product => ({
  id: sku,
  sku,
  name: sku,
  brand: null,
  tempRequirement: "ambient",
  unitLabel: "bag",
  kgPerUnit: 1,
  m3PerUnit: 0.01,
  active: true,
  sortOrder: 0,
  createdAt: "",
  updatedAt: "",
  ...o,
});

const catalogue = [
  make("FA001", { name: "White Rice 5 kg", brand: "Fresh" }),
  make("FA002", { name: "Red Rice 5 kg", brand: null, active: false }),
  make("FC001", { name: "Fresh Milk 1 L", brand: "Fresh", tempRequirement: "chilled" }),
  make("ST001", { name: "Linen Shirt", brand: "Style" }),
];
const none = parseFilters({});

describe("parseFilters", () => {
  it("ignores anything it does not recognise", () => {
    expect(parseFilters({ temp: "frozen", brand: "Acme", status: "x", q: "  rice " })).toEqual({ temp: null, brand: "any", status: "all", q: "rice" });
  });

  it("reads the real values", () => {
    expect(parseFilters({ temp: "chilled", brand: "all-brands", status: "inactive" })).toMatchObject({ temp: "chilled", brand: "all-brands", status: "inactive" });
    expect(parseFilters({ brand: ["Style", "Fresh"] }).brand).toBe("Style");
  });
});

describe("filterCatalogue", () => {
  it("keeps inactive products unless asked otherwise", () => {
    expect(filterCatalogue(catalogue, none)).toHaveLength(4);
    expect(filterCatalogue(catalogue, { ...none, status: "active" })).toHaveLength(3);
    expect(filterCatalogue(catalogue, { ...none, status: "inactive" }).map((p) => p.sku)).toEqual(["FA002"]);
  });

  it("treats All brands as its own filter, not as every product", () => {
    expect(filterCatalogue(catalogue, { ...none, brand: "all-brands" }).map((p) => p.sku)).toEqual(["FA002"]);
    expect(filterCatalogue(catalogue, { ...none, brand: "Fresh" }).map((p) => p.sku)).toEqual(["FA001", "FC001"]);
  });

  it("searches name or SKU in any case", () => {
    expect(filterCatalogue(catalogue, { ...none, q: "rice" })).toHaveLength(2);
    expect(filterCatalogue(catalogue, { ...none, q: "st001" })).toHaveLength(1);
  });

  it("counts each temperature under the other filters", () => {
    expect(tempCounts(catalogue, { ...none, temp: "chilled" })).toEqual({ all: 4, ambient: 3, chilled: 1 });
    expect(tempCounts(catalogue, { ...none, status: "active" })).toEqual({ all: 3, ambient: 2, chilled: 1 });
  });
});

describe("links", () => {
  it("keeps the filters and adds the dialog", () => {
    expect(productsHref(none)).toBe("/dispatcher/products");
    expect(productsHref({ ...none, temp: "chilled", q: "milk" }, { edit: "p1" })).toBe("/dispatcher/products?temp=chilled&q=milk&edit=p1");
    expect(productsHref(none, { add: true })).toBe("/dispatcher/products?add=1");
  });

  it("only follows a return path that stays on the page", () => {
    expect(safeProductsPath("/dispatcher/products?temp=chilled")).toBe("/dispatcher/products?temp=chilled");
    expect(safeProductsPath("https://evil.example")).toBe("/dispatcher/products");
    expect(safeProductsPath("//evil.example")).toBe("/dispatcher/products");
    expect(safeProductsPath("/dispatcher/productsx")).toBe("/dispatcher/products");
    expect(safeProductsPath(null)).toBe("/dispatcher/products");
  });
});
