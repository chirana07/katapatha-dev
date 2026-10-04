import { describe, expect, it } from "vitest";
import { filterUsers, parseFilters, roleCounts, scopeText, usersHref, type AdminUser } from "./user-view";

const make = (id: string, o: Partial<AdminUser>): AdminUser => ({
  id,
  email: `${id}@waypoint.lk`,
  name: id,
  role: "DRIVER",
  depotCode: "Peliyagoda",
  outletId: null,
  staffId: null,
  active: true,
  createdAt: "",
  lastSignInAt: null,
  ...o,
});

const users = [
  make("nimal", { name: "Nimal Perera", role: "DISPATCHER" }),
  make("kamal", { name: "Kamal Silva" }),
  make("saman", { name: "Saman Fernando", active: false }),
  make("dilani", { name: "Dilani Jayawardena", role: "STORE_MANAGER", depotCode: null, outletId: "OUT074" }),
  make("admin", { name: "Ayesha Admin", role: "ADMIN", depotCode: null }),
];
const none = parseFilters({});

describe("parseFilters", () => {
  it("ignores anything it does not recognise", () => {
    expect(parseFilters({ role: "OWNER", status: "x", q: "  nim " })).toEqual({ role: null, status: "all", q: "nim" });
  });

  it("reads the real values", () => {
    expect(parseFilters({ role: "LOADER", status: "disabled" })).toMatchObject({ role: "LOADER", status: "disabled" });
    expect(parseFilters({ role: ["ADMIN", "DRIVER"] }).role).toBe("ADMIN");
  });
});

describe("filterUsers", () => {
  it("keeps disabled accounts unless asked otherwise", () => {
    expect(filterUsers(users, none)).toHaveLength(5);
    expect(filterUsers(users, { ...none, status: "active" })).toHaveLength(4);
    expect(filterUsers(users, { ...none, status: "disabled" }).map((u) => u.id)).toEqual(["saman"]);
  });

  it("searches name or email in any case", () => {
    expect(filterUsers(users, { ...none, q: "PERERA" }).map((u) => u.id)).toEqual(["nimal"]);
    expect(filterUsers(users, { ...none, q: "dilani@" }).map((u) => u.id)).toEqual(["dilani"]);
  });

  it("counts each role under the other filters", () => {
    expect(roleCounts(users, { ...none, role: "ADMIN" })).toEqual({ all: 5, DISPATCHER: 1, LOADER: 0, DRIVER: 2, STORE_MANAGER: 1, ADMIN: 1 });
    expect(roleCounts(users, { ...none, status: "active" })).toMatchObject({ all: 4, DRIVER: 1 });
  });
});

describe("scopeText", () => {
  const outlets = new Map([["OUT074", { displayName: "Fresh Puttalam" }]]);

  it("names a depot, an outlet with its name, or all of Waypoint", () => {
    expect(scopeText(users[0]!, outlets)).toBe("Peliyagoda");
    expect(scopeText(users[3]!, outlets)).toBe("OUT074 · Fresh Puttalam");
    expect(scopeText(users[4]!, outlets)).toBe("All of Waypoint");
  });

  it("shows an outlet it does not know by id, and says when nothing is bound", () => {
    expect(scopeText(make("x", { role: "STORE_MANAGER", depotCode: null, outletId: "OUT999" }), outlets)).toBe("OUT999");
    expect(scopeText(make("y", { depotCode: null }), outlets)).toBe("Not assigned");
  });
});

describe("usersHref", () => {
  it("keeps the filters and adds the dialog", () => {
    expect(usersHref(none)).toBe("/admin/users");
    expect(usersHref({ ...none, role: "DRIVER", q: "kam" }, { edit: "u1" })).toBe("/admin/users?role=DRIVER&q=kam&edit=u1");
    expect(usersHref({ ...none, status: "disabled" }, { disable: "u2" })).toBe("/admin/users?status=disabled&disable=u2");
    expect(usersHref(none, { add: true })).toBe("/admin/users?add=1");
  });
});
