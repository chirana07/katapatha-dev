import { describe, expect, it } from "vitest";
import { EMPTY_OUTLET_FORM, normaliseOutletId, parseClock, validateNewOutlet, validateOutletEdit, type OutletFormValues } from "./outlet-form";

const valid: OutletFormValues = {
  id: " out200 ",
  displayName: " Fresh Wattala ",
  brand: "Fresh",
  districtName: "Gampaha",
  dockType: "street",
  parkingConstraint: "van_only",
  windowOpen: "05:30",
  windowClose: "09:00",
  mallWindowOpen: "",
  mallWindowClose: "",
  lat: "",
  lng: "",
};

describe("validateNewOutlet", () => {
  it("builds the request, upper-casing the id and leaving out what was not given", () => {
    expect(validateNewOutlet(valid)).toEqual({
      ok: true,
      data: {
        id: "OUT200",
        displayName: "Fresh Wattala",
        brand: "Fresh",
        districtName: "Gampaha",
        dockType: "street",
        parkingConstraint: "van_only",
        windowOpen: "05:30",
        windowClose: "09:00",
      },
    });
  });

  it("omits an empty name, and sends a position and mall window only when whole", () => {
    const result = validateNewOutlet({ ...valid, displayName: " ", lat: "7.08", lng: "79.99", mallWindowOpen: "06:00", mallWindowClose: "10:00" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect("displayName" in result.data).toBe(false);
    expect(result.data).toMatchObject({ lat: 7.08, lng: 79.99, mallWindowOpen: "06:00", mallWindowClose: "10:00" });
  });

  it("reports every field that is wrong at once, so the form can mark them all", () => {
    const result = validateNewOutlet(EMPTY_OUTLET_FORM);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(Object.keys(result.errors).sort()).toEqual(["brand", "districtName", "id", "windowClose", "windowOpen"]);
  });

  it("rejects an id the API would", () => {
    for (const id of ["O", "-OUT1", "OUT 1", "OUT1!", "A".repeat(33)]) {
      expect(validateNewOutlet({ ...valid, id }).ok).toBe(false);
    }
    expect(validateNewOutlet({ ...valid, id: "out-200_b" }).ok).toBe(true);
  });

  it("rejects a brand, dock or parking it does not know", () => {
    expect(validateNewOutlet({ ...valid, brand: "Acme" }).ok).toBe(false);
    expect(validateNewOutlet({ ...valid, dockType: "loading_bay" }).ok).toBe(false);
    expect(validateNewOutlet({ ...valid, parkingConstraint: "trucks" }).ok).toBe(false);
  });

  it("needs both coordinates or neither, inside Sri Lanka", () => {
    const half = validateNewOutlet({ ...valid, lat: "7.0" });
    expect(!half.ok && half.errors.lng).toBeTruthy();
    expect(validateNewOutlet({ ...valid, lat: "5.7", lng: "80" }).ok).toBe(false);
    expect(validateNewOutlet({ ...valid, lat: "7", lng: "82.1" }).ok).toBe(false);
    expect(validateNewOutlet({ ...valid, lat: "north", lng: "80" }).ok).toBe(false);
    expect(validateNewOutlet({ ...valid, lat: "9.9", lng: "79.5" }).ok).toBe(true);
  });
});

describe("receiving windows", () => {
  it("must open before they close", () => {
    const result = validateOutletEdit({ ...valid, windowOpen: "09:00", windowClose: "09:00" });
    expect(!result.ok && result.errors.windowClose).toBe("Receiving must close after it opens.");
    expect(validateOutletEdit({ ...valid, windowOpen: "10:00", windowClose: "08:00" }).ok).toBe(false);
  });

  it("takes a mall window whole or not at all", () => {
    const half = validateOutletEdit({ ...valid, mallWindowOpen: "06:00" });
    expect(!half.ok && half.errors.mallWindowClose).toBe("Give both mall times, or neither.");
    expect(validateOutletEdit({ ...valid, mallWindowOpen: "10:00", mallWindowClose: "06:00" }).ok).toBe(false);
  });

  it("needs a mall window for a mall bay", () => {
    const result = validateOutletEdit({ ...valid, dockType: "mall_bay" });
    expect(!result.ok && result.errors.mallWindowOpen).toBeTruthy();
    expect(validateOutletEdit({ ...valid, dockType: "mall_bay", mallWindowOpen: "06:00", mallWindowClose: "10:00" }).ok).toBe(true);
  });
});

describe("validateOutletEdit", () => {
  it("carries only the editable fields, clearing a removed name and mall window with null", () => {
    const result = validateOutletEdit({ ...valid, displayName: "", lat: "7", lng: "80" });
    expect(result).toEqual({
      ok: true,
      data: { displayName: null, dockType: "street", parkingConstraint: "van_only", windowOpen: "05:30", windowClose: "09:00", mallWindowOpen: null, mallWindowClose: null },
    });
  });

  it("does not require the id, brand or district, since they are read-only", () => {
    expect(validateOutletEdit({ ...valid, id: "", brand: "", districtName: "" }).ok).toBe(true);
  });
});

describe("parseClock", () => {
  it("keeps a 24-hour HH:MM as a string, padding a single-digit hour", () => {
    expect(parseClock("05:00")).toBe("05:00");
    expect(parseClock(" 5:30 ")).toBe("05:30");
    expect(parseClock("23:59")).toBe("23:59");
  });

  it("refuses anything that is not a clock time", () => {
    for (const value of ["", "24:00", "12:60", "5", "5pm", "05:00:00", "0500"]) expect(parseClock(value)).toBeNull();
  });
});

describe("normaliseOutletId", () => {
  it("upper-cases and trims", () => {
    expect(normaliseOutletId(" out074 ")).toBe("OUT074");
  });
});
