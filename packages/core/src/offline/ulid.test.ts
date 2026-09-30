import { describe, expect, it } from "vitest";
import { ulid } from "./ulid";

describe("ulid", () => {
  it("is 26 Crockford base32 characters", () => {
    expect(ulid()).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
  });

  it("sorts lexicographically by time", () => {
    const early = ulid(1_700_000_000_000);
    const later = ulid(1_700_000_001_000);
    expect(early < later).toBe(true);
  });

  it("stays ordered within a single millisecond", () => {
    // Several taps in the same tick must still replay in the order they
    // happened, or an arrival can land after the delivery it precedes.
    const t = 1_700_000_000_000;
    const batch = [ulid(t), ulid(t), ulid(t), ulid(t)];
    expect([...batch].sort()).toEqual(batch);
    expect(new Set(batch).size).toBe(4);
  });

  it("does not collide across calls", () => {
    const many = new Set(Array.from({ length: 2000 }, () => ulid()));
    expect(many.size).toBe(2000);
  });
});
