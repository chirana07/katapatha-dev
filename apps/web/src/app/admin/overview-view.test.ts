import { describe, expect, it } from "vitest";
import type { components } from "@katapatha/contracts/types";
import { belowTarget, combine, parseRange, pctText } from "./overview-view";

type DepotRow = components["schemas"]["AdminDepotRow"];

const row = (over: Partial<DepotRow>): DepotRow => ({
  depotCode: "Peliyagoda",
  name: "Peliyagoda depot",
  outlets: 1,
  vehicles: 1,
  reefers: 0,
  activeUsers: 1,
  onTimePct: null,
  stops: 0,
  orders: 0,
  delivered: 0,
  deferred: 0,
  utilisationPct: null,
  discrepancies: null,
  ...over,
});

describe("overview view", () => {
  it("passes on only real dates", () => {
    expect(parseRange({ from: "2026-09-01", to: "nope" })).toEqual({ from: "2026-09-01" });
    expect(parseRange({})).toEqual({});
  });

  it("weights on-time by stops rather than averaging depots", () => {
    const all = combine([row({ onTimePct: 100, stops: 3 }), row({ onTimePct: 50, stops: 297 })]);
    expect(all.onTimePct).toBe(50.5);
    expect(all.stops).toBe(300);
  });

  it("leaves a figure unknown when no depot recorded it, rather than calling it zero", () => {
    const all = combine([row({}), row({})]);
    expect(all.onTimePct).toBeNull();
    expect(all.discrepancies).toBeNull();
    expect(combine([row({ discrepancies: 2 }), row({})]).discrepancies).toBe(2);
  });

  it("formats and judges percentages, never judging an unknown", () => {
    expect(pctText(91.24)).toBe("91.2%");
    expect(pctText(80)).toBe("80%");
    expect(pctText(null)).toBe("—");
    expect(belowTarget(null, 95)).toBe(false);
    expect(belowTarget(90, 95)).toBe(true);
  });
});
