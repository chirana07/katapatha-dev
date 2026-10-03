import { describe, expect, it } from "vitest";
import { hasItems, itemLine, pluraliseLabel, productCount, quantityLabel } from "./order-items";
import { formatKg, formatM3, perUnitSize } from "./product-format";

describe("pluraliseLabel", () => {
  it("handles the common shapes of a unit label", () => {
    expect(pluraliseLabel("bag")).toBe("bags");
    expect(pluraliseLabel("carton")).toBe("cartons");
    expect(pluraliseLabel("box")).toBe("boxes");
    expect(pluraliseLabel("pantry")).toBe("pantries");
    expect(pluraliseLabel("tray")).toBe("trays");
  });
});

describe("item formatting", () => {
  it("says one, not 1s", () => {
    expect(quantityLabel(1, "crate")).toBe("1 crate");
    expect(quantityLabel(12, "crate")).toBe("12 crates");
    expect(quantityLabel(1200, "bag")).toBe("1,200 bags");
  });

  it("writes a line the way the dock reads it", () => {
    expect(itemLine({ name: "White Rice 5 kg", quantity: 20, unitLabel: "bag" })).toBe("White Rice 5 kg × 20 bags");
  });

  it("treats absent and empty items alike: legacy orders have none", () => {
    expect(hasItems(undefined)).toBe(false);
    expect(hasItems(null)).toBe(false);
    expect(hasItems([])).toBe(false);
    expect(hasItems([{ sku: "A", name: "A", quantity: 1, unitLabel: "bag" }])).toBe(true);
  });

  it("counts distinct products", () => {
    expect(productCount([{ sku: "A" }, { sku: "B" }, { sku: "A" }])).toBe("2 products");
    expect(productCount([{ sku: "A" }])).toBe("1 product");
  });
});

describe("size formatting", () => {
  it("keeps one decimal on light loads and whole kilos on heavy ones", () => {
    expect(formatKg(5.1)).toBe("5.1 kg");
    expect(formatKg(102)).toBe("102 kg");
    expect(formatKg(1260.4)).toBe("1,260 kg");
  });

  it("gives tiny volumes enough digits to be non-zero", () => {
    expect(formatM3(0.007)).toBe("0.007 m³");
    expect(formatM3(0.14)).toBe("0.14 m³");
    expect(formatM3(4.327)).toBe("4.33 m³");
    expect(formatM3(25.04)).toBe("25 m³");
  });

  it("states a unit's size on one line", () => {
    expect(perUnitSize({ kgPerUnit: 5.1, m3PerUnit: 0.007 })).toBe("5.1 kg · 0.007 m³ each");
  });
});
