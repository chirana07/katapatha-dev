import { describe, expect, it } from "vitest";
import { allocate } from "./allocate";
import type { AllocatorInput, AllocatorVehicle } from "./types";
import { ALLOWANCE, DISTRICTS, order, outlet, vehicle } from "@katapatha/core/validation/fixtures";
import { buildTravelMatrix, depotKey, outletKey, type Leg } from "@katapatha/core/domain/travel";
import { scene } from "./scene.fixture";
import { toMin } from "@katapatha/core/domain/time";
import type { OrderRef, OutletRef } from "@katapatha/core/domain/types";

/**
 * The allocator on real road legs: stops in road order rather than window
 * order, the Fresh deadline, a vehicle's two trips end to end, fuel from road
 * distance, and the overlap of an outlet's window with its mall's.
 */

const avail = (v: ReturnType<typeof vehicle>): AllocatorVehicle => ({ ...v, available: true });

/** Outlets on a line: the depot at 0 and each outlet at a position. One unit is 10 min and 10 km. */
function line(positions: Record<string, number>, unit: Leg = { min: 10, km: 10 }) {
  return buildTravelMatrix(
    [depotKey("Peliyagoda"), ...Object.keys(positions).map(outletKey)],
    (from, to) => {
      const at = (k: string) => (k.startsWith("depot:") ? 0 : positions[k.replace("outlet:", "")]!);
      const d = Math.abs(at(from) - at(to));
      return { min: d * unit.min, km: d * unit.km };
    },
    "osrm",
  );
}

function run(parts: {
  orders: OrderRef[];
  outlets: OutletRef[];
  vehicles: AllocatorVehicle[];
  travel?: AllocatorInput["travel"];
  config?: AllocatorInput["config"];
}) {
  return allocate({
    date: "2026-04-09",
    depot: "Peliyagoda",
    orders: parts.orders,
    vehicles: parts.vehicles,
    outlets: new Map(parts.outlets.map((o) => [o.outletId, o])),
    districts: DISTRICTS,
    allowance: ALLOWANCE,
    fuel: new Map(parts.vehicles.map((v) => [v.vehicleId, { quotaL: v.weeklyFuelQuotaL, committedOtherDaysL: 0 }])),
    travel: parts.travel,
    config: parts.config,
  });
}

describe("stop order follows the road, not the window", () => {
  // On a line, A is far (3), B near (1), C between (2). A shuts first, so ordering
  // by window close would drive 3, 1, 2: out, back, out again. The shortest tour is 1, 2, 3 (or the reverse).
  const outlets = [
    outlet("A", { windowOpen: "05:00", windowClose: "07:00" }),
    outlet("B", { windowOpen: "05:00", windowClose: "07:15" }),
    outlet("C", { windowOpen: "05:00", windowClose: "07:30" }),
  ];
  const orders = [order("OA", { outletId: "A" }), order("OB", { outletId: "B" }), order("OC", { outletId: "C" })];
  const travel = line({ A: 3, B: 1, C: 2 });

  it("visits the outlets in an order that drives the shortest way round", () => {
    const out = run({ orders, outlets, vehicles: [avail(vehicle("VEH001"))], travel });
    expect(out.trips).toHaveLength(1);
    const visited = out.trips[0]!.stops.map((s) => s.outletId);
    // A line out to 3 and back is 60 km; any other order is longer.
    expect(out.trips[0]!.distanceKm).toBe(60);
    expect(visited).toSatisfy((v: string[]) => v.join("") === "BCA" || v.join("") === "ACB");
    expect(out.selfCheck).toEqual([]);
  });

  it("reports each stop's own leg, in kilometres and minutes", () => {
    const out = run({ orders, outlets, vehicles: [avail(vehicle("VEH001"))], travel });
    const stops = out.trips[0]!.stops;
    // Legs between neighbours on the line are 10 km / 10 min; the first is from the depot.
    expect(stops.map((s) => s.legKm).reduce((a, b) => a + b, 0)).toBe(30);
    expect(stops.every((s) => s.legMinutes > 0 && s.serviceStart >= s.plannedArrival && s.leave > s.serviceStart)).toBe(true);
    expect(out.trips[0]!.travelSource).toBe("osrm");
    expect(out.travelSource).toBe("osrm");
  });

  it("says the plan is an estimate when no road legs were supplied", () => {
    const out = run({ orders: [order("OA", { outletId: "A" })], outlets: [outlets[0]!], vehicles: [avail(vehicle("VEH001"))] });
    expect(out.travelSource).toBe("estimate");
    expect(out.trips[0]!.travelSource).toBe("estimate");
  });

  it("ignores a matrix that does not cover the outlets it is asked to plan, and says so", () => {
    const out = run({ orders: [order("OA", { outletId: "A" })], outlets: [outlets[0]!], vehicles: [avail(vehicle("VEH001"))], travel: line({ Z: 1 }) });
    expect(out.travelSource).toBe("estimate");
    expect(out.stats.served).toBe(1);
  });
});

describe("Fresh deliveries are in before stores open", () => {
  // The outlet's own window runs to 10:00, but Fresh must arrive by 08:00.
  const outlets = [outlet("A", { windowOpen: "05:00", windowClose: "10:00" })];

  it("defers, permanently, a Fresh order too far away to arrive by 08:00 even leaving at 03:30", () => {
    // 29 units * 10 min = 290 min: leaving 03:30 reaches it at 08:20.
    const out = run({ orders: [order("OA", { outletId: "A" })], outlets, vehicles: [avail(vehicle("VEH001"))], travel: line({ A: 29 }) });
    expect(out.stats.served).toBe(0);
    expect(out.deferred[0]).toMatchObject({ reasonCode: "FRESH_DEADLINE_UNREACHABLE", permanent: true });
    expect(out.deferred[0]!.suggestion).toMatch(/before stores open/);
  });

  it("serves it when it is just near enough, arriving by 08:00 whatever the window allows", () => {
    // 25 units = 250 min: leaving at 03:30 arrives 07:40; leaving any later than 03:50 would not.
    const out = run({ orders: [order("OA", { outletId: "A" })], outlets, vehicles: [avail(vehicle("VEH001"))], travel: line({ A: 25 }) });
    expect(out.stats.served).toBe(1);
    expect(toMin(out.trips[0]!.stops[0]!.plannedArrival)).toBeLessThanOrEqual(toMin("08:00"));
    expect(out.selfCheck).toEqual([]);
  });

  it("does not apply the rule to Style", () => {
    const style = [outlet("A", { brand: "Style", windowOpen: "09:00", windowClose: "17:00" })];
    const out = run({ orders: [order("OA", { outletId: "A", brand: "Style" })], outlets: style, vehicles: [avail(vehicle("VEH001"))], travel: line({ A: 10 }) });
    expect(out.stats.served).toBe(1);
  });

  it("can be switched off", () => {
    const out = run({
      orders: [order("OA", { outletId: "A" })],
      outlets,
      vehicles: [avail(vehicle("VEH001"))],
      travel: line({ A: 29 }),
      config: { freshDeadline: null },
    });
    expect(out.stats.served).toBe(1);
  });
});

describe("outlet windows that cannot be met", () => {
  it("defers, permanently, an outlet whose own window and its mall's never overlap", () => {
    const stuck = outlet("M", { brand: "Style", dockType: "mall_bay", windowOpen: "05:30", windowClose: "08:00", mallWindowOpen: "09:00", mallWindowClose: "11:00" });
    const out = run({ orders: [order("OM", { outletId: "M", brand: "Style" })], outlets: [stuck], vehicles: [avail(vehicle("VEH001"))], travel: line({ M: 2 }) });
    expect(out.deferred[0]).toMatchObject({ reasonCode: "NO_COMMON_WINDOW", permanent: true });
  });

  it("serves a mall outlet inside the overlap of the two windows", () => {
    const mall = outlet("M", { brand: "Style", dockType: "mall_bay", windowOpen: "08:00", windowClose: "12:00", mallWindowOpen: "09:00", mallWindowClose: "11:00" });
    const out = run({ orders: [order("OM", { outletId: "M", brand: "Style" })], outlets: [mall], vehicles: [avail(vehicle("VEH001"))], travel: line({ M: 2 }) });
    const stop = out.trips[0]!.stops[0]!;
    expect(toMin(stop.serviceStart)).toBeGreaterThanOrEqual(toMin("09:00"));
    expect(toMin(stop.plannedArrival)).toBeLessThanOrEqual(toMin("11:00"));
    expect(out.selfCheck).toEqual([]);
  });

  it("defers, permanently, an order whose window shuts before any vehicle can get there", () => {
    const early = [outlet("A", { windowOpen: "03:30", windowClose: "04:00" })];
    const out = run({ orders: [order("OA", { outletId: "A" })], outlets: early, vehicles: [avail(vehicle("VEH001"))], travel: line({ A: 10 }) });
    expect(out.deferred[0]).toMatchObject({ reasonCode: "OUTLET_UNREACHABLE_IN_WINDOW", permanent: true });
  });
});

describe("a vehicle's two trips run end to end", () => {
  it("numbers the trips by when they run, and leaves time to reload between", () => {
    const outlets = [
      outlet("F", { windowOpen: "05:00", windowClose: "07:30" }),
      outlet("S", { brand: "Style", windowOpen: "09:00", windowClose: "17:00" }),
    ];
    // The Style order was skipped yesterday, so it is placed first and opens trip 1 in creation order.
    const orders = [
      order("STYLE", { outletId: "S", brand: "Style", deferredYesterday: true, daysSinceLastServed: 3 }),
      order("FRESH", { outletId: "F" }),
    ];
    const out = run({ orders, outlets, vehicles: [avail(vehicle("VEH001"))], travel: line({ F: 3, S: 3 }) });

    expect(out.trips).toHaveLength(2);
    const [first, second] = [...out.trips].sort((a, b) => a.tripNo - b.tripNo);
    expect(first!.brand).toBe("Fresh");
    expect(second!.brand).toBe("Style");
    expect(first!.departAt < second!.departAt).toBe(true);
    expect(toMin(second!.departAt)).toBeGreaterThanOrEqual(toMin(first!.returnAt) + 30);
    expect(out.selfCheck).toEqual([]);
  });

  it("defers an order whose trip would have to leave before the vehicle is back from its first", () => {
    // One vehicle. Fresh A opens at 07:00, so even leaving at 03:30 the vehicle waits there until 07:00 and is not
    // home until 09:15; with 30 min to reload it cannot leave again before 09:45. Style B shuts at 10:30
    // and is 60 min away, so its trip must leave by 09:30.
    const outlets = [
      outlet("A", { windowOpen: "07:00", windowClose: "08:00" }),
      outlet("B", { brand: "Style", windowOpen: "09:00", windowClose: "10:30" }),
    ];
    const out = run({
      orders: [order("OA", { outletId: "A" }), order("OB", { outletId: "B", brand: "Style" })],
      outlets,
      vehicles: [avail(vehicle("VEH001"))],
      travel: line({ A: 12, B: 6 }),
    });
    expect(out.stats.served).toBe(1);
    expect(out.deferred).toHaveLength(1);
    expect(out.deferred[0]).toMatchObject({ orderRef: "OB", reasonCode: "TRIP_SEQUENCE_CONFLICT", permanent: false });
    expect(out.selfCheck).toEqual([]);
  });

  it("serves both once the reload time is short enough to fit", () => {
    const outlets = [
      outlet("A", { windowOpen: "07:00", windowClose: "08:00" }),
      outlet("B", { brand: "Style", windowOpen: "09:00", windowClose: "10:30" }),
    ];
    const out = run({
      orders: [order("OA", { outletId: "A" }), order("OB", { outletId: "B", brand: "Style" })],
      outlets,
      vehicles: [avail(vehicle("VEH001"))],
      travel: line({ A: 12, B: 6 }),
      config: { reloadMin: 10 },
    });
    expect(out.stats.served).toBe(2);
    expect(out.selfCheck).toEqual([]);
  });
});

describe("fuel is spent on the road", () => {
  // The district table says 24 km out and back; this road is 100 km each way.
  const outlets = [outlet("A", { windowOpen: "05:00", windowClose: "23:00", brand: "Style" })];
  const orders = [order("OA", { outletId: "A", brand: "Style" })];
  const travel = line({ A: 10 }, { min: 1, km: 10 });

  it("defers an order that would burn more than the vehicle has left this week", () => {
    // 200 km on a 4.7 km/L truck is 42.6 L.
    const v = avail(vehicle("VEH001", { weeklyFuelQuotaL: 30 }));
    const out = run({ orders, outlets, vehicles: [v], travel });
    expect(out.deferred[0]).toMatchObject({ orderRef: "OA", reasonCode: "FUEL_QUOTA_EXCEEDED" });
  });

  it("serves it with the quota to spare, and reports the road's litres", () => {
    const out = run({ orders, outlets, vehicles: [avail(vehicle("VEH001", { weeklyFuelQuotaL: 100 }))], travel });
    expect(out.trips[0]!.distanceKm).toBe(200);
    expect(out.trips[0]!.fuelL).toBeCloseTo(200 / 4.7, 1);
    expect(out.meters[0]!.fuelCommittedL).toBeCloseTo(200 / 4.7, 1);
  });

  it("counts what the vehicle's other days have already used", () => {
    const v = avail(vehicle("VEH001", { weeklyFuelQuotaL: 100 }));
    const input: AllocatorInput = {
      date: "2026-04-09",
      depot: "Peliyagoda",
      orders,
      vehicles: [v],
      outlets: new Map(outlets.map((o) => [o.outletId, o])),
      districts: DISTRICTS,
      allowance: ALLOWANCE,
      fuel: new Map([["VEH001", { quotaL: 100, committedOtherDaysL: 70 }]]),
      travel,
    };
    expect(allocate(input).deferred[0]!.reasonCode).toBe("FUEL_QUOTA_EXCEEDED");
  });
});

describe("on real geometry, a plan is always feasible, reproducible and in order", () => {
  it("never emits an error, a double-booked vehicle, or a Fresh arrival after 08:00", () => {
    for (let seed = 1; seed <= 60; seed++) {
      const out = run(scene(seed));
      const errors = out.selfCheck.filter((v) => v.severity === "error");
      expect(errors, `seed ${seed}`).toEqual([]);
      expect(out.stats.served + out.stats.deferred, `seed ${seed}`).toBe(out.stats.orders);

      const byVehicle = new Map<string, typeof out.trips>();
      for (const t of out.trips) byVehicle.set(t.vehicleId, [...(byVehicle.get(t.vehicleId) ?? []), t]);
      for (const trips of byVehicle.values()) {
        const ordered = [...trips].sort((a, b) => a.tripNo - b.tripNo);
        expect(ordered.map((t) => t.tripNo), `seed ${seed}`).toEqual(ordered.map((_, i) => i + 1));
        for (let i = 1; i < ordered.length; i++) {
          expect(toMin(ordered[i]!.departAt), `seed ${seed}`).toBeGreaterThanOrEqual(toMin(ordered[i - 1]!.returnAt) + 30);
        }
      }
      for (const t of out.trips.filter((x) => x.brand === "Fresh")) {
        for (const s of t.stops) expect(toMin(s.plannedArrival), `seed ${seed}`).toBeLessThanOrEqual(toMin("08:00"));
      }
    }
  });

  it("gives the same plan for the same day, however the queue arrives", () => {
    for (let seed = 1; seed <= 25; seed++) {
      const s = scene(seed);
      const a = run(s);
      const b = run({ ...s, orders: [...s.orders].reverse(), vehicles: [...s.vehicles].reverse() });
      expect(b.stats.hash, `seed ${seed}`).toBe(a.stats.hash);
    }
  });
});
