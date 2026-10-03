import { describe, expect, it } from "vitest";
import { planOrder, splitSummary } from "./order-plan";

const limits = {
  ambient: { m3PerUnit: 0.1, kgPerUnit: 10, maxUnitsPerOrder: 300 },
  chilled: { m3PerUnit: 0.09, kgPerUnit: 8, maxUnitsPerOrder: 0 },
};

describe("planOrder", () => {
  it("keeps only the lines with units and estimates size from the limits", () => {
    const plan = planOrder({ ambient: 50, chilled: 0 }, limits);
    expect(plan.lines).toHaveLength(1);
    expect(plan.totalUnits).toBe(50);
    expect(plan.volumeM3).toBeCloseTo(5);
    expect(plan.weightKg).toBe(500);
    expect(plan.blocked).toBe(false);
  });

  it("splits an order bigger than the largest vehicle, the way the action will", () => {
    const [line] = planOrder({ ambient: 700, chilled: 0 }, limits).lines;
    expect(line!.parts.reduce((a, b) => a + b, 0)).toBe(700);
    expect(Math.max(...line!.parts)).toBeLessThanOrEqual(300);
    expect(splitSummary(line!)).toMatch(/^3 orders of /);
  });

  it("flags goods no vehicle can carry to this outlet", () => {
    expect(planOrder({ ambient: 0, chilled: 5 }, limits).blocked).toBe(true);
  });

  it("says unknown, not zero, without limits", () => {
    const plan = planOrder({ ambient: 5, chilled: 0 }, null);
    expect(plan.volumeM3).toBeNull();
    expect(plan.weightKg).toBeNull();
    expect(plan.lines[0]!.parts).toEqual([5]);
    expect(splitSummary(plan.lines[0]!)).toBeNull();
  });
});
