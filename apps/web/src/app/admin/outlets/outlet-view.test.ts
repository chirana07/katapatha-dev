import { describe, expect, it } from "vitest";
import {
  depotCounts,
  dockLabel,
  filterOutlets,
  mallWindowLabel,
  outletName,
  outletsHref,
  parkingLabel,
  parseFilters,
  positionLabel,
  windowLabel,
  type Outlet,
} from "./outlet-view";

const make = (id: string, o: Partial<Outlet>): Outlet => ({
  id,
  displayName: null,
  brand: "Fresh",
  districtName: "Colombo",
  depotCode: "Peliyagoda",
  dockType: "rear_dock",
  parkingConstraint: "normal",
  windowOpen: "05:00",
  windowClose: "08:30",
  mallWindowOpen: null,
  mallWindowClose: null,
  lat: 6.93,
  lng: 79.86,
  geoSource: "CSV",
  managers: 0,
  ...o,
});

const depots = ["Kandy", "Peliyagoda"];
const outlets = [
  make("OUT010", { displayName: "Fresh Kollupitiya" }),
  make("OUT011", { brand: "Style", districtName: "Gampaha" }),
  make("OUT050", { districtName: "Kandy", depotCode: "Kandy" }),
  make("OUT051", { brand: "Tech", districtName: "Matale", depotCode: "Kandy" }),
];
const none = parseFilters({}, depots);

describe("parseFilters", () => {
  it("ignores anything it does not recognise, including a depot not in the directory", () => {
    expect(parseFilters({ depot: "Galle", brand: "Acme", q: "  kandy " }, depots)).toEqual({ depot: null, brand: "any", q: "kandy" });
  });

  it("reads the real values", () => {
    expect(parseFilters({ depot: "Kandy", brand: ["Tech", "Fresh"] }, depots)).toEqual({ depot: "Kandy", brand: "Tech", q: "" });
  });
});

describe("filterOutlets", () => {
  it("narrows by depot and brand", () => {
    expect(filterOutlets(outlets, { ...none, depot: "Kandy" }).map((o) => o.id)).toEqual(["OUT050", "OUT051"]);
    expect(filterOutlets(outlets, { ...none, brand: "Style" }).map((o) => o.id)).toEqual(["OUT011"]);
  });

  it("searches id, name or district in any case", () => {
    expect(filterOutlets(outlets, { ...none, q: "out05" })).toHaveLength(2);
    expect(filterOutlets(outlets, { ...none, q: "kollu" }).map((o) => o.id)).toEqual(["OUT010"]);
    expect(filterOutlets(outlets, { ...none, q: "matale" }).map((o) => o.id)).toEqual(["OUT051"]);
  });

  it("counts each depot under the other filters, including empty depots", () => {
    expect(depotCounts(outlets, { ...none, depot: "Kandy" }, depots)).toEqual({ all: 4, byDepot: { Kandy: 2, Peliyagoda: 2 } });
    expect(depotCounts(outlets, { ...none, brand: "Tech" }, depots)).toEqual({ all: 1, byDepot: { Kandy: 1, Peliyagoda: 0 } });
  });
});

describe("labels", () => {
  it("names docks and parking in plain words", () => {
    expect([dockLabel("rear_dock"), dockLabel("street"), dockLabel("mall_bay")]).toEqual(["Rear dock", "Street", "Mall bay"]);
    expect([parkingLabel("normal"), parkingLabel("van_only"), parkingLabel("mall_dock")]).toEqual(["Normal", "Vans only", "Mall dock"]);
  });

  it("writes windows as the clock strings they are", () => {
    expect(windowLabel("05:00", "08:30")).toBe("05:00–08:30");
    expect(mallWindowLabel(make("X", {}))).toBeNull();
    expect(mallWindowLabel(make("X", { mallWindowOpen: "06:00", mallWindowClose: "10:00" }))).toBe("06:00–10:00");
  });

  it("says where the position came from", () => {
    expect(positionLabel(make("X", { geoSource: "SYNTHETIC" })).label).toBe("Approximate");
    expect(positionLabel(make("X", { geoSource: "CSV" })).label).toBe("From file");
    expect(positionLabel(make("X", { geoSource: "DISPATCHER" })).label).toBe("Set by hand");
    expect(positionLabel(make("X", { geoSource: null, lat: null, lng: null })).label).toBe("None");
  });

  it("falls back to the id when an outlet has no name", () => {
    expect(outletName(make("OUT010", {}))).toBe("OUT010");
    expect(outletName(make("OUT010", { displayName: "Fresh Kollupitiya" }))).toBe("Fresh Kollupitiya");
  });
});

describe("links", () => {
  it("keeps the filters and adds the dialog", () => {
    expect(outletsHref(none)).toBe("/admin/outlets");
    expect(outletsHref({ ...none, depot: "Kandy", q: "out" }, { edit: "OUT050" })).toBe("/admin/outlets?depot=Kandy&q=out&edit=OUT050");
    expect(outletsHref(none, { add: true })).toBe("/admin/outlets?add=1");
  });
});
