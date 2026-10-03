import { describe, expect, it } from "vitest";
import {
  currentPlan,
  deskStep,
  meterRows,
  minutesLabel,
  publishBlocker,
  publishConsequences,
  publishFacts,
  violationRefs,
} from "./plan-summary";

const plan = {
  stats: { served: 10, deferred: 2 },
  trips: [{ vehicleId: "VEH101" }, { vehicleId: "VEH101" }, { vehicleId: "VEH102" }],
  deferrals: [{ order: { outletId: "OUT010" } }, { order: { outletId: "OUT010" } }, { order: { outletId: "OUT074" } }],
} as never;

describe("publishFacts", () => {
  it("counts distinct vehicles and distinct outlets, not rows", () => {
    // Two trips on one vehicle is one vehicle's run; two deferrals at one
    // outlet is one notice target. The dialog promises exactly these numbers.
    expect(publishFacts(plan)).toEqual({ served: 10, deferred: 2, trips: 3, vehicles: 2, notifiedOutlets: 2 });
  });
});

describe("publishConsequences", () => {
  it("names every role publication reaches, with the real counts", () => {
    const items = publishConsequences(publishFacts(plan));
    expect(items.map((i) => i.who)).toEqual(["Orders", "Loaders", "Drivers", "Store managers", "Decision log"]);
    expect(items[1]!.detail).toContain("3 trips on 2 vehicles");
    expect(items[3]!.detail).toContain("2 outlets");
  });

  it("promises no deferral notices when nothing is deferred", () => {
    const items = publishConsequences({ served: 4, deferred: 0, trips: 2, vehicles: 1, notifiedOutlets: 0 });
    expect(items[0]!.detail).not.toContain("Deferred");
    expect(items[3]!.detail).toContain("No deferral notices");
  });

  it("uses singular nouns for one", () => {
    const items = publishConsequences({ served: 1, deferred: 1, trips: 1, vehicles: 1, notifiedOutlets: 1 });
    expect(items[0]!.detail).toBe("1 served order becomes Planned. 1 deferred order becomes Deferred, each with the reason you recorded.");
    expect(items[1]!.detail).toContain("1 trip on 1 vehicle,");
    expect(items[2]!.detail).toContain("the 1 vehicle");
    expect(items[3]!.detail).toContain("1 outlet with a deferred order gets");
  });
});

describe("publishBlocker", () => {
  const ok = { status: "DRAFT" as const, pendingDeferrals: 0, validationAvailable: true, blockingErrors: 0 };

  it("is null only when nothing stands in the way", () => {
    expect(publishBlocker(ok)).toBeNull();
  });

  it("names what is missing, in the order the dispatcher can fix it", () => {
    expect(publishBlocker({ ...ok, pendingDeferrals: 1 })).toBe("1 deferral still needs a reason.");
    expect(publishBlocker({ ...ok, pendingDeferrals: 3 })).toBe("3 deferrals still need a reason.");
    expect(publishBlocker({ ...ok, validationAvailable: false })).toContain("could not be loaded");
    expect(publishBlocker({ ...ok, blockingErrors: 2 })).toBe("2 blocking issues must be resolved first.");
  });

  it("refuses to offer publishing on a plan that is not a draft", () => {
    expect(publishBlocker({ ...ok, status: "PUBLISHED" })).toContain("already published");
    expect(publishBlocker({ ...ok, status: "SUPERSEDED" })).toContain("newer draft");
  });
});

describe("deskStep and currentPlan", () => {
  it("walks the day through its four steps and finishes past the last", () => {
    expect(["OPEN", "CLOSED", "PLANNING", "PUBLISHED"].map((s) => deskStep(s as never))).toEqual([0, 1, 2, 4]);
  });

  it("shows the published plan on a published day and the draft otherwise, never a replaced one", () => {
    const plans = [{ status: "SUPERSEDED" }, { status: "DRAFT" }, { status: "PUBLISHED" }] as never[];
    expect(currentPlan({ status: "PUBLISHED" }, plans)).toBe(plans[2]);
    expect(currentPlan({ status: "PLANNING" }, plans)).toBe(plans[1]);
    expect(currentPlan({ status: "CLOSED" }, [{ status: "SUPERSEDED" }] as never[])).toBeUndefined();
  });
});

describe("meterRows", () => {
  it("levels each bar with the allocator's thresholds", () => {
    const [row] = meterRows([
      {
        vehicleId: "VEH101",
        tripsUsed: 2,
        predawnUsedMin: 267,
        predawnBudgetMin: 270,
        daytimeUsedMin: 0,
        daytimeBudgetMin: 480,
        fuelCommittedL: 450,
        fuelQuotaL: 420,
      },
    ]);
    expect(row!.predawn.level).toBe("near");
    expect(row!.daytime.level).toBe("ok");
    expect(row!.fuel.level).toBe("over");
    expect(row!.trips).toEqual({ used: 2, max: 2 });
  });

  it("returns nothing for a plan that predates the meters", () => {
    expect(meterRows(undefined)).toEqual([]);
  });
});

describe("violationRefs", () => {
  it("reads the plural fields the API sends and the singular the contract declares", () => {
    expect(violationRefs({ orderRefs: ["A", "B"], outletIds: ["OUT1"] } as never)).toEqual(["A", "B", "OUT1"]);
    expect(violationRefs({ orderRef: "A" } as never)).toEqual(["A"]);
    expect(violationRefs({} as never)).toEqual([]);
  });
});

describe("minutesLabel", () => {
  it("formats durations and survives a missing one", () => {
    expect(minutesLabel(188)).toBe("3h 8m");
    expect(minutesLabel(45)).toBe("45m");
    expect(minutesLabel(undefined)).toBe("—");
  });
});
