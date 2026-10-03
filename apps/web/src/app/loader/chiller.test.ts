import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { chillerByline, chillerHeadline, chillerVerdict, type Reading } from "./chiller";

const reading = (over: Partial<Reading> = {}): Reading => ({
  tempC: 6,
  targetMinC: 2,
  targetMaxC: 5,
  inRange: false,
  source: "LOADER_AT_BAY",
  recordedByName: "Ranjith Silva",
  recordedAt: "2026-04-09T22:30:00.000Z",
  ...over,
});

describe("chiller wording", () => {
  it("says which side of the band a reading is on, from the band stored on the reading", () => {
    assert.deepEqual(chillerVerdict(reading()), { label: "too warm", tone: "bad" });
    assert.deepEqual(chillerVerdict(reading({ tempC: 1, inRange: false })), { label: "too cold", tone: "bad" });
    assert.deepEqual(chillerVerdict(reading({ tempC: 3.8, inRange: true })), { label: "in range", tone: "good" });
    assert.equal(chillerHeadline(reading({ tempC: 3.8, inRange: true })), "3.8 °C in range");
  });

  it("attributes the reading to a person and a place, with its age from when it was taken", () => {
    const now = new Date("2026-04-09T23:31:00.000Z");
    assert.equal(chillerByline(reading(), now), "read by Ranjith Silva at the bay · 1 h ago · target 2–5 °C");
    assert.match(chillerByline(reading({ source: "DRIVER_ON_ARRIVAL", recordedByName: null }), now), /read by the driver on arrival/);
  });
});
