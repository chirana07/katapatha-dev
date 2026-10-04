import { describe, expect, it } from "vitest";
import { validatePlan } from "./rules";
import { OVERRIDABLE_CODES, ORGANISER_ENFORCED } from "./codes";
import type { RuleCode } from "./codes";
import { order, outlet, snapshot, trip, vehicle } from "./fixtures";
import { buildTravelMatrix, depotKey, outletKey, type Leg } from "../domain/travel";
import type { Violation } from "./types";

/**
 * The rules that need real arrival times: windows judged on the road, Fresh in
 * before stores open, a vehicle's turnaround between trips, fuel from road
 * distance. All of them are inert without road travel times, so a snapshot
 * without a matrix is judged exactly as it always was.
 */

const has = (vs: Violation[], c: RuleCode) => vs.some((v) => v.code === c);
const codes = (vs: Violation[]) => vs.map((v) => v.code).sort();

/** Every depot<->outlet and outlet<->outlet leg takes the same time and distance. */
const roads = (ids: string[], leg: Leg) =>
  buildTravelMatrix([depotKey("Peliyagoda"), ...ids.map(outletKey)], () => leg, "osrm");

describe("the new codes' standing", () => {
  it("are not the organisers' rules and are hard stops, never overridden", () => {
    for (const code of ["FRESH_AFTER_0800", "TRIPS_OVERLAP", "NO_COMMON_WINDOW"] as const) {
      expect(ORGANISER_ENFORCED.has(code)).toBe(false);
      expect(OVERRIDABLE_CODES.has(code)).toBe(false);
    }
  });
});

describe("NO_COMMON_WINDOW", () => {
  const stuck = outlet("OUT015", {
    brand: "Style",
    dockType: "mall_bay",
    parkingConstraint: "mall_dock",
    windowOpen: "05:30",
    windowClose: "08:00",
    mallWindowOpen: "09:00",
    mallWindowClose: "11:00",
  });
  const plan = (departAt?: string) =>
    snapshot({
      outlets: [stuck],
      orders: [order("A", { outletId: "OUT015", brand: "Style" })],
      trips: [trip("VEH001", 1, [{ outletId: "OUT015", orderRefs: ["A"] }], departAt)],
    });

  it("flags an outlet whose own and mall windows never overlap, whatever the trip", () => {
    const found = validatePlan(plan("09:30")).filter((v) => v.code === "NO_COMMON_WINDOW");
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ severity: "error", overridable: false, outletIds: ["OUT015"], orderRefs: ["A"] });
    expect(found[0]!.message).toMatch(/05:30-08:00.*09:00-11:00.*never overlap/);
  });

  it("is found even with no departure time, because it does not depend on arrivals", () => {
    expect(has(validatePlan(plan()), "NO_COMMON_WINDOW")).toBe(true);
  });

  it("is the only window complaint for that outlet, not a late arrival on top", () => {
    const vs = validatePlan(plan("09:30"));
    expect(has(vs, "MALL_WINDOW_MISSED")).toBe(false);
    expect(has(vs, "NON_FRESH_WINDOW_MISSED")).toBe(false);
  });

  it("does not flag a mall outlet whose windows overlap", () => {
    const ok = outlet("OUT015", { brand: "Style", dockType: "mall_bay", windowOpen: "08:00", windowClose: "12:00", mallWindowOpen: "09:00", mallWindowClose: "11:00" });
    const s = snapshot({
      outlets: [ok],
      orders: [order("A", { outletId: "OUT015", brand: "Style" })],
      trips: [trip("VEH001", 1, [{ outletId: "OUT015", orderRefs: ["A"] }], "08:30")],
    });
    expect(has(validatePlan(s), "NO_COMMON_WINDOW")).toBe(false);
  });
});

describe("windows judged on the road", () => {
  // Colombo's district table says 24 min out; this road says 90.
  const parts = (travel: boolean) => ({
    outlets: [outlet("OUT001", { windowOpen: "05:00", windowClose: "07:30" })],
    orders: [order("A", { outletId: "OUT001" })],
    trips: [trip("VEH001", 1, [{ outletId: "OUT001", orderRefs: ["A"] }], "06:20")],
    ...(travel ? { travel: roads(["OUT001"], { min: 90, km: 12 }) } : {}),
  });

  it("is on time by the district table, which is what the organisers measure", () => {
    expect(has(validatePlan(snapshot(parts(false))), "WINDOW_CLOSE_MISSED")).toBe(false);
  });

  it("is late once the real road is used: 06:20 + 90 min is 07:50", () => {
    const found = validatePlan(snapshot(parts(true))).filter((v) => v.code === "WINDOW_CLOSE_MISSED");
    expect(found).toHaveLength(1);
    expect(found[0]!.message).toMatch(/07:50.*20 min after its window closes at 07:30/);
  });

  it("falls back to the district table for a trip the matrix cannot answer for", () => {
    const s = snapshot({ ...parts(false), travel: roads(["OUT999"], { min: 90, km: 12 }) });
    expect(has(validatePlan(s), "WINDOW_CLOSE_MISSED")).toBe(false);
  });
});

describe("FRESH_AFTER_0800", () => {
  const late = (brand: "Fresh" | "Style", deadline?: string | null) =>
    snapshot({
      outlets: [outlet("OUT001", { brand, windowOpen: "05:00", windowClose: "10:00" })],
      orders: [order("A", { outletId: "OUT001", brand })],
      // Departs 07:30, 45 min on the road: in at 08:15. The outlet's own window runs to 10:00.
      trips: [trip("VEH001", 1, [{ outletId: "OUT001", orderRefs: ["A"] }], "07:30")],
      travel: roads(["OUT001"], { min: 45, km: 12 }),
      ...(deadline === undefined ? {} : { config: { freshDeadline: deadline } }),
    });

  it("flags a Fresh delivery that arrives after stores open even though its own window allows it", () => {
    const found = validatePlan(late("Fresh")).filter((v) => v.code === "FRESH_AFTER_0800");
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ severity: "error", overridable: false, outletIds: ["OUT001"] });
    expect(found[0]!.message).toMatch(/08:15.*15 min after Fresh deliveries must be in.*08:00/);
    expect(has(validatePlan(late("Fresh")), "WINDOW_CLOSE_MISSED")).toBe(false);
  });

  it("leaves a Style delivery alone: the rule is about Fresh", () => {
    expect(has(validatePlan(late("Style")), "FRESH_AFTER_0800")).toBe(false);
  });

  it("can be switched off, or moved", () => {
    expect(has(validatePlan(late("Fresh", null)), "FRESH_AFTER_0800")).toBe(false);
    expect(has(validatePlan(late("Fresh", "08:30")), "FRESH_AFTER_0800")).toBe(false);
  });

  it("is not raised on top of a missed window: the window is the more specific complaint", () => {
    const s = snapshot({
      outlets: [outlet("OUT001", { windowOpen: "05:00", windowClose: "07:30" })],
      orders: [order("A", { outletId: "OUT001" })],
      trips: [trip("VEH001", 1, [{ outletId: "OUT001", orderRefs: ["A"] }], "07:30")],
      travel: roads(["OUT001"], { min: 45, km: 12 }),
    });
    const vs = validatePlan(s);
    expect(has(vs, "WINDOW_CLOSE_MISSED")).toBe(true);
    expect(has(vs, "FRESH_AFTER_0800")).toBe(false);
  });

  it("is not checked without road times, where arrivals are only the district table's estimate", () => {
    const s = late("Fresh");
    delete (s.reference as { travel?: unknown }).travel;
    expect(has(validatePlan(s), "FRESH_AFTER_0800")).toBe(false);
  });
});

describe("TRIPS_OVERLAP", () => {
  // One Fresh trip, one Style trip, 60 min out and 60 back (+ 15 min handling) = home 135 min after leaving.
  const day = (secondDepart: string) =>
    snapshot({
      outlets: [outlet("OUT001", { windowOpen: "05:00", windowClose: "07:30" }), outlet("OUT070", { brand: "Style", windowOpen: "09:00", windowClose: "17:00" })],
      orders: [order("A", { outletId: "OUT001" }), order("B", { outletId: "OUT070", brand: "Style" })],
      trips: [
        trip("VEH001", 1, [{ outletId: "OUT001", orderRefs: ["A"] }], "05:00"),
        trip("VEH001", 2, [{ outletId: "OUT070", orderRefs: ["B"] }], secondDepart),
      ],
      travel: roads(["OUT001", "OUT070"], { min: 60, km: 12 }),
    });

  it("flags a second trip that leaves before the first is back", () => {
    // Trip 1 is home at 05:00 + 60 + 15 + 60 = 07:15. Leaving at 07:00 overlaps it.
    const found = validatePlan(day("07:00")).filter((v) => v.code === "TRIPS_OVERLAP");
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ vehicleId: "VEH001", tripNo: 2, severity: "error", overridable: false });
    expect(found[0]!.message).toMatch(/not back until 07:15/);
    expect(found[0]!.metric).toEqual({ name: "turnaround", have: -15, limit: 30, unit: "min" });
  });

  it("flags one that leaves back at the depot too soon to unload and reload", () => {
    const found = validatePlan(day("07:30")).filter((v) => v.code === "TRIPS_OVERLAP");
    expect(found).toHaveLength(1);
    expect(found[0]!.message).toMatch(/only 15 min after trip 1 is back at 07:15; it needs 30 min/);
  });

  it("accepts a second trip that leaves exactly at return plus the reload time", () => {
    expect(has(validatePlan(day("07:45")), "TRIPS_OVERLAP")).toBe(false);
    expect(has(validatePlan(day("09:00")), "TRIPS_OVERLAP")).toBe(false);
  });

  it("follows the configured reload time", () => {
    expect(has(validatePlan({ ...day("07:30"), config: { ...day("07:30").config, reloadMin: 15 } }), "TRIPS_OVERLAP")).toBe(false);
  });

  it("judges by departure, not by trip number: trip 2 may run first", () => {
    const s = day("09:00");
    const swapped = { ...s, trips: [{ ...s.trips[0]!, tripNo: 2 as const }, { ...s.trips[1]!, tripNo: 1 as const }] };
    expect(has(validatePlan(swapped), "TRIPS_OVERLAP")).toBe(false);
  });

  it("is not checked without road times", () => {
    const s = day("07:00");
    delete (s.reference as { travel?: unknown }).travel;
    expect(has(validatePlan(s), "TRIPS_OVERLAP")).toBe(false);
  });

  it("is not raised for two different vehicles", () => {
    const s = day("07:00");
    const other = { ...s, trips: [s.trips[0]!, { ...s.trips[1]!, vehicleId: "VEH002", tripNo: 1 as const }] };
    other.reference.vehicles = new Map([...other.reference.vehicles, ["VEH002", vehicle("VEH002")]]);
    expect(has(validatePlan(other), "TRIPS_OVERLAP")).toBe(false);
  });
});

describe("fuel from road distance", () => {
  // The district table says 12 km each way (24 km, about 5 L on this truck). The road says 100 km each way.
  const plan = (travel: boolean) =>
    snapshot({
      outlets: [outlet("OUT001", { windowOpen: "05:00", windowClose: "23:00" })],
      orders: [order("A", { outletId: "OUT001" })],
      trips: [trip("VEH001", 1, [{ outletId: "OUT001", orderRefs: ["A"] }])],
      fuel: { VEH001: { quotaL: 30, committedOtherDaysL: 0 } },
      config: { freshDeadline: null },
      ...(travel ? { travel: roads(["OUT001"], { min: 10, km: 100 }) } : {}),
    });

  it("is within quota on the district table", () => {
    expect(has(validatePlan(plan(false)), "FUEL_QUOTA_EXCEEDED")).toBe(false);
  });

  it("is over quota once the real distance, the way home included, is used", () => {
    const found = validatePlan(plan(true)).filter((v) => v.code === "FUEL_QUOTA_EXCEEDED");
    expect(found).toHaveLength(1);
    // 200 km / 4.7 km per litre.
    expect(found[0]!.metric!.have).toBeCloseTo(200 / 4.7, 6);
    expect(found[0]!.metric!.limit).toBe(30);
  });

  it("adds what other days have already committed", () => {
    const s = plan(true);
    s.reference = { ...s.reference, fuel: new Map([["VEH001", { quotaL: 60, committedOtherDaysL: 25 }]]) };
    // 42.55 + 25 = 67.55 > 60
    expect(has(validatePlan(s), "FUEL_QUOTA_EXCEEDED")).toBe(true);
    s.reference = { ...s.reference, fuel: new Map([["VEH001", { quotaL: 70, committedOtherDaysL: 25 }]]) };
    expect(has(validatePlan(s), "FUEL_QUOTA_EXCEEDED")).toBe(false);
  });
});

describe("a plan with no road travel times is judged as it always was", () => {
  it("raises none of the road-only codes on an otherwise rule-breaking snapshot", () => {
    const s = snapshot({
      outlets: [outlet("OUT001", { windowOpen: "05:00", windowClose: "10:00" })],
      orders: [order("A", { outletId: "OUT001" })],
      trips: [
        trip("VEH001", 1, [{ outletId: "OUT001", orderRefs: ["A"] }], "07:50"),
        trip("VEH001", 2, [{ outletId: "OUT001", orderRefs: ["A"] }], "07:55"),
      ],
    });
    const road: RuleCode[] = ["FRESH_AFTER_0800", "TRIPS_OVERLAP"];
    expect(codes(validatePlan(s)).filter((c) => road.includes(c as RuleCode))).toEqual([]);
  });
});
