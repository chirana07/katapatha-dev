import { describe, expect, it } from "vitest";
import { deferralMessage, nextOperatingDate, shortDay, suggestDeferralReason } from "./deferral";
import { DEFERRAL_REASONS } from "./reasons";

describe("suggestDeferralReason", () => {
  it("maps the reefer shortage to REEFER_FULL", () => {
    expect(suggestDeferralReason("NO_REEFER_AVAILABLE")).toBe("REEFER_FULL");
    expect(suggestDeferralReason("NO_REEFER_IN_FLEET")).toBe("REEFER_FULL");
  });

  it("maps every time-budget cause to TIME_BUDGET", () => {
    for (const code of [
      "PREDAWN_BUDGET_EXCEEDED",
      "DAYTIME_BUDGET_EXCEEDED",
      "NO_TRIP_SLOT",
      "DISTRICT_UNREACHABLE_IN_BUDGET",
    ]) {
      expect(suggestDeferralReason(code)).toBe("TIME_BUDGET");
    }
  });

  it("maps capacity causes to ORDER_TOO_LARGE", () => {
    expect(suggestDeferralReason("ORDER_EXCEEDS_FLEET_CAPACITY")).toBe("ORDER_TOO_LARGE");
    expect(suggestDeferralReason("VOLUME_CAP_EXCEEDED")).toBe("ORDER_TOO_LARGE");
    expect(suggestDeferralReason("WEIGHT_CAP_EXCEEDED")).toBe("ORDER_TOO_LARGE");
  });

  it("suggests nothing when the order simply yielded to a higher priority", () => {
    expect(suggestDeferralReason("YIELDED_TO_HIGHER_PRIORITY")).toBeNull();
    expect(suggestDeferralReason("WRONG_DEPOT")).toBeNull();
  });

  it("suggests the workshop when that is the only reason the right vehicles weren't free", () => {
    expect(suggestDeferralReason("NO_REEFER_AVAILABLE", ["NO_REEFER_AVAILABLE", "VEHICLE_IN_WORKSHOP"])).toBe(
      "VEHICLE_IN_WORKSHOP",
    );
    expect(suggestDeferralReason("NO_VAN_AVAILABLE", ["VEHICLE_IN_WORKSHOP", "NO_VAN_AVAILABLE"])).toBe(
      "VEHICLE_IN_WORKSHOP",
    );
  });

  it("keeps the capacity reason when some suitable vehicle was simply full", () => {
    expect(
      suggestDeferralReason("NO_REEFER_AVAILABLE", ["VEHICLE_IN_WORKSHOP", "VOLUME_CAP_EXCEEDED", "NO_REEFER_AVAILABLE"]),
    ).toBe("REEFER_FULL");
    expect(suggestDeferralReason("NO_TRIP_SLOT", ["VEHICLE_IN_WORKSHOP", "VOLUME_CAP_EXCEEDED", "NO_TRIP_SLOT"])).toBe(
      "TIME_BUDGET",
    );
    expect(suggestDeferralReason("NO_REEFER_AVAILABLE", ["NO_REEFER_AVAILABLE"])).toBe("REEFER_FULL");
  });

  it("suggests nothing for an unknown or missing cause", () => {
    expect(suggestDeferralReason("SOMETHING_NEW")).toBeNull();
    expect(suggestDeferralReason(null)).toBeNull();
    expect(suggestDeferralReason(undefined)).toBeNull();
  });

  it("only ever suggests a code from the fixed deferral list", () => {
    const allowed = new Set(DEFERRAL_REASONS.map((r) => r.code));
    for (const code of [
      "NO_REEFER_AVAILABLE",
      "NO_VAN_AVAILABLE",
      "NO_VAN_IN_FLEET",
      "WINDOW_UNREACHABLE",
      "FUEL_QUOTA_EXCEEDED",
      "VEHICLE_IN_WORKSHOP",
      "VOLUME_CAP_EXCEEDED",
      "NO_TRIP_SLOT",
    ]) {
      const suggested = suggestDeferralReason(code);
      expect(suggested).not.toBeNull();
      expect(allowed.has(suggested!)).toBe(true);
    }
  });
});

describe("nextOperatingDate", () => {
  const calendar = new Map<string, boolean>([
    ["2026-04-10", true],
    ["2026-04-11", true],
    ["2026-04-12", false], // Sunday
    ["2026-04-13", true],
    ["2026-04-14", false], // New Year holiday
    ["2026-04-15", true],
  ]);
  const lookup = (d: string) => calendar.get(d);

  it("is the next day when that day operates", () => {
    expect(nextOperatingDate("2026-04-09", lookup)).toBe("2026-04-10");
  });

  it("skips a non-operating Sunday", () => {
    expect(nextOperatingDate("2026-04-11", lookup)).toBe("2026-04-13");
  });

  it("skips a mid-week holiday", () => {
    expect(nextOperatingDate("2026-04-13", lookup)).toBe("2026-04-15");
  });

  it("falls back to skipping Sundays outside the calendar", () => {
    // 2026-10-03 is a Saturday; nothing in the lookup.
    expect(nextOperatingDate("2026-10-03", () => undefined)).toBe("2026-10-05");
    expect(nextOperatingDate("2026-10-05", () => undefined)).toBe("2026-10-06");
  });
});

describe("deferralMessage — what the store manager reads", () => {
  const order = { ref: "S1-083", windowOpen: "05:30", windowClose: "08:00" };

  it("names the next run, the window and the reason for an ordinary deferral", () => {
    expect(deferralMessage(order, "REEFER_FULL", "2026-09-30")).toBe(
      "Your order S1-083 moves to Wed 30 Sep, 05:30–08:00. Reason: refrigerated capacity full. It will be planned first on that run.",
    );
  });

  it("does not promise a next run when no vehicle could ever carry it", () => {
    const text = deferralMessage(order, "ORDER_TOO_LARGE", "2026-09-30", true);
    expect(text).toContain("could not be delivered today");
    expect(text).not.toContain("moves to");
    expect(text).not.toContain("planned first");
  });

  it("asks for smaller orders only when size is the reason given", () => {
    expect(deferralMessage(order, "ORDER_TOO_LARGE", "2026-09-30", true)).toContain(
      "Please place it again as smaller orders.",
    );
    const cutoff = deferralMessage(order, "AFTER_CUTOFF", "2026-09-30", true);
    expect(cutoff).not.toContain("smaller orders");
    expect(cutoff).not.toContain("splitting");
    expect(cutoff).toContain("Your dispatcher will contact you about what happens next.");
  });

  it("falls back to a readable label for an unknown code", () => {
    expect(deferralMessage(order, "SOMETHING_ELSE", "2026-09-30")).toContain(
      "Reason: something else.",
    );
  });

  it("formats days without depending on the host's locale data", () => {
    expect(shortDay("2026-04-10")).toBe("Fri 10 Apr");
    expect(shortDay("2026-09-30")).toBe("Wed 30 Sep");
  });
});
