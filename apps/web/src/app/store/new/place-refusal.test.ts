import { describe, expect, it } from "vitest";
import { placeRefusal } from "./place-refusal";

describe("placeRefusal", () => {
  it("says how big an order can be when it is too large", () => {
    const failure = placeRefusal({
      code: "ORDER_TOO_LARGE",
      message: "…",
      details: { tempRequirement: "ambient", units: 5000, maxUnitsPerOrder: 1200 },
    });
    expect(failure?.title).toBe("That order is too large");
    expect(failure?.detail).toContain("1,200");
    expect(failure?.detail).toContain("5,000");
    expect(failure?.outcome).toBe("failed");
  });

  it("says plainly when no vehicle can carry that temperature here", () => {
    const failure = placeRefusal({ code: "ORDER_TOO_LARGE", details: { tempRequirement: "chilled", units: 3, maxUnitsPerOrder: 0 } });
    expect(failure?.title).toBe("Chilled goods can't be delivered here");
  });

  it("falls back to the API's own words when the details are missing", () => {
    expect(placeRefusal({ code: "ORDER_TOO_LARGE", message: "Too big." })?.detail).toBe("Too big.");
  });

  it("names the product that was deactivated, from the API's message", () => {
    const failure = placeRefusal({ code: "PRODUCT_INACTIVE", message: "Fresh Milk is no longer ordered. Take it off the order." });
    expect(failure?.detail).toContain("Fresh Milk");
    expect(failure?.outcome).toBe("failed");
  });

  it("covers the other product refusals", () => {
    expect(placeRefusal({ code: "PRODUCT_NOT_FOUND" })?.title).toMatch(/no longer in the catalogue/);
    expect(placeRefusal({ code: "PRODUCT_NOT_AVAILABLE_FOR_BRAND", message: "Rice is not for Tech outlets." })?.detail).toContain("Tech");
  });

  it("leaves everything else to the generic write failure", () => {
    expect(placeRefusal({ code: "VALIDATION_FAILED" })).toBeNull();
    expect(placeRefusal(undefined)).toBeNull();
  });
});
