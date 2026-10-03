import { describe, expect, it } from "vitest";
import { changeText, countText, deltaMinutesText, outletLabel, pctText, rangeText, weekDatesText, weekLabel } from "./report-format";

describe("figures the API could not back", () => {
  it("writes null as a dash, never as zero", () => {
    expect(pctText(null)).toBe("—");
    expect(countText(null)).toBe("—");
    expect(deltaMinutesText(null)).toBe("—");
  });

  it("still writes a real zero as zero", () => {
    expect(pctText(0)).toBe("0%");
    expect(countText(0)).toBe("0");
    expect(deltaMinutesText(0)).toBe("0 min");
  });
});

describe("pctText", () => {
  it("keeps one decimal only when there is one", () => {
    expect(pctText(94.2)).toBe("94.2%");
    expect(pctText(100)).toBe("100%");
    expect(pctText(66.666)).toBe("66.7%");
  });
});

describe("deltaMinutesText", () => {
  it("signs early and late with a true minus", () => {
    expect(deltaMinutesText(-14)).toBe("−14 min");
    expect(deltaMinutesText(6)).toBe("+6 min");
  });
});

describe("changeText", () => {
  it("colours by meaning, not by sign", () => {
    expect(changeText(1.8, "pts", "up")).toEqual({ text: "▲ 1.8 pts", tone: "good" });
    expect(changeText(4, "", "down")).toEqual({ text: "▲ 4", tone: "bad" });
    expect(changeText(-4, "", "down")).toEqual({ text: "▼ 4", tone: "good" });
  });

  it("is absent when there is no previous period to compare", () => {
    expect(changeText(null, "pts", "up")).toBeNull();
  });
});

describe("dates", () => {
  it("writes ranges compactly", () => {
    expect(rangeText("2026-04-03", "2026-04-09")).toBe("3–9 Apr 2026");
    expect(rangeText("2026-03-28", "2026-04-03")).toBe("28 Mar – 3 Apr 2026");
    expect(rangeText("2025-12-28", "2026-01-03")).toBe("28 Dec 2025 – 3 Jan 2026");
    expect(rangeText("2026-04-09", "2026-04-09")).toBe("9 Apr 2026");
  });

  it("writes a week", () => {
    expect(weekDatesText("2026-10-05", "2026-10-10")).toBe("5–10 Oct");
    expect(weekDatesText("2026-03-30", "2026-04-04")).toBe("30 Mar – 4 Apr");
    expect(weekLabel(5)).toBe("W05");
  });
});

describe("outletLabel", () => {
  it("prefers the name, then the district, then the id alone", () => {
    expect(outletLabel({ outletId: "OUT074", displayName: "Fresh Puttalam", districtName: "Puttalam" })).toBe("OUT074 · Fresh Puttalam");
    expect(outletLabel({ outletId: "OUT074", displayName: null, districtName: "Puttalam" })).toBe("OUT074 · Puttalam");
    expect(outletLabel({ outletId: "OUT074", displayName: null, districtName: null })).toBe("OUT074");
  });
});
