import { buildTravelMatrix, depotKey, outletKey } from "@katapatha/core/domain/travel";
import { DISTRICT_POSITIONS, estimateLeg, syntheticOutletPosition } from "@katapatha/core/domain/geography";
import { order, outlet, vehicle } from "@katapatha/core/validation/fixtures";
import type { OrderRef, OutletRef } from "@katapatha/core/domain/types";
import type { AllocatorVehicle } from "./types";

/**
 * A randomised day on real geometry, for tests: outlets scattered round three
 * districts, legs estimated from straight-line distance, a small mixed fleet.
 * The same seed gives the same day. `orders` and `extraVehicles` make it bigger,
 * which is where routing choices start to matter.
 */

const avail = (v: ReturnType<typeof vehicle>): AllocatorVehicle => ({ ...v, available: true });

/** Outlets scattered round Colombo; legs estimated from straight-line distance. */
export function scene(seed: number, size: { orders?: number; extraVehicles?: number } = {}) {
  let s = seed;
  const rand = () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
  const districts = ["Colombo", "Gampaha", "Puttalam"];
  const brands = ["Fresh", "Style", "Tech"] as const;
  const outlets: OutletRef[] = [];
  const orders: OrderRef[] = [];
  const n = size.orders ?? 4 + Math.floor(rand() * 10);
  for (let i = 0; i < n; i++) {
    const brand = brands[Math.floor(rand() * 3)]!;
    const district = districts[Math.floor(rand() * 3)]!;
    const id = `OUT${100 + i}`;
    outlets.push(
      outlet(id, {
        brand,
        district,
        dockType: rand() < 0.5 ? "rear_dock" : "street",
        parkingConstraint: rand() < 0.2 ? "van_only" : "normal",
        windowOpen: brand === "Fresh" ? "05:00" : "09:00",
        windowClose: brand === "Fresh" ? "07:30" : "17:00",
      }),
    );
    orders.push(
      order(`O${seed}-${i}`, {
        outletId: id,
        brand,
        district,
        tempRequirement: rand() < 0.3 ? "chilled" : rand() < 0.15 ? "frozen" : "ambient",
        volumeM3: Number((rand() * 8).toFixed(2)),
        weightKg: Number((rand() * 1500).toFixed(1)),
        deferredYesterday: rand() < 0.2,
        daysSinceLastServed: 1 + Math.floor(rand() * 5),
      }),
    );
  }
  const depot = { lat: 6.9689, lng: 79.8936 };
  const at = new Map(
    outlets.map((o) => [outletKey(o.outletId), syntheticOutletPosition(o.outletId, DISTRICT_POSITIONS[o.district]!, "suburban")] as const),
  );
  const travel = buildTravelMatrix(
    [depotKey("Peliyagoda"), ...at.keys()],
    (a, b) => estimateLeg(a.startsWith("depot:") ? depot : at.get(a)!, b.startsWith("depot:") ? depot : at.get(b)!, "suburban", 40),
    "estimate",
  );
  const vehicles = [
    avail(vehicle("VEH001", { temp: "reefer" })),
    avail(vehicle("VEH002", { temp: "ambient", volumeCapM3: 38, weightCapKg: 7200 })),
    avail(vehicle("VEH003", { type: "van", temp: "reefer", volumeCapM3: 7, weightCapKg: 1040 })),
    avail(vehicle("VEH004", { type: "van", temp: "ambient", volumeCapM3: 7, weightCapKg: 1040 })),
    ...Array.from({ length: size.extraVehicles ?? 0 }, (_, i) =>
      avail(vehicle(`VEH1${String(i).padStart(2, "0")}`, i % 3 === 0 ? { temp: "reefer" } : { temp: "ambient", volumeCapM3: 38, weightCapKg: 7200 })),
    ),
  ];
  return { orders, outlets, vehicles, travel };
}
