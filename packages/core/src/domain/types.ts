/**
 * The vocabulary of the Waypoint delivery network.
 *
 * Every string union here matches a value that actually appears in the
 * competition CSVs. Two distinctions are easy to conflate and are kept
 * deliberately separate:
 *
 *   - an ORDER is `chilled` or `ambient`   (`temp_requirement`)
 *   - a VEHICLE is `reefer` or `ambient`   (`temp`)
 *
 * A reefer may carry either kind of order; an ambient vehicle may not carry
 * chilled. Mixing the two vocabularies is the single most common way to get
 * rule 2 wrong.
 */

export type Brand = "Fresh" | "Style" | "Tech";
export type TempRequirement = "chilled" | "ambient";
export type VehicleTemp = "reefer" | "ambient";
export type VehicleType = "truck" | "van";
export type DockType = "rear_dock" | "street" | "mall_bay";
export type ParkingConstraint = "normal" | "van_only" | "mall_dock";
export type DepotCode = "Peliyagoda" | "Kandy";

/** A vehicle runs at most two trips a day; the organisers' CSV calls it `trip_id`. */
export type TripNo = 1 | 2;

/**
 * The two operating windows. They carry *separate* time budgets against the
 * same vehicle, which is what makes the three brands compete: a vehicle may run
 * one Fresh trip and one Style trip, but never three trips of anything.
 */
export type Wave = "PREDAWN" | "DAYTIME";

/** `"HH:MM"`, Asia/Colombo. Never a Date — the datasets have no timezone. */
export type ClockTime = string;

/** `"YYYY-MM-DD"`. */
export type DateOnly = string;

// ---------------------------------------------------------------------------
// Reference shapes — the read-mostly data the planner reasons over.
// ---------------------------------------------------------------------------

export interface OutletRef {
  outletId: string;
  brand: Brand;
  district: string;
  depot: DepotCode;
  dockType: DockType;
  parkingConstraint: ParkingConstraint;
  /** Populated only for mall outlets; blank for the other 108. */
  mallWindowOpen: ClockTime | null;
  mallWindowClose: ClockTime | null;
  windowOpen: ClockTime;
  windowClose: ClockTime;
}

export interface VehicleRef {
  vehicleId: string;
  type: VehicleType;
  temp: VehicleTemp;
  weightCapKg: number;
  volumeCapM3: number;
  kmPerL: number;
  weeklyFuelQuotaL: number;
  depot: DepotCode;
}

/**
 * One row per district. Each district belongs to exactly one depot, so depot
 * assignment is a lookup and never a decision.
 */
export interface DistrictTravel {
  district: string;
  depot: DepotCode;
  roadClass: "urban" | "suburban" | "highway" | "hill";
  freeFlowKmh: number;
  depotToDistrictKm: number;
  depotToDistrictFreeflowMin: number;
  interStopKm: number;
  interStopFreeflowMin: number;
}

export interface OrderRef {
  /** Stable identifier used as the allocation key. */
  ref: string;
  outletId: string;
  brand: Brand;
  district: string;
  depot: DepotCode;
  tempRequirement: TempRequirement;
  units: number;
  weightKg: number;
  volumeM3: number;
  windowOpen: ClockTime;
  windowClose: ClockTime;
  /** Fairness signals. Present in the peak-day scenario; derived elsewhere. */
  deferredYesterday: boolean;
  daysSinceLastServed: number;
}

// ---------------------------------------------------------------------------
// Operating constants — all four are load-bearing and all four come from the
// booklet (pp.20-21) and `check_allocation.py`.
// ---------------------------------------------------------------------------

/** Fresh trips, 03:30-08:00. Summed across all of a vehicle's Fresh trips. */
export const TRIP_BUDGET_PREDAWN = 270;

/** Style and Tech trips combined, across the trading day. */
export const TRIP_BUDGET_DAYTIME = 480;

export const MAX_TRIPS_PER_VEHICLE = 2;

/**
 * The organisers' checker compares with a 1e-6 slack, so a trip of exactly
 * 270.0 minutes passes and 270.000001 fails. We match that exactly, because a
 * plan that passes here must pass there.
 */
export const TOLERANCE = 1e-6;

export const PREDAWN_START: ClockTime = "03:30";
export const PREDAWN_END: ClockTime = "08:00";
export const DAYTIME_START: ClockTime = "08:30";

/** Orders placed after this roll to the following run. */
export const ORDER_CUTOFF: ClockTime = "16:00";

/** A projected arrival within this many minutes of window close is "at risk". */
export const RISK_MARGIN_MIN = 15;

/** Which wave a brand's trips are charged against. */
export function waveForBrand(brand: Brand): Wave {
  return brand === "Fresh" ? "PREDAWN" : "DAYTIME";
}

export function budgetForWave(wave: Wave): number {
  return wave === "PREDAWN" ? TRIP_BUDGET_PREDAWN : TRIP_BUDGET_DAYTIME;
}
