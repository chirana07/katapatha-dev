import { describe, expect, it } from "vitest";
import { historyReason, historyStamp, historyTitle } from "./history";

describe("historyTitle", () => {
  it("names the verbs it knows", () => {
    expect(historyTitle("order.defer")).toEqual({ title: "Deferred", tone: "bad" });
    expect(historyTitle("plan.publish").tone).toBe("good");
  });

  it("shows a verb it does not know instead of dropping it", () => {
    expect(historyTitle("vehicle.recall_from_workshop")).toEqual({ title: "Vehicle recall from workshop" });
  });
});

describe("historyReason", () => {
  it("shows a deferral reason by its label, then the note as written", () => {
    expect(historyReason({ reasonCode: "REEFER_FULL", note: "Phoned the store" })).toBe("Refrigerated capacity full · Phoned the store");
    expect(historyReason({ reasonCode: null, note: "Phoned the store" })).toBe("Phoned the store");
    expect(historyReason({ reasonCode: null, note: null })).toBeUndefined();
  });
});

describe("historyStamp", () => {
  it("reads on the Colombo clock, not the viewer's", () => {
    // 22:08 UTC is 03:38 the next morning in Colombo (UTC+5:30).
    expect(historyStamp("2026-10-03T22:08:00.000Z")).toBe("4 Oct, 03:38");
  });
});
