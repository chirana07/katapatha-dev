import { describe, expect, it } from "vitest";
import {
  applyCaption,
  capacityFailure,
  chilledCategories,
  demandCategories,
  levelTone,
  parseWeekParam,
  reeferTripsText,
  reliefText,
  weekParam,
  type CapacityWeek,
} from "./capacity-model";

function week(partial: Partial<CapacityWeek>): CapacityWeek {
  return {
    isoYear: 2026,
    isoWeek: 16,
    startDate: "2026-04-13",
    endDate: "2026-04-18",
    kind: "forecast",
    signals: [],
    operatingDays: 6,
    totalM3: 300,
    chilledM3: 110,
    ambientM3: 190,
    reeferTripsPerDay: { needed: 5, capacity: 4, shortfall: 1 },
    reefersInWorkshop: 0,
    chilledCapacityM3: 100,
    fleetCapacityM3: 340,
    level: "over",
    action: "+1 hired reefer",
    actions: [],
    ...partial,
  };
}

describe("week param", () => {
  it("round-trips", () => {
    expect(parseWeekParam(weekParam({ isoYear: 2026, isoWeek: 16 }))).toEqual({ isoYear: 2026, isoWeek: 16 });
  });

  it("rejects what the API would", () => {
    expect(parseWeekParam("2026-54")).toBeNull();
    expect(parseWeekParam("2026-0")).toBeNull();
    expect(parseWeekParam("soon")).toBeNull();
    expect(parseWeekParam(undefined)).toBeNull();
  });
});

describe("week rows", () => {
  it("tones the level", () => {
    expect([levelTone("ok"), levelTone("near"), levelTone("over")]).toEqual(["good", "warn", "bad"]);
  });

  it("writes trips needed of trips available", () => {
    expect(reeferTripsText(week({}))).toBe("5 of 4");
  });
});

describe("chart categories", () => {
  it("stacks chilled under ambient and flags an over week in words, not only colour", () => {
    const [over, ok] = demandCategories([week({}), week({ isoWeek: 17, level: "ok", kind: "actual" })]);
    expect(over).toMatchObject({ label: "W16", sublabel: "over", values: [110, 190], alert: true, forecast: true });
    expect(ok).toMatchObject({ sublabel: undefined, alert: false, forecast: false });
  });

  it("flags a week by the API's reefer shortfall, as the table does", () => {
    const [a, b] = chilledCategories([
      week({ chilledM3: 100, chilledCapacityM3: 100 }),
      week({ chilledM3: 130, chilledCapacityM3: 100, reeferTripsPerDay: { needed: 4, capacity: 4, shortfall: 0 } }),
    ]);
    expect(a!.alert).toBe(true);
    expect(a!.sublabel).toBe("over");
    expect(b!.alert).toBe(false);
  });

  it("gives every bar a text alternative with its figures", () => {
    expect(demandCategories([week({})])[0]!.alt).toContain("chilled 110");
  });
});

describe("reliefText", () => {
  it("states relief with its basis and says when it is an estimate", () => {
    expect(reliefText({ expectedRelief: { tripsPerDay: 1, basis: "Assumes 15% moves a day earlier", estimate: true } })).toBe(
      "Frees about 1 reefer trip a day (an estimate) · Assumes 15% moves a day earlier",
    );
  });

  it("handles fuel and missing relief", () => {
    expect(reliefText({ expectedRelief: { litres: 1200 } })).toBe("Frees about 1,200 L of fuel quota");
    expect(reliefText({ expectedRelief: {} })).toBeNull();
  });
});

describe("applyCaption", () => {
  it("promises effect only for the two kinds that have one", () => {
    expect(applyCaption("RECALL_FROM_WORKSHOP")).toContain("workshop days");
    expect(applyCaption("RAISE_FUEL_QUOTA")).toContain("fuel quota");
    expect(applyCaption("HIRE_RELIEF_VEHICLE")).toContain("records the decision only");
    expect(applyCaption("PRE_BUILD_ORDERS")).toContain("records the decision only");
  });
});

describe("capacityFailure", () => {
  it("tells the dispatcher to approve first", () => {
    expect(capacityFailure(409, "ACTION_NOT_APPROVED", null).title).toBe("Approve it first");
  });

  it("uses the API's words for another 409 and asks the page to refresh", () => {
    const failure = capacityFailure(409, "ACTION_CLOSED", "It was rejected.");
    expect(failure.detail).toContain("It was rejected.");
    expect(failure.refresh).toBe(true);
  });

  it("does not claim failure when there was no answer", () => {
    expect(capacityFailure(0, null, null).outcome).toBe("unknown");
    expect(capacityFailure(500, null, null).outcome).toBe("unknown");
  });
});
