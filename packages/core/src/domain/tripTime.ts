/**
 * The published planning standard for trip duration (Challenge Booklet p.20-21).
 *
 *   trip_minutes = depot_to_district_freeflow_min
 *                + (n_orders - 1) * inter_stop_freeflow_min
 *                + SUM service_allowance[(brand, dock_type)]
 *
 * Three details are easy to get wrong and all three are load-bearing:
 *
 *  1. Handling is charged PER ORDER, not per outlet. An outlet with two orders
 *     on the same trip pays its allowance twice. `check_allocation.py` builds
 *     its dock list from `list(t.dock_type)` over order rows, so it does the
 *     same, and a per-outlet reading would under-count every multi-order stop.
 *
 *  2. There is no return leg. The booklet is explicit: "Do not add the return
 *     journey to the depot; the stated budgets already allow for it."
 *
 *  3. It is free-flow only. `traffic_speed.csv` and `road_conditions.csv` are
 *     deliberately NOT applied here — they belong to live ETA, which is a
 *     separate model. Mixing them in would make our plans disagree with the
 *     organisers' checker.
 *
 * A consequence worth stating plainly, because it surprises people: this
 * formula has no per-outlet geography, so RESEQUENCING A TRIP'S STOPS CHANGES
 * ITS DURATION BY EXACTLY ZERO. Sequence governs loading order (LIFO) and
 * window feasibility, nothing else. The UI says so on screen.
 */

import type { Brand, DistrictTravel, DockType } from "./types";

/** Keyed `${brand}|${dockType}` — nine entries, one per brand x dock combination. */
export type AllowanceTable = ReadonlyMap<string, number>;

export function allowanceKey(brand: Brand, dock: DockType): string {
  return `${brand}|${dock}`;
}

export function lookupAllowance(
  allowance: AllowanceTable,
  brand: Brand,
  dock: DockType,
): number {
  const v = allowance.get(allowanceKey(brand, dock));
  if (v === undefined) {
    throw new Error(`No service allowance for ${brand} at a ${dock}`);
  }
  return v;
}

/**
 * Planned duration of one trip.
 *
 * @param travel   the trip's district row from `district_travel.csv`
 * @param brand    the trip's single brand (rule 1 guarantees there is only one)
 * @param docks    one entry per ORDER on the trip, in any order
 */
export function tripMinutes(
  travel: DistrictTravel,
  brand: Brand,
  docks: readonly DockType[],
  allowance: AllowanceTable,
): number {
  const n = docks.length;
  if (n === 0) return 0;

  const outbound = travel.depotToDistrictFreeflowMin;
  const betweenStops = (n - 1) * travel.interStopFreeflowMin;
  const handling = docks.reduce(
    (sum, dock) => sum + lookupAllowance(allowance, brand, dock),
    0,
  );

  return outbound + betweenStops + handling;
}

/** The three components separately, for the trip-time breakdown in the UI. */
export interface TripTimeBreakdown {
  outboundMin: number;
  interStopMin: number;
  handlingMin: number;
  totalMin: number;
  stopCount: number;
}

export function tripTimeBreakdown(
  travel: DistrictTravel,
  brand: Brand,
  docks: readonly DockType[],
  allowance: AllowanceTable,
): TripTimeBreakdown {
  const n = docks.length;
  if (n === 0) {
    return { outboundMin: 0, interStopMin: 0, handlingMin: 0, totalMin: 0, stopCount: 0 };
  }
  const outboundMin = travel.depotToDistrictFreeflowMin;
  const interStopMin = (n - 1) * travel.interStopFreeflowMin;
  const handlingMin = docks.reduce(
    (sum, dock) => sum + lookupAllowance(allowance, brand, dock),
    0,
  );
  return {
    outboundMin,
    interStopMin,
    handlingMin,
    totalMin: outboundMin + interStopMin + handlingMin,
    stopCount: n,
  };
}

/**
 * Round-trip distance for a trip, used for the weekly fuel ledger. Unlike the
 * time standard this DOES include the return leg, because the vehicle really
 * does drive home and really does burn the fuel.
 */
export function tripDistanceKm(travel: DistrictTravel, orderCount: number): number {
  if (orderCount === 0) return 0;
  return 2 * travel.depotToDistrictKm + (orderCount - 1) * travel.interStopKm;
}

export function tripFuelLitres(
  travel: DistrictTravel,
  orderCount: number,
  kmPerL: number,
): number {
  if (kmPerL <= 0) throw new Error("kmPerL must be positive");
  return tripDistanceKm(travel, orderCount) / kmPerL;
}
