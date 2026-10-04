import type { Prisma } from "@prisma/client";
import type { FuelPosition } from "@katapatha/allocator/types";
import { prisma } from "../lib/db";
import { isoWeekOfDate } from "./forecast";

/**
 * The weekly fuel allowance, as the planner needs it and as publishing spends it.
 *
 * Each vehicle has a quota per ISO week and route distance consumes it. The
 * ledger is append-only: publishing a plan writes one PLANNED entry per trip, so
 * "how much has this vehicle already committed this week" is a sum anyone can
 * audit rather than a counter nobody can explain. `FuelLedger.committedL` is a
 * cache of that sum.
 *
 * The week is the plain ISO week of the date, the same key a capacity action
 * uses when it raises a quota, so a raise and the spending against it land on
 * the same row.
 */

export interface FuelEntryLike {
  litres: number;
  kind: "PLANNED" | "ACTUAL" | "ADJUSTMENT";
  /** The day of the plan the entry came from; null for a manual adjustment. */
  plannedFor: string | null;
}

/**
 * Litres already spoken for on days other than `date`.
 *
 * Planned entries and adjustments count. ACTUAL entries would replace the
 * planned figure for a completed trip, but nothing writes them yet, so counting
 * them as well would double-count once something does. The day being planned is
 * excluded: re-planning a day must not charge it against itself.
 */
export function committedOtherDays(entries: readonly FuelEntryLike[], date: string): number {
  let litres = 0;
  for (const e of entries) {
    if (e.kind === "ACTUAL") continue;
    if (e.plannedFor === date) continue;
    litres += e.litres;
  }
  return litres;
}

/** Quota and committed litres for each vehicle, for the week `date` falls in. */
export async function fuelPositions(
  date: Date,
  vehicles: ReadonlyArray<{ id: string; weeklyFuelQuotaL: number }>,
): Promise<Map<string, FuelPosition>> {
  const iso = date.toISOString().slice(0, 10);
  const week = isoWeekOfDate(iso);
  const ledgers = await prisma.fuelLedger.findMany({
    where: { vehicleId: { in: vehicles.map((v) => v.id) }, isoYear: week.isoYear, isoWeek: week.isoWeek },
    include: {
      entries: {
        select: {
          litres: true,
          kind: true,
          trip: { select: { plan: { select: { planningDay: { select: { date: true } } } } } },
        },
      },
    },
  });
  const byVehicle = new Map(ledgers.map((l) => [l.vehicleId, l]));

  return new Map(
    vehicles.map((v) => {
      const ledger = byVehicle.get(v.id);
      const entries: FuelEntryLike[] = (ledger?.entries ?? []).map((e) => ({
        litres: e.litres,
        kind: e.kind,
        plannedFor: e.trip?.plan.planningDay.date.toISOString().slice(0, 10) ?? null,
      }));
      return [
        v.id,
        {
          // A raised quota lives on the week's ledger; the standing one is the fallback.
          quotaL: ledger?.quotaL ?? v.weeklyFuelQuotaL,
          committedOtherDaysL: committedOtherDays(entries, iso),
        },
      ];
    }),
  );
}

/**
 * Spend a published plan's fuel: one PLANNED entry per trip, against the
 * vehicle's ledger for the plan's week. Called inside the publication
 * transaction, so a plan is never published without its fuel recorded or the
 * reverse. A trip that already has an entry is skipped, which makes a repeat
 * call harmless.
 */
export async function commitPlanFuel(
  tx: Prisma.TransactionClient,
  planId: string,
  date: Date,
): Promise<{ trips: number; litres: number }> {
  const week = isoWeekOfDate(date.toISOString().slice(0, 10));
  const trips = await tx.trip.findMany({
    where: { planId },
    orderBy: [{ vehicleId: "asc" }, { tripNo: "asc" }],
    select: {
      id: true,
      vehicleId: true,
      plannedDistanceKm: true,
      plannedFuelL: true,
      vehicle: { select: { weeklyFuelQuotaL: true } },
      fuelEntries: { where: { kind: "PLANNED" }, select: { id: true }, take: 1 },
    },
  });

  let count = 0;
  let litres = 0;
  for (const trip of trips) {
    if (trip.fuelEntries.length > 0) continue;
    const ledger = await tx.fuelLedger.upsert({
      where: { vehicleId_isoYear_isoWeek: { vehicleId: trip.vehicleId, isoYear: week.isoYear, isoWeek: week.isoWeek } },
      create: {
        vehicleId: trip.vehicleId,
        isoYear: week.isoYear,
        isoWeek: week.isoWeek,
        quotaL: trip.vehicle.weeklyFuelQuotaL,
      },
      // Never touch an existing quota: it may have been raised for this week.
      update: {},
    });
    await tx.fuelLedgerEntry.create({
      data: {
        ledgerId: ledger.id,
        tripId: trip.id,
        km: trip.plannedDistanceKm,
        litres: trip.plannedFuelL,
        kind: "PLANNED",
      },
    });
    await tx.fuelLedger.update({ where: { id: ledger.id }, data: { committedL: { increment: trip.plannedFuelL } } });
    count += 1;
    litres += trip.plannedFuelL;
  }
  return { trips: count, litres };
}
