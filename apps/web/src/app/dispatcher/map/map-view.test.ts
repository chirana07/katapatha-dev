import { describe, expect, it } from "vitest";
import {
  etaLabel,
  filterCounts,
  filterMapVehicles,
  parseFilter,
  plottable,
  progressLine,
  reportLine,
  STATE_VIEW,
  stateLabel,
  type MapVehicle,
} from "./map-view";

function vehicle(overrides: Partial<MapVehicle> & { vehicleId: string }): MapVehicle {
  return {
    driverName: null,
    state: "ON_TIME",
    lateMinutes: 0,
    trip: { tripId: "t", tripNo: 1, districtName: "Colombo" },
    position: { lat: 6.9, lng: 79.9, accuracyM: 10, recordedAt: "2026-04-09T01:00:00.000Z", ageSeconds: 120, lamp: false },
    nextStop: { outletId: "OUT040", outletName: "Fresh Colombo", stopNumber: 2, totalStops: 4, deliveredStops: 1, eta: "07:21", windowOpen: "05:30", windowClose: "08:00" },
    ...overrides,
  };
}

const FLEET: MapVehicle[] = [
  vehicle({ vehicleId: "VEH101", state: "LATE", lateMinutes: 12, driverName: "Sunil Fernando", trip: { tripId: "a", tripNo: 1, districtName: "Puttalam" } }),
  vehicle({
    vehicleId: "VEH102",
    state: "LAMP",
    position: { lat: 7.2, lng: 79.8, accuracyM: null, recordedAt: "2026-04-09T00:40:00.000Z", ageSeconds: 1320, lamp: true },
  }),
  vehicle({ vehicleId: "VEH103", state: "RETURNING", nextStop: null }),
  vehicle({ vehicleId: "VEH104", state: "NOT_STARTED", position: null }),
];

describe("filters", () => {
  it("late and lamp pick exactly their state", () => {
    expect(filterMapVehicles(FLEET, "late", "").map((v) => v.vehicleId)).toEqual(["VEH101"]);
    expect(filterMapVehicles(FLEET, "lamp", "").map((v) => v.vehicleId)).toEqual(["VEH102"]);
    expect(filterMapVehicles(FLEET, "all", "")).toHaveLength(4);
  });

  it("search matches id, driver, district and outlet", () => {
    expect(filterMapVehicles(FLEET, "all", "puttalam").map((v) => v.vehicleId)).toEqual(["VEH101"]);
    expect(filterMapVehicles(FLEET, "all", "sunil").map((v) => v.vehicleId)).toEqual(["VEH101"]);
    expect(filterMapVehicles(FLEET, "all", "veh103").map((v) => v.vehicleId)).toEqual(["VEH103"]);
    // VEH103 has no next stop, so its outlet cannot match.
    expect(filterMapVehicles(FLEET, "all", "out040").map((v) => v.vehicleId)).toEqual(["VEH101", "VEH102", "VEH104"]);
  });

  it("falls back to all for an unknown filter", () => {
    expect(parseFilter("bogus")).toBe("all");
    expect(parseFilter(["lamp"])).toBe("lamp");
  });

  it("takes chip counts from the summary", () => {
    expect(filterCounts({ all: 3, late: 1, lamp: 1 })).toEqual({ all: 3, late: 1, lamp: 1 });
  });
});

describe("plottable", () => {
  it("leaves out a vehicle that has never reported", () => {
    expect(plottable(FLEET).map((v) => v.vehicleId)).toEqual(["VEH101", "VEH102", "VEH103"]);
  });
});

describe("labels", () => {
  it("states carry text, and Lamp Mode is the only hollow one", () => {
    expect(stateLabel(FLEET[0]!)).toBe("Late 12 min");
    expect(stateLabel(FLEET[1]!)).toBe("Lamp Mode");
    expect(STATE_VIEW.LAMP.fill).toBe("fill-surface");
    for (const key of ["ON_TIME", "LATE", "RETURNING", "NOT_STARTED"] as const) {
      expect(STATE_VIEW[key].fill).not.toBe("fill-surface");
    }
  });

  it("words the report line with its age, and the never-reported cases plainly", () => {
    expect(reportLine(FLEET[0]!)).toBe("Reported 2 min ago");
    expect(reportLine(FLEET[1]!)).toBe("Last reliable update 22 min ago");
    expect(reportLine(vehicle({ vehicleId: "X", state: "ON_TIME", position: null }))).toBe("No position reported yet");
    expect(reportLine(FLEET[3]!)).toBe("At the dock");
  });

  it("always calls the ETA an estimate, and Lamp's a rougher one", () => {
    expect(etaLabel(FLEET[0]!)).toBe("07:21, estimated");
    expect(etaLabel(FLEET[1]!)).toBe("about 07:21, estimated");
    expect(etaLabel(FLEET[2]!)).toBeNull();
  });

  it("describes progress, including a vehicle with nothing left to serve", () => {
    expect(progressLine(FLEET[0]!)).toBe("Stop 2 of 4");
    expect(progressLine(FLEET[2]!)).toBe("All stops done");
    expect(progressLine(vehicle({ vehicleId: "X", state: "NOT_STARTED", nextStop: null }))).toBe("Not yet departed");
  });
});
