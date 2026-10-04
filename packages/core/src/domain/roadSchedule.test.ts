import { describe, expect, it } from "vitest";
import { computeRoadSchedule, latestRoadDeparture, matrixCovers, roadKmOf } from "./roadSchedule";
import { buildTravelMatrix, depotKey, outletKey, type Leg } from "./travel";
import { ALLOWANCE, outlet } from "../validation/fixtures";
import type { OutletRef } from "./types";

/**
 * A hand-made road network, so every figure below can be worked by hand.
 *
 *   depot -> A  24 min / 12 km      A -> B   8 min /  4 km
 *   depot -> B  30 min / 15 km      B -> A   9 min /  5 km (one-way streets: not symmetric)
 *   A -> depot  22 min / 11 km      B -> depot 26 min / 13 km
 */
const LEGS: Record<string, Leg> = {
  "depot>A": { min: 24, km: 12 },
  "depot>B": { min: 30, km: 15 },
  "A>B": { min: 8, km: 4 },
  "B>A": { min: 9, km: 5 },
  "A>depot": { min: 22, km: 11 },
  "B>depot": { min: 26, km: 13 },
};
const name = (key: string) => key.replace("depot:Peliyagoda", "depot").replace("outlet:", "");
const matrix = (over: Record<string, Leg> = {}) =>
  buildTravelMatrix(
    [depotKey("Peliyagoda"), outletKey("A"), outletKey("B")],
    (a, b) => ({ ...LEGS, ...over })[`${name(a)}>${name(b)}`] ?? { min: 999, km: 999 },
    "osrm",
  );

const outlets = (list: OutletRef[]) => new Map(list.map((o) => [o.outletId, o]));
const A = outlet("A", { windowOpen: "05:00", windowClose: "07:30" });
const B = outlet("B", { windowOpen: "05:00", windowClose: "07:30" });
const stops = [
  { outletId: "A", docks: ["rear_dock" as const] },
  { outletId: "B", docks: ["rear_dock" as const] },
];
const run = (depart: string, list = stops, m = matrix(), os = outlets([A, B]), brand: "Fresh" | "Style" = "Fresh", opts = {}) =>
  computeRoadSchedule(depart, "Peliyagoda", brand, list, os, m, ALLOWANCE, opts);

describe("computeRoadSchedule", () => {
  it("walks depot -> A -> B -> depot over the road legs, waiting for a window to open", () => {
    // Depart 04:30. Reach A 04:54, window opens 05:00: wait 6, unload 15, leave 05:15.
    // A -> B 8 min: reach B 05:23, within its window already open: no wait, unload 15, leave 05:38.
    // B -> depot 26 min: back 06:04.
    const s = run("04:30");
    expect(s.stops.map((x) => [x.outletId, x.arrival, x.serviceStart, x.leave, x.waitMin])).toEqual([
      ["A", "04:54", "05:00", "05:15", 6],
      ["B", "05:23", "05:23", "05:38", 0],
    ]);
    expect(s.returnAt).toBe("06:04");
    expect(s.roadMin).toBe(94);
    expect(s.waitMin).toBe(6);
    expect(s.feasible).toBe(true);
  });

  it("counts the way home in the distance, because fuel is burned on the way back", () => {
    expect(run("04:30").roadKm).toBe(12 + 4 + 13);
    expect(roadKmOf("Peliyagoda", ["A", "B"], matrix())).toBe(29);
  });

  it("uses each direction's own leg, so the order of stops matters", () => {
    const ab = run("05:00", stops);
    const ba = run("05:00", [stops[1]!, stops[0]!]);
    expect(ab.roadKm).toBe(12 + 4 + 13);
    expect(ba.roadKm).toBe(15 + 5 + 11);
    expect(ab.returnAt).not.toBe(ba.returnAt);
  });

  it("rounds a fractional leg up, never down", () => {
    const m = matrix({ "depot>A": { min: 24.2, km: 12 } });
    expect(run("05:00", [stops[0]!], m).stops[0]!.arrival).toBe("05:25");
    // Dust just over an integer is not a minute.
    const dust = matrix({ "depot>A": { min: 24 + 1e-12, km: 12 } });
    expect(run("05:00", [stops[0]!], dust).stops[0]!.arrival).toBe("05:24");
  });

  it("marks a stop reached after its window closes, and the trip infeasible", () => {
    // Depart 06:50: A at 07:14 is fine, unloading until 07:29; B is reached at 07:37, 7 min after it closes.
    const s = run("06:50");
    expect(s.stops[0]!.lateByMin).toBe(0);
    expect(s.stops[1]!.lateByMin).toBe(7);
    expect(s.feasible).toBe(false);
  });

  it("applies the Fresh deadline to a Fresh trip even where the outlet's window runs later", () => {
    const late = outlets([outlet("A", { windowOpen: "05:00", windowClose: "10:00" }), outlet("B", { windowOpen: "05:00", windowClose: "10:00" })]);
    // Depart 07:30: reaches A at 07:54, B at 08:17. Windows allow it; the deadline does not.
    const fresh = run("07:30", stops, matrix(), late, "Fresh", { freshDeadline: "08:00" });
    expect(fresh.stops[0]!.freshLateByMin).toBe(0);
    expect(fresh.stops[1]!.freshLateByMin).toBe(17);
    expect(fresh.stops.every((x) => x.lateByMin === 0)).toBe(true);
    expect(fresh.feasible).toBe(false);
  });

  it("leaves a non-Fresh trip alone: the deadline is about Fresh", () => {
    const late = outlets([outlet("A", { brand: "Style", windowOpen: "09:00", windowClose: "17:00" }), outlet("B", { brand: "Style", windowOpen: "09:00", windowClose: "17:00" })]);
    const s = run("09:00", stops, matrix(), late, "Style", { freshDeadline: "08:00" });
    expect(s.stops.every((x) => x.freshLateByMin === 0)).toBe(true);
    expect(s.feasible).toBe(true);
  });

  it("serves a mall outlet inside the overlap of its two windows", () => {
    const mall = outlet("A", { dockType: "mall_bay", windowOpen: "08:00", windowClose: "12:00", mallWindowOpen: "09:00", mallWindowClose: "11:00", brand: "Style" });
    const s = run("08:00", [stops[0]!], matrix(), outlets([mall, B]), "Style");
    // Arrives 08:24, mall opens 09:00: waits until then.
    expect(s.stops[0]).toMatchObject({ arrival: "08:24", serviceStart: "09:00", windowOpen: "09:00", windowClose: "11:00", isMallWindow: true });
    expect(s.feasible).toBe(true);
  });

  it("is infeasible for an outlet whose windows never overlap, however it is timed", () => {
    const never = outlet("A", { dockType: "mall_bay", windowOpen: "05:30", windowClose: "08:00", mallWindowOpen: "09:00", mallWindowClose: "11:00" });
    expect(run("03:30", [stops[0]!], matrix(), outlets([never, B])).feasible).toBe(false);
    expect(run("10:00", [stops[0]!], matrix(), outlets([never, B])).feasible).toBe(false);
  });

  it("goes nowhere, and takes no time, with no stops", () => {
    const s = run("05:00", []);
    expect(s).toMatchObject({ returnAt: "05:00", roadKm: 0, roadMin: 0, feasible: true });
  });

  it("refuses an outlet it has no road leg for rather than inventing one", () => {
    expect(() => run("05:00", [{ outletId: "Z", docks: ["rear_dock"] }], matrix(), outlets([A, B, outlet("Z")]))).toThrow(/no leg/);
  });
});

describe("matrixCovers", () => {
  it("says whether the matrix knows the depot and every outlet", () => {
    expect(matrixCovers(matrix(), "Peliyagoda", ["A", "B"])).toBe(true);
    expect(matrixCovers(matrix(), "Peliyagoda", ["A", "Z"])).toBe(false);
    expect(matrixCovers(matrix(), "Kandy", ["A"])).toBe(false);
  });
});

describe("latestRoadDeparture", () => {
  const find = (earliest = "03:30", latest = "08:00", m = matrix(), os = outlets([A, B]), opts = {}) =>
    latestRoadDeparture("Peliyagoda", "Fresh", stops, os, m, ALLOWANCE, earliest, latest, opts);

  it("finds the last minute to leave and still reach B by 07:30", () => {
    // B is reached 24 + 15 + 8 = 47 min after departure (once A's window is open): leave 06:43.
    expect(find()).toBe("06:43");
    // One minute later is infeasible, one minute earlier is fine.
    expect(run("06:43").feasible).toBe(true);
    expect(run("06:44").feasible).toBe(false);
  });

  it("is limited by the Fresh deadline when that is tighter than the windows", () => {
    const late = outlets([outlet("A", { windowOpen: "05:00", windowClose: "10:00" }), outlet("B", { windowOpen: "05:00", windowClose: "10:00" })]);
    // B by 08:00: depart no later than 07:13.
    expect(find("03:30", "09:00", matrix(), late, { freshDeadline: "08:00" })).toBe("07:13");
  });

  it("answers null when even the earliest departure is too late", () => {
    expect(find("07:00", "08:00")).toBeNull();
  });

  it("answers null for a trip with nothing to deliver, or an empty range", () => {
    expect(latestRoadDeparture("Peliyagoda", "Fresh", [], outlets([A, B]), matrix(), ALLOWANCE, "03:30", "08:00")).toBeNull();
    expect(find("08:00", "03:30")).toBeNull();
  });

  it("never leaves later than the latest allowed", () => {
    expect(find("03:30", "05:00")).toBe("05:00");
  });
});
