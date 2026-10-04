import { describe, expect, it } from "vitest";
import { allocate, createContext } from "./allocate";
import { commit, improve } from "./improve";
import { applyToTrip, assignDepartures, checkTrip, type TripSpec } from "./feasibility";
import { objectiveOf } from "./objective";
import { tryPlace } from "./construct";
import { scene } from "./scene.fixture";
import type { Context, StopBuild } from "./state";
import type { AllocatorInput, AllocatorVehicle } from "./types";
import { ALLOWANCE, DISTRICTS, order, outlet, vehicle } from "@katapatha/core/validation/fixtures";
import { buildTravelMatrix, depotKey, outletKey } from "@katapatha/core/domain/travel";
import { fromMin } from "@katapatha/core/domain/time";
import { waveForBrand, type OrderRef, type OutletRef } from "@katapatha/core/domain/types";

/**
 * The improvement pass. Each move is tested on a hand-built plan in which it is
 * the only thing that can help, so a failure names the move. The plans are built
 * with `force`, which puts a trip in place exactly as stated (after checking it
 * is legal), because the greedy would not have made these mistakes.
 */

const avail = (v: ReturnType<typeof vehicle>): AllocatorVehicle => ({ ...v, available: true });

/** Outlets on a line, the depot at 0; one unit is `unit` minutes and `unit` km (10 unless said). */
const line = (positions: Record<string, number>, unit = 10) =>
  buildTravelMatrix(
    [depotKey("Peliyagoda"), ...Object.keys(positions).map(outletKey)],
    (from, to) => {
      const at = (k: string) => (k.startsWith("depot:") ? 0 : positions[k.replace("outlet:", "")]!);
      const d = Math.abs(at(from) - at(to));
      return { min: d * unit, km: d * unit };
    },
    "osrm",
  );

function contextFor(parts: {
  outlets: OutletRef[];
  vehicles: AllocatorVehicle[];
  positions: Record<string, number>;
  unit?: number;
  config?: AllocatorInput["config"];
}): Context {
  return createContext({
    date: "2026-04-09",
    depot: "Peliyagoda",
    orders: [],
    vehicles: parts.vehicles,
    outlets: new Map(parts.outlets.map((o) => [o.outletId, o])),
    districts: DISTRICTS,
    allowance: ALLOWANCE,
    fuel: new Map(parts.vehicles.map((v) => [v.vehicleId, { quotaL: v.weeklyFuelQuotaL, committedOtherDaysL: 0 }])),
    travel: line(parts.positions, parts.unit),
    config: parts.config,
  });
}

/** Put a trip in place exactly as stated, after checking that it is legal. */
function force(ctx: Context, vehicle: AllocatorVehicle, stops: StopBuild[]) {
  const first = stops[0]!.orders[0]!;
  const spec: TripSpec = {
    vehicle,
    brand: first.brand,
    district: first.district,
    wave: waveForBrand(first.brand),
    travel: ctx.districts.get(first.district)!,
    stops,
  };
  const check = checkTrip(ctx, spec, null);
  if (!check.ok) throw new Error(`forced trip is not legal: ${check.failure.rejection.code}`);
  const trip = {
    id: ctx.nextTripId++,
    vehicle,
    tripNo: 1 as const,
    brand: spec.brand,
    district: spec.district,
    wave: spec.wave,
    travel: spec.travel,
    stops: [],
    minutes: 0,
    fuelL: 0,
    roadKm: 0,
    volumeM3: 0,
    weightKg: 0,
    latestDepartMin: 0,
    departAt: fromMin(0),
    road: check.figures.road,
  };
  ctx.trips.push(trip);
  applyToTrip(trip, spec, check.figures);
  return trip;
}

const stop = (outletId: string, ...orders: OrderRef[]): StopBuild => ({ outletId, orders });
const km = (ctx: Context) => objectiveOf(ctx).roadKm;

describe("resequence", () => {
  it("reorders a trip that doubles back into the shortest tour", () => {
    const ctx = contextFor({
      outlets: ["A", "B", "C"].map((id) => outlet(id, { windowOpen: "05:00", windowClose: "07:30" })),
      vehicles: [avail(vehicle("VEH001"))],
      positions: { A: 3, B: 1, C: 2 },
    });
    const a = order("OA", { outletId: "A" });
    const b = order("OB", { outletId: "B" });
    const c = order("OC", { outletId: "C" });
    force(ctx, ctx.input.vehicles[0]!, [stop("A", a), stop("B", b), stop("C", c)]);
    // Out to 3, back to 1, out to 2, home: 30 + 20 + 10 + 20 = 80 km.
    expect(km(ctx)).toBe(80);

    const { search } = improve(ctx, []);

    expect(km(ctx)).toBe(60);
    expect(search.moves.resequence).toBeGreaterThanOrEqual(1);
    expect(search.after.value).toBeLessThan(search.before.value);
    // On a line, every tour that goes out to the far end and comes home through the rest is as short.
    expect(ctx.trips[0]!.stops.map((s) => s.outletId)).not.toEqual(["A", "B", "C"]);
  });

  it("keeps the order it has when a shorter one would miss a window", () => {
    // B is nearer but shuts at 05:40; reaching it first is the only way to make it.
    const ctx = contextFor({
      outlets: [
        outlet("A", { windowOpen: "05:00", windowClose: "07:30" }),
        outlet("B", { windowOpen: "05:00", windowClose: "05:40" }),
      ],
      vehicles: [avail(vehicle("VEH001"))],
      positions: { A: 2, B: 1 },
    });
    force(ctx, ctx.input.vehicles[0]!, [stop("B", order("OB", { outletId: "B" })), stop("A", order("OA", { outletId: "A" }))]);

    improve(ctx, []);

    expect(ctx.trips[0]!.stops.map((s) => s.outletId)).toEqual(["B", "A"]);
  });

  it("finds the shortest tour for a trip with more stops than it can try every order of", () => {
    const ids = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"];
    // On a line the shortest tour is straight out and back, whatever the starting order.
    const positions = Object.fromEntries(ids.map((id, i) => [id, i + 1]));
    const ctx = contextFor({
      outlets: ids.map((id) => outlet(id, { brand: "Style", windowOpen: "09:00", windowClose: "17:00" })),
      vehicles: [avail(vehicle("VEH001", { volumeCapM3: 38, weightCapKg: 7200 }))],
      positions,
      unit: 1,
    });
    const scrambled = ["E", "A", "J", "C", "H", "B", "I", "D", "G", "F"];
    force(
      ctx,
      ctx.input.vehicles[0]!,
      scrambled.map((id) => stop(id, order(`O${id}`, { outletId: id, brand: "Style", volumeM3: 0.5, weightKg: 50 }))),
    );
    const before = km(ctx);

    const { search } = improve(ctx, []);

    expect(km(ctx)).toBeLessThan(before);
    expect(km(ctx)).toBe(20); // out to 10 and back
    expect(search.moves.resequence).toBeGreaterThanOrEqual(1);
  });
});

describe("eliminate and relocate", () => {
  it("folds a second trip into the first when it would cost less than a trip of its own", () => {
    const ctx = contextFor({
      outlets: ["A", "B"].map((id) => outlet(id, { windowOpen: "05:00", windowClose: "07:30" })),
      vehicles: [avail(vehicle("VEH001")), avail(vehicle("VEH002"))],
      positions: { A: 1, B: 2 },
    });
    force(ctx, ctx.input.vehicles[0]!, [stop("A", order("OA", { outletId: "A" }))]);
    force(ctx, ctx.input.vehicles[1]!, [stop("B", order("OB", { outletId: "B" }))]);
    expect(ctx.trips).toHaveLength(2);

    const { search } = improve(ctx, []);

    expect(ctx.trips).toHaveLength(1);
    expect(km(ctx)).toBe(40); // out to 2 and back, calling at 1 on the way
    expect(search.moves.eliminate + search.moves.relocate).toBeGreaterThanOrEqual(1);
    expect(search.after.trips).toBe(1);
    expect(search.after.value).toBeLessThan(search.before.value - 25); // at least the trip it saved
  });

  it("does not merge trips that cannot share a vehicle", () => {
    // 6 m3 each on 8 m3 vehicles: one trip cannot hold both.
    const ctx = contextFor({
      outlets: ["A", "B"].map((id) => outlet(id, { windowOpen: "05:00", windowClose: "07:30" })),
      vehicles: [avail(vehicle("VEH001", { volumeCapM3: 8 })), avail(vehicle("VEH002", { volumeCapM3: 8 }))],
      positions: { A: 1, B: 2 },
    });
    force(ctx, ctx.input.vehicles[0]!, [stop("A", order("OA", { outletId: "A", volumeM3: 6 }))]);
    force(ctx, ctx.input.vehicles[1]!, [stop("B", order("OB", { outletId: "B", volumeM3: 6 }))]);

    improve(ctx, []);

    expect(ctx.trips).toHaveLength(2);
  });

  it("never merges across lanes: one brand and one district per trip", () => {
    const ctx = contextFor({
      outlets: [outlet("A", { windowOpen: "05:00", windowClose: "07:30" }), outlet("B", { brand: "Style", windowOpen: "09:00", windowClose: "17:00" })],
      vehicles: [avail(vehicle("VEH001")), avail(vehicle("VEH002"))],
      positions: { A: 1, B: 2 },
    });
    force(ctx, ctx.input.vehicles[0]!, [stop("A", order("OA", { outletId: "A" }))]);
    force(ctx, ctx.input.vehicles[1]!, [stop("B", order("OB", { outletId: "B", brand: "Style" }))]);

    improve(ctx, []);

    expect(ctx.trips).toHaveLength(2);
  });
});

describe("swap", () => {
  it("exchanges stops between two full trips when that shortens both", () => {
    // Each vehicle holds exactly two stops. Trip 1 has the outlets at 1 and 9, trip 2 those at 2 and 8:
    // 18 + 16 = 34 km. Swapping 9 and 2 gives {1, 2} and {9, 8}: 4 + 18 = 22 km. Nothing can move
    // alone, because both are full.
    const ctx = contextFor({
      outlets: ["P1", "P9", "P2", "P8"].map((id) => outlet(id, { windowOpen: "05:00", windowClose: "07:30" })),
      vehicles: [avail(vehicle("VEH001", { volumeCapM3: 6 })), avail(vehicle("VEH002", { volumeCapM3: 6 }))],
      positions: { P1: 1, P9: 9, P2: 2, P8: 8 },
    });
    const o = (id: string) => order(`O${id}`, { outletId: id, volumeM3: 3 });
    force(ctx, ctx.input.vehicles[0]!, [stop("P1", o("P1")), stop("P9", o("P9"))]);
    force(ctx, ctx.input.vehicles[1]!, [stop("P2", o("P2")), stop("P8", o("P8"))]);
    const before = km(ctx);
    // 18 + 16 = 34 units, at 10 km a unit.
    expect(before).toBe(340);

    const { search } = improve(ctx, []);

    expect(search.moves.swap).toBeGreaterThanOrEqual(1);
    expect(km(ctx)).toBeLessThan(before);
    expect(ctx.trips).toHaveLength(2);
  });
});

describe("reassign and reinsert", () => {
  it("moves ambient work off a reefer onto an ambient truck that is free", () => {
    const ctx = contextFor({
      outlets: [outlet("A", { windowOpen: "05:00", windowClose: "07:30" })],
      vehicles: [avail(vehicle("REEFER", { temp: "reefer" })), avail(vehicle("DRY", { temp: "ambient" }))],
      positions: { A: 2 },
    });
    force(ctx, ctx.input.vehicles[0]!, [stop("A", order("OA", { outletId: "A", tempRequirement: "ambient" }))]);
    // A reefer carrying goods that need no refrigeration counts as 2 units of waste.
    expect(objectiveOf(ctx).scarcity).toBe(2);

    const { search } = improve(ctx, []);

    expect(ctx.trips[0]!.vehicle.vehicleId).toBe("DRY");
    expect(search.moves.reassign).toBeGreaterThanOrEqual(1);
    expect(search.after.scarcity).toBe(0);
  });

  it("frees the only reefer so a chilled order that was left out can be served", () => {
    const ctx = contextFor({
      outlets: ["A", "B"].map((id) => outlet(id, { windowOpen: "05:00", windowClose: "07:30" })),
      vehicles: [avail(vehicle("REEFER", { temp: "reefer" })), avail(vehicle("DRY", { temp: "ambient" }))],
      positions: { A: 2, B: 2 },
      config: { maxTripsPerVehicle: 1 },
    });
    force(ctx, ctx.input.vehicles[0]!, [stop("A", order("OA", { outletId: "A", tempRequirement: "ambient", volumeM3: 20 }))]);
    const chilled = order("OB", { outletId: "B", tempRequirement: "chilled", volumeM3: 20 });
    // Nothing is free for the chilled order as the plan stands.
    expect(tryPlace(ctx, chilled)).toBe(false);

    const { unplaced, search } = improve(ctx, [chilled]);

    expect(unplaced).toEqual([]);
    expect(search.moves.reinsert).toBe(1);
    const carrying = new Map(ctx.trips.flatMap((t) => t.stops.flatMap((s) => s.orders.map((o) => [o.ref, t.vehicle.vehicleId] as const))));
    expect(carrying.get("OB")).toBe("REEFER");
    expect(carrying.get("OA")).toBe("DRY");
    expect(search.after.servedWeight).toBeGreaterThan(search.before.servedWeight);
  });

  it("clears the reason a re-inserted order had been given", () => {
    const ctx = contextFor({
      outlets: ["A", "B"].map((id) => outlet(id, { windowOpen: "05:00", windowClose: "07:30" })),
      vehicles: [avail(vehicle("REEFER", { temp: "reefer" })), avail(vehicle("DRY", { temp: "ambient" }))],
      positions: { A: 2, B: 2 },
      config: { maxTripsPerVehicle: 1 },
    });
    force(ctx, ctx.input.vehicles[0]!, [stop("A", order("OA", { outletId: "A", tempRequirement: "ambient", volumeM3: 20 }))]);
    const chilled = order("OB", { outletId: "B", tempRequirement: "chilled", volumeM3: 20 });
    tryPlace(ctx, chilled);
    expect(ctx.ledger.for("OB").length).toBeGreaterThan(0);

    improve(ctx, [chilled]);

    expect(ctx.ledger.for("OB")).toEqual([]);
  });
});

describe("a move that breaks the vehicle's day is undone", () => {
  it("restores every trip exactly when the whole-vehicle check fails", () => {
    const ctx = contextFor({
      outlets: [outlet("A", { windowOpen: "05:00", windowClose: "07:30" })],
      vehicles: [avail(vehicle("VEH001"))],
      positions: { A: 1 },
    });
    const trip = force(ctx, ctx.input.vehicles[0]!, [stop("A", order("OA", { outletId: "A" }))]);
    const spec = { ...({ vehicle: trip.vehicle, brand: trip.brand, district: trip.district, wave: trip.wave, travel: trip.travel, stops: trip.stops } as TripSpec) };
    const check = checkTrip(ctx, spec, trip);
    if (!check.ok) throw new Error("setup");
    const before = JSON.stringify({ minutes: trip.minutes, stops: trip.stops, depart: trip.latestDepartMin });

    // A replacement whose trip time is far over the pre-dawn budget.
    const ok = commit(ctx, {
      delta: -1,
      removed: [],
      replacements: [{ trip, spec, figures: { ...check.figures, minutes: 10_000 } }],
    });

    expect(ok).toBe(false);
    expect(JSON.stringify({ minutes: trip.minutes, stops: trip.stops, depart: trip.latestDepartMin })).toBe(before);
    expect(ctx.trips).toHaveLength(1);
  });

  it("puts back a trip it had removed", () => {
    const ctx = contextFor({
      outlets: ["A", "B"].map((id) => outlet(id, { windowOpen: "05:00", windowClose: "07:30" })),
      vehicles: [avail(vehicle("VEH001")), avail(vehicle("VEH002"))],
      positions: { A: 1, B: 2 },
    });
    const keep = force(ctx, ctx.input.vehicles[0]!, [stop("A", order("OA", { outletId: "A" }))]);
    const drop = force(ctx, ctx.input.vehicles[1]!, [stop("B", order("OB", { outletId: "B" }))]);
    const spec = { vehicle: keep.vehicle, brand: keep.brand, district: keep.district, wave: keep.wave, travel: keep.travel, stops: keep.stops } as TripSpec;
    const check = checkTrip(ctx, spec, keep);
    if (!check.ok) throw new Error("setup");

    const ok = commit(ctx, { delta: -1, removed: [drop], replacements: [{ trip: keep, spec, figures: { ...check.figures, minutes: 10_000 } }] });

    expect(ok).toBe(false);
    expect(ctx.trips.map((t) => t.id)).toEqual([keep.id, drop.id]);
  });
});

describe("on whole days", () => {
  const plan = (s: ReturnType<typeof scene>, config?: AllocatorInput["config"]) =>
    allocate({
      date: "2026-04-09",
      depot: "Peliyagoda",
      orders: s.orders,
      vehicles: s.vehicles,
      outlets: new Map(s.outlets.map((o) => [o.outletId, o])),
      districts: DISTRICTS,
      allowance: ALLOWANCE,
      fuel: new Map(s.vehicles.map((v) => [v.vehicleId, { quotaL: v.weeklyFuelQuotaL, committedOtherDaysL: 0 }])),
      travel: s.travel,
      config,
    });

  it("is never worse than construction alone, serves at least as many, and is still a legal plan", () => {
    let better = 0;
    for (let seed = 1; seed <= 30; seed++) {
      const s = scene(seed, { orders: 40, extraVehicles: 4 });
      const built = plan(s, { localSearch: { maxRounds: 0 } });
      const full = plan(s);
      expect(full.search.after.value, `seed ${seed}`).toBeLessThanOrEqual(built.search.after.value + 1e-6);
      expect(full.stats.served, `seed ${seed}`).toBeGreaterThanOrEqual(built.stats.served);
      expect(full.selfCheck.filter((v) => v.severity === "error"), `seed ${seed}`).toEqual([]);
      expect(full.stats.served + full.stats.deferred, `seed ${seed}`).toBe(full.stats.orders);
      if (full.search.after.value < built.search.after.value - 1e-6) better += 1;
    }
    // On days this size the greedy leaves something to find, on most of them.
    expect(better).toBeGreaterThan(10);
    // Sixty full allocations: about 7s on a CI runner, over vitest's default 5s.
  }, 60_000);

  it("reports what it did, and the before and after agree with the plan it returned", () => {
    const s = scene(7, { orders: 40, extraVehicles: 4 });
    const out = plan(s);
    expect(out.search.after.trips).toBe(out.stats.tripsBuilt);
    expect(out.search.after.roadKm).toBeCloseTo(out.trips.reduce((n, t) => n + t.distanceKm, 0), 0);
    expect(Object.keys(out.search.moves).sort()).toEqual(["eliminate", "reassign", "reinsert", "relocate", "resequence", "swap"]);
    expect(out.search.evaluations).toBeGreaterThan(0);
  });

  it("gives the same plan and the same record for the same day, however the queue arrives", () => {
    for (let seed = 1; seed <= 12; seed++) {
      const s = scene(seed, { orders: 40, extraVehicles: 4 });
      const a = plan(s);
      const b = plan({ ...s, orders: [...s.orders].reverse(), vehicles: [...s.vehicles].reverse() });
      expect(b.stats.hash, `seed ${seed}`).toBe(a.stats.hash);
      expect(b.search.moves, `seed ${seed}`).toEqual(a.search.moves);
      expect(b.search.after.value, `seed ${seed}`).toBe(a.search.after.value);
    }
  });

  it("stops at its budget, and with no budget returns exactly what construction built", () => {
    const s = scene(7, { orders: 40, extraVehicles: 4 });
    const built = plan(s, { localSearch: { maxRounds: 0 } });

    const none = plan(s, { localSearch: { maxEvaluations: 0 } });
    expect(none.stats.hash).toBe(built.stats.hash);
    expect(none.search.evaluations).toBe(0);

    const small = plan(s, { localSearch: { maxEvaluations: 50 } });
    const big = plan(s, { localSearch: { maxEvaluations: 200_000 } });
    expect(small.search.evaluations).toBeLessThan(big.search.evaluations);
    expect(small.search.after.value).toBeLessThanOrEqual(built.search.after.value + 1e-6);
    expect(big.search.after.value).toBeLessThanOrEqual(small.search.after.value + 1e-6);
    // The same budget is the same plan.
    expect(plan(s, { localSearch: { maxEvaluations: 50 } }).stats.hash).toBe(small.stats.hash);
  });

  it("assigns the departures after the search, so no vehicle is double-booked", () => {
    for (let seed = 1; seed <= 10; seed++) {
      const s = scene(seed, { orders: 40, extraVehicles: 4 });
      const out = plan(s);
      const byVehicle = new Map<string, typeof out.trips>();
      for (const t of out.trips) byVehicle.set(t.vehicleId, [...(byVehicle.get(t.vehicleId) ?? []), t]);
      for (const trips of byVehicle.values()) {
        const ordered = [...trips].sort((a, b) => a.tripNo - b.tripNo);
        for (let i = 1; i < ordered.length; i++) expect(ordered[i]!.departAt >= ordered[i - 1]!.returnAt, `seed ${seed}`).toBe(true);
      }
    }
    void assignDepartures;
  });
});
