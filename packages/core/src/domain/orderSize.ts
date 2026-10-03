/**
 * Will an order physically fit a vehicle, and if not, how to raise it instead.
 *
 * Rule 5 says an order travels whole, on one vehicle and one trip, so an
 * order bigger than every vehicle that may carry it can never be planned on
 * any day. The allocator only discovers that the morning it plans. This lets
 * the store see it while ordering and raise it as several orders — which is
 * the store's call to make, not a split by dispatch.
 */

export interface FleetVehicle {
  type: "truck" | "van";
  temp: "reefer" | "ambient";
  volumeCapM3: number;
  weightCapKg: number;
}

export interface OrderNeed {
  tempRequirement: "chilled" | "ambient";
  /** The outlet can only be reached by a van (parking constraint `van_only`). */
  vanOnly: boolean;
}

export interface UnitSize {
  m3PerUnit: number;
  kgPerUnit: number;
}

/** The vehicles allowed to carry this order at all — the allocator's own tests. */
export function compatibleVehicles<V extends FleetVehicle>(vehicles: readonly V[], need: OrderNeed): V[] {
  return vehicles.filter(
    (v) => (need.tempRequirement !== "chilled" || v.temp === "reefer") && (!need.vanOnly || v.type === "van"),
  );
}

/**
 * The most units one order can hold and still fit the roomiest compatible
 * vehicle, by both volume and weight. Zero when no vehicle can carry it.
 */
export function maxUnitsPerOrder(vehicles: readonly FleetVehicle[], need: OrderNeed, size: UnitSize): number {
  let best = 0;
  for (const v of compatibleVehicles(vehicles, need)) {
    const byVolume = size.m3PerUnit > 0 ? v.volumeCapM3 / size.m3PerUnit : Infinity;
    const byWeight = size.kgPerUnit > 0 ? v.weightCapKg / size.kgPerUnit : Infinity;
    // A hair of tolerance so 34.0 m³ of goods on a 34 m³ truck isn't rounded out.
    best = Math.max(best, Math.floor(Math.min(byVolume, byWeight) + 1e-9));
  }
  return Number.isFinite(best) ? best : 0;
}

/**
 * Units split into as few orders as fit, as evenly as possible — 400 units at
 * a 302-unit limit is 200 + 200, not 302 + 98, so neither order sits at the
 * edge of a vehicle. Returns `[units]` when it already fits, and `[]` when no
 * vehicle can carry even one unit.
 */
export function splitUnits(units: number, maxPerOrder: number): number[] {
  if (units <= 0) return [];
  if (maxPerOrder <= 0) return [];
  const parts = Math.ceil(units / maxPerOrder);
  const base = Math.floor(units / parts);
  const extra = units % parts;
  return Array.from({ length: parts }, (_, i) => base + (i < extra ? 1 : 0));
}
