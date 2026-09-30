/**
 * The allocator's contract.
 *
 * `allocate()` is a pure function: no Prisma, no I/O, no `Date.now()`, no
 * randomness. Every tie is broken by identifier, so the same input always
 * produces byte-identical output — which is what makes `stats.hash` a usable
 * regression test and what lets a dispatcher re-run auto-plan without the
 * board shuffling underneath them.
 */

import type { AllowanceTable } from "@katapatha/core/domain/tripTime";
import type {
  Brand,
  ClockTime,
  DateOnly,
  DepotCode,
  DistrictTravel,
  OrderRef,
  OutletRef,
  TripNo,
  VehicleRef,
  Wave,
} from "@katapatha/core/domain/types";
import type { Violation } from "@katapatha/core/validation/types";

/** A vehicle plus whether it can be used on the day being planned. */
export interface AllocatorVehicle extends VehicleRef {
  available: boolean;
}

export interface FuelPosition {
  quotaL: number;
  committedOtherDaysL: number;
}

export interface AllocatorConfig {
  predawnBudget: number;
  daytimeBudget: number;
  maxTripsPerVehicle: number;
  predawnStart: ClockTime;
  predawnEnd: ClockTime;
  daytimeStart: ClockTime;
  daytimeEnd: ClockTime;
  /** Off, or a ceiling the allocator refuses to cross when choosing a vehicle. */
  enforceFuelQuota: boolean;
  /** Whether to try the fairness swap in the repair pass. */
  enableFairnessSwap: boolean;
}

export const DEFAULT_ALLOCATOR_CONFIG: AllocatorConfig = {
  predawnBudget: 270,
  daytimeBudget: 480,
  maxTripsPerVehicle: 2,
  predawnStart: "03:30",
  predawnEnd: "08:00",
  daytimeStart: "08:30",
  daytimeEnd: "18:00",
  enforceFuelQuota: true,
  enableFairnessSwap: true,
};

export interface AllocatorInput {
  date: DateOnly;
  depot: DepotCode;
  orders: OrderRef[];
  vehicles: AllocatorVehicle[];
  outlets: ReadonlyMap<string, OutletRef>;
  districts: ReadonlyMap<string, DistrictTravel>;
  allowance: AllowanceTable;
  fuel: ReadonlyMap<string, FuelPosition>;
  config?: Partial<AllocatorConfig>;
}

// ---------------------------------------------------------------------------
// Why an order could not be placed.
// ---------------------------------------------------------------------------

/**
 * The reason a particular vehicle could not take a particular order.
 *
 * Most map onto a rule code, but three are allocator-specific: they describe
 * the fleet being *exhausted* rather than a rule being broken. "No reefer is
 * free" is a different sentence from "you put chilled goods on a dry truck",
 * and a dispatcher explaining the day to three brand managers needs the first.
 */
export type RejectionCode =
  // Permanent — no plan on any day could serve this order as it stands.
  | "ORDER_EXCEEDS_FLEET_CAPACITY"
  | "NO_REEFER_IN_FLEET"
  | "NO_VAN_IN_FLEET"
  | "DISTRICT_UNREACHABLE_IN_BUDGET"
  // Competitive — the fleet ran out today.
  | "NO_REEFER_AVAILABLE"
  | "NO_VAN_AVAILABLE"
  | "VEHICLE_IN_WORKSHOP"
  | "WRONG_DEPOT"
  | "VOLUME_CAP_EXCEEDED"
  | "WEIGHT_CAP_EXCEEDED"
  | "NO_TRIP_SLOT"
  | "PREDAWN_BUDGET_EXCEEDED"
  | "DAYTIME_BUDGET_EXCEEDED"
  | "FUEL_QUOTA_EXCEEDED"
  | "WINDOW_UNREACHABLE"
  // Given up for a higher-priority order in the same lane.
  | "YIELDED_TO_HIGHER_PRIORITY";

/** Codes that no amount of re-planning today could fix. */
export const PERMANENT_CODES: ReadonlySet<RejectionCode> = new Set<RejectionCode>([
  "ORDER_EXCEEDS_FLEET_CAPACITY",
  "NO_REEFER_IN_FLEET",
  "NO_VAN_IN_FLEET",
  "DISTRICT_UNREACHABLE_IN_BUDGET",
]);

export interface RejectionMetric {
  name: string;
  have: number;
  limit: number;
  unit: string;
}

export interface Rejection {
  code: RejectionCode;
  vehicleId?: string;
  metric?: RejectionMetric;
}

/** One line of the "why" a deferral screen shows. */
export interface ExplanationLine {
  code: RejectionCode;
  /** How many candidate vehicles failed for this reason. */
  count: number;
  sample?: string;
}

export interface NearMiss {
  vehicleId: string;
  metric: RejectionMetric;
  /** How much was missing — 1.4 m3, 56 kg, 12 min. */
  short: number;
  unit: string;
}

export interface DeferredOrder {
  orderRef: string;
  outletId: string;
  brand: Brand;
  district: string;
  /** The dominant binding constraint across every candidate vehicle. */
  reasonCode: RejectionCode;
  permanent: boolean;
  explanation: ExplanationLine[];
  nearMiss?: NearMiss;
  /** Plain-language next step, e.g. "fits if VEH003 returns from the workshop". */
  suggestion?: string;
}

// ---------------------------------------------------------------------------
// What the allocator produces.
// ---------------------------------------------------------------------------

export interface AllocatedStop {
  seq: number;
  outletId: string;
  orderRefs: string[];
  plannedArrival: ClockTime;
}

export interface AllocatedTrip {
  vehicleId: string;
  tripNo: TripNo;
  brand: Brand;
  district: string;
  wave: Wave;
  departAt: ClockTime;
  minutes: number;
  distanceKm: number;
  fuelL: number;
  volumeM3: number;
  weightKg: number;
  stops: AllocatedStop[];
}

export interface VehicleMeter {
  vehicleId: string;
  tripsUsed: number;
  predawnUsedMin: number;
  predawnBudgetMin: number;
  daytimeUsedMin: number;
  daytimeBudgetMin: number;
  fuelCommittedL: number;
  fuelQuotaL: number;
}

export interface AllocatorStats {
  orders: number;
  served: number;
  deferred: number;
  tripsBuilt: number;
  /** Stable fingerprint of the allocation, for the determinism test. */
  hash: string;
}

export interface AllocatorOutput {
  trips: AllocatedTrip[];
  deferred: DeferredOrder[];
  meters: VehicleMeter[];
  /**
   * The shared validator run over our own output. It must contain no errors —
   * that is the guarantee that auto-plan output is always feasible. Warnings
   * are legitimate: `HIGH_PRIORITY_DEFERRED` fires whenever the day genuinely
   * forces a twice-skipped outlet, and silencing it would hide the thing a
   * dispatcher most needs to see.
   */
  selfCheck: Violation[];
  stats: AllocatorStats;
}
