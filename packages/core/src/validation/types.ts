/**
 * The shapes the validator works on.
 *
 * `PlanSnapshot` is a plain object with no Prisma types in it. That is
 * deliberate and it is the whole point of this module: the same
 * `validatePlan` runs server-side over database rows, client-side over the
 * plan board's in-memory state while the user is still dragging, inside the
 * allocator as a self-check, and in Vitest over hand-written fixtures.
 */

import type { AllowanceTable } from "../domain/tripTime";
import type { TravelMatrix } from "../domain/travel";
import type {
  ClockTime,
  DateOnly,
  DepotCode,
  DistrictTravel,
  OrderRef,
  OutletRef,
  TripNo,
  VehicleRef,
} from "../domain/types";
import { FRESH_DEADLINE, RELOAD_MIN } from "../domain/types";
import type { RuleCode } from "./codes";

export type Severity = "error" | "warning";

export interface Violation {
  code: RuleCode;
  severity: Severity;
  /** A sentence a dispatcher can read. Rendered verbatim in the UI. */
  message: string;
  vehicleId?: string;
  tripNo?: TripNo;
  orderRefs?: string[];
  outletIds?: string[];
  /** Populated for numeric breaches so the UI can show "1.4 m3 over". */
  metric?: { name: string; have: number; limit: number; unit: string };
  overridable: boolean;
}

export type VehicleDayStatus = "AVAILABLE" | "IN_WORKSHOP";

export interface FuelPosition {
  quotaL: number;
  /** Litres already committed on OTHER days of the same Mon-Sat week. */
  committedOtherDaysL: number;
}

export interface PlanConfig {
  predawnBudget: number;
  daytimeBudget: number;
  maxTripsPerVehicle: number;
  /**
   * The booklet only insists on Fresh and mall windows. Every outlet has a
   * window in the CSV, but enforcing all of them is stricter than the
   * organisers' own checker and would force extra deferrals, so non-Fresh
   * non-mall windows default to a warning.
   */
  enforceNonFreshWindows: "warn" | "error";
  /** Fuel is a weekly ledger against a daily plan, so it warns before it blocks. */
  enforceFuelQuota: "off" | "warn" | "error";
  /**
   * Fresh deliveries must arrive by this time whatever an outlet's own window
   * says; `null` switches the rule off. Checked only when road travel times are
   * supplied, because that is when arrival times are real.
   */
  freshDeadline: ClockTime | null;
  /** Minutes between a vehicle's first trip returning and its second leaving. */
  reloadMin: number;
}

export const DEFAULT_PLAN_CONFIG: PlanConfig = {
  predawnBudget: 270,
  daytimeBudget: 480,
  maxTripsPerVehicle: 2,
  enforceNonFreshWindows: "warn",
  enforceFuelQuota: "error",
  freshDeadline: FRESH_DEADLINE,
  reloadMin: RELOAD_MIN,
};

export interface StopSnapshot {
  seq: number;
  outletId: string;
  /** Orders delivered at this stop. An outlet may take more than one. */
  orderRefs: string[];
}

export interface TripSnapshot {
  vehicleId: string;
  tripNo: TripNo;
  stops: StopSnapshot[];
  /**
   * Planned departure. When absent the window rules are skipped, because
   * without a departure there are no arrival times to check. Trip time,
   * capacity and every structural rule still run.
   */
  departAt?: ClockTime;
}

export interface ReferenceData {
  vehicles: ReadonlyMap<string, VehicleRef>;
  outlets: ReadonlyMap<string, OutletRef>;
  districts: ReadonlyMap<string, DistrictTravel>;
  allowance: AllowanceTable;
  vehicleStatus: ReadonlyMap<string, VehicleDayStatus>;
  fuel: ReadonlyMap<string, FuelPosition>;
  /**
   * Road minutes and kilometres between the depot and every outlet. When
   * present, arrival times, windows, the Fresh deadline, a vehicle's turnaround
   * between trips and fuel are all judged on the road; when absent the
   * organisers' district table is used, exactly as before. Trip minutes against
   * the wave budgets always use the district table, because that is what their
   * checker measures.
   */
  travel?: TravelMatrix;
}

export interface DeferredSnapshot {
  orderRef: string;
  reasonCode?: string;
}

export interface PlanSnapshot {
  date: DateOnly;
  depot: DepotCode;
  config: PlanConfig;
  reference: ReferenceData;
  /** Every order that must receive a decision, keyed by `ref`. */
  orders: ReadonlyMap<string, OrderRef>;
  trips: TripSnapshot[];
  deferred: DeferredSnapshot[];
  /** Order refs with a loading shortfall still awaiting a dispatcher decision. */
  openShortfallOrderRefs?: string[];
}

export interface ValidateOptions {
  /** Restrict to a subset of rules — used for fast feedback during a drag. */
  only?: readonly RuleCode[];
  /**
   * Publish-time rules (every order decided, deferrals reasoned, shortfalls
   * resolved) are noise on a half-built draft, so they are opt-in.
   */
  stage?: "draft" | "publish";
}
