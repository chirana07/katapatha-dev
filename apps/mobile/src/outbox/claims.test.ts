import { describe, it, expect } from "vitest";
import { OFFLINE_DURABILITY_VERIFIED, outboxExplainer, unsentCopy } from "./claims";

/**
 * Guards on the wording itself, because docs/PRODUCT.md and docs/DESIGN.md make
 * these sentences binding rather than editorial.
 */

describe("the durability claim", () => {
  it("is only true while the acceptance test is passing", () => {
    // This assertion is a tripwire, not a tautology: if someone deletes or skips
    // drain.acceptance.test.ts, the claim it licenses should be reconsidered
    // here. The test file and this constant are meant to move together.
    expect(OFFLINE_DURABILITY_VERIFIED).toBe(true);
  });
});

describe("what the copy must never say", () => {
  const everything = [
    unsentCopy(1),
    unsentCopy(3),
    outboxExplainer(),
  ].join(" ").toLowerCase();

  it("never implies background sync", () => {
    // Every drain is foreground-only; no background task is registered and
    // expo-background-task is deliberately not a dependency.
    for (const forbidden of ["background", "automatic", "automatically"]) {
      expect(everything).not.toContain(forbidden);
    }
  });

  it("never implies a vehicle's position is known", () => {
    // There is no GPS in this product.
    for (const forbidden of ["location", "gps", "position", "tracking"]) {
      expect(everything).not.toContain(forbidden);
    }
  });

  it("never promises the server will deduplicate", () => {
    // Server-side idempotency is not implemented yet (delivery.ts mints its own
    // id), so the copy must not lean on it.
    for (const forbidden of ["duplicate", "safely", "guaranteed"]) {
      expect(everything).not.toContain(forbidden);
    }
  });
});

describe("unsentCopy", () => {
  it("agrees with itself about one record versus several", () => {
    expect(unsentCopy(1)).toMatch(/\b1 record\b(?! s)/);
    expect(unsentCopy(3)).toContain("3 records");
  });

  it("says where the records are and when they go", () => {
    const copy = unsentCopy(2);
    expect(copy).toMatch(/on this phone/i);
    expect(copy).toMatch(/signal/i);
  });
});
