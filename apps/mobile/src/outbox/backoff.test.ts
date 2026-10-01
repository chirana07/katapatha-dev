import { describe, it, expect } from "vitest";
import {
  MAX_AUTOMATIC_ATTEMPTS,
  backoffMs,
  isExhausted,
  nextAttemptAt,
} from "./backoff";

/** random() = 0.5 maps to a jitter factor of exactly 1, so the schedule is exact. */
const noJitter = () => 0.5;

describe("backoffMs", () => {
  it("doubles from two seconds", () => {
    expect([0, 1, 2, 3, 4].map((n) => backoffMs(n, noJitter))).toEqual([
      2_000, 4_000, 8_000, 16_000, 32_000,
    ]);
  });

  it("caps at five minutes, so a dead endpoint cannot drain the battery", () => {
    expect(backoffMs(8, noJitter)).toBe(300_000);
    expect(backoffMs(40, noJitter)).toBe(300_000);
  });

  it("jitters within ±20%, so handsets do not all retry on the same tick", () => {
    expect(backoffMs(1, () => 0)).toBe(3_200);
    expect(backoffMs(1, () => 1)).toBe(4_800);
  });

  it("treats a negative attempt count as the first attempt", () => {
    expect(backoffMs(-5, noJitter)).toBe(2_000);
  });
});

describe("nextAttemptAt", () => {
  const now = new Date("2026-10-01T04:10:00.000Z");

  it("schedules the next attempt from now", () => {
    expect(nextAttemptAt(0, now, noJitter)).toBe("2026-10-01T04:10:02.000Z");
    expect(nextAttemptAt(2, now, noJitter)).toBe("2026-10-01T04:10:08.000Z");
  });

  it("still returns a date once attempts are exhausted", () => {
    // It must NOT return null. next_attempt_at IS NULL already means "never
    // attempted, send now", so returning null for an exhausted row made it the
    // first thing a drain would pick up. Exhaustion is enforced separately, by
    // the attempts check in claimBatch.
    expect(nextAttemptAt(MAX_AUTOMATIC_ATTEMPTS, now, noJitter)).toBe(
      "2026-10-01T04:15:00.000Z",
    );
  });
});

describe("isExhausted", () => {
  it("flips exactly at the limit", () => {
    expect(isExhausted(MAX_AUTOMATIC_ATTEMPTS - 1)).toBe(false);
    expect(isExhausted(MAX_AUTOMATIC_ATTEMPTS)).toBe(true);
  });
});
