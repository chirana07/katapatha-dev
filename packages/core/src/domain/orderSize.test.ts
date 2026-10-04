import { describe, expect, it } from "vitest";
import { compatibleVehicles, maxUnitsPerOrder, splitUnits, type FleetVehicle } from "./orderSize";

// The Peliyagoda fleet in the seed.
const FLEET: FleetVehicle[] = [
  { type: "truck", temp: "reefer", volumeCapM3: 30, weightCapKg: 5000 }, // VEH101
  { type: "truck", temp: "ambient", volumeCapM3: 34, weightCapKg: 6000 }, // VEH102
  { type: "van", temp: "reefer", volumeCapM3: 10, weightCapKg: 1200 }, // VEH103
  { type: "van", temp: "ambient", volumeCapM3: 12, weightCapKg: 1400 }, // VEH104
];

describe("compatibleVehicles", () => {
  it("only lets reefers carry chilled goods", () => {
    expect(compatibleVehicles(FLEET, { tempRequirement: "chilled", vanOnly: false })).toHaveLength(2);
  });
  it("only lets vans reach a van-only outlet", () => {
    expect(compatibleVehicles(FLEET, { tempRequirement: "ambient", vanOnly: true })).toHaveLength(2);
    expect(compatibleVehicles(FLEET, { tempRequirement: "chilled", vanOnly: true })).toHaveLength(1);
  });
});

describe("compatibleVehicles, frozen", () => {
  it("treats frozen like chilled: reefers only", () => {
    expect(compatibleVehicles(FLEET, { tempRequirement: "frozen", vanOnly: false })).toEqual(
      compatibleVehicles(FLEET, { tempRequirement: "chilled", vanOnly: false }),
    );
    expect(compatibleVehicles(FLEET, { tempRequirement: "frozen", vanOnly: true })).toHaveLength(1);
  });
});

describe("maxUnitsPerOrder", () => {
  // DEMO-012: 400 units, 45 m³ → 0.1125 m³ per unit.
  const demo012 = { m3PerUnit: 0.1125, kgPerUnit: 8 };

  it("finds the limit on the roomiest compatible vehicle", () => {
    // VEH102: 34 m³ / 0.1125 = 302.2 → 302 units (weight allows 750).
    expect(maxUnitsPerOrder(FLEET, { tempRequirement: "ambient", vanOnly: false }, demo012)).toBe(302);
  });

  it("uses only reefers for chilled goods", () => {
    // VEH101: 30 / 0.1125 = 266.7 → 266.
    expect(maxUnitsPerOrder(FLEET, { tempRequirement: "chilled", vanOnly: false }, demo012)).toBe(266);
  });

  it("lets weight bind when it is tighter than volume", () => {
    // Heavy goods: VEH102 6000 kg / 50 kg = 120 units, volume would allow 3400.
    expect(maxUnitsPerOrder(FLEET, { tempRequirement: "ambient", vanOnly: false }, { m3PerUnit: 0.01, kgPerUnit: 50 })).toBe(120);
  });

  it("is zero when nothing may carry it", () => {
    expect(maxUnitsPerOrder([], { tempRequirement: "ambient", vanOnly: false }, demo012)).toBe(0);
    expect(
      maxUnitsPerOrder([FLEET[1]!], { tempRequirement: "chilled", vanOnly: false }, demo012),
    ).toBe(0);
  });

  it("does not round an exact fit out", () => {
    expect(maxUnitsPerOrder([FLEET[1]!], { tempRequirement: "ambient", vanOnly: false }, { m3PerUnit: 0.34, kgPerUnit: 1 })).toBe(100);
  });
});

describe("splitUnits", () => {
  it("leaves an order that fits alone", () => {
    expect(splitUnits(250, 302)).toEqual([250]);
  });
  it("splits DEMO-012 evenly into two", () => {
    expect(splitUnits(400, 302)).toEqual([200, 200]);
  });
  it("spreads a remainder over the first parts", () => {
    expect(splitUnits(701, 302)).toEqual([234, 234, 233]);
  });
  it("returns nothing for zero units or no capacity", () => {
    expect(splitUnits(0, 302)).toEqual([]);
    expect(splitUnits(400, 0)).toEqual([]);
  });
});
