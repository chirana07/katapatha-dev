import { describe, it, expect } from "vitest";
import {
  countSubtitle,
  countSummaryCard,
  defaultCounts,
  firstSegment,
  orderRefLabel,
  receiptUnitsCard,
  rowOfLabel,
  stopSubline,
  summariseUnits,
  type CountOrder,
} from "./units";

const ORDERS: CountOrder[] = [
  { orderId: "a", orderRef: "S1-082a", expectedUnits: 20 },
  { orderId: "b", orderRef: "S1-082b", expectedUnits: 18 },
  { orderId: "c", orderRef: "S1-082c", expectedUnits: 16 },
  { orderId: "d", orderRef: "S1-082d", expectedUnits: 15 },
];

describe("counting", () => {
  it("defaults every order to what was expected", () => {
    expect(defaultCounts(ORDERS)).toEqual({ a: 20, b: 18, c: 16, d: 15 });
  });

  it("a full count matches the loading list", () => {
    const summary = summariseUnits(ORDERS, defaultCounts(ORDERS));
    expect(summary).toMatchObject({ expected: 69, counted: 69, short: 0, shortOrders: 0, complete: true });
    expect(countSummaryCard(summary, "OUT074")).toEqual({
      tone: "good",
      title: "69 / 69 units counted",
      body: "Matches the loading list for OUT074",
    });
    expect(receiptUnitsCard(summary)).toEqual({
      tone: "good",
      title: "69 / 69 units checked",
      body: "No shortages recorded",
    });
  });

  it("a short count says how many and that it becomes a part delivery", () => {
    const summary = summariseUnits(ORDERS, { ...defaultCounts(ORDERS), a: 17, d: 14 });
    expect(summary).toMatchObject({ counted: 65, short: 4, shortOrders: 2, complete: false });
    expect(summary.rows.find((row) => row.orderId === "a")).toMatchObject({ counted: 17, short: 3 });
    expect(countSummaryCard(summary, "OUT074")).toEqual({
      tone: "warn",
      title: "4 units short",
      body: "Will be recorded as a part delivery",
    });
    expect(receiptUnitsCard(summary)).toMatchObject({ tone: "warn", title: "4 short" });
    expect(countSummaryCard(summariseUnits(ORDERS, { ...defaultCounts(ORDERS), a: 19 }), "O").title).toBe("1 unit short");
  });

  it("treats a missing count as the expected one, and never reports a negative shortage", () => {
    const summary = summariseUnits(ORDERS, { a: 25 });
    expect(summary.rows[0].short).toBe(0);
    expect(summary.rows[1]).toMatchObject({ counted: 18, short: 0 });
  });

  it("an order the dock sent short says so beside 'of N units'", () => {
    const orders: CountOrder[] = [{ orderId: "a", orderRef: "S1", expectedUnits: 18, orderedUnits: 20 }];
    const row = summariseUnits(orders, { a: 18 }).rows[0];
    expect(row.dockShort).toBe(2);
    expect(rowOfLabel(row)).toBe("of 18 units · 20 ordered");

    const plain = summariseUnits([{ orderId: "a", orderRef: "S1", expectedUnits: 18, orderedUnits: 18 }], { a: 18 }).rows[0];
    expect(rowOfLabel(plain)).toBe("of 18 units");
    expect(rowOfLabel(summariseUnits(ORDERS, defaultCounts(ORDERS)).rows[0])).toBe("of 20 units");
  });
});

describe("wording about the stop", () => {
  it("counts orders, not items", () => {
    expect(countSubtitle(4, 69, "this stop")).toBe(
      "Tap − if units are missing or refused. 4 orders · 69 units on this stop.",
    );
    expect(countSubtitle(1, 1, "S1-082")).toBe("Tap − if units are missing or refused. 1 order · 1 unit on S1-082.");
  });

  it("takes the first segment of the access note", () => {
    expect(firstSegment("Rear dock. Van only.")).toBe("Rear dock");
    expect(firstSegment("  ; Side gate · ring bell")).toBe("Side gate");
    expect(firstSegment("")).toBe(null);
    expect(firstSegment(null)).toBe(null);
  });

  it("names one order by its ref and several by count", () => {
    expect(orderRefLabel(["S1-082"])).toBe("S1-082");
    expect(orderRefLabel(["a", "b"])).toBe("2 orders");
    expect(orderRefLabel([])).toBe(null);
  });

  it("builds the header subline from what is real, leaving out the rest", () => {
    expect(stopSubline({ accessNote: "Rear dock. Van only.", orderRefs: ["S1-082"], expectedUnits: 69 })).toBe(
      "Rear dock · S1-082 · 69 units",
    );
    expect(stopSubline({ accessNote: null, orderRefs: ["a", "b"], expectedUnits: 1 })).toBe("1 unit");
    expect(stopSubline({ accessNote: "Rear dock", orderRefs: ["a", "b", "c", "d"], expectedUnits: 69 })).toBe(
      "Rear dock · 69 units",
    );
    expect(stopSubline({ accessNote: "Street", orderRefs: [], expectedUnits: 0 })).toBe("Street");
  });
});
