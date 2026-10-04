/**
 * Build allocator input straight from the competition CSVs.
 *
 * This bypasses the database on purpose. It is what the unit tests and the
 * `verify:organiser` script use, so a failure there is unambiguously the
 * allocator's fault rather than the seeder's. It also means the submission CSV
 * we hand the organisers is derived from exactly the rows they shipped.
 */

import path from "node:path";
import { existsSync, readdirSync, statSync } from "node:fs";
import { readCsvAll } from "./csv";
import { allowanceKey, type AllowanceTable } from "@katapatha/core/domain/tripTime";
import type {
  Brand,
  DistrictTravel,
  DockType,
  OrderRef,
  OutletRef,
  ParkingConstraint,
  TempRequirement,
} from "@katapatha/core/domain/types";
import type { AllocatorInput, AllocatorVehicle, FuelPosition } from "./types";

/** Same "find a file by name anywhere under here" approach as the organisers' checker. */
function findUnder(root: string, filename: string, depth = 0): string | null {
  if (depth > 4 || !existsSync(root)) return null;
  let entries: string[];
  try {
    entries = readdirSync(root);
  } catch {
    return null;
  }
  if (entries.includes(filename)) return path.join(root, filename);
  for (const entry of entries) {
    if (entry.startsWith(".") || entry === "node_modules") continue;
    const full = path.join(root, entry);
    try {
      if (!statSync(full).isDirectory()) continue;
    } catch {
      continue;
    }
    const hit = findUnder(full, filename, depth + 1);
    if (hit) return hit;
  }
  return null;
}

export function resolveDataRoot(env: NodeJS.ProcessEnv = process.env): string | null {
  const candidates = [
    env.DATA_DIR,
    path.join(import.meta.dirname, "..", "..", "..", "..", "data"),
    "/data",
  ].filter((x): x is string => Boolean(x));

  for (const candidate of candidates) {
    const root = path.resolve(candidate);
    if (findUnder(root, "task2b_peak_day_scenarios.csv")) return root;
  }
  return null;
}

export interface LoadedScenario {
  input: AllocatorInput;
  /** Order refs in the order the organisers' template lists them. */
  templateOrder: string[];
}

/**
 * Load the S1 peak-day scenario.
 *
 * @param date the date to label the plan with; the scenario itself is undated
 */
export async function loadPeakDayScenario(
  dataRoot: string,
  date = "2026-04-09",
): Promise<LoadedScenario> {
  const file = (name: string): string => {
    const hit = findUnder(dataRoot, name);
    if (!hit) throw new Error(`${name} not found under ${dataRoot}`);
    return hit;
  };

  const [scenarioRows, fleetRows, vehicleRows, outletRows, travelRows, allowanceRows] =
    await Promise.all([
      readCsvAll(file("task2b_peak_day_scenarios.csv")),
      readCsvAll(file("task2b_peak_day_fleet.csv")),
      readCsvAll(file("vehicles.csv")),
      readCsvAll(file("outlets.csv")),
      readCsvAll(file("district_travel.csv")),
      readCsvAll(file("service_allowance.csv")),
    ]);

  const allowance: AllowanceTable = new Map(
    allowanceRows.map((r) => [
      allowanceKey(r.brand as Brand, r.dock_type as DockType),
      Number(r.service_allowance_min),
    ]),
  );

  const districts = new Map<string, DistrictTravel>(
    travelRows.map((r) => [
      r.district,
      {
        district: r.district,
        depot: r.depot as "Peliyagoda" | "Kandy",
        roadClass: r.road_class as DistrictTravel["roadClass"],
        freeFlowKmh: Number(r.free_flow_kmh),
        depotToDistrictKm: Number(r.depot_to_district_km),
        depotToDistrictFreeflowMin: Number(r.depot_to_district_freeflow_min),
        interStopKm: Number(r.inter_stop_km),
        interStopFreeflowMin: Number(r.inter_stop_freeflow_min),
      },
    ]),
  );

  const outlets = new Map<string, OutletRef>(
    outletRows.map((r) => {
      const mall = r.mall_window?.trim();
      const [mallOpen, mallClose] = mall ? mall.split("-") : [undefined, undefined];
      return [
        r.outlet_id,
        {
          outletId: r.outlet_id,
          brand: r.brand as Brand,
          district: r.district,
          depot: r.depot as "Peliyagoda" | "Kandy",
          dockType: r.dock_type as DockType,
          parkingConstraint: r.parking_constraint as ParkingConstraint,
          mallWindowOpen: mallOpen?.trim() || null,
          mallWindowClose: mallClose?.trim() || null,
          windowOpen: r.window_open_time,
          windowClose: r.window_close_time,
        },
      ];
    }),
  );

  // The scenario file lists availability for its own depot only; vehicles it
  // does not mention are simply not in play for this scenario.
  const status = new Map(fleetRows.map((r) => [r.vehicle_id, r.status]));
  const scenarioDepot = scenarioRows[0]?.depot ?? "Peliyagoda";

  const vehicles: AllocatorVehicle[] = vehicleRows
    .filter((r) => r.depot === scenarioDepot)
    .map((r) => ({
      vehicleId: r.vehicle_id,
      type: r.type as "truck" | "van",
      temp: r.temp as "reefer" | "ambient",
      weightCapKg: Number(r.weight_cap_kg),
      volumeCapM3: Number(r.volume_cap_m3),
      kmPerL: Number(r.km_per_l),
      weeklyFuelQuotaL: Number(r.weekly_fuel_quota_l),
      depot: r.depot as "Peliyagoda" | "Kandy",
      available: status.get(r.vehicle_id) === "available",
    }));

  const orders: OrderRef[] = scenarioRows.map((r) => ({
    ref: r.order_ref,
    outletId: r.outlet_id,
    brand: r.brand as Brand,
    district: r.district,
    depot: r.depot as "Peliyagoda" | "Kandy",
    tempRequirement: r.temp_requirement as TempRequirement,
    units: Number(r.order_units),
    weightKg: Number(r.order_weight_kg),
    volumeM3: Number(r.order_volume_m3),
    windowOpen: r.window_open_time,
    windowClose: r.window_close_time,
    deferredYesterday: r.deferred_yesterday === "1",
    daysSinceLastServed: Number(r.days_since_last_served),
  }));

  // A single-day scenario carries no history, so every vehicle starts its week
  // with a full tank of quota.
  const fuel = new Map<string, FuelPosition>(
    vehicles.map((v) => [
      v.vehicleId,
      { quotaL: v.weeklyFuelQuotaL, committedOtherDaysL: 0 },
    ]),
  );

  return {
    input: {
      date,
      depot: scenarioDepot as "Peliyagoda" | "Kandy",
      orders,
      vehicles,
      outlets,
      districts,
      allowance,
      fuel,
    },
    templateOrder: scenarioRows.map((r) => r.order_ref),
  };
}
