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
import type { TravelMatrix, TravelSource } from "@katapatha/core/domain/travel";
import { FRESH_DEADLINE, RELOAD_MIN } from "@katapatha/core/domain/types";
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
  /** Minutes between a vehicle's first trip returning and its second leaving. */
  reloadMin: number;
  /** Fresh trips must reach every stop by this time; `null` switches the rule off. */
  freshDeadline: ClockTime | null;
  /**
   * How hard the improvement pass tries. The budget is counted in feasibility
   * evaluations, never in time, so the same input gives the same plan on a fast
   * machine and a slow one. `maxRounds: 0` plans with construction alone.
   */
  localSearch: { maxRounds: number; maxEvaluations: number };
  objective: ObjectiveWeights;
}

/**
 * What the improvement pass minimises. The serve weight is so much larger than
 * the rest that the ordering is effectively lexicographic: serve as many
 * priority-weighted orders as possible, then drive as few kilometres as
 * possible (which is also the fuel), then use fewer trips, then wait less, then
 * waste fewer reefers and vans on work any vehicle could do.
 */
export interface ObjectiveWeights {
  /** Per served order, scaled by its priority: 1 + score / 1000. */
  wServe: number;
  /** Per road kilometre, the way home included. */
  lambdaKm: number;
  /** Per trip. A trip costs a whole outbound leg that consolidation saves. */
  lambdaTrip: number;
  /** Per minute spent waiting at an outlet for its window to open. */
  lambdaWait: number;
  /** Per order on a vehicle too capable for it (see `scarcity`). */
  lambdaScarce: number;
}

export const DEFAULT_OBJECTIVE: ObjectiveWeights = {
  wServe: 1e6,
  lambdaKm: 1,
  lambdaTrip: 25,
  lambdaWait: 0.05,
  lambdaScarce: 40,
};

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
  reloadMin: RELOAD_MIN,
  freshDeadline: FRESH_DEADLINE,
  localSearch: { maxRounds: 8, maxEvaluations: 200_000 },
  objective: DEFAULT_OBJECTIVE,
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
  /**
   * Road minutes and kilometres between the depot and every outlet. The
   * allocator never fetches this: it is handed in, so the allocator stays pure
   * and a plan can be reproduced from its inputs. Without it (or when it does
   * not cover every outlet in the queue) the organisers' district table is
   * turned into legs and used instead, and the output says it is an estimate.
   */
  travel?: TravelMatrix;
  config?: AllocatorOverrides;
}

/** Any setting may be overridden, and the nested ones may be overridden in part. */
export type AllocatorOverrides = Partial<Omit<AllocatorConfig, "localSearch" | "objective">> & {
  localSearch?: Partial<AllocatorConfig["localSearch"]>;
  objective?: Partial<ObjectiveWeights>;
};

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
  | "NO_COMMON_WINDOW"
  | "FRESH_DEADLINE_UNREACHABLE"
  | "OUTLET_UNREACHABLE_IN_WINDOW"
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
  | "TRIP_SEQUENCE_CONFLICT"
  // Given up for a higher-priority order in the same lane.
  | "YIELDED_TO_HIGHER_PRIORITY";

/** Codes that no amount of re-planning today could fix. */
export const PERMANENT_CODES: ReadonlySet<RejectionCode> = new Set<RejectionCode>([
  "ORDER_EXCEEDS_FLEET_CAPACITY",
  "NO_REEFER_IN_FLEET",
  "NO_VAN_IN_FLEET",
  "DISTRICT_UNREACHABLE_IN_BUDGET",
  "NO_COMMON_WINDOW",
  "FRESH_DEADLINE_UNREACHABLE",
  "OUTLET_UNREACHABLE_IN_WINDOW",
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
  /** When unloading begins: the arrival, or the window opening if that is later. */
  serviceStart: ClockTime;
  leave: ClockTime;
  /** Road distance and time of the leg that reaches this stop. */
  legKm: number;
  legMinutes: number;
}

export interface AllocatedTrip {
  vehicleId: string;
  tripNo: TripNo;
  brand: Brand;
  district: string;
  wave: Wave;
  departAt: ClockTime;
  /** The organisers' trip minutes, against the wave budget. Not the road time. */
  minutes: number;
  /** Road distance, depot to depot, the way home included. */
  distanceKm: number;
  /** Litres for that distance on this vehicle. */
  fuelL: number;
  volumeM3: number;
  weightKg: number;
  /** Wall-clock minutes on the road, departure to return, waiting included. */
  roadMinutes: number;
  /** When the vehicle is back at the depot. */
  returnAt: ClockTime;
  /** Whether the legs came from the road network or the district table. */
  travelSource: TravelSource;
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

/** The objective's parts for a plan, so the figure is explained and not merely stated. */
export interface ObjectiveBreakdown {
  /** The value minimised; lower is better. */
  value: number;
  /** Sum over served orders of 1 + priority / 1000. */
  servedWeight: number;
  roadKm: number;
  trips: number;
  waitMin: number;
  scarcity: number;
}

/** What the improvement pass did, for the record. */
export interface SearchSummary {
  rounds: number;
  /** Candidate trips checked. The budget is counted in these. */
  evaluations: number;
  /** How many times each kind of move was applied. */
  moves: Record<string, number>;
  /** The plan as construction left it, and after improvement. */
  before: ObjectiveBreakdown;
  after: ObjectiveBreakdown;
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
  /** What the plan's distances and times are made of. */
  travelSource: TravelSource;
  /** What the improvement pass did and what it bought. */
  search: SearchSummary;
}
