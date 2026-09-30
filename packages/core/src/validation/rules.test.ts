import { describe, expect, it } from "vitest";
import { hasBlockingErrors, validatePlan } from "./rules";
import { ORGANISER_ENFORCED, RULE_CODES, RULE_LABELS } from "./codes";
import type { RuleCode } from "./codes";
import { order, outlet, snapshot, trip, vehicle } from "./fixtures";
import type { Violation } from "./types";

const codes = (vs: Violation[]) => vs.map((v) => v.code).sort();
const has = (vs: Violation[], c: RuleCode) => vs.some((v) => v.code === c);

describe("bookkeeping", () => {
  it("gives every rule code a human label", () => {
    for (const code of RULE_CODES) {
      expect(RULE_LABELS[code], code).toBeTruthy();
    }
  });

  it("covers every rule the organisers' checker enforces", () => {
    for (const code of ORGANISER_ENFORCED) {
      expect(RULE_CODES).toContain(code);
    }
  });
});

// --- Rule 1: one brand, one district per trip -------------------------------

describe("rule 1 - one brand and one district per trip", () => {
  it("flags a trip that mixes brands", () => {
    const s = snapshot({
      outlets: [outlet("OUT001"), outlet("OUT070", { brand: "Style" })],
      orders: [
        order("A", { outletId: "OUT001", brand: "Fresh" }),
        order("B", { outletId: "OUT070", brand: "Style" }),
      ],
      trips: [
        trip("VEH001", 1, [
          { outletId: "OUT001", orderRefs: ["A"] },
          { outletId: "OUT070", orderRefs: ["B"] },
        ]),
      ],
    });
    expect(has(validatePlan(s), "MIXED_BRAND_IN_TRIP")).toBe(true);
  });

  it("flags a trip that mixes districts", () => {
    const s = snapshot({
      outlets: [outlet("OUT001"), outlet("OUT030", { district: "Gampaha" })],
      orders: [
        order("A", { outletId: "OUT001", district: "Colombo" }),
        order("B", { outletId: "OUT030", district: "Gampaha" }),
      ],
      trips: [
        trip("VEH001", 1, [
          { outletId: "OUT001", orderRefs: ["A"] },
          { outletId: "OUT030", orderRefs: ["B"] },
        ]),
      ],
    });
    expect(has(validatePlan(s), "MIXED_DISTRICT_IN_TRIP")).toBe(true);
  });

  it("accepts one brand in one district", () => {
    const s = snapshot({
      outlets: [outlet("OUT001"), outlet("OUT002")],
      orders: [order("A", { outletId: "OUT001" }), order("B", { outletId: "OUT002" })],
      trips: [
        trip("VEH001", 1, [
          { outletId: "OUT001", orderRefs: ["A"] },
          { outletId: "OUT002", orderRefs: ["B"] },
        ]),
      ],
    });
    expect(codes(validatePlan(s))).toEqual([]);
  });
});

// --- Rule 2: chilled needs a reefer -----------------------------------------

describe("rule 2 - refrigeration", () => {
  it("rejects chilled on an ambient vehicle", () => {
    const s = snapshot({
      vehicles: [vehicle("VEH008", { temp: "ambient" })],
      orders: [order("A", { tempRequirement: "chilled" })],
      trips: [trip("VEH008", 1, [{ outletId: "OUT001", orderRefs: ["A"] }])],
    });
    expect(has(validatePlan(s), "CHILLED_ON_NON_REEFER")).toBe(true);
  });

  it("allows a reefer to carry ambient goods", () => {
    const s = snapshot({
      vehicles: [vehicle("VEH001", { temp: "reefer" })],
      orders: [order("A", { tempRequirement: "ambient" })],
      trips: [trip("VEH001", 1, [{ outletId: "OUT001", orderRefs: ["A"] }])],
    });
    expect(codes(validatePlan(s))).toEqual([]);
  });
});

// --- Rule 3: van-only access ------------------------------------------------

describe("rule 3 - van-only outlets", () => {
  it("rejects a truck sent to a van-only outlet", () => {
    const s = snapshot({
      outlets: [outlet("OUT001", { parkingConstraint: "van_only" })],
      vehicles: [vehicle("VEH001", { type: "truck" })],
      orders: [order("A")],
      trips: [trip("VEH001", 1, [{ outletId: "OUT001", orderRefs: ["A"] }])],
    });
    expect(has(validatePlan(s), "VAN_ONLY_OUTLET_NEEDS_VAN")).toBe(true);
  });

  it("accepts a van at a van-only outlet", () => {
    const s = snapshot({
      outlets: [outlet("OUT001", { parkingConstraint: "van_only" })],
      vehicles: [vehicle("VEH036", { type: "van", weightCapKg: 1040, volumeCapM3: 7 })],
      orders: [order("A")],
      trips: [trip("VEH036", 1, [{ outletId: "OUT001", orderRefs: ["A"] }])],
    });
    expect(codes(validatePlan(s))).toEqual([]);
  });
});

// --- Rule 4: home depot -----------------------------------------------------

describe("rule 4 - home depot", () => {
  it("rejects a Kandy vehicle carrying Peliyagoda orders", () => {
    const s = snapshot({
      vehicles: [vehicle("VEH043", { depot: "Kandy" })],
      orders: [order("A", { depot: "Peliyagoda" })],
      trips: [trip("VEH043", 1, [{ outletId: "OUT001", orderRefs: ["A"] }])],
    });
    expect(has(validatePlan(s), "DEPOT_MISMATCH")).toBe(true);
  });
});

// --- Rule 5: whole orders ---------------------------------------------------

describe("rule 5 - whole orders", () => {
  it("rejects an order split across two trips", () => {
    const s = snapshot({
      vehicles: [vehicle("VEH001"), vehicle("VEH002")],
      orders: [order("A")],
      trips: [
        trip("VEH001", 1, [{ outletId: "OUT001", orderRefs: ["A"] }]),
        trip("VEH002", 1, [{ outletId: "OUT001", orderRefs: ["A"] }]),
      ],
    });
    expect(has(validatePlan(s), "ORDER_SPLIT_ACROSS_TRIPS")).toBe(true);
  });

  it("rejects an order listed twice on one trip", () => {
    const s = snapshot({
      orders: [order("A")],
      trips: [
        trip("VEH001", 1, [
          { outletId: "OUT001", orderRefs: ["A"] },
          { outletId: "OUT001", orderRefs: ["A"] },
        ]),
      ],
    });
    expect(has(validatePlan(s), "DUPLICATE_ASSIGNMENT")).toBe(true);
  });

  it("rejects an order that is both served and deferred", () => {
    const s = snapshot({
      orders: [order("A")],
      trips: [trip("VEH001", 1, [{ outletId: "OUT001", orderRefs: ["A"] }])],
      deferred: [{ orderRef: "A", reasonCode: "REEFER_FULL" }],
    });
    expect(has(validatePlan(s), "DUPLICATE_ASSIGNMENT")).toBe(true);
  });
});

// --- Rule 6: capacity, and the 1e-6 boundary --------------------------------

describe("rule 6 - capacity", () => {
  it("rejects a trip over volume", () => {
    const s = snapshot({
      vehicles: [vehicle("VEH001", { volumeCapM3: 10 })],
      orders: [order("A", { volumeM3: 10.5 })],
      trips: [trip("VEH001", 1, [{ outletId: "OUT001", orderRefs: ["A"] }])],
    });
    const found = validatePlan(s);
    expect(has(found, "VOLUME_CAP_EXCEEDED")).toBe(true);
    expect(found.find((v) => v.code === "VOLUME_CAP_EXCEEDED")?.metric).toMatchObject({
      have: 10.5,
      limit: 10,
      unit: "m3",
    });
  });

  it("rejects a trip over weight", () => {
    const s = snapshot({
      vehicles: [vehicle("VEH001", { weightCapKg: 1040 })],
      orders: [order("A", { weightKg: 1095.7 })],
      trips: [trip("VEH001", 1, [{ outletId: "OUT001", orderRefs: ["A"] }])],
    });
    expect(has(validatePlan(s), "WEIGHT_CAP_EXCEEDED")).toBe(true);
  });

  it("accepts a load exactly at capacity", () => {
    const s = snapshot({
      vehicles: [vehicle("VEH001", { volumeCapM3: 10, weightCapKg: 1000 })],
      orders: [order("A", { volumeM3: 10, weightKg: 1000 })],
      trips: [trip("VEH001", 1, [{ outletId: "OUT001", orderRefs: ["A"] }])],
    });
    expect(codes(validatePlan(s))).toEqual([]);
  });

  it("rejects a load a hair over capacity", () => {
    const s = snapshot({
      vehicles: [vehicle("VEH001", { volumeCapM3: 10 })],
      orders: [order("A", { volumeM3: 10.00001 })],
      trips: [trip("VEH001", 1, [{ outletId: "OUT001", orderRefs: ["A"] }])],
    });
    expect(has(validatePlan(s), "VOLUME_CAP_EXCEEDED")).toBe(true);
  });
});

// --- Rule 7 and the wave budgets -------------------------------------------

describe("rule 7 and the two wave budgets", () => {
  it("rejects a third trip", () => {
    const s = snapshot({
      orders: [order("A"), order("B"), order("C")],
      trips: [
        trip("VEH001", 1, [{ outletId: "OUT001", orderRefs: ["A"] }]),
        trip("VEH001", 2, [{ outletId: "OUT001", orderRefs: ["B"] }]),
        // A third trip can only be expressed with an out-of-range number,
        // which is itself the organisers' `trip_id must be 1 or 2` rule.
        { vehicleId: "VEH001", tripNo: 3 as 1, stops: [{ seq: 0, outletId: "OUT001", orderRefs: ["C"] }] },
      ],
    });
    expect(has(validatePlan(s), "TRIP_ID_RANGE")).toBe(true);
  });

  it("rejects Fresh trips over the 270 minute pre-dawn budget", () => {
    // Puttalam: 173 outbound + 3 x 24 inter-stop + 4 x 15 handling = 305 min.
    const outs = ["OUT090", "OUT091", "OUT092", "OUT093"];
    const s = snapshot({
      outlets: outs.map((id) => outlet(id, { district: "Puttalam" })),
      orders: outs.map((id, i) =>
        order(`P${i}`, { outletId: id, district: "Puttalam", brand: "Fresh" }),
      ),
      trips: [trip("VEH001", 1, outs.map((id, i) => ({ outletId: id, orderRefs: [`P${i}`] })))],
    });
    const found = validatePlan(s);
    expect(has(found, "PREDAWN_BUDGET_EXCEEDED")).toBe(true);
    expect(found.find((v) => v.code === "PREDAWN_BUDGET_EXCEEDED")?.metric?.have).toBe(305);
  });

  it("accepts three Puttalam Fresh orders at 266 minutes", () => {
    const outs = ["OUT090", "OUT091", "OUT092"];
    const s = snapshot({
      outlets: outs.map((id) => outlet(id, { district: "Puttalam" })),
      orders: outs.map((id, i) =>
        order(`P${i}`, { outletId: id, district: "Puttalam", brand: "Fresh" }),
      ),
      trips: [trip("VEH001", 1, outs.map((id, i) => ({ outletId: id, orderRefs: [`P${i}`] })))],
    });
    expect(codes(validatePlan(s))).toEqual([]);
  });

  /**
   * The single most important test in the project: it encodes the brand
   * contention mechanic. Fresh and Style trips are charged against SEPARATE
   * budgets, so one of each passes where three of anything would not.
   */
  it("lets one Fresh trip and one Style trip coexist on separate budgets", () => {
    const s = snapshot({
      outlets: [
        outlet("OUT001", { brand: "Fresh", district: "Colombo" }),
        outlet("OUT070", { brand: "Style", district: "Gampaha", windowOpen: "09:00", windowClose: "17:00" }),
      ],
      orders: [
        order("F", { outletId: "OUT001", brand: "Fresh", district: "Colombo" }),
        order("S", { outletId: "OUT070", brand: "Style", district: "Gampaha" }),
      ],
      trips: [
        trip("VEH001", 1, [{ outletId: "OUT001", orderRefs: ["F"] }]),
        trip("VEH001", 2, [{ outletId: "OUT070", orderRefs: ["S"] }]),
      ],
    });
    expect(codes(validatePlan(s))).toEqual([]);
  });

  it("rejects Style and Tech trips over the 480 minute trading day", () => {
    // Gampaha Style, 9 street orders: 37 + 8 x 9 + 9 x 46 = 523 min.
    const outs = Array.from({ length: 9 }, (_, i) => `OUT${200 + i}`);
    const s = snapshot({
      outlets: outs.map((id) =>
        outlet(id, { brand: "Style", district: "Gampaha", dockType: "street", windowOpen: "09:00", windowClose: "17:00" }),
      ),
      orders: outs.map((id, i) =>
        order(`S${i}`, { outletId: id, brand: "Style", district: "Gampaha" }),
      ),
      trips: [trip("VEH001", 1, outs.map((id, i) => ({ outletId: id, orderRefs: [`S${i}`] })))],
    });
    const found = validatePlan(s);
    expect(has(found, "DAYTIME_BUDGET_EXCEEDED")).toBe(true);
    expect(found.find((v) => v.code === "DAYTIME_BUDGET_EXCEEDED")?.metric?.have).toBe(523);
  });
});

// --- Workshop, fuel and windows --------------------------------------------

describe("vehicle availability", () => {
  it("rejects a vehicle that is in the workshop, but marks it overridable", () => {
    const s = snapshot({
      orders: [order("A")],
      trips: [trip("VEH001", 1, [{ outletId: "OUT001", orderRefs: ["A"] }])],
      status: { VEH001: "IN_WORKSHOP" },
    });
    const found = validatePlan(s);
    const hit = found.find((v) => v.code === "VEHICLE_IN_WORKSHOP");
    expect(hit).toBeDefined();
    expect(hit!.overridable).toBe(true);
  });
});

describe("weekly fuel quota", () => {
  it("rejects a plan that pushes a vehicle past its weekly litres", () => {
    // Puttalam round trip: 2 x 130 km = 260 km at 4.7 km/L = 55.3 L.
    const s = snapshot({
      outlets: [outlet("OUT090", { district: "Puttalam" })],
      orders: [order("A", { outletId: "OUT090", district: "Puttalam" })],
      trips: [trip("VEH001", 1, [{ outletId: "OUT090", orderRefs: ["A"] }])],
      fuel: { VEH001: { quotaL: 340, committedOtherDaysL: 300 } },
    });
    const found = validatePlan(s);
    expect(has(found, "FUEL_QUOTA_EXCEEDED")).toBe(true);
    expect(found.find((v) => v.code === "FUEL_QUOTA_EXCEEDED")?.overridable).toBe(true);
  });

  it("can be downgraded to a warning", () => {
    const s = snapshot({
      outlets: [outlet("OUT090", { district: "Puttalam" })],
      orders: [order("A", { outletId: "OUT090", district: "Puttalam" })],
      trips: [trip("VEH001", 1, [{ outletId: "OUT090", orderRefs: ["A"] }])],
      fuel: { VEH001: { quotaL: 340, committedOtherDaysL: 300 } },
      config: { enforceFuelQuota: "warn" },
    });
    expect(hasBlockingErrors(validatePlan(s))).toBe(false);
  });

  it("stays quiet when there is fuel left", () => {
    const s = snapshot({
      outlets: [outlet("OUT090", { district: "Puttalam" })],
      orders: [order("A", { outletId: "OUT090", district: "Puttalam" })],
      trips: [trip("VEH001", 1, [{ outletId: "OUT090", orderRefs: ["A"] }])],
      fuel: { VEH001: { quotaL: 340, committedOtherDaysL: 100 } },
    });
    expect(codes(validatePlan(s))).toEqual([]);
  });
});

describe("delivery windows", () => {
  it("flags a Fresh outlet reached after its window closes", () => {
    // Depart 07:00, Colombo outbound 24 min -> arrive 07:24, window shuts 07:30.
    // Second stop adds 15 handling + 8 travel -> 07:47, past 07:30.
    const s = snapshot({
      outlets: [outlet("OUT001"), outlet("OUT002")],
      orders: [order("A", { outletId: "OUT001" }), order("B", { outletId: "OUT002" })],
      trips: [
        trip(
          "VEH001",
          1,
          [
            { outletId: "OUT001", orderRefs: ["A"] },
            { outletId: "OUT002", orderRefs: ["B"] },
          ],
          "07:00",
        ),
      ],
    });
    expect(has(validatePlan(s), "WINDOW_CLOSE_MISSED")).toBe(true);
  });

  it("flags a mall outlet reached outside its access window", () => {
    const s = snapshot({
      outlets: [
        outlet("OUT015", {
          brand: "Style",
          dockType: "mall_bay",
          parkingConstraint: "mall_dock",
          mallWindowOpen: "09:00",
          mallWindowClose: "11:00",
          windowOpen: "09:00",
          windowClose: "11:00",
        }),
      ],
      orders: [order("A", { outletId: "OUT015", brand: "Style" })],
      trips: [trip("VEH001", 1, [{ outletId: "OUT015", orderRefs: ["A"] }], "11:00")],
    });
    expect(has(validatePlan(s), "MALL_WINDOW_MISSED")).toBe(true);
  });

  it("only warns for a non-Fresh, non-mall outlet by default", () => {
    const s = snapshot({
      outlets: [
        outlet("OUT120", { brand: "Tech", district: "Colombo", windowOpen: "09:00", windowClose: "17:00" }),
      ],
      orders: [order("A", { outletId: "OUT120", brand: "Tech" })],
      trips: [trip("VEH001", 1, [{ outletId: "OUT120", orderRefs: ["A"] }], "17:00")],
    });
    const found = validatePlan(s);
    expect(has(found, "NON_FRESH_WINDOW_MISSED")).toBe(true);
    expect(hasBlockingErrors(found)).toBe(false);
  });

  it("does not penalise arriving before the window opens", () => {
    // 03:30 departure reaches Colombo at 03:54; the window opens at 05:00 and
    // the vehicle simply waits. That wait is not a violation.
    const s = snapshot({
      orders: [order("A")],
      trips: [trip("VEH001", 1, [{ outletId: "OUT001", orderRefs: ["A"] }], "03:30")],
    });
    expect(codes(validatePlan(s))).toEqual([]);
  });
});

// --- Publish-stage policy ---------------------------------------------------

describe("publish stage", () => {
  it("requires every order to have a decision", () => {
    const s = snapshot({ orders: [order("A"), order("B")] });
    expect(has(validatePlan(s, { stage: "publish" }), "EVERY_ORDER_DECIDED")).toBe(true);
  });

  it("stays quiet about undecided orders on a draft", () => {
    const s = snapshot({ orders: [order("A"), order("B")] });
    expect(has(validatePlan(s), "EVERY_ORDER_DECIDED")).toBe(false);
  });

  it("requires a reason on every deferral", () => {
    const s = snapshot({
      orders: [order("A")],
      deferred: [{ orderRef: "A" }],
    });
    expect(has(validatePlan(s, { stage: "publish" }), "DEFERRED_WITHOUT_REASON")).toBe(true);
  });

  it("warns about an undecided loading shortfall", () => {
    const s = snapshot({
      orders: [order("A")],
      deferred: [{ orderRef: "A", reasonCode: "REEFER_FULL" }],
      openShortfallOrderRefs: ["A"],
    });
    expect(has(validatePlan(s, { stage: "publish" }), "OPEN_SHORTFALL_AT_PUBLISH")).toBe(true);
  });
});

describe("the fairness guard", () => {
  it("warns when an outlet would be skipped two runs running", () => {
    const s = snapshot({
      orders: [order("A", { deferredYesterday: true, outletId: "OUT005" })],
      deferred: [{ orderRef: "A", reasonCode: "REEFER_FULL" }],
    });
    const found = validatePlan(s);
    const hit = found.find((v) => v.code === "HIGH_PRIORITY_DEFERRED");
    expect(hit).toBeDefined();
    expect(hit!.severity).toBe("warning");
    expect(hit!.outletIds).toEqual(["OUT005"]);
  });

  it("says nothing when the outlet was served yesterday", () => {
    const s = snapshot({
      orders: [order("A", { deferredYesterday: false })],
      deferred: [{ orderRef: "A", reasonCode: "REEFER_FULL" }],
    });
    expect(has(validatePlan(s), "HIGH_PRIORITY_DEFERRED")).toBe(false);
  });
});

// --- Unknown references and scoping ----------------------------------------

describe("unknown references", () => {
  it("flags an unknown vehicle", () => {
    const s = snapshot({
      orders: [order("A")],
      trips: [trip("VEH999", 1, [{ outletId: "OUT001", orderRefs: ["A"] }])],
    });
    expect(has(validatePlan(s), "UNKNOWN_VEHICLE")).toBe(true);
  });

  it("flags an unknown outlet", () => {
    const s = snapshot({
      orders: [order("A")],
      trips: [trip("VEH001", 1, [{ outletId: "OUT999", orderRefs: ["A"] }])],
    });
    expect(has(validatePlan(s), "UNKNOWN_OUTLET")).toBe(true);
  });

  it("flags an order that is not in the day's queue", () => {
    const s = snapshot({
      orders: [],
      trips: [trip("VEH001", 1, [{ outletId: "OUT001", orderRefs: ["GHOST"] }])],
    });
    expect(has(validatePlan(s), "UNKNOWN_ORDER")).toBe(true);
  });
});

describe("the `only` filter", () => {
  it("restricts output to the requested rules", () => {
    const s = snapshot({
      vehicles: [vehicle("VEH008", { temp: "ambient", volumeCapM3: 1 })],
      orders: [order("A", { tempRequirement: "chilled", volumeM3: 99 })],
      trips: [trip("VEH008", 1, [{ outletId: "OUT001", orderRefs: ["A"] }])],
    });
    expect(codes(validatePlan(s))).toEqual(["CHILLED_ON_NON_REEFER", "VOLUME_CAP_EXCEEDED"]);
    expect(codes(validatePlan(s, { only: ["VOLUME_CAP_EXCEEDED"] }))).toEqual([
      "VOLUME_CAP_EXCEEDED",
    ]);
  });
});
