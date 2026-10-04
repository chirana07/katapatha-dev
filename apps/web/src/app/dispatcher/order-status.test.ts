import { describe, expect, it } from "vitest";
import { ORDER_STATUS, filterOrders, groupCounts, inGroup, isBrand, isOrderGroup, isTemp, sumVolume } from "./order-status";

const order = (over: Partial<Parameters<typeof filterOrders>[0][number]> = {}) => ({
  status: "PLANNED" as const,
  brand: "Fresh" as const,
  tempRequirement: "ambient" as const,
  ref: "S1-0001",
  outletId: "OUT010",
  districtName: "Colombo",
  ...over,
});

describe("order groups", () => {
  it("puts every status somewhere it can be found", () => {
    // A status that no tab can show would be an order the dispatcher can only
    // find by scrolling "All orders".
    for (const status of Object.keys(ORDER_STATUS) as (keyof typeof ORDER_STATUS)[]) {
      const reachable = ["waiting", "allocated", "deferred", "attention", "completed"].some((g) => inGroup(status, g as never));
      if (status !== "CANCELLED" && status !== "DRAFT") expect(reachable).toBe(true);
    }
  });

  it("counts a deferred order under both deferred and attention", () => {
    const counts = groupCounts([{ status: "DEFERRED" }, { status: "PLANNED" }, { status: "QUEUED" }, { status: "PART_DELIVERED" }]);
    expect(counts).toEqual({ waiting: 1, allocated: 1, deferred: 1, attention: 2, completed: 1 });
  });

  it("only accepts group names it knows", () => {
    expect(isOrderGroup("deferred")).toBe(true);
    expect(isOrderGroup("constructor")).toBe(false);
    expect(isOrderGroup(undefined)).toBe(false);
  });
});

describe("filterOrders", () => {
  const rows = [
    order({ ref: "S1-0001", outletId: "OUT010", districtName: "Colombo" }),
    order({ ref: "S1-0002", outletId: "OUT074", districtName: "Puttalam", brand: "Style", tempRequirement: "chilled", status: "DEFERRED" }),
  ];

  it("filters by tab, brand and temperature together", () => {
    expect(filterOrders(rows, { group: "deferred" }).map((r) => r.ref)).toEqual(["S1-0002"]);
    expect(filterOrders(rows, { brand: "Fresh" }).map((r) => r.ref)).toEqual(["S1-0001"]);
    expect(filterOrders(rows, { temp: "chilled", brand: "Fresh" })).toEqual([]);
  });

  it("searches ref, outlet and district without caring about case", () => {
    expect(filterOrders(rows, { q: "out074" })).toHaveLength(1);
    expect(filterOrders(rows, { q: "COLOMBO" })).toHaveLength(1);
    expect(filterOrders(rows, { q: "s1-000" })).toHaveLength(2);
    expect(filterOrders(rows, { q: "   " })).toHaveLength(2);
  });

  it("treats a missing volume as zero rather than NaN", () => {
    expect(sumVolume([{ volumeM3: 1.5 }, {}])).toBe(1.5);
  });

  it("validates the params it takes from the URL", () => {
    expect(isBrand("Fresh")).toBe(true);
    expect(isBrand("fresh")).toBe(false);
    expect(isTemp("chilled")).toBe(true);
    expect(isTemp("frozen")).toBe(true);
    expect(isTemp("tepid")).toBe(false);
  });
});
