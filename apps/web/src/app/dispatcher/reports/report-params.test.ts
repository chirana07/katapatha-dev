import { describe, expect, it } from "vitest";
import { daysInRange, lastDays, parseRange, reportHref } from "./report-params";

describe("parseRange", () => {
  it("keeps real days and drops the rest", () => {
    expect(parseRange({ from: "2026-04-03", to: "2026-04-09" })).toEqual({ from: "2026-04-03", to: "2026-04-09" });
    expect(parseRange({ from: "2026-02-30", to: "soon" })).toEqual({});
    expect(parseRange({})).toEqual({});
  });

  it("takes the first of a repeated param", () => {
    expect(parseRange({ from: ["2026-04-03", "2026-04-04"] })).toEqual({ from: "2026-04-03" });
  });
});

describe("reportHref", () => {
  it("omits an absent range so the API default applies", () => {
    expect(reportHref("/dispatcher/reports", {})).toBe("/dispatcher/reports");
  });

  it("carries the range and other params", () => {
    expect(reportHref("/dispatcher/reports/outlets", { from: "2026-04-03", to: "2026-04-09" }, { sort: "onTime", brand: undefined })).toBe(
      "/dispatcher/reports/outlets?from=2026-04-03&to=2026-04-09&sort=onTime",
    );
  });
});

describe("ranges", () => {
  it("counts a range inclusively", () => {
    expect(daysInRange("2026-04-03", "2026-04-09")).toBe(7);
    expect(daysInRange("2026-04-09", "2026-04-09")).toBe(1);
    expect(daysInRange("2026-04-09", "2026-04-03")).toBe(0);
  });

  it("builds the last N days ending on a day", () => {
    expect(lastDays("2026-04-09", 7)).toEqual({ from: "2026-04-03", to: "2026-04-09" });
    expect(daysInRange(...(Object.values(lastDays("2026-04-09", 30)) as [string, string]))).toBe(30);
  });
});
