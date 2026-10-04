import { describe, expect, it } from "vitest";
import { CHILLED_TARGET, FROZEN_TARGET, bandFor, isInRange } from "./chiller";

describe("the chilled target band", () => {
  it("is 2 to 5 degrees, as the screens print it", () => {
    expect(CHILLED_TARGET).toEqual({ minC: 2, maxC: 5 });
  });

  it("includes both ends", () => {
    expect(isInRange(2, CHILLED_TARGET)).toBe(true);
    expect(isInRange(5, CHILLED_TARGET)).toBe(true);
    expect(isInRange(3.8, CHILLED_TARGET)).toBe(true);
  });

  it("excludes anything outside, however slightly", () => {
    expect(isInRange(1.9, CHILLED_TARGET)).toBe(false);
    expect(isInRange(5.1, CHILLED_TARGET)).toBe(false);
    expect(isInRange(6, CHILLED_TARGET)).toBe(false);
    expect(isInRange(-18, CHILLED_TARGET)).toBe(false);
  });

  it("judges against the band it is given, not the current policy", () => {
    expect(isInRange(7, { minC: 4, maxC: 8 })).toBe(true);
  });
});

describe("the band for a load", () => {
  it("is the chilled band for chilled, the deep-freeze band for frozen, and none for ambient", () => {
    expect(bandFor("chilled")).toBe(CHILLED_TARGET);
    expect(bandFor("frozen")).toBe(FROZEN_TARGET);
    expect(bandFor("ambient")).toBeNull();
  });

  it("judges a frozen reading against minus 25 to minus 15", () => {
    expect(isInRange(-18, FROZEN_TARGET)).toBe(true);
    expect(isInRange(-10, FROZEN_TARGET)).toBe(false);
    expect(isInRange(3, FROZEN_TARGET)).toBe(false);
  });
});
