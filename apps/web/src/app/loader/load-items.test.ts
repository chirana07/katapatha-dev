import { describe, expect, it } from "vitest";
import type { LoadLine } from "./dock-model";
import { UNITS_KEY, apiItemCounts, fillInOrder, initialCounts, itemsOf, packOf, productsOnTrip, shortName, spreadShort } from "./load-items";

function line(over: Partial<LoadLine> & Pick<LoadLine, "orderId">): LoadLine {
  return {
    orderRef: over.orderId.toUpperCase(),
    outletId: "OUT001",
    seq: 0,
    expectedUnits: 30,
    loadedUnits: null,
    condition: null,
    items: [
      { sku: "FA001", name: "White Rice 5 kg", quantity: 20, unitLabel: "bag" },
      { sku: "FA003", name: "Wheat Flour 1 kg (12 per carton)", quantity: 10, unitLabel: "carton" },
    ],
    ...over,
  } as LoadLine;
}

describe("itemsOf", () => {
  it("gives a units-only order one pseudo-item, the order itself", () => {
    expect(itemsOf(line({ orderId: "a", items: [] }))).toEqual([{ key: UNITS_KEY, sku: null, name: "A", unitLabel: "units", quantity: 30 }]);
  });
});

describe("initialCounts", () => {
  it("starts an untouched line at zero", () => {
    expect(initialCounts(line({ orderId: "a" }))).toEqual({ FA001: 0, FA003: 0 });
  });

  it("shows a count in progress", () => {
    expect(
      initialCounts(line({ orderId: "a", progress: { loadedUnits: 12, itemCounts: { FA001: 8, FA003: 4 }, updatedByName: "R", updatedAt: "" } })),
    ).toEqual({ FA001: 8, FA003: 4 });
  });

  it("fills a check without item counts in list order", () => {
    expect(initialCounts(line({ orderId: "a", condition: "SHORT", loadedUnits: 25 }))).toEqual({ FA001: 20, FA003: 5 });
  });

  it("prefers the item counts a check carried", () => {
    expect(initialCounts(line({ orderId: "a", condition: "SHORT", loadedUnits: 25, itemCounts: { FA001: 15, FA003: 10 } }))).toEqual({ FA001: 15, FA003: 10 });
  });
});

describe("fillInOrder / apiItemCounts", () => {
  it("never puts more on an item than it has", () => {
    expect(fillInOrder(itemsOf(line({ orderId: "a" })), 99)).toEqual({ FA001: 20, FA003: 10 });
  });

  it("sends no item counts for a units-only order", () => {
    expect(apiItemCounts({ [UNITS_KEY]: 5 })).toBeNull();
    expect(apiItemCounts({ FA001: 5 })).toEqual({ FA001: 5 });
  });
});

describe("spreadShort", () => {
  // Loading order: stop 3 first, stop 1 last. Both carry flour.
  const lines = [
    line({ orderId: "s3", seq: 2, outletId: "OUT003" }),
    line({ orderId: "s1", seq: 0, outletId: "OUT001", items: [{ sku: "FA003", name: "Wheat Flour 1 kg (12 per carton)", quantity: 6, unitLabel: "carton" }], expectedUnits: 6 }),
  ];
  const flour = productsOnTrip(lines, {}).find((p) => p.sku === "FA003")!;

  it("totals a product across the trip", () => {
    expect(flour.required).toBe(16);
    expect(flour.orders.map((o) => o.orderId)).toEqual(["s3", "s1"]);
  });

  it("lands the short on the orders loaded last, then works back", () => {
    expect(spreadShort(flour, 4).map((o) => [o.orderId, o.short])).toEqual([["s1", 4]]);
    expect(spreadShort(flour, 9).map((o) => [o.orderId, o.short])).toEqual([
      ["s3", 3],
      ["s1", 6],
    ]);
  });

  it("never spreads more than the trip carries", () => {
    expect(spreadShort(flour, 99).reduce((sum, o) => sum + o.short, 0)).toBe(16);
  });
});

describe("names", () => {
  it("splits the pack size out of a product name", () => {
    expect(shortName("Wheat Flour 1 kg (12 per carton)")).toBe("Wheat Flour 1 kg");
    expect(packOf({ name: "Wheat Flour 1 kg (12 per carton)", unitLabel: "carton" })).toBe("12 per carton");
    expect(packOf({ name: "Red Rice 5 kg", unitLabel: "bag" })).toBe("bag");
  });
});
