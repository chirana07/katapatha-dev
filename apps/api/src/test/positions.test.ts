import { describe, expect, it } from "vitest";
import {
  LAMP_AFTER_MINUTES,
  ageSecondsOf,
  clockOf,
  estimatedArrival,
  isLamp,
  lateMinutes,
} from "../services/positions.js";

describe("position age", () => {
  const now = new Date("2026-04-09T01:20:00.000Z");

  it("is measured from when the fix was taken", () => {
    expect(ageSecondsOf(new Date("2026-04-09T01:06:00.000Z"), now)).toBe(14 * 60);
  });

  it("never goes negative when the phone's clock runs ahead", () => {
    expect(ageSecondsOf(new Date("2026-04-09T01:25:00.000Z"), now)).toBe(0);
  });

  it("enters Lamp Mode only after the threshold, not at it", () => {
    expect(isLamp(LAMP_AFTER_MINUTES * 60)).toBe(false);
    expect(isLamp(LAMP_AFTER_MINUTES * 60 + 1)).toBe(true);
  });
});

describe("lateMinutes", () => {
  // 06:12 in Colombo (UTC+05:30) is 00:42Z.
  const stops = [
    { seq: 1, plannedArrivalAt: "06:00", arrivedAt: new Date("2026-04-09T00:30:00.000Z"), status: "DONE" },
    { seq: 2, plannedArrivalAt: "06:30", arrivedAt: new Date("2026-04-09T01:12:00.000Z"), status: "ARRIVED" },
    { seq: 3, plannedArrivalAt: "07:00", arrivedAt: null, status: "PENDING" },
  ];

  it("is the slip at the last stop the driver arrived at", () => {
    expect(lateMinutes(stops)).toBe(12);
  });

  it("is zero before the first arrival: no evidence yet is not lateness", () => {
    expect(lateMinutes(stops.map((s) => ({ ...s, arrivedAt: null })))).toBe(0);
  });

  it("is zero when the driver is ahead of plan", () => {
    expect(lateMinutes([{ seq: 1, plannedArrivalAt: "06:30", arrivedAt: new Date("2026-04-09T00:30:00.000Z"), status: "DONE" }])).toBe(0);
  });
});

describe("clock helpers", () => {
  it("pushes an ETA back by the slip", () => {
    expect(estimatedArrival("07:48", 12)).toBe("08:00");
  });

  it("wraps past midnight rather than printing 24:xx", () => {
    expect(clockOf(24 * 60 + 5)).toBe("00:05");
  });
});
