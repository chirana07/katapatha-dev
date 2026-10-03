import { describe, expect, it } from "vitest";
import type { components } from "@katapatha/contracts/types";
import {
  capacityLabel,
  chillerSummary,
  filterVehicles,
  initials,
  matchesTab,
  parseTab,
  tabCounts,
} from "./vehicle-view";

type Row = components["schemas"]["VehicleRow"];

function row(overrides: Partial<Row>): Row {
  return {
    vehicleId: "VEH101",
    type: "truck",
    temp: "reefer",
    depotCode: "Peliyagoda",
    volumeCapM3: 30,
    weightCapKg: 5000,
    driverName: null,
    tripsToday: 0,
    utilisationPct: 0,
    status: "AVAILABLE",
    note: null,
    ...overrides,
  };
}

const FLEET: Row[] = [
  row({ vehicleId: "VEH101", status: "ON_ROUTE", driverName: "Sunil Fernando" }),
  row({ vehicleId: "VEH102", status: "LOADING" }),
  row({ vehicleId: "VEH103", status: "RETURNED" }),
  row({ vehicleId: "VEH104", status: "IN_WORKSHOP", note: "Compressor" }),
  row({ vehicleId: "VEH105", status: "AVAILABLE" }),
];

describe("parseTab", () => {
  it("falls back to all for anything unknown", () => {
    expect(parseTab(undefined)).toBe("all");
    expect(parseTab("nope")).toBe("all");
    expect(parseTab(["on-route", "x"])).toBe("on-route");
  });
});

describe("tabs", () => {
  it("available is everything that can run today, matching the KPI", () => {
    const available = FLEET.filter((v) => matchesTab(v, "available"));
    expect(available.map((v) => v.vehicleId)).toEqual(["VEH101", "VEH102", "VEH103", "VEH105"]);
  });

  it("on route and workshop are exact statuses", () => {
    expect(filterVehicles(FLEET, "on-route", "").map((v) => v.vehicleId)).toEqual(["VEH101"]);
    expect(filterVehicles(FLEET, "workshop", "").map((v) => v.vehicleId)).toEqual(["VEH104"]);
  });

  it("counts come from the summary, not the filtered list", () => {
    const counts = tabCounts({
      total: 4, refrigerated: 2, ambient: 2, available: 3, idle: 0, onRoute: 3, loading: 0, returned: 0, inWorkshop: 1,
    });
    expect(counts).toEqual({ all: 4, available: 3, "on-route": 3, workshop: 1 });
  });
});

describe("search", () => {
  it("matches vehicle id or driver, ignoring case and padding", () => {
    expect(filterVehicles(FLEET, "all", " veh103 ").map((v) => v.vehicleId)).toEqual(["VEH103"]);
    expect(filterVehicles(FLEET, "all", "fernando").map((v) => v.vehicleId)).toEqual(["VEH101"]);
  });

  it("combines with the tab", () => {
    expect(filterVehicles(FLEET, "workshop", "veh101")).toEqual([]);
  });
});

describe("labels", () => {
  it("writes capacity in tonnes with one decimal at most", () => {
    expect(capacityLabel({ volumeCapM3: 15, weightCapKg: 4800 })).toBe("15 m³ · 4.8 t");
    expect(capacityLabel({ volumeCapM3: 30, weightCapKg: 5000 })).toBe("30 m³ · 5 t");
  });

  it("makes initials from the first and last word", () => {
    expect(initials("Sunil Fernando")).toBe("SF");
    expect(initials("Priya")).toBe("P");
    expect(initials("  ")).toBe("?");
  });
});

describe("chillerSummary", () => {
  const base = {
    tempC: 6, targetMinC: 2, targetMaxC: 5, inRange: false, source: "LOADER_AT_BAY" as const,
    recordedByName: "Ranjith Silva", recordedAt: "2026-04-09T00:00:00.000Z", ageSeconds: 3660,
  };

  it("says it is a reading, by whom, where and how long ago", () => {
    const summary = chillerSummary(base);
    expect(summary.headline).toBe("6 °C");
    expect(summary.byline).toBe("A reading, by Ranjith Silva at the bay, 1 h ago");
    expect(summary.inRange).toBe(false);
  });

  it("words a driver's arrival reading and a missing name", () => {
    const summary = chillerSummary({ ...base, source: "DRIVER_ON_ARRIVAL", recordedByName: null, ageSeconds: 30 });
    expect(summary.byline).toBe("A reading, by someone on arrival, just now");
  });
});
