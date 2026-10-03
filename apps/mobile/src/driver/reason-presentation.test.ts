import { describe, expect, it } from "vitest";
import { FALLBACK_PROBLEM_REASONS } from "./reasons";
import { reasonLabel, reasonOptions } from "./reason-presentation";

const labels = (codes: string[]) => reasonOptions(codes).map((option) => option.label);

describe("reasonOptions", () => {
  it("uses the design's wording where a code maps cleanly", () => {
    const byCode = Object.fromEntries(reasonOptions(["OUTLET_CLOSED", "DELIVERY_REFUSED"]).map((o) => [o.code, o.label]));
    expect(byCode.OUTLET_CLOSED).toBe("Store closed · shutter down");
    expect(byCode.DELIVERY_REFUSED).toBe("Store refused the goods");
  });

  it("keeps the server's order and one row per code", () => {
    const codes = ["DELIVERY_REFUSED", "OUTLET_CLOSED", "DELIVERY_REFUSED", "VEHICLE_BREAKDOWN"];
    expect(reasonOptions(codes).map((o) => o.code)).toEqual([
      "DELIVERY_REFUSED",
      "OUTLET_CLOSED",
      "VEHICLE_BREAKDOWN",
    ]);
  });

  it("never offers two rows with the same label for the full vocabulary", () => {
    const all = labels([...FALLBACK_PROBLEM_REASONS]);
    expect(new Set(all).size).toBe(all.length);
    // Both reach reasons exist, so neither takes the design's merged wording.
    expect(all).toContain("Access denied");
    expect(all).toContain("Road blocked");
    expect(all).not.toContain("Can't reach the outlet");
  });

  it("uses the merged wording only when exactly one reach code is present", () => {
    expect(labels(["OUTLET_CLOSED", "ACCESS_DENIED"])).toContain("Can't reach the outlet");
    expect(labels(["ROAD_BLOCKED", "DELIVERY_REFUSED"])).toContain("Can't reach the outlet");
    const both = labels(["ACCESS_DENIED", "ROAD_BLOCKED"]);
    expect(new Set(both).size).toBe(2);
  });

  it("keeps labelFor for a code the design has no wording for", () => {
    expect(labels(["VEHICLE_BREAKDOWN"])).toEqual(["Vehicle breakdown"]);
    expect(labels(["SOMETHING_NEW"])).toEqual(["SOMETHING_NEW"]);
  });

  it("falls back to the local list when the server's is empty", () => {
    expect(reasonOptions([]).map((o) => o.code)).toEqual([...FALLBACK_PROBLEM_REASONS]);
  });

  it("does not invent a reason the vocabulary lacks (no 'No one to receive')", () => {
    expect(labels([...FALLBACK_PROBLEM_REASONS]).join("|")).not.toMatch(/no one to receive/i);
  });
});

describe("reasonLabel", () => {
  it("matches the picker and says so when nothing was recorded", () => {
    expect(reasonLabel("OUTLET_CLOSED")).toBe("Store closed · shutter down");
    expect(reasonLabel("ROAD_BLOCKED")).toBe("Road blocked");
    expect(reasonLabel(null)).toBe("No reason recorded");
  });
});
