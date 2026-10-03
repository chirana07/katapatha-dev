import { describe, expect, it } from "vitest";
import { writeFailure, readFailure } from "./failures";
import { ageLabel } from "./format";
import { dateParam, isDateOnly, shiftDate } from "./dates";

describe("writeFailure", () => {
  it("says unknown, not failed, when no answer came back", () => {
    expect(writeFailure(0, "confirm receipt").outcome).toBe("unknown");
    expect(writeFailure(503, "confirm receipt").outcome).toBe("unknown");
  });

  it("says failed only when the server refused", () => {
    for (const status of [401, 403, 409, 422]) {
      expect(writeFailure(status, "place the order").outcome).toBe("failed");
    }
  });

  it("treats a read failure as having nothing at stake", () => {
    expect(readFailure(0, "today's orders").outcome).toBe("read");
  });
});

describe("dates", () => {
  it("rejects days the calendar does not have", () => {
    expect(isDateOnly("2026-02-30")).toBe(false);
    expect(isDateOnly("2026-13-01")).toBe(false);
    expect(isDateOnly("2026-04-09")).toBe(true);
  });

  it("falls back for a bad ?date=", () => {
    expect(dateParam("2026-02-30", "2026-04-09")).toBe("2026-04-09");
    expect(dateParam(undefined, "2026-04-09")).toBe("2026-04-09");
    expect(dateParam("2026-05-01", "2026-04-09")).toBe("2026-05-01");
  });

  it("shifts across a month end", () => {
    expect(shiftDate("2026-04-30", 1)).toBe("2026-05-01");
    expect(shiftDate("2026-03-01", -1)).toBe("2026-02-28");
  });
});

describe("ageLabel", () => {
  it("reads in the unit a dispatcher would say it", () => {
    expect(ageLabel(20)).toBe("just now");
    expect(ageLabel(14 * 60)).toBe("14 min ago");
    expect(ageLabel(3 * 3600)).toBe("3 h ago");
    expect(ageLabel(2 * 86400)).toBe("2 d ago");
  });
});
