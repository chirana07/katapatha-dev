import { describe, expect, it } from "vitest";
import { computeStopSchedule, effectiveWindow, latestFeasibleDeparture, windowIsEmpty } from "./schedule";
import { ALLOWANCE, DISTRICTS, outlet } from "../validation/fixtures";
import type { OutletRef } from "./types";

const colombo = DISTRICTS.get("Colombo")!;
const puttalam = DISTRICTS.get("Puttalam")!;

const outlets = (list: OutletRef[]) => new Map(list.map((o) => [o.outletId, o]));

describe("effectiveWindow", () => {
  it("uses the outlet's own window when it is not in a mall", () => {
    const o = outlet("OUT001", { windowOpen: "05:00", windowClose: "07:30" });
    expect(effectiveWindow(o)).toEqual({
      open: "05:00",
      close: "07:30",
      isMallWindow: false,
    });
  });

  it("uses the mall's fixed access window when there is one", () => {
    const o = outlet("OUT015", {
      mallWindowOpen: "09:00",
      mallWindowClose: "11:00",
      windowOpen: "09:00",
      windowClose: "11:00",
    });
    expect(effectiveWindow(o).isMallWindow).toBe(true);
    expect(effectiveWindow(o).close).toBe("11:00");
  });
});

describe("effectiveWindow for a mall outlet is where both windows overlap", () => {
  const mall = (over: Partial<OutletRef>) =>
    outlet("OUT015", { dockType: "mall_bay", parkingConstraint: "mall_dock", ...over });

  it("takes the later opening and the earlier closing", () => {
    // The shop asks for 08:00-12:00 but the mall only lets vehicles in 09:00-11:00.
    expect(effectiveWindow(mall({ windowOpen: "08:00", windowClose: "12:00", mallWindowOpen: "09:00", mallWindowClose: "11:00" }))).toEqual({
      open: "09:00",
      close: "11:00",
      isMallWindow: true,
    });
    // And the other way round: the shop is the tighter side.
    expect(effectiveWindow(mall({ windowOpen: "09:30", windowClose: "10:30", mallWindowOpen: "09:00", mallWindowClose: "11:00" }))).toEqual({
      open: "09:30",
      close: "10:30",
      isMallWindow: true,
    });
  });

  it("is empty when the two windows never meet, so the outlet can never be served", () => {
    const o = mall({ windowOpen: "05:30", windowClose: "08:00", mallWindowOpen: "09:00", mallWindowClose: "11:00" });
    expect(windowIsEmpty(o)).toBe(true);
    expect(windowIsEmpty(mall({ windowOpen: "08:00", windowClose: "12:00", mallWindowOpen: "09:00", mallWindowClose: "11:00" }))).toBe(false);
    expect(windowIsEmpty(outlet("OUT001"))).toBe(false);
  });

  it("treats arriving before an empty window opens as a missed window, not as on time", () => {
    // Arrives 04:54, waits for 09:00, but the window closed at 08:00: service would start after close.
    const map = outlets([mall({ windowOpen: "05:30", windowClose: "08:00", mallWindowOpen: "09:00", mallWindowClose: "11:00" })]);
    const sched = computeStopSchedule("04:30", colombo, "Fresh", [{ outletId: "OUT015", docks: ["mall_bay"] }], map, ALLOWANCE);
    expect(sched[0]!.lateByMin).toBeGreaterThan(0);
  });
});

describe("computeStopSchedule", () => {
  const map = outlets([outlet("OUT001"), outlet("OUT002"), outlet("OUT003")]);

  it("walks the stops forward from the departure", () => {
    // Depart 04:30, Colombo outbound is 24 min -> arrive 04:54. Window opens
    // 05:00 so the vehicle waits 6 min, unloads for 15, leaves 05:15, then an
    // 8 min hop to the next outlet -> 05:23.
    const sched = computeStopSchedule(
      "04:30",
      colombo,
      "Fresh",
      [
        { outletId: "OUT001", docks: ["rear_dock"] },
        { outletId: "OUT002", docks: ["rear_dock"] },
      ],
      map,
      ALLOWANCE,
    );

    expect(sched[0]).toMatchObject({
      arrival: "04:54",
      serviceStart: "05:00",
      leave: "05:15",
      waitMin: 6,
      lateByMin: 0,
    });
    expect(sched[1]).toMatchObject({ arrival: "05:23", serviceStart: "05:23", waitMin: 0 });
  });

  it("does not count waiting as handling time", () => {
    const sched = computeStopSchedule(
      "03:30",
      colombo,
      "Fresh",
      [{ outletId: "OUT001", docks: ["rear_dock"] }],
      map,
      ALLOWANCE,
    );
    // Arrives 03:54, waits until 05:00, then 15 minutes of actual handling.
    expect(sched[0].waitMin).toBe(66);
    expect(sched[0].leave).toBe("05:15");
  });

  it("charges an outlet twice when it takes two orders", () => {
    const sched = computeStopSchedule(
      "05:00",
      colombo,
      "Fresh",
      [{ outletId: "OUT001", docks: ["rear_dock", "rear_dock"] }],
      map,
      ALLOWANCE,
    );
    expect(sched[0].arrival).toBe("05:24");
    expect(sched[0].leave).toBe("05:54"); // 2 x 15 minutes
  });

  it("reports how late an arrival is past the window close", () => {
    const sched = computeStopSchedule(
      "07:30",
      colombo,
      "Fresh",
      [{ outletId: "OUT001", docks: ["rear_dock"] }],
      map,
      ALLOWANCE,
    );
    expect(sched[0].arrival).toBe("07:54");
    expect(sched[0].lateByMin).toBe(24); // window shuts 07:30
  });

  it("throws on an unknown outlet rather than guessing", () => {
    expect(() =>
      computeStopSchedule(
        "05:00",
        colombo,
        "Fresh",
        [{ outletId: "GHOST", docks: ["rear_dock"] }],
        map,
        ALLOWANCE,
      ),
    ).toThrow(/Unknown outlet/);
  });
});

describe("latestFeasibleDeparture", () => {
  const map = outlets([
    outlet("OUT001", { windowOpen: "05:00", windowClose: "07:30" }),
    outlet("OUT002", { windowOpen: "05:30", windowClose: "08:00" }),
  ]);

  it("finds the latest departure that still meets every window", () => {
    const depart = latestFeasibleDeparture(
      colombo,
      "Fresh",
      [
        { outletId: "OUT001", docks: ["rear_dock"] },
        { outletId: "OUT002", docks: ["rear_dock"] },
      ],
      map,
      ALLOWANCE,
      "03:30",
      "08:00",
    );
    expect(depart).not.toBeNull();

    // Leaving at that moment must work, and one minute later must not.
    const ok = computeStopSchedule(depart!, colombo, "Fresh", [
      { outletId: "OUT001", docks: ["rear_dock"] },
      { outletId: "OUT002", docks: ["rear_dock"] },
    ], map, ALLOWANCE);
    expect(ok.every((s) => s.lateByMin === 0)).toBe(true);
  });

  it("returns null when no departure in the wave can make it", () => {
    // Puttalam is 173 minutes out; a window that shuts at 05:00 is
    // unreachable from a 03:30 pre-dawn start.
    const far = outlets([outlet("OUT090", { district: "Puttalam", windowOpen: "04:00", windowClose: "05:00" })]);
    const depart = latestFeasibleDeparture(
      puttalam,
      "Fresh",
      [{ outletId: "OUT090", docks: ["rear_dock"] }],
      far,
      ALLOWANCE,
      "03:30",
      "08:00",
    );
    expect(depart).toBeNull();
  });

  it("returns null for an empty trip", () => {
    expect(
      latestFeasibleDeparture(colombo, "Fresh", [], map, ALLOWANCE, "03:30", "08:00"),
    ).toBeNull();
  });
});
