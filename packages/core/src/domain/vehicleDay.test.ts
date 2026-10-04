import { describe, expect, it } from "vitest";
import { scheduleVehicleDay, type VehicleDayTrip } from "./vehicleDay";

const hm = (h: number, m = 0) => h * 60 + m;

/** A trip that takes a fixed time on the road, whenever it leaves. */
const trip = (id: string, earliest: number, latest: number, duration: number): VehicleDayTrip => ({
  id,
  earliest,
  latest,
  returnAt: (depart) => depart + duration,
});

describe("scheduleVehicleDay", () => {
  it("sends a lone trip off as late as it can", () => {
    const day = scheduleVehicleDay([trip("T1", hm(3, 30), hm(6, 43), 94)], 30)!;
    expect(day.order).toEqual(["T1"]);
    expect(day.departs.get("T1")).toBe(hm(6, 43));
    expect(day.returns.get("T1")).toBe(hm(6, 43) + 94);
  });

  it("holds the second trip back until the first is home and the van is reloaded", () => {
    // Fresh leaves 03:30-06:43 (94 min out and back); Style leaves 08:30-14:00 (200 min).
    const day = scheduleVehicleDay([trip("FRESH", hm(3, 30), hm(6, 43), 94), trip("STYLE", hm(8, 30), hm(14), 200)], 30)!;
    expect(day.order).toEqual(["FRESH", "STYLE"]);
    expect(day.departs.get("STYLE")).toBe(hm(14));
    // The first trip is never later than the second allows, and always home + 30 min before it.
    expect(day.returns.get("FRESH")! + 30).toBeLessThanOrEqual(day.departs.get("STYLE")!);
  });

  it("pulls the first trip earlier when the second's latest departure leaves no room otherwise", () => {
    // Both want the same morning. B must leave by 09:00; A takes 120 min, so A must leave by 06:30 to be home by 08:30.
    const day = scheduleVehicleDay([trip("A", hm(4), hm(8), 120), trip("B", hm(4), hm(9), 60)], 30)!;
    // Either order that fits is acceptable; what matters is that they do not overlap.
    const [first, second] = day.order;
    expect(day.returns.get(first!)! + 30).toBeLessThanOrEqual(day.departs.get(second!)!);
    expect(day.departs.get(second!)).toBeLessThanOrEqual(second === "A" ? hm(8) : hm(9));
  });

  it("finds no day when the two trips cannot be fitted end to end", () => {
    // 200 min trips with a 30 min reload need 430 min between the earliest and the latest start.
    expect(scheduleVehicleDay([trip("A", hm(4), hm(5), 200), trip("B", hm(4), hm(5), 200)], 30)).toBeNull();
  });

  it("tries the other order when the natural one will not fit", () => {
    // A must leave by 05:00 and takes 600 min, so it is back at 13:30 at the earliest: too late for B,
    // which must leave by 12:00. B (60 min) first, then A at 05:00, does fit.
    const a = trip("A", hm(3, 30), hm(5), 600);
    const b = trip("B", hm(3, 30), hm(12), 60);
    const day = scheduleVehicleDay([a, b], 30)!;
    expect(day.order).toEqual(["B", "A"]);
    expect(day.departs.get("A")).toBe(hm(5));
    expect(day.departs.get("B")).toBe(hm(3, 30));
    expect(day.returns.get("B")! + 30).toBeLessThanOrEqual(day.departs.get("A")!);
  });

  it("does not depend on the order the trips are given in", () => {
    const t1 = trip("FRESH", hm(3, 30), hm(6, 43), 94);
    const t2 = trip("STYLE", hm(8, 30), hm(14), 200);
    const one = scheduleVehicleDay([t1, t2], 30)!;
    const two = scheduleVehicleDay([t2, t1], 30)!;
    expect(two.order).toEqual(one.order);
    expect([...two.departs]).toEqual([...one.departs].sort((x, y) => (two.order.indexOf(x[0]) - two.order.indexOf(y[0]))));
  });

  it("follows a return time that depends on when the trip leaves, as waiting for a window does", () => {
    // Leaving before 06:00 means waiting, so the trip is back at 07:30 whenever it leaves early.
    const waits: VehicleDayTrip = { id: "W", earliest: hm(3, 30), latest: hm(7), returnAt: (d) => Math.max(d, hm(6)) + 90 };
    const next = trip("N", hm(8), hm(12), 60);
    const day = scheduleVehicleDay([waits, next], 30)!;
    expect(day.returns.get("W")).toBe(Math.max(day.departs.get("W")!, hm(6)) + 90);
    expect(day.returns.get("W")! + 30).toBeLessThanOrEqual(day.departs.get("N")!);
  });

  it("refuses a trip whose own range is empty", () => {
    expect(scheduleVehicleDay([trip("A", hm(8), hm(7), 30)], 30)).toBeNull();
    expect(scheduleVehicleDay([trip("A", hm(8), hm(7), 30), trip("B", hm(9), hm(10), 30)], 30)).toBeNull();
  });

  it("is an empty day for no trips, and refuses a third trip", () => {
    expect(scheduleVehicleDay([], 30)).toEqual({ order: [], departs: new Map(), returns: new Map() });
    expect(() => scheduleVehicleDay([trip("A", 0, 1, 1), trip("B", 0, 1, 1), trip("C", 0, 1, 1)], 30)).toThrow(/at most two/);
  });
});
