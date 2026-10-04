/**
 * The allocator's mutable working state, shared by its phases.
 *
 * `allocate()` is pure from the outside, but building a plan is incremental:
 * trips are opened, stops are inserted, orders swap places. That state lives in
 * one `Context`, created per call and never shared, so the modules that grow or
 * check a plan (`feasibility`, `construct`, `output`) can be separate files
 * without any of them holding hidden state of their own.
 */

import type { RoadSchedule } from "@katapatha/core/domain/roadSchedule";
import type { TravelMatrix } from "@katapatha/core/domain/travel";
import type { AllowanceTable } from "@katapatha/core/domain/tripTime";
import {
  TOLERANCE,
  type Brand,
  type ClockTime,
  type DistrictTravel,
  type DockType,
  type OrderRef,
  type OutletRef,
  type TripNo,
  type Wave,
} from "@katapatha/core/domain/types";
import type { RejectionLedger } from "./rejection";
import type { AllocatorConfig, AllocatorInput, AllocatorVehicle } from "./types";

/** One outlet on a trip, with every order for it on that trip. */
export interface StopBuild {
  outletId: string;
  orders: OrderRef[];
}

export interface TripBuild {
  /** Creation order; a stable name for the trip while `tripNo` is still undecided. */
  id: number;
  vehicle: AllocatorVehicle;
  /** 1 or 2, assigned from the actual departure order once the plan is built. */
  tripNo: TripNo;
  brand: Brand;
  district: string;
  wave: Wave;
  travel: DistrictTravel;
  /** In the order the vehicle visits them. The order is part of the plan. */
  stops: StopBuild[];
  /** The organisers' trip minutes, against the wave budget. */
  minutes: number;
  fuelL: number;
  roadKm: number;
  volumeM3: number;
  weightKg: number;
  /** The latest minute this trip may leave and still make every stop. */
  latestDepartMin: number;
  departAt: ClockTime;
  road: RoadSchedule;
}

export interface VehicleState {
  vehicle: AllocatorVehicle;
  quotaL: number;
  committedOtherDaysL: number;
}

export interface Context {
  input: AllocatorInput;
  config: AllocatorConfig;
  ledger: RejectionLedger;
  matrix: TravelMatrix;
  outlets: ReadonlyMap<string, OutletRef>;
  districts: ReadonlyMap<string, DistrictTravel>;
  allowance: AllowanceTable;
  vehicleState: Map<string, VehicleState>;
  trips: TripBuild[];
  /** Next trip id. Trips can be removed by the improvement pass, so the count of trips is not an id. */
  nextTripId: number;
  /** Candidate trips checked so far; the improvement budget is counted in these. */
  evaluations: number;
}

/** `a > b` with the organisers' slack, so exactly-at-cap fits. */
export const over = (have: number, limit: number): boolean => have > limit + TOLERANCE;

export const ordersOf = (trip: { stops: readonly StopBuild[] }): OrderRef[] => trip.stops.flatMap((s) => s.orders);

export function dockOf(ctx: Context, outletId: string): DockType | null {
  return ctx.outlets.get(outletId)?.dockType ?? null;
}

/** A vehicle's trips, optionally leaving one out (the one being replaced). */
export function tripsOf(ctx: Context, vehicleId: string, except?: TripBuild | null): TripBuild[] {
  return ctx.trips.filter((t) => t.vehicle.vehicleId === vehicleId && t !== except);
}

export const waveStart = (config: AllocatorConfig, wave: Wave): ClockTime =>
  wave === "PREDAWN" ? config.predawnStart : config.daytimeStart;

export const waveEnd = (config: AllocatorConfig, wave: Wave): ClockTime =>
  wave === "PREDAWN" ? config.predawnEnd : config.daytimeEnd;

export const waveBudget = (config: AllocatorConfig, wave: Wave): number =>
  wave === "PREDAWN" ? config.predawnBudget : config.daytimeBudget;

export function round(n: number, dp = 2): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}
