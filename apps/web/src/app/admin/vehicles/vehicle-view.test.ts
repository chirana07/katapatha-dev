import { describe, expect, it } from "vitest";
import {
  capacityLabel,
  depotCounts,
  filterFleet,
  fleetSummary,
  fuelLabel,
  knownDepots,
  parseFilters,
  vehiclesHref,
  type AdminVehicle,
} from "./vehicle-view";

const make = (id: string, o: Partial<AdminVehicle>): AdminVehicle => ({
  id,
  type: "truck",
  temp: "ambient",
  weightCapKg: 4000,
  volumeCapM3: 20,
  fuelType: "diesel",
  kmPerL: 8,
  weeklyFuelQuotaL: 300,
  depotCode: "Peliyagoda",
  trips: 0,
  ...o,
});

const fleet = [
  make("VEH101", { temp: "reefer", volumeCapM3: 18.5 }),
  make("VEH102", { type: "van", volumeCapM3: 8 }),
  make("VEH201", { depotCode: "Kandy", temp: "reefer", volumeCapM3: 16 }),
  make("VEH202", { depotCode: "Kandy", type: "van", volumeCapM3: 7.5 }),
];
const codes = ["Peliyagoda", "Kandy"];
const none = parseFilters({}, codes);

describe("parseFilters", () => {
  it("ignores anything it does not recognise, including an order temperature", () => {
    expect(parseFilters({ depot: "Galle", temp: "chilled", type: "lorry" }, codes)).toEqual({ depot: null, temp: null, type: null });
  });

  it("reads the real values", () => {
    expect(parseFilters({ depot: "Kandy", temp: "reefer", type: ["van", "truck"] }, codes)).toEqual({ depot: "Kandy", temp: "reefer", type: "van" });
  });
});

describe("filterFleet", () => {
  it("narrows by depot, temperature and type together", () => {
    expect(filterFleet(fleet, none)).toHaveLength(4);
    expect(filterFleet(fleet, { ...none, depot: "Kandy" }).map((v) => v.id)).toEqual(["VEH201", "VEH202"]);
    expect(filterFleet(fleet, { ...none, temp: "reefer", type: "truck" }).map((v) => v.id)).toEqual(["VEH101", "VEH201"]);
  });

  it("counts each depot under the other filters, whichever tab is open", () => {
    expect(depotCounts(fleet, { ...none, depot: "Kandy", type: "van" })).toEqual({ all: 2, byDepot: { Peliyagoda: 1, Kandy: 1 } });
    expect(depotCounts(fleet, { ...none, temp: "reefer" }).all).toBe(2);
  });
});

describe("knownDepots", () => {
  it("adds any depot a vehicle names that the directory does not", () => {
    expect(knownDepots([{ code: "Peliyagoda", name: "Peliyagoda DC" }], fleet)).toEqual([
      { code: "Peliyagoda", name: "Peliyagoda DC" },
      { code: "Kandy", name: "Kandy" },
    ]);
    expect(knownDepots(null, []).length).toBe(0);
  });
});

describe("labels", () => {
  it("states capacity and fuel with grouped, trimmed numbers", () => {
    expect(capacityLabel({ weightCapKg: 12000, volumeCapM3: 18.5 })).toBe("12,000 kg · 18.5 m³");
    expect(fuelLabel({ fuelType: "diesel", kmPerL: 7.25, weeklyFuelQuotaL: 1200 })).toBe("diesel · 7.3 km/L · 1,200 L a week");
  });

  it("summarises what is on screen", () => {
    expect(fleetSummary(fleet, 4)).toBe("4 vehicles · 2 refrigerated · total 50 m³");
    expect(fleetSummary(fleet.slice(0, 1), 4)).toBe("1 of 4 vehicles · 1 refrigerated · total 18.5 m³");
  });
});

describe("vehiclesHref", () => {
  it("keeps the filters and adds the dialog", () => {
    expect(vehiclesHref(none)).toBe("/admin/vehicles");
    expect(vehiclesHref({ ...none, depot: "Kandy", temp: "reefer" }, { edit: "VEH201" })).toBe("/admin/vehicles?depot=Kandy&temp=reefer&edit=VEH201");
    expect(vehiclesHref(none, { add: true })).toBe("/admin/vehicles?add=1");
  });
});
