/**
 * The hero day: Thursday 9 April 2026 (ISO week 15).
 *
 * Chosen because it is four things at once — a Thursday (the Style-heavy day,
 * so all three brands appear by construction), inside the new-year festival
 * ramp at 0.6, monsoon, and inside the W14-W23 forecast horizon so the
 * forecast screen and the planned day are one story.
 *
 * Peliyagoda's orders are the organisers' own S1 peak-day scenario, loaded
 * verbatim. That is what lets us export a submission CSV and run it straight
 * through their `check_allocation.py` with nothing lost in translation.
 *
 * The day is deliberately infeasible, and provably so:
 *
 *   1. Ten of the 38 Peliyagoda vehicles are in the workshop, leaving four
 *      reefers. Chilled demand spans seven districts, and rule 1 allows one
 *      district per trip, so at least nine chilled trips are needed against
 *      eight reefer trip slots.
 *   2. S1-078 is 40.66 m3; the largest vehicle in the fleet is 38.0 m3. Under
 *      rule 5 no vehicle can ever carry it.
 *   3. Four Puttalam Fresh orders cost 305 minutes against a 270 minute
 *      pre-dawn budget; three cost 266 and eat the whole budget.
 *   4. Three chilled van-only Colombo orders weigh 1,095.7 kg against a
 *      1,040 kg reefer-van cap, and only one reefer van is available.
 *
 * `heroDay.test.ts` asserts all four against the seeded rows, so if the data
 * ever drifts the build fails loudly instead of the demo quietly going soft.
 */

import type { PrismaClient } from "@prisma/client";
import { bool, int, num, readCsvAll, str } from "@katapatha/allocator/csv";
import type { DataSource } from "./source";

export const HERO_DATE = "2026-04-09";
export const HERO_DEPOT = "Peliyagoda";

export function heroDate(): Date {
  return new Date(`${HERO_DATE}T00:00:00.000Z`);
}

export interface HeroDayCounts {
  orders: number;
  byBrand: Record<string, number>;
  chilledOrders: number;
  chilledVolumeM3: number;
  vehiclesAvailable: number;
  vehiclesInWorkshop: number;
}

export async function seedHeroDay(
  prisma: PrismaClient,
  source: DataSource,
): Promise<HeroDayCounts | null> {
  const scenarioPath = source.find("peakDayScenarios");
  const fleetPath = source.find("peakDayFleet");
  if (!scenarioPath || !fleetPath) {
    console.log("[seed] No peak-day scenario files; skipping the hero day.");
    return null;
  }

  const date = heroDate();

  // --- Fleet availability ---------------------------------------------------
  // The scenario file covers Peliyagoda only. Kandy's vehicles are marked
  // available so the second depot is usable rather than empty.
  const fleetRows = await readCsvAll(fleetPath);
  const scenarioStatus = new Map(
    fleetRows.map((r) => [str(r, "vehicle_id"), str(r, "status")]),
  );

  const allVehicles = await prisma.vehicle.findMany({
    select: { id: true, depotCode: true },
  });
  const statuses = allVehicles.map((v) => {
    const raw = scenarioStatus.get(v.id);
    return {
      date,
      vehicleId: v.id,
      depotCode: v.depotCode,
      status: raw === "in_workshop" ? ("IN_WORKSHOP" as const) : ("AVAILABLE" as const),
      note: raw === "in_workshop" ? "In the workshop on the scenario day" : null,
    };
  });
  await prisma.vehicleDayStatus.createMany({
    data: statuses.map(({ date, vehicleId, status, note }) => ({
      date,
      vehicleId,
      status,
      note,
    })),
    skipDuplicates: true,
  });

  // --- The planning day -----------------------------------------------------
  await prisma.planningDay.upsert({
    where: { date_depotCode: { date, depotCode: HERO_DEPOT } },
    update: {},
    create: { date, depotCode: HERO_DEPOT, status: "OPEN", cutoffAt: "16:00" },
  });

  // --- Orders ---------------------------------------------------------------
  const scenarioRows = await readCsvAll(scenarioPath);
  const orders = scenarioRows.map((r) => ({
    ref: str(r, "order_ref"),
    outletId: str(r, "outlet_id"),
    brand: str(r, "brand") as "Fresh" | "Style" | "Tech",
    districtName: str(r, "district"),
    depotCode: str(r, "depot"),
    tempRequirement: str(r, "temp_requirement") as "chilled" | "ambient",
    units: int(r, "order_units"),
    weightKg: num(r, "order_weight_kg"),
    volumeM3: num(r, "order_volume_m3"),
    windowOpen: str(r, "window_open_time"),
    windowClose: str(r, "window_close_time"),
    requestedDate: date,
    status: "QUEUED" as const,
    deferredYesterday: bool(r, "deferred_yesterday"),
    daysSinceLastServed: int(r, "days_since_last_served"),
  }));

  await prisma.order.createMany({ data: orders, skipDuplicates: true });

  // --- Summary, used by the seed log and asserted by the tests --------------
  const byBrand: Record<string, number> = {};
  for (const o of orders) byBrand[o.brand] = (byBrand[o.brand] ?? 0) + 1;

  const chilled = orders.filter((o) => o.tempRequirement === "chilled");
  // Scoped to the scenario's own depot — the whole-fleet number would include
  // Kandy's 22 vehicles, which have nothing to do with this day's problem.
  const atDepot = statuses.filter((s) => s.depotCode === HERO_DEPOT);
  const inWorkshop = atDepot.filter((s) => s.status === "IN_WORKSHOP").length;

  return {
    orders: orders.length,
    byBrand,
    chilledOrders: chilled.length,
    chilledVolumeM3: Number(chilled.reduce((s, o) => s + o.volumeM3, 0).toFixed(2)),
    vehiclesAvailable: atDepot.length - inWorkshop,
    vehiclesInWorkshop: inWorkshop,
  };
}

/**
 * Open the ten forecast weeks the organisers ask for (W14-W23 of 2026) as
 * empty shells. `forecast.ts` fills them; having the rows exist from seed
 * means the forecast screen is never a blank page on a fresh install.
 */
export async function seedForecastShells(
  prisma: PrismaClient,
  source: DataSource,
): Promise<number> {
  const path = source.find("forecastInputs");
  if (!path) return 0;

  const rows = await readCsvAll(path);
  const data = rows.map((r) => ({
    isoYear: int(r, "iso_year"),
    isoWeek: int(r, "iso_week"),
    depotCode: str(r, "depot"),
    brand: str(r, "brand") as "Fresh" | "Style" | "Tech",
    predTotalVolumeM3: 0,
    predChilledVolumeM3: 0,
    method: "pending",
  }));
  await prisma.demandForecast.createMany({ data, skipDuplicates: true });
  return data.length;
}
