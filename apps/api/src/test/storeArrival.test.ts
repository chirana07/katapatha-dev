import { describe, expect, it } from "vitest";
import { estimateArrival } from "../services/store.js";

/**
 * DOMAIN.md: a single arrival time is shown only while a fresh report supports
 * it; once it is uncertain it is a range. This pins when each applies.
 */
describe("estimateArrival", () => {
  const base = { etaAt: "07:21", departed: true, slipMinutes: 0 };

  it("is the plan, labelled as the plan, before the vehicle has left", () => {
    expect(estimateArrival({ ...base, departed: false, reportAgeSeconds: null })).toEqual({
      basis: "plan", at: "07:21", from: null, to: null,
    });
  });

  it("is a single time while a fresh report supports it, pushed back by the slip", () => {
    expect(estimateArrival({ ...base, slipMinutes: 12, reportAgeSeconds: 120 })).toEqual({
      basis: "report", at: "07:33", from: null, to: null,
    });
  });

  it("becomes a range once the last report is past the Lamp threshold", () => {
    const result = estimateArrival({ ...base, slipMinutes: 12, reportAgeSeconds: 22 * 60 });
    expect(result.basis).toBe("estimate");
    expect(result.at).toBeNull();
    // centre 07:33; five minutes early at most, the report's age late (22 min).
    expect(result).toMatchObject({ from: "07:28", to: "07:55" });
  });

  it("is a range, not a time, when nothing has been reported since departure", () => {
    expect(estimateArrival({ ...base, reportAgeSeconds: null })).toMatchObject({
      basis: "estimate", at: null, from: "07:16", to: "07:36",
    });
  });

  it("never narrows below fifteen minutes or widens past forty-five", () => {
    expect(estimateArrival({ ...base, reportAgeSeconds: 11 * 60 })).toMatchObject({ to: "07:36" });
    expect(estimateArrival({ ...base, reportAgeSeconds: 5 * 3600 })).toMatchObject({ to: "08:06" });
  });

  it("says nothing it cannot know when the order has no planned arrival", () => {
    expect(estimateArrival({ etaAt: null, departed: true, slipMinutes: 0, reportAgeSeconds: 60 })).toEqual({
      basis: "plan", at: null, from: null, to: null,
    });
  });
});
