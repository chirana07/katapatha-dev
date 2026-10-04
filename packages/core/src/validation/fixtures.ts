/**
 * Hand-built reference data for the rule tests.
 *
 * The numbers are taken from the real CSVs so the fixtures stay honest:
 * Colombo and Puttalam travel rows, the real Fresh/Style/Tech allowance grid,
 * and vehicle capacities that exist in the fleet. Tests that need the full
 * dataset read it directly and skip when it is absent.
 */

import { allowanceKey } from "../domain/tripTime";
import type {
  Brand,
  DistrictTravel,
  DockType,
  OrderRef,
  OutletRef,
  TempRequirement,
  VehicleRef,
} from "../domain/types";
import type { TravelMatrix } from "../domain/travel";
import { DEFAULT_PLAN_CONFIG } from "./types";
import type { FuelPosition, PlanSnapshot, TripSnapshot, VehicleDayStatus } from "./types";

/** The real nine-cell grid from `service_allowance.csv`. */
export const ALLOWANCE = new Map<string, number>([
  [allowanceKey("Fresh", "rear_dock"), 15],
  [allowanceKey("Fresh", "street"), 16],
  [allowanceKey("Fresh", "mall_bay"), 18],
  [allowanceKey("Style", "rear_dock"), 38],
  [allowanceKey("Style", "street"), 46],
  [allowanceKey("Style", "mall_bay"), 59],
  [allowanceKey("Tech", "rear_dock"), 43],
  [allowanceKey("Tech", "street"), 55],
  [allowanceKey("Tech", "mall_bay"), 55],
]);

/** Real rows from `district_travel.csv`. */
export const DISTRICTS = new Map<string, DistrictTravel>([
  [
    "Colombo",
    {
      district: "Colombo",
      depot: "Peliyagoda",
      roadClass: "urban",
      freeFlowKmh: 30,
      depotToDistrictKm: 12,
      depotToDistrictFreeflowMin: 24,
      interStopKm: 4,
      interStopFreeflowMin: 8,
    },
  ],
  [
    "Gampaha",
    {
      district: "Gampaha",
      depot: "Peliyagoda",
      roadClass: "suburban",
      freeFlowKmh: 45,
      depotToDistrictKm: 28,
      depotToDistrictFreeflowMin: 37,
      interStopKm: 7,
      interStopFreeflowMin: 9,
    },
  ],
  [
    "Puttalam",
    {
      district: "Puttalam",
      depot: "Peliyagoda",
      roadClass: "suburban",
      freeFlowKmh: 45,
      depotToDistrictKm: 130,
      depotToDistrictFreeflowMin: 173,
      interStopKm: 18,
      interStopFreeflowMin: 24,
    },
  ],
  [
    "Kandy",
    {
      district: "Kandy",
      depot: "Kandy",
      roadClass: "urban",
      freeFlowKmh: 30,
      depotToDistrictKm: 8,
      depotToDistrictFreeflowMin: 16,
      interStopKm: 3,
      interStopFreeflowMin: 6,
    },
  ],
]);

export function outlet(
  outletId: string,
  over: Partial<OutletRef> = {},
): OutletRef {
  return {
    outletId,
    brand: "Fresh",
    district: "Colombo",
    depot: "Peliyagoda",
    dockType: "rear_dock",
    parkingConstraint: "normal",
    mallWindowOpen: null,
    mallWindowClose: null,
    windowOpen: "05:00",
    windowClose: "07:30",
    ...over,
  };
}

export function vehicle(vehicleId: string, over: Partial<VehicleRef> = {}): VehicleRef {
  return {
    vehicleId,
    type: "truck",
    temp: "reefer",
    weightCapKg: 5510,
    volumeCapM3: 26.4,
    kmPerL: 4.7,
    weeklyFuelQuotaL: 340,
    depot: "Peliyagoda",
    ...over,
  };
}

export function order(ref: string, over: Partial<OrderRef> = {}): OrderRef {
  return {
    ref,
    outletId: "OUT001",
    brand: "Fresh",
    district: "Colombo",
    depot: "Peliyagoda",
    tempRequirement: "ambient" as TempRequirement,
    units: 10,
    weightKg: 100,
    volumeM3: 1,
    windowOpen: "05:00",
    windowClose: "07:30",
    deferredYesterday: false,
    daysSinceLastServed: 1,
    ...over,
  };
}

export function trip(
  vehicleId: string,
  tripNo: 1 | 2,
  stops: { outletId: string; orderRefs: string[] }[],
  departAt?: string,
): TripSnapshot {
  return {
    vehicleId,
    tripNo,
    departAt,
    stops: stops.map((s, i) => ({ seq: i, ...s })),
  };
}

export interface SnapshotParts {
  outlets?: OutletRef[];
  vehicles?: VehicleRef[];
  orders?: OrderRef[];
  trips?: TripSnapshot[];
  deferred?: { orderRef: string; reasonCode?: string }[];
  status?: Record<string, VehicleDayStatus>;
  fuel?: Record<string, FuelPosition>;
  config?: Partial<PlanSnapshot["config"]>;
  openShortfallOrderRefs?: string[];
  /** Road legs; when given, windows, the Fresh deadline, turnaround and fuel are judged on the road. */
  travel?: TravelMatrix;
}

export function snapshot(parts: SnapshotParts = {}): PlanSnapshot {
  return {
    date: "2026-04-09",
    depot: "Peliyagoda",
    config: { ...DEFAULT_PLAN_CONFIG, ...parts.config },
    reference: {
      vehicles: new Map((parts.vehicles ?? [vehicle("VEH001")]).map((x) => [x.vehicleId, x])),
      outlets: new Map((parts.outlets ?? [outlet("OUT001")]).map((x) => [x.outletId, x])),
      districts: DISTRICTS,
      allowance: ALLOWANCE,
      vehicleStatus: new Map(Object.entries(parts.status ?? {})),
      fuel: new Map(Object.entries(parts.fuel ?? {})),
      ...(parts.travel ? { travel: parts.travel } : {}),
    },
    orders: new Map((parts.orders ?? []).map((x) => [x.ref, x])),
    trips: parts.trips ?? [],
    deferred: parts.deferred ?? [],
    openShortfallOrderRefs: parts.openShortfallOrderRefs,
  };
}

/** Build `n` identical orders at one outlet, for capacity and budget tests. */
export function orders(
  n: number,
  base: Partial<OrderRef> & { outletId: string },
  prefix = "O",
): OrderRef[] {
  return Array.from({ length: n }, (_, i) => order(`${prefix}${i}`, base));
}

export const DOCKS: DockType[] = ["rear_dock", "street", "mall_bay"];
export const BRANDS: Brand[] = ["Fresh", "Style", "Tech"];
