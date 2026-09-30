/**
 * The hero day has to be genuinely hard, or the deferral screens have nothing
 * true to say. These tests assert the four constraints that make it so,
 * straight from the competition CSVs, using the same domain functions the
 * allocator uses.
 *
 * They skip when the real data is absent — the synthetic fixture deliberately
 * has different numbers — so a clean clone still runs a green suite.
 */

import { describe, expect, it } from "vitest";
import { readCsvAll } from "@katapatha/allocator/csv";
import { resolveDataSource } from "./source";
import { tripMinutes } from "@katapatha/core/domain/tripTime";
import { TRIP_BUDGET_PREDAWN } from "@katapatha/core/domain/types";
import type { Brand, DistrictTravel, DockType } from "@katapatha/core/domain/types";
import { allowanceKey } from "@katapatha/core/domain/tripTime";

const source = resolveDataSource();
const hasRealData = source.kind === "real" && source.find("peakDayScenarios") !== null;

const load = async () => {
  const scenario = await readCsvAll(source.require("peakDayScenarios"));
  const fleet = await readCsvAll(source.require("peakDayFleet"));
  const vehicles = await readCsvAll(source.require("vehicles"));
  const outlets = await readCsvAll(source.require("outlets"));
  const travelRows = await readCsvAll(source.require("districtTravel"));
  const allowanceRows = await readCsvAll(source.require("serviceAllowance"));

  const allowance = new Map(
    allowanceRows.map((r) => [
      allowanceKey(r.brand as Brand, r.dock_type as DockType),
      Number(r.service_allowance_min),
    ]),
  );
  const travel = new Map<string, DistrictTravel>(
    travelRows.map((r) => [
      r.district,
      {
        district: r.district,
        depot: r.depot as "Peliyagoda" | "Kandy",
        roadClass: r.road_class as DistrictTravel["roadClass"],
        freeFlowKmh: Number(r.free_flow_kmh),
        depotToDistrictKm: Number(r.depot_to_district_km),
        depotToDistrictFreeflowMin: Number(r.depot_to_district_freeflow_min),
        interStopKm: Number(r.inter_stop_km),
        interStopFreeflowMin: Number(r.inter_stop_freeflow_min),
      },
    ]),
  );
  const dockOf = new Map(outlets.map((r) => [r.outlet_id, r.dock_type as DockType]));

  const available = new Set(
    fleet.filter((r) => r.status === "available").map((r) => r.vehicle_id),
  );
  const vehicleById = new Map(vehicles.map((r) => [r.vehicle_id, r]));

  return { scenario, available, vehicleById, dockOf, travel, allowance };
};

describe.skipIf(!hasRealData)("the hero day is forced to defer", () => {
  it("has all three brands, so contention is visible", async () => {
    const { scenario } = await load();
    const byBrand = new Map<string, number>();
    for (const r of scenario) byBrand.set(r.brand, (byBrand.get(r.brand) ?? 0) + 1);

    expect(scenario).toHaveLength(85);
    expect(byBrand.get("Fresh")).toBe(75);
    expect(byBrand.get("Style")).toBe(5);
    expect(byBrand.get("Tech")).toBe(5);
  });

  /**
   * Constraint 1. Rule 1 allows one district per trip, so chilled demand
   * spread over seven districts needs at least one trip per district, and more
   * where a district's volume exceeds a single reefer. Against eight reefer
   * trip slots, some of it cannot go.
   */
  it("needs more chilled trips than the reefer fleet has trip slots", async () => {
    const { scenario, available, vehicleById } = await load();

    const chilled = scenario.filter((r) => r.temp_requirement === "chilled");
    const reefers = [...available]
      .map((id) => vehicleById.get(id)!)
      .filter((v) => v.temp === "reefer");

    const reeferSlots = reefers.length * 2; // rule 7: two trips a day
    const largestReefer = Math.max(...reefers.map((v) => Number(v.volume_cap_m3)));

    // Volume per district, since a trip cannot mix districts.
    const byDistrict = new Map<string, number>();
    for (const r of chilled) {
      byDistrict.set(
        r.district,
        (byDistrict.get(r.district) ?? 0) + Number(r.order_volume_m3),
      );
    }
    const tripsNeeded = [...byDistrict.values()].reduce(
      (sum, vol) => sum + Math.ceil(vol / largestReefer),
      0,
    );

    expect(reefers).toHaveLength(4);
    expect(reeferSlots).toBe(8);
    expect(byDistrict.size).toBe(7);
    expect(tripsNeeded).toBeGreaterThan(reeferSlots);
  });

  /**
   * Constraint 2. A single order larger than any vehicle in the fleet can
   * never be served, because rule 5 forbids splitting it. This is the clearest
   * possible deferral: not a judgement call, an impossibility.
   */
  it("contains one order no vehicle in the fleet can carry", async () => {
    const { scenario, vehicleById } = await load();
    const fleetMaxVolume = Math.max(
      ...[...vehicleById.values()].map((v) => Number(v.volume_cap_m3)),
    );

    const impossible = scenario.filter(
      (r) => Number(r.order_volume_m3) > fleetMaxVolume,
    );

    expect(fleetMaxVolume).toBe(38);
    expect(impossible).toHaveLength(1);
    expect(impossible[0].order_ref).toBe("S1-078");
    expect(Number(impossible[0].order_volume_m3)).toBeCloseTo(40.66, 2);
  });

  /**
   * Constraint 3. Puttalam is 173 minutes out. Four Fresh orders cost 305
   * minutes against a 270 minute pre-dawn budget; three cost 266 and consume
   * almost all of it, killing the vehicle's second Fresh trip.
   */
  it("cannot fit all four Puttalam Fresh orders in the pre-dawn budget", async () => {
    const { scenario, dockOf, travel, allowance } = await load();
    const puttalam = scenario.filter(
      (r) => r.district === "Puttalam" && r.brand === "Fresh",
    );
    const docks = puttalam.map((r) => dockOf.get(r.outlet_id)!);
    const t = travel.get("Puttalam")!;

    expect(puttalam).toHaveLength(4);
    expect(tripMinutes(t, "Fresh", docks, allowance)).toBe(305);
    expect(tripMinutes(t, "Fresh", docks.slice(0, 3), allowance)).toBe(266);
    expect(305).toBeGreaterThan(TRIP_BUDGET_PREDAWN);
    expect(266).toBeLessThanOrEqual(TRIP_BUDGET_PREDAWN);
  });

  /**
   * Constraint 4. The chilled van-only orders outweigh the one available
   * reefer van, so they need two trips on that single van. An allocator that
   * packs by volume alone gets this wrong, which makes it a good regression.
   */
  it("forces the single reefer van into two trips on weight alone", async () => {
    const { scenario, available, vehicleById } = await load();

    const reeferVans = [...available]
      .map((id) => vehicleById.get(id)!)
      .filter((v) => v.temp === "reefer" && v.type === "van");

    const vanOnlyChilled = scenario.filter(
      (r) => r.parking_constraint === "van_only" && r.temp_requirement === "chilled",
    );
    const totalKg = vanOnlyChilled.reduce((s, r) => s + Number(r.order_weight_kg), 0);
    const vanCapKg = Math.max(...reeferVans.map((v) => Number(v.weight_cap_kg)));
    const totalM3 = vanOnlyChilled.reduce((s, r) => s + Number(r.order_volume_m3), 0);
    const vanCapM3 = Math.max(...reeferVans.map((v) => Number(v.volume_cap_m3)));

    expect(reeferVans).toHaveLength(1);
    expect(vanOnlyChilled).toHaveLength(3);
    expect(totalKg).toBeCloseTo(1095.7, 1);
    expect(vanCapKg).toBe(1040);
    // Weight is the binding constraint here, not volume — the trap.
    expect(totalKg).toBeGreaterThan(vanCapKg);
    expect(totalM3).toBeLessThanOrEqual(vanCapM3);
  });

  it("carries the fairness signals the prioritisation policy depends on", async () => {
    const { scenario } = await load();
    const deferredYesterday = scenario.filter((r) => r.deferred_yesterday === "1");
    const maxDays = Math.max(
      ...scenario.map((r) => Number(r.days_since_last_served)),
    );

    expect(deferredYesterday.length).toBe(10);
    expect(maxDays).toBe(5);
  });
});
