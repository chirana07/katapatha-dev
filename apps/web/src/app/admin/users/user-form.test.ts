import { describe, expect, it } from "vitest";
import { EMPTY_USER_FORM, needsDepot, needsOutlet, normaliseEmail, validateNewUser, validateUserEdit, type UserFormValues } from "./user-form";

const valid: UserFormValues = {
  email: " Nimal@Waypoint.lk ",
  name: " Nimal Perera ",
  role: "DRIVER",
  password: "correct horse",
  depotCode: "Peliyagoda",
  outletId: "",
};

describe("validateNewUser", () => {
  it("builds the request, lower-casing the email and trimming the name", () => {
    expect(validateNewUser(valid)).toEqual({
      ok: true,
      data: { email: "nimal@waypoint.lk", name: "Nimal Perera", role: "DRIVER", password: "correct horse", depotCode: "Peliyagoda", outletId: null },
    });
  });

  it("sends only the binding the role uses, nulling the other", () => {
    const manager = validateNewUser({ ...valid, role: "STORE_MANAGER", outletId: "OUT074" });
    expect(manager.ok && manager.data).toMatchObject({ outletId: "OUT074", depotCode: null });
    const admin = validateNewUser({ ...valid, role: "ADMIN", outletId: "OUT074" });
    expect(admin.ok && admin.data).toMatchObject({ outletId: null, depotCode: null });
  });

  it("reports every field that is wrong at once, so the form can mark them all", () => {
    const result = validateNewUser(EMPTY_USER_FORM);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(Object.keys(result.errors).sort()).toEqual(["depotCode", "email", "name", "password"]);
  });

  it("needs a depot for depot roles and an outlet for a store manager", () => {
    for (const role of ["DISPATCHER", "LOADER", "DRIVER"]) {
      expect(validateNewUser({ ...valid, role, depotCode: "" }).ok).toBe(false);
    }
    const manager = validateNewUser({ ...valid, role: "STORE_MANAGER", outletId: "" });
    expect(!manager.ok && manager.errors.outletId).toBeTruthy();
    expect(validateNewUser({ ...valid, role: "ADMIN", depotCode: "" }).ok).toBe(true);
  });

  it("rejects a bad email, name, role or short password", () => {
    expect(validateNewUser({ ...valid, email: "nimal" }).ok).toBe(false);
    expect(validateNewUser({ ...valid, email: "nimal@waypoint" }).ok).toBe(false);
    expect(validateNewUser({ ...valid, name: "N" }).ok).toBe(false);
    expect(validateNewUser({ ...valid, name: "N".repeat(121) }).ok).toBe(false);
    expect(validateNewUser({ ...valid, role: "OWNER" }).ok).toBe(false);
    expect(validateNewUser({ ...valid, password: "1234567" }).ok).toBe(false);
    expect(validateNewUser({ ...valid, password: "12345678" }).ok).toBe(true);
  });
});

describe("validateUserEdit", () => {
  it("never carries an email, even when the form has one", () => {
    const result = validateUserEdit(valid);
    expect(result.ok && "email" in result.data).toBe(false);
  });

  it("keeps the current password when the field is empty", () => {
    const result = validateUserEdit({ ...valid, password: "" });
    expect(result.ok && "password" in result.data).toBe(false);
  });

  it("checks a new password like a create does", () => {
    expect(validateUserEdit({ ...valid, password: "short" }).ok).toBe(false);
    const result = validateUserEdit({ ...valid, password: "a new one!" });
    expect(result.ok && result.data.password).toBe("a new one!");
  });

  it("re-binds when the role changes", () => {
    const result = validateUserEdit({ ...valid, role: "STORE_MANAGER", outletId: "OUT010" });
    expect(result.ok && result.data).toMatchObject({ role: "STORE_MANAGER", depotCode: null, outletId: "OUT010" });
  });
});

describe("helpers", () => {
  it("knows which roles bind to what", () => {
    expect(needsDepot("LOADER")).toBe(true);
    expect(needsDepot("STORE_MANAGER")).toBe(false);
    expect(needsOutlet("STORE_MANAGER")).toBe(true);
    expect(needsOutlet("ADMIN")).toBe(false);
  });

  it("normalises an email the way sign-in looks it up", () => {
    expect(normaliseEmail("  A@B.LK ")).toBe("a@b.lk");
  });
});
