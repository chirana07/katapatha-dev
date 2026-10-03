import { describe, it, expect } from "vitest";
import {
  asOrderedNote,
  COMPACT_ITEM_LINES,
  itemLine,
  itemsTotal,
  itemsView,
  pluralUnitLabel,
  productCountLabel,
  toggleLabel,
  type CachedItem,
} from "./order-items";

const item = (n: number, quantity = n): CachedItem => ({
  sku: `FA${String(n).padStart(3, "0")}`,
  name: `Product ${n}`,
  quantity,
  unitLabel: "bag",
});

const EIGHT = Array.from({ length: 8 }, (_, i) => item(i + 1, 2));

describe("itemLine", () => {
  it("reads 'name · quantity unit'", () => {
    expect(
      itemLine({ sku: "FA001", name: "White Rice 5 kg", quantity: 12, unitLabel: "bag" }),
    ).toBe("White Rice 5 kg · 12 bags");
  });

  it("keeps the singular for one", () => {
    expect(itemLine({ sku: "X", name: "Tea Leaves 400 g", quantity: 1, unitLabel: "box" })).toBe(
      "Tea Leaves 400 g · 1 box",
    );
  });
});

describe("pluralUnitLabel", () => {
  it("pluralises plain, sibilant and -y labels", () => {
    expect(pluralUnitLabel("carton", 3)).toBe("cartons");
    expect(pluralUnitLabel("box", 3)).toBe("boxes");
    expect(pluralUnitLabel("pantry", 2)).toBe("pantries");
    expect(pluralUnitLabel("tray", 2)).toBe("trays");
    expect(pluralUnitLabel("bag", 1)).toBe("bag");
  });
});

describe("itemsView", () => {
  it("shows a short order whole, with nothing to toggle", () => {
    const view = itemsView(EIGHT.slice(0, COMPACT_ITEM_LINES), false);
    expect(view.lines).toHaveLength(3);
    expect(view.canToggle).toBe(false);
    expect(view.moreLabel).toBeNull();
  });

  it("does not hide a single line behind '+1 more'", () => {
    const view = itemsView(EIGHT.slice(0, COMPACT_ITEM_LINES + 1), false);
    expect(view.lines).toHaveLength(4);
    expect(view.canToggle).toBe(false);
  });

  it("collapses a long order to three lines and '+N more'", () => {
    const view = itemsView(EIGHT, false);
    expect(view.lines).toEqual(EIGHT.slice(0, 3).map(itemLine));
    expect(view.hidden).toBe(5);
    expect(view.moreLabel).toBe("+5 more");
    expect(view.canToggle).toBe(true);
    expect(toggleLabel(view, false)).toBe("+5 more");
  });

  it("expands to every line, in the server's order", () => {
    const view = itemsView(EIGHT, true);
    expect(view.lines).toEqual(EIGHT.map(itemLine));
    expect(view.moreLabel).toBeNull();
    expect(view.canToggle).toBe(true);
    expect(toggleLabel(view, true)).toBe("Show fewer");
  });

  it("treats a missing breakdown as empty, not as an error", () => {
    expect(itemsView(undefined, false).lines).toEqual([]);
    expect(itemsView([], false).canToggle).toBe(false);
  });
});

describe("asOrderedNote", () => {
  const items = [item(1, 40), item(2, 29)];

  it("is silent when the breakdown matches what is on the vehicle", () => {
    expect(asOrderedNote({ expectedUnits: 69, orderedUnits: 69, items })).toBeNull();
  });

  it("is silent, not a warning, when the quantities do not sum to the units", () => {
    // Fewer in the breakdown than on the vehicle: nothing to say.
    expect(asOrderedNote({ expectedUnits: 80, orderedUnits: 80, items })).toBeNull();
    expect(asOrderedNote({ expectedUnits: 80, items })).toBeNull();
  });

  it("labels the breakdown 'as ordered' when the dock sent the order short", () => {
    expect(asOrderedNote({ expectedUnits: 60, orderedUnits: 69, items })).toMatch(/as ordered/i);
    // Even when the ordered figure is unknown, a breakdown bigger than the load is.
    expect(asOrderedNote({ expectedUnits: 60, items })).toMatch(/as ordered/i);
  });

  it("says nothing without a breakdown", () => {
    expect(asOrderedNote({ expectedUnits: 60, orderedUnits: 69, items: [] })).toBeNull();
    expect(asOrderedNote({ expectedUnits: 60, orderedUnits: 69 })).toBeNull();
  });
});

describe("totals and counts", () => {
  it("sums quantities (for the 'as ordered' check only)", () => {
    expect(itemsTotal([item(1, 40), item(2, 29)])).toBe(69);
    expect(itemsTotal(undefined)).toBe(0);
  });

  it("counts products, not units", () => {
    expect(productCountLabel([item(1, 40), item(2, 29)])).toBe("2 products");
    expect(productCountLabel([item(1)])).toBe("1 product");
    expect(productCountLabel([])).toBeNull();
  });
});
