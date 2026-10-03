import { describe, expect, it } from "vitest";
import {
  areaPath,
  bands,
  compactNumber,
  labelIndexes,
  linePath,
  niceStep,
  percentDomain,
  runsOf,
  scaleLinear,
  spreadX,
  stackSegments,
  zeroBasedTicks,
} from "./chart-math";

describe("scaleLinear", () => {
  it("maps the domain onto the range, including an inverted y range", () => {
    const y = scaleLinear([0, 100], [200, 0]);
    expect(y(0)).toBe(200);
    expect(y(50)).toBe(100);
    expect(y(100)).toBe(0);
  });

  it("does not divide by zero on a flat domain", () => {
    expect(scaleLinear([5, 5], [10, 20])(5)).toBe(10);
  });
});

describe("niceStep / zeroBasedTicks", () => {
  it("rounds steps to 1, 2, 2.5, 5, 10", () => {
    expect(niceStep(0.7)).toBe(1);
    expect(niceStep(3.1)).toBe(5);
    expect(niceStep(240)).toBe(250);
    expect(niceStep(0)).toBe(1);
  });

  it("starts at zero and covers the maximum", () => {
    const ticks = zeroBasedTicks(3560, 4);
    expect(ticks[0]).toBe(0);
    expect(ticks[ticks.length - 1]).toBeGreaterThanOrEqual(3560);
  });

  it("still gives an axis when everything is zero", () => {
    expect(zeroBasedTicks(0).length).toBeGreaterThan(1);
  });
});

describe("percentDomain", () => {
  it("zooms to the data but keeps the target and the 0–100 bounds", () => {
    const d = percentDomain([91.5, 94.2, 96], 95);
    expect(d.hi).toBe(100);
    expect(d.lo).toBe(90);
    expect(d.ticks).toEqual([90, 95, 100]);
  });

  it("includes a target that is below the data", () => {
    expect(percentDomain([99, 100], 80).lo).toBeLessThanOrEqual(80);
  });

  it("never goes below zero", () => {
    expect(percentDomain([0, 10], 95).lo).toBe(0);
  });

  it("falls back to 0–100 with no data", () => {
    expect(percentDomain([], null)).toMatchObject({ lo: 0, hi: 100 });
  });
});

describe("runsOf / paths", () => {
  const p = (x: number, y: number) => ({ x, y });

  it("breaks the line at a missing point instead of dropping to zero", () => {
    const runs = runsOf([p(0, 5), p(1, 6), null, p(3, 7), p(4, 8)]);
    expect(runs).toHaveLength(2);
    expect(linePath(runs)).toBe("M0 5 L1 6 M3 7 L4 8");
  });

  it("draws a lone point as a dot only (no path)", () => {
    expect(linePath(runsOf([null, p(1, 1), null]))).toBe("");
  });

  it("closes the area down to the baseline", () => {
    expect(areaPath([[p(0, 5), p(10, 3)]], 20)).toBe("M0 20 L0 5 L10 3 L10 20 Z");
  });

  it("is empty for no data", () => {
    expect(runsOf([null, null])).toEqual([]);
  });
});

describe("spreadX / labelIndexes", () => {
  it("spreads points evenly and centres a single one", () => {
    expect(spreadX(3, 0, 100)).toEqual([0, 50, 100]);
    expect(spreadX(1, 0, 100)).toEqual([50]);
    expect(spreadX(0, 0, 100)).toEqual([]);
  });

  it("prints every label when they fit", () => {
    expect(labelIndexes(5, 7)).toEqual([0, 1, 2, 3, 4]);
  });

  it("thins labels but keeps the first and last", () => {
    const picked = labelIndexes(30, 6);
    expect(picked[0]).toBe(0);
    expect(picked[picked.length - 1]).toBe(29);
    expect(picked.length).toBeLessThanOrEqual(7);
  });
});

describe("bands / stackSegments", () => {
  it("centres each bar in an equal band", () => {
    const [first, second] = bands(2, 0, 100, 0.5);
    expect(first).toEqual({ x: 0, width: 50, barX: 12.5, barWidth: 25 });
    expect(second!.x).toBe(50);
  });

  it("stacks from the baseline up, ignoring negatives and gaps", () => {
    const y = scaleLinear([0, 100], [100, 0]);
    const [a, b, c] = stackSegments([20, 30, -5], y);
    expect(a).toEqual({ y: 80, height: 20 });
    expect(b).toEqual({ y: 50, height: 30 });
    expect(c!.height).toBe(0);
  });
});

describe("compactNumber", () => {
  it("groups thousands and trims a trailing .0", () => {
    expect(compactNumber(3560)).toBe("3,560");
    expect(compactNumber(105.5)).toBe("105.5");
    expect(compactNumber(100.04)).toBe("100");
  });
});
