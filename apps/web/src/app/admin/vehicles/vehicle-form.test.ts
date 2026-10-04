import { describe, expect, it } from "vitest";
import { EMPTY_VEHICLE_FORM, normaliseVehicleId, validateNewVehicle, validateVehicleEdit, type VehicleFormValues } from "./vehicle-form";

const valid: VehicleFormValues = {
  id: " veh120 ",
  type: "truck",
  temp: "reefer",
  weightCapKg: "4000",
  volumeCapM3: "18.5",
  fuelType: " Diesel ",
  kmPerL: "7.5",
  weeklyFuelQuotaL: "300",
  depotCode: "Peliyagoda",
};

describe("validateNewVehicle", () => {
  it("builds the request, upper-casing the id and tidying the fuel", () => {
    expect(validateNewVehicle(valid)).toEqual({
      ok: true,
      data: {
        id: "VEH120",
        type: "truck",
        temp: "reefer",
        weightCapKg: 4000,
        volumeCapM3: 18.5,
        fuelType: "diesel",
        kmPerL: 7.5,
        weeklyFuelQuotaL: 300,
        depotCode: "Peliyagoda",
      },
    });
  });

  it("reports every field that is wrong at once, so the form can mark them all", () => {
    const result = validateNewVehicle(EMPTY_VEHICLE_FORM);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(Object.keys(result.errors).sort()).toEqual(["depotCode", "id", "kmPerL", "volumeCapM3", "weeklyFuelQuotaL", "weightCapKg"]);
  });

  it("rejects an id the API would", () => {
    for (const id of ["V", "-VEH1", "VEH 1", "VEH1!", "A".repeat(33)]) {
      expect(validateNewVehicle({ ...valid, id }).ok).toBe(false);
    }
    expect(validateNewVehicle({ ...valid, id: "kdy-van_02" }).ok).toBe(true);
  });

  it("holds whole-number figures to whole numbers and their ranges", () => {
    for (const weightCapKg of ["0", "-1", "1.5", "40001", "abc"]) {
      expect(validateNewVehicle({ ...valid, weightCapKg }).ok).toBe(false);
    }
    expect(validateNewVehicle({ ...valid, weightCapKg: "40000" }).ok).toBe(true);
    expect(validateNewVehicle({ ...valid, weeklyFuelQuotaL: "0" }).ok).toBe(true);
    expect(validateNewVehicle({ ...valid, weeklyFuelQuotaL: "10001" }).ok).toBe(false);
    expect(validateNewVehicle({ ...valid, weeklyFuelQuotaL: "2.5" }).ok).toBe(false);
  });

  it("needs volume and economy above 0 and within the API's limits", () => {
    expect(validateNewVehicle({ ...valid, volumeCapM3: "0" }).ok).toBe(false);
    expect(validateNewVehicle({ ...valid, volumeCapM3: "120.1" }).ok).toBe(false);
    expect(validateNewVehicle({ ...valid, volumeCapM3: "120" }).ok).toBe(true);
    expect(validateNewVehicle({ ...valid, kmPerL: "50.5" }).ok).toBe(false);
    expect(validateNewVehicle({ ...valid, kmPerL: "0.1" }).ok).toBe(true);
  });

  it("rejects a vehicle temperature that is an order's temperature instead", () => {
    expect(validateNewVehicle({ ...valid, temp: "chilled" }).ok).toBe(false);
    expect(validateNewVehicle({ ...valid, temp: "ambient" }).ok).toBe(true);
    expect(validateNewVehicle({ ...valid, type: "lorry" }).ok).toBe(false);
  });

  it("refuses a depot that is not one offered, when the offer is known", () => {
    expect(validateNewVehicle({ ...valid, depotCode: "Kandy" }, ["Peliyagoda"]).ok).toBe(false);
    expect(validateNewVehicle(valid, ["Peliyagoda"]).ok).toBe(true);
  });

  it("rejects a missing or overlong fuel", () => {
    expect(validateNewVehicle({ ...valid, fuelType: "  " }).ok).toBe(false);
    expect(validateNewVehicle({ ...valid, fuelType: "x".repeat(25) }).ok).toBe(false);
  });
});

describe("validateVehicleEdit", () => {
  it("never carries the id or the depot, even when the form has them", () => {
    const result = validateVehicleEdit(valid);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect("id" in result.data).toBe(false);
    expect("depotCode" in result.data).toBe(false);
  });

  it("does not require them either, since they are read-only", () => {
    expect(validateVehicleEdit({ ...valid, id: "", depotCode: "" }).ok).toBe(true);
  });

  it("validates the same figures as a create", () => {
    expect(validateVehicleEdit({ ...valid, kmPerL: "0" }).ok).toBe(false);
  });
});

describe("normaliseVehicleId", () => {
  it("upper-cases and trims", () => {
    expect(normaliseVehicleId(" veh101 ")).toBe("VEH101");
  });
});
