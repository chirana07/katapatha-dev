import { describe, expect, it } from "vitest";
import { allocate } from "./allocate";
import { loadPeakDayScenario, resolveDataRoot } from "./scenario";
import type { AllocatorInput, AllocatorVehicle } from "./types";
import { ALLOWANCE, DISTRICTS, order, outlet, vehicle } from "@katapatha/core/validation/fixtures";
import type { OrderRef, OutletRef } from "@katapatha/core/domain/types";

// ---------------------------------------------------------------------------
// Small hand-built cases
// ---------------------------------------------------------------------------

function input(parts: {
  orders: OrderRef[];
  vehicles: AllocatorVehicle[];
  outlets: OutletRef[];
  config?: AllocatorInput["config"];
}): AllocatorInput {
  return {
    date: "2026-04-09",
    depot: "Peliyagoda",
    orders: parts.orders,
    vehicles: parts.vehicles,
    outlets: new Map(parts.outlets.map((o) => [o.outletId, o])),
    districts: DISTRICTS,
    allowance: ALLOWANCE,
    fuel: new Map(
      parts.vehicles.map((v) => [
        v.vehicleId,
        { quotaL: v.weeklyFuelQuotaL, committedOtherDaysL: 0 },
      ]),
    ),
    config: parts.config,
  };
}

const avail = (v: ReturnType<typeof vehicle>): AllocatorVehicle => ({
  ...v,
  available: true,
});

describe("the allocator always passes its own validator", () => {
  it("self-checks clean on a simple day", () => {
    const out = allocate(
      input({
        outlets: [outlet("OUT001"), outlet("OUT002")],
        vehicles: [avail(vehicle("VEH001"))],
        orders: [order("A", { outletId: "OUT001" }), order("B", { outletId: "OUT002" })],
      }),
    );
    expect(out.selfCheck).toEqual([]);
    expect(out.stats.served).toBe(2);
  });

  it("never emits a plan that breaks a rule, across randomised inputs", () => {
    // A property test: whatever the shape of the day, validatePlan(allocate(x))
    // must be empty. This is the guarantee that auto-plan output can be trusted.
    let seed = 20260409;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    const districts = ["Colombo", "Gampaha", "Puttalam"];
    const brands = ["Fresh", "Style", "Tech"] as const;

    for (let run = 0; run < 60; run++) {
      const outs: OutletRef[] = [];
      const ords: OrderRef[] = [];
      const n = 3 + Math.floor(rand() * 10);

      for (let i = 0; i < n; i++) {
        const brand = brands[Math.floor(rand() * brands.length)];
        const district = districts[Math.floor(rand() * districts.length)];
        const id = `OUT${String(100 + i).padStart(3, "0")}`;
        outs.push(
          outlet(id, {
            brand,
            district,
            dockType: rand() < 0.5 ? "rear_dock" : "street",
            parkingConstraint: rand() < 0.2 ? "van_only" : "normal",
            windowOpen: brand === "Fresh" ? "05:00" : "09:00",
            windowClose: brand === "Fresh" ? "07:30" : "17:00",
          }),
        );
        ords.push(
          order(`O${run}-${i}`, {
            outletId: id,
            brand,
            district,
            tempRequirement: rand() < 0.4 ? "chilled" : "ambient",
            volumeM3: Number((rand() * 8).toFixed(2)),
            weightKg: Number((rand() * 1500).toFixed(1)),
            windowOpen: brand === "Fresh" ? "05:00" : "09:00",
            windowClose: brand === "Fresh" ? "07:30" : "17:00",
            deferredYesterday: rand() < 0.2,
            daysSinceLastServed: 1 + Math.floor(rand() * 5),
          }),
        );
      }

      const out = allocate(
        input({
          outlets: outs,
          orders: ords,
          vehicles: [
            avail(vehicle("VEH001", { temp: "reefer" })),
            avail(vehicle("VEH002", { temp: "ambient", volumeCapM3: 38, weightCapKg: 7200 })),
            avail(vehicle("VEH003", { type: "van", temp: "reefer", volumeCapM3: 7, weightCapKg: 1040 })),
          ],
        }),
      );

      const errors = out.selfCheck.filter((v) => v.severity === "error");
      expect(errors, `run ${run}`).toEqual([]);
      // Every order is accounted for exactly once.
      const served = out.trips.reduce(
        (sum, t) => sum + t.stops.reduce((m, s) => m + s.orderRefs.length, 0),
        0,
      );
      expect(served + out.deferred.length, `run ${run}`).toBe(ords.length);
    }
  });
});

describe("determinism", () => {
  it("produces an identical plan for identical input", () => {
    const build = () =>
      input({
        outlets: [outlet("OUT001"), outlet("OUT002"), outlet("OUT003")],
        vehicles: [avail(vehicle("VEH001")), avail(vehicle("VEH002"))],
        orders: [
          order("A", { outletId: "OUT001", volumeM3: 4 }),
          order("B", { outletId: "OUT002", volumeM3: 5 }),
          order("C", { outletId: "OUT003", volumeM3: 6 }),
        ],
      });

    const a = allocate(build());
    const b = allocate(build());
    expect(a.stats.hash).toBe(b.stats.hash);
    expect(a.trips).toEqual(b.trips);
  });

  it("does not depend on the order the queue arrives in", () => {
    const outs = [outlet("OUT001"), outlet("OUT002"), outlet("OUT003")];
    const ords = [
      order("A", { outletId: "OUT001", volumeM3: 4 }),
      order("B", { outletId: "OUT002", volumeM3: 5 }),
      order("C", { outletId: "OUT003", volumeM3: 6 }),
    ];
    const vehicles = [avail(vehicle("VEH001")), avail(vehicle("VEH002"))];

    const forward = allocate(input({ outlets: outs, vehicles, orders: ords }));
    const reversed = allocate(
      input({ outlets: outs, vehicles, orders: [...ords].reverse() }),
    );
    expect(reversed.stats.hash).toBe(forward.stats.hash);
  });
});

describe("structural screening", () => {
  it("permanently defers an order larger than any vehicle, and says so", () => {
    const out = allocate(
      input({
        outlets: [outlet("OUT001")],
        vehicles: [avail(vehicle("VEH001", { volumeCapM3: 26.4 }))],
        orders: [order("BIG", { volumeM3: 40.66 })],
      }),
    );
    expect(out.deferred).toHaveLength(1);
    expect(out.deferred[0].reasonCode).toBe("ORDER_EXCEEDS_FLEET_CAPACITY");
    expect(out.deferred[0].permanent).toBe(true);
    expect(out.deferred[0].suggestion).toMatch(/travels whole on one vehicle, so the store needs to place it as smaller orders/);
  });

  it("distinguishes a fleet with no reefer from a fleet whose reefers are busy", () => {
    const noReefer = allocate(
      input({
        outlets: [outlet("OUT001")],
        vehicles: [avail(vehicle("VEH008", { temp: "ambient" }))],
        orders: [order("A", { tempRequirement: "chilled" })],
      }),
    );
    expect(noReefer.deferred[0].reasonCode).toBe("NO_REEFER_IN_FLEET");
    expect(noReefer.deferred[0].permanent).toBe(true);
  });

  it("permanently defers a district that cannot be reached inside the wave", () => {
    // Puttalam is 173 min out; a 60 min budget cannot reach it at all.
    const out = allocate(
      input({
        outlets: [outlet("OUT090", { district: "Puttalam" })],
        vehicles: [avail(vehicle("VEH001"))],
        orders: [order("A", { outletId: "OUT090", district: "Puttalam" })],
        config: { predawnBudget: 60 },
      }),
    );
    expect(out.deferred[0].reasonCode).toBe("DISTRICT_UNREACHABLE_IN_BUDGET");
  });
});

describe("scarce resources go to the work only they can do", () => {
  it("leaves the reefer alone when an ambient truck will serve", () => {
    const out = allocate(
      input({
        outlets: [outlet("OUT001")],
        vehicles: [
          avail(vehicle("VEH001", { temp: "reefer" })),
          avail(vehicle("VEH008", { temp: "ambient" })),
        ],
        orders: [order("A", { tempRequirement: "ambient" })],
      }),
    );
    expect(out.trips).toHaveLength(1);
    expect(out.trips[0].vehicleId).toBe("VEH008");
  });

  it("keeps the only reefer van free for the chilled van-only outlet", () => {
    // The trap: a van is the only thing that can reach OUT001, and a reefer is
    // the only thing that can carry chilled. Spend the reefer van on the
    // ambient order and the chilled one has nowhere to go.
    const out = allocate(
      input({
        outlets: [
          outlet("OUT001", { parkingConstraint: "van_only" }),
          outlet("OUT002", { parkingConstraint: "van_only" }),
        ],
        vehicles: [
          avail(vehicle("VAN_R", { type: "van", temp: "reefer", volumeCapM3: 7, weightCapKg: 1040 })),
          avail(vehicle("VAN_A", { type: "van", temp: "ambient", volumeCapM3: 7, weightCapKg: 1040 })),
        ],
        orders: [
          order("AMB", { outletId: "OUT002", tempRequirement: "ambient", volumeM3: 3 }),
          order("CHI", { outletId: "OUT001", tempRequirement: "chilled", volumeM3: 3 }),
        ],
      }),
    );
    expect(out.deferred).toHaveLength(0);
    const chilledTrip = out.trips.find((t) =>
      t.stops.some((s) => s.orderRefs.includes("CHI")),
    );
    expect(chilledTrip?.vehicleId).toBe("VAN_R");
  });
});

describe("the fairness policy has teeth", () => {
  it("serves an outlet skipped yesterday ahead of one served yesterday", () => {
    // One vehicle, room for one order. The skipped outlet must win.
    const out = allocate(
      input({
        outlets: [outlet("OUT001"), outlet("OUT002")],
        vehicles: [avail(vehicle("VEH001", { volumeCapM3: 6, weightCapKg: 2000 }))],
        config: { maxTripsPerVehicle: 1 },
        orders: [
          order("FRESH_TODAY", {
            outletId: "OUT001",
            volumeM3: 5,
            deferredYesterday: false,
            daysSinceLastServed: 1,
          }),
          order("SKIPPED", {
            outletId: "OUT002",
            volumeM3: 5,
            deferredYesterday: true,
            daysSinceLastServed: 3,
          }),
        ],
      }),
    );
    const servedRefs = out.trips.flatMap((t) => t.stops.flatMap((s) => s.orderRefs));
    expect(servedRefs).toContain("SKIPPED");
    expect(out.deferred.map((d) => d.orderRef)).toEqual(["FRESH_TODAY"]);
  });

  /**
   * The swap only fires when a previously-skipped order is reached too late to
   * find space of its own. Constrained goods are placed first, so a routine
   * CHILLED order gets on board before a skipped AMBIENT one is even tried —
   * and the repair pass then has to take the space back.
   */
  it("takes a place back for an outlet that was skipped yesterday", () => {
    const out = allocate(
      input({
        outlets: [outlet("OUT001"), outlet("OUT002")],
        vehicles: [
          avail(vehicle("VEH001", { temp: "reefer", volumeCapM3: 10, weightCapKg: 4000 })),
        ],
        config: { maxTripsPerVehicle: 1 },
        orders: [
          order("CHI_ROUTINE", {
            outletId: "OUT001",
            tempRequirement: "chilled",
            volumeM3: 6,
            weightKg: 500,
            daysSinceLastServed: 1,
          }),
          order("AMB_SKIPPED", {
            outletId: "OUT002",
            tempRequirement: "ambient",
            volumeM3: 6,
            weightKg: 500,
            deferredYesterday: true,
            daysSinceLastServed: 4,
          }),
        ],
      }),
    );

    const served = out.trips.flatMap((t) => t.stops.flatMap((s) => s.orderRefs));
    expect(served).toEqual(["AMB_SKIPPED"]);
    expect(out.deferred).toHaveLength(1);
    expect(out.deferred[0].orderRef).toBe("CHI_ROUTINE");
    expect(out.deferred[0].reasonCode).toBe("YIELDED_TO_HIGHER_PRIORITY");
    expect(out.deferred[0].suggestion).toMatch(/already been skipped/);
  });
});

describe("explaining a deferral", () => {
  it("reports the closest vehicle and by how much it missed", () => {
    const out = allocate(
      input({
        outlets: [outlet("OUT001"), outlet("OUT002")],
        vehicles: [avail(vehicle("VEH001", { volumeCapM3: 10, weightCapKg: 9000 }))],
        config: { maxTripsPerVehicle: 1 },
        orders: [
          order("A", { outletId: "OUT001", volumeM3: 9 }),
          order("B", { outletId: "OUT002", volumeM3: 2 }),
        ],
      }),
    );
    const miss = out.deferred[0]?.nearMiss;
    expect(miss).toBeDefined();
    expect(miss!.vehicleId).toBe("VEH001");
    expect(miss!.unit).toBe("m3");
    expect(miss!.short).toBeCloseTo(1, 2);
  });
});

// ---------------------------------------------------------------------------
// The real peak-day scenario
// ---------------------------------------------------------------------------

const dataRoot = resolveDataRoot();

describe.skipIf(!dataRoot)("the organisers' S1 peak day", () => {
  it("produces a feasible plan that our own validator accepts", async () => {
    const { input: scenario } = await loadPeakDayScenario(dataRoot!);
    const out = allocate(scenario);

    expect(out.selfCheck).toEqual([]);
    expect(out.stats.orders).toBe(85);
    expect(out.stats.served + out.stats.deferred).toBe(85);
  });

  it("defers the order no vehicle can carry", async () => {
    const { input: scenario } = await loadPeakDayScenario(dataRoot!);
    const out = allocate(scenario);
    const impossible = out.deferred.find((d) => d.orderRef === "S1-078");
    expect(impossible).toBeDefined();
    expect(impossible!.reasonCode).toBe("ORDER_EXCEEDS_FLEET_CAPACITY");
  });

  /**
   * S1-083 is OUT074 in Puttalam: chilled, deferred yesterday, five days
   * unserved — the most deprived order in the scenario. Serving it costs 188
   * of a reefer's 270 pre-dawn minutes, roughly two Colombo orders' worth of
   * capacity. The policy says it goes anyway, and this test holds us to that.
   */
  it("serves the longest-waiting outlet even though it is expensive", async () => {
    const { input: scenario } = await loadPeakDayScenario(dataRoot!);
    const out = allocate(scenario);

    const served = new Set(
      out.trips.flatMap((t) => t.stops.flatMap((s) => s.orderRefs)),
    );
    expect(served.has("S1-083")).toBe(true);
  });

  it("spends the reefers on chilled goods rather than ambient", async () => {
    const { input: scenario } = await loadPeakDayScenario(dataRoot!);
    const out = allocate(scenario);
    const byRef = new Map(scenario.orders.map((o) => [o.ref, o]));
    const reefers = new Set(
      scenario.vehicles.filter((v) => v.temp === "reefer").map((v) => v.vehicleId),
    );

    for (const trip of out.trips) {
      if (!reefers.has(trip.vehicleId)) continue;
      const refs = trip.stops.flatMap((s) => s.orderRefs);
      const chilled = refs.filter(
        (r) => byRef.get(r)?.tempRequirement === "chilled",
      ).length;
      // Every reefer trip must justify itself with at least some chilled load.
      expect(chilled, `${trip.vehicleId} trip ${trip.tripNo}`).toBeGreaterThan(0);
    }
  });

  it("leaves no compatible capacity obviously unused", async () => {
    const { input: scenario } = await loadPeakDayScenario(dataRoot!);
    const out = allocate(scenario);

    // Nothing should be deferred for want of a trip slot while an ambient
    // truck sits completely idle — that would be plain waste rather than a
    // real constraint.
    const idleAmbientTrucks = scenario.vehicles.filter(
      (v) =>
        v.available &&
        v.temp === "ambient" &&
        v.type === "truck" &&
        !out.trips.some((t) => t.vehicleId === v.vehicleId),
    );
    const wasted = out.deferred.filter(
      (d) => d.reasonCode === "NO_TRIP_SLOT",
    );
    if (idleAmbientTrucks.length > 0) expect(wasted).toHaveLength(0);
  });
});
