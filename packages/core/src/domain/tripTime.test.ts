import { describe, expect, it } from "vitest";
import { tripDistanceKm, tripFuelLitres, tripMinutes, tripTimeBreakdown } from "./tripTime";
import { ALLOWANCE, DISTRICTS } from "../validation/fixtures";
import type { DockType } from "./types";

const colombo = DISTRICTS.get("Colombo")!;
const gampaha = DISTRICTS.get("Gampaha")!;
const puttalam = DISTRICTS.get("Puttalam")!;

describe("the booklet's own worked example", () => {
  /**
   * Challenge Booklet p.21: "A Fresh trip to Gampaha carries three orders, two
   * with rear docks and one with street access."
   *   depot to Gampaha 37 + travel between three stops 18 + 15 + 15 + 16 = 101
   */
  it("reproduces the Gampaha Fresh trip at 101 minutes", () => {
    const docks: DockType[] = ["rear_dock", "rear_dock", "street"];
    expect(tripMinutes(gampaha, "Fresh", docks, ALLOWANCE)).toBe(101);
  });

  /**
   * Same page: "a second Fresh trip to Colombo with four street-access stops
   * takes 24 + (3 x 8) + (4 x 16) = 112 minutes. Combined with the Gampaha
   * trip, the vehicle uses 101 + 112 = 213 of its 270 Fresh minutes. A third
   * trip is not allowed."
   */
  it("reproduces the Colombo Fresh trip at 112 minutes, and 213 combined", () => {
    const docks: DockType[] = ["street", "street", "street", "street"];
    const colomboTrip = tripMinutes(colombo, "Fresh", docks, ALLOWANCE);
    expect(colomboTrip).toBe(112);

    const gampahaTrip = tripMinutes(gampaha, "Fresh", ["rear_dock", "rear_dock", "street"], ALLOWANCE);
    expect(gampahaTrip + colomboTrip).toBe(213);
    expect(gampahaTrip + colomboTrip).toBeLessThanOrEqual(270);
  });
});

describe("the Puttalam constraint that forces a deferral", () => {
  it("costs 305 minutes for four Fresh orders, over the 270 budget", () => {
    const docks: DockType[] = ["rear_dock", "rear_dock", "rear_dock", "rear_dock"];
    // 173 + 3 x 24 + 4 x 15
    expect(tripMinutes(puttalam, "Fresh", docks, ALLOWANCE)).toBe(305);
  });

  it("fits at 266 minutes for three, consuming almost the whole pre-dawn budget", () => {
    const docks: DockType[] = ["rear_dock", "rear_dock", "rear_dock"];
    // 173 + 2 x 24 + 3 x 15
    expect(tripMinutes(puttalam, "Fresh", docks, ALLOWANCE)).toBe(266);
    expect(270 - 266).toBe(4); // no room for a second Fresh trip of any kind
  });
});

describe("handling is charged per order, not per outlet", () => {
  /**
   * The organisers' checker builds its dock list from order rows, so an outlet
   * taking two orders on one trip pays its allowance twice. Reading this as
   * "per outlet" under-counts every multi-order stop, and Fresh outlets
   * routinely place a dry order and a chilled order for the same day.
   */
  it("charges an outlet twice when it takes two orders", () => {
    const oneOrder = tripMinutes(colombo, "Fresh", ["rear_dock"], ALLOWANCE);
    const twoOrdersSameOutlet = tripMinutes(colombo, "Fresh", ["rear_dock", "rear_dock"], ALLOWANCE);
    expect(oneOrder).toBe(24 + 15);
    // Two orders means one inter-stop leg and two handling charges.
    expect(twoOrdersSameOutlet).toBe(24 + 8 + 15 + 15);
    expect(twoOrdersSameOutlet - oneOrder).toBe(23);
  });
});

describe("brand shapes the cost of a stop", () => {
  it("makes Style and Tech far more expensive per stop than Fresh", () => {
    const fresh = tripMinutes(colombo, "Fresh", ["rear_dock"], ALLOWANCE);
    const style = tripMinutes(colombo, "Style", ["rear_dock"], ALLOWANCE);
    const tech = tripMinutes(colombo, "Tech", ["rear_dock"], ALLOWANCE);
    expect(fresh).toBe(39);
    expect(style).toBe(62);
    expect(tech).toBe(67);
  });

  it("makes a mall bay the slowest dock for every brand", () => {
    for (const brand of ["Fresh", "Style", "Tech"] as const) {
      const rear = tripMinutes(colombo, brand, ["rear_dock"], ALLOWANCE);
      const mall = tripMinutes(colombo, brand, ["mall_bay"], ALLOWANCE);
      expect(mall).toBeGreaterThanOrEqual(rear);
    }
  });
});

describe("edge cases", () => {
  it("is zero for an empty trip", () => {
    expect(tripMinutes(colombo, "Fresh", [], ALLOWANCE)).toBe(0);
  });

  it("charges no inter-stop travel for a single order", () => {
    expect(tripMinutes(puttalam, "Fresh", ["rear_dock"], ALLOWANCE)).toBe(173 + 15);
  });

  it("throws rather than silently skipping an unknown brand and dock pairing", () => {
    const empty = new Map<string, number>();
    expect(() => tripMinutes(colombo, "Fresh", ["rear_dock"], empty)).toThrow(
      /No service allowance/,
    );
  });
});

describe("the breakdown shown in the UI", () => {
  it("splits into outbound, inter-stop and handling, and sums to the total", () => {
    const b = tripTimeBreakdown(gampaha, "Fresh", ["rear_dock", "rear_dock", "street"], ALLOWANCE);
    expect(b).toEqual({
      outboundMin: 37,
      interStopMin: 18,
      handlingMin: 46,
      totalMin: 101,
      stopCount: 3,
    });
    expect(b.outboundMin + b.interStopMin + b.handlingMin).toBe(b.totalMin);
  });
});

describe("fuel, which unlike time does include the return leg", () => {
  it("counts the round trip to the district", () => {
    // Puttalam is 130 km out, so 260 km there and back plus inter-stop hops.
    expect(tripDistanceKm(puttalam, 1)).toBe(260);
    expect(tripDistanceKm(puttalam, 3)).toBe(260 + 2 * 18);
  });

  it("converts distance to litres at the vehicle's efficiency", () => {
    expect(tripFuelLitres(puttalam, 1, 4.7)).toBeCloseTo(260 / 4.7, 6);
  });

  it("is zero for an empty trip", () => {
    expect(tripDistanceKm(puttalam, 0)).toBe(0);
  });
});
