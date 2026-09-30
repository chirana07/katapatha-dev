/**
 * Reference data: outlets, vehicles, districts, allowances, calendar, and the
 * two lookup tables the live-ETA model uses.
 *
 * All of it loads in full — the largest is road_conditions at 10,920 rows,
 * which is nothing for Postgres. The 90k-row training files are handled
 * separately in history.ts, as aggregates.
 */

import type { PrismaClient } from "@prisma/client";
import { bool, dateOnly, int, num, optStr, readCsv, readCsvAll, str } from "@katapatha/allocator/csv";
import type { DataSource } from "./source";

/** Insert in chunks so a single statement never carries 10k rows of parameters. */
async function chunked<T>(
  rows: T[],
  size: number,
  fn: (batch: T[]) => Promise<unknown>,
): Promise<number> {
  for (let i = 0; i < rows.length; i += size) {
    await fn(rows.slice(i, i + size));
  }
  return rows.length;
}

export interface ReferenceCounts {
  depots: number;
  districts: number;
  outlets: number;
  vehicles: number;
  allowances: number;
  calendarDays: number;
  trafficSpeeds: number;
  roadConditions: number;
}

export async function seedReference(
  prisma: PrismaClient,
  source: DataSource,
): Promise<ReferenceCounts> {
  // --- Districts, and the depots they imply --------------------------------
  // district_travel.csv is the authority for which depot serves a district,
  // and the mapping is 1:1, so the depot table falls straight out of it.
  const districtRows = await readCsvAll(source.require("districtTravel"));
  const depotCodes = [...new Set(districtRows.map((r) => str(r, "depot")))].sort();

  await prisma.depot.createMany({
    data: depotCodes.map((code) => ({ code, name: `${code} depot` })),
    skipDuplicates: true,
  });

  await prisma.district.createMany({
    data: districtRows.map((r) => ({
      name: str(r, "district"),
      depotCode: str(r, "depot"),
      roadClass: str(r, "road_class") as "urban" | "suburban" | "highway" | "hill",
      freeFlowKmh: num(r, "free_flow_kmh"),
      depotToDistrictKm: num(r, "depot_to_district_km"),
      depotToDistrictFreeflowMin: int(r, "depot_to_district_freeflow_min"),
      interStopKm: num(r, "inter_stop_km"),
      interStopFreeflowMin: int(r, "inter_stop_freeflow_min"),
    })),
    skipDuplicates: true,
  });

  // --- Outlets --------------------------------------------------------------
  const outletRows = await readCsvAll(source.require("outlets"));
  const outlets = outletRows.map((r) => {
    // mall_window is a single "HH:MM-HH:MM" string, blank outside malls.
    const mall = optStr(r, "mall_window");
    const [mallOpen, mallClose] = mall ? mall.split("-") : [null, null];
    return {
      id: str(r, "outlet_id"),
      brand: str(r, "brand") as "Fresh" | "Style" | "Tech",
      districtName: str(r, "district"),
      depotCode: str(r, "depot"),
      dockType: str(r, "dock_type") as "rear_dock" | "street" | "mall_bay",
      parkingConstraint: str(r, "parking_constraint") as "normal" | "van_only" | "mall_dock",
      mallWindowOpen: mallOpen?.trim() || null,
      mallWindowClose: mallClose?.trim() || null,
      windowOpen: str(r, "window_open_time"),
      windowClose: str(r, "window_close_time"),
    };
  });
  await chunked(outlets, 500, (batch) =>
    prisma.outlet.createMany({ data: batch, skipDuplicates: true }),
  );

  // --- Vehicles -------------------------------------------------------------
  const vehicleRows = await readCsvAll(source.require("vehicles"));
  const vehicles = vehicleRows.map((r) => ({
    id: str(r, "vehicle_id"),
    type: str(r, "type") as "truck" | "van",
    temp: str(r, "temp") as "reefer" | "ambient",
    weightCapKg: int(r, "weight_cap_kg"),
    volumeCapM3: num(r, "volume_cap_m3"),
    fuelType: str(r, "fuel_type"),
    kmPerL: num(r, "km_per_l"),
    weeklyFuelQuotaL: int(r, "weekly_fuel_quota_l"),
    depotCode: str(r, "depot"),
  }));
  await chunked(vehicles, 500, (batch) =>
    prisma.vehicle.createMany({ data: batch, skipDuplicates: true }),
  );

  // --- Service allowances ---------------------------------------------------
  const allowanceRows = await readCsvAll(source.require("serviceAllowance"));
  await prisma.serviceAllowance.createMany({
    data: allowanceRows.map((r) => ({
      brand: str(r, "brand") as "Fresh" | "Style" | "Tech",
      dockType: str(r, "dock_type") as "rear_dock" | "street" | "mall_bay",
      minutes: int(r, "service_allowance_min"),
    })),
    skipDuplicates: true,
  });

  // --- Calendar -------------------------------------------------------------
  const calendarRows = await readCsvAll(source.require("calendar"));
  const calendar = calendarRows.map((r) => ({
    date: dateOnly(r, "date"),
    dow: int(r, "dow"),
    dowName: str(r, "dow_name"),
    isWeekend: bool(r, "is_weekend"),
    isoYear: int(r, "iso_year"),
    isoWeek: int(r, "iso_week"),
    isPayday: bool(r, "is_payday"),
    festival: optStr(r, "festival"),
    festivalRamp: num(r, "festival_ramp"),
    isHoliday: bool(r, "is_holiday"),
    monsoon: bool(r, "monsoon"),
    isOperating: bool(r, "is_operating"),
  }));
  await chunked(calendar, 500, (batch) =>
    prisma.calendarDay.createMany({ data: batch, skipDuplicates: true }),
  );

  // --- Traffic and road conditions (live ETA only, never planning) ----------
  let trafficSpeeds = 0;
  const trafficPath = source.find("trafficSpeed");
  if (trafficPath) {
    const batch: {
      districtName: string;
      hour: number;
      monsoon: boolean;
      speedIndex: number;
    }[] = [];
    for await (const r of readCsv(trafficPath)) {
      batch.push({
        districtName: str(r, "district"),
        hour: int(r, "hour"),
        monsoon: bool(r, "monsoon"),
        speedIndex: int(r, "speed_index"),
      });
    }
    trafficSpeeds = await chunked(batch, 1000, (b) =>
      prisma.trafficSpeed.createMany({ data: b, skipDuplicates: true }),
    );
  }

  let roadConditions = 0;
  const roadPath = source.find("roadConditions");
  if (roadPath) {
    const batch: { districtName: string; date: Date; disruptionIndex: number }[] = [];
    for await (const r of readCsv(roadPath)) {
      batch.push({
        districtName: str(r, "district"),
        date: dateOnly(r, "date"),
        disruptionIndex: int(r, "disruption_index"),
      });
    }
    roadConditions = await chunked(batch, 2000, (b) =>
      prisma.roadCondition.createMany({ data: b, skipDuplicates: true }),
    );
  }

  return {
    depots: depotCodes.length,
    districts: districtRows.length,
    outlets: outlets.length,
    vehicles: vehicles.length,
    allowances: allowanceRows.length,
    calendarDays: calendar.length,
    trafficSpeeds,
    roadConditions,
  };
}
