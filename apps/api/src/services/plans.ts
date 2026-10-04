

import type { Prisma } from "@prisma/client";
import { prisma } from "../lib/db";
import { fuelPositions } from "./fuel";
import { allocate } from "@katapatha/allocator/allocate";
import type { AllocatorInput, AllocatorOutput, AllocatorVehicle } from "@katapatha/allocator/types";
import { allowanceKey, type AllowanceTable } from "@katapatha/core/domain/tripTime";
import type {
  Brand,
  DepotCode,
  DistrictTravel,
  OrderRef,
  OutletRef,
} from "@katapatha/core/domain/types";

/**
 * The bridge between the database and the pure allocator.
 *
 * Everything the allocator needs is loaded here and handed over as plain
 * objects. Keeping Prisma on this side of the line is what lets the allocator
 * and validator run in a test, in a script, and in the browser.
 */

/**
 * Widen a typed object into Prisma's JSON input type.
 *
 * Prisma only accepts index-signature types for Json columns, which our
 * domain interfaces deliberately are not. Round-tripping through JSON is
 * honest about what is actually being stored and drops anything unserialisable
 * rather than letting it through as `undefined`.
 */
function asJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

export function asDate(date: string): Date {
  return new Date(`${date}T00:00:00.000Z`);
}

export function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** ISO week for a date, matching the calendar table's own numbering. */
export async function isoWeekOf(date: Date): Promise<{ isoYear: number; isoWeek: number }> {
  const row = await prisma.calendarDay.findUnique({
    where: { date },
    select: { isoYear: true, isoWeek: true },
  });
  if (row) return row;
  // Fall back to a local computation if the day is outside the seeded calendar.
  const d = new Date(date);
  const day = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - day + 3);
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const week =
    1 +
    Math.round(
      ((d.getTime() - firstThursday.getTime()) / 86400000 -
        3 +
        ((firstThursday.getUTCDay() + 6) % 7)) /
        7,
    );
  return { isoYear: d.getUTCFullYear(), isoWeek: week };
}

export async function loadAllowance(): Promise<AllowanceTable> {
  const rows = await prisma.serviceAllowance.findMany();
  return new Map(rows.map((r) => [allowanceKey(r.brand, r.dockType), r.minutes]));
}

export async function loadDistricts(): Promise<Map<string, DistrictTravel>> {
  const rows = await prisma.district.findMany();
  return new Map(
    rows.map((r) => [
      r.name,
      {
        district: r.name,
        depot: r.depotCode as DepotCode,
        roadClass: r.roadClass,
        freeFlowKmh: r.freeFlowKmh,
        depotToDistrictKm: r.depotToDistrictKm,
        depotToDistrictFreeflowMin: r.depotToDistrictFreeflowMin,
        interStopKm: r.interStopKm,
        interStopFreeflowMin: r.interStopFreeflowMin,
      },
    ]),
  );
}

export async function loadOutlets(): Promise<Map<string, OutletRef>> {
  const rows = await prisma.outlet.findMany();
  return new Map(
    rows.map((r) => [
      r.id,
      {
        outletId: r.id,
        brand: r.brand,
        district: r.districtName,
        depot: r.depotCode as DepotCode,
        dockType: r.dockType,
        parkingConstraint: r.parkingConstraint,
        mallWindowOpen: r.mallWindowOpen,
        mallWindowClose: r.mallWindowClose,
        windowOpen: r.windowOpen,
        windowClose: r.windowClose,
      },
    ]),
  );
}

export interface DayContext {
  planningDay: { id: string; date: Date; depotCode: string; status: string; cutoffAt: string };
  input: AllocatorInput;
  /** Order ref -> database id, so allocator output can be persisted. */
  orderIdByRef: Map<string, string>;
}

/**
 * Assemble everything needed to plan one depot-day.
 *
 * Fuel is a weekly ledger against a daily plan, so each vehicle's position is
 * what it has already committed on the *other* days of the same Mon-Sat week.
 */
export async function loadDayContext(
  date: Date,
  depot: DepotCode,
): Promise<DayContext | null> {
  const planningDay = await prisma.planningDay.findUnique({
    where: { date_depotCode: { date, depotCode: depot } },
  });
  if (!planningDay) return null;

  const [orders, vehicles, statuses, outlets, districts, allowance] =
    await Promise.all([
      prisma.order.findMany({
        where: { requestedDate: date, depotCode: depot, status: { not: "CANCELLED" } },
        orderBy: { ref: "asc" },
      }),
      prisma.vehicle.findMany({ where: { depotCode: depot }, orderBy: { id: "asc" } }),
      prisma.vehicleDayStatus.findMany({ where: { date } }),
      loadOutlets(),
      loadDistricts(),
      loadAllowance(),
    ]);

  const statusById = new Map(statuses.map((s) => [s.vehicleId, s.status]));

  // The week's quota (raised or standing) and what other days have already spent.
  const fuel = await fuelPositions(date, vehicles);

  const allocatorVehicles: AllocatorVehicle[] = vehicles.map((v) => ({
    vehicleId: v.id,
    type: v.type,
    temp: v.temp,
    weightCapKg: v.weightCapKg,
    volumeCapM3: v.volumeCapM3,
    kmPerL: v.kmPerL,
    weeklyFuelQuotaL: v.weeklyFuelQuotaL,
    depot: v.depotCode as DepotCode,
    // No row for the day means nobody has said otherwise, so it can run.
    available: (statusById.get(v.id) ?? "AVAILABLE") === "AVAILABLE",
  }));

  const orderRefs: OrderRef[] = orders.map((o) => ({
    ref: o.ref,
    outletId: o.outletId,
    brand: o.brand as Brand,
    district: o.districtName,
    depot: o.depotCode as DepotCode,
    tempRequirement: o.tempRequirement,
    units: o.units,
    weightKg: o.weightKg,
    volumeM3: o.volumeM3,
    windowOpen: o.windowOpen,
    windowClose: o.windowClose,
    deferredYesterday: o.deferredYesterday,
    daysSinceLastServed: o.daysSinceLastServed,
  }));

  return {
    planningDay: {
      id: planningDay.id,
      date: planningDay.date,
      depotCode: planningDay.depotCode,
      status: planningDay.status,
      cutoffAt: planningDay.cutoffAt,
    },
    input: {
      date: isoDate(date),
      depot,
      orders: orderRefs,
      vehicles: allocatorVehicles,
      outlets,
      districts,
      allowance,
      fuel,
    },
    orderIdByRef: new Map(orders.map((o) => [o.ref, o.id])),
  };
}

/**
 * Run the allocator and persist the result as a draft plan.
 *
 * Any previous draft for the day is replaced: re-running auto-plan is meant to
 * be free, so it must not leave a trail of half-plans behind.
 */
export async function runAutoPlan(
  date: Date,
  depot: DepotCode,
  userId: string,
): Promise<{ planId: string; output: AllocatorOutput } | null> {
  const ctx = await loadDayContext(date, depot);
  if (!ctx) return null;

  const output = allocate(ctx.input);

  const planId = await prisma.$transaction(async (tx) => {
    await tx.plan.deleteMany({
      where: { planningDayId: ctx.planningDay.id, status: "DRAFT" },
    });

    const plan = await tx.plan.create({
      data: {
        planningDayId: ctx.planningDay.id,
        status: "DRAFT",
        createdByUserId: userId,
        allocatorVersion: output.stats.hash,
        objectiveSummary: asJson({
          served: output.stats.served,
          deferred: output.stats.deferred,
          trips: output.stats.tripsBuilt,
          // Kept so the board can draw utilisation after a reload; the
          // allocator computes it anyway and it is cheaper to keep than redo.
          meters: output.meters,
        }),
      },
    });

    for (const trip of output.trips) {
      const created = await tx.trip.create({
        data: {
          planId: plan.id,
          vehicleId: trip.vehicleId,
          tripNo: trip.tripNo,
          brand: trip.brand as Brand,
          districtName: trip.district,
          wave: trip.wave,
          plannedDepartAt: trip.departAt,
          plannedMinutes: trip.minutes,
          plannedDistanceKm: trip.distanceKm,
          plannedFuelL: trip.fuelL,
          sumWeightKg: trip.weightKg,
          sumVolumeM3: trip.volumeM3,
        },
      });

      for (const stop of trip.stops) {
        const tripStop = await tx.tripStop.create({
          data: {
            tripId: created.id,
            seq: stop.seq,
            outletId: stop.outletId,
            plannedArrivalAt: stop.plannedArrival,
          },
        });

        for (const ref of stop.orderRefs) {
          const orderId = ctx.orderIdByRef.get(ref);
          if (!orderId) continue;
          await tx.tripStopOrder.create({ data: { tripStopId: tripStop.id, orderId } });
          await tx.assignment.create({
            data: {
              planId: plan.id,
              orderId,
              tripStopId: tripStop.id,
              decision: "SERVED",
            },
          });
        }
      }
    }

    for (const d of output.deferred) {
      const orderId = ctx.orderIdByRef.get(d.orderRef);
      if (!orderId) continue;
      await tx.assignment.create({
        data: {
          planId: plan.id,
          orderId,
          decision: "DEFERRED",
          // The machine-derived cause. The dispatcher's own reason code is
          // recorded separately when they confirm the deferral.
          explanation: asJson({
            reasonCode: d.reasonCode,
            permanent: d.permanent,
            explanation: d.explanation,
            // The allocator's metric is a record ({name, have, limit, unit});
            // the contract and every reader want the metric's name. Stored
            // flat, because a plan whose board returns 500 cannot be published.
            nearMiss: d.nearMiss ? { ...d.nearMiss, metric: d.nearMiss.metric.name } : null,
            suggestion: d.suggestion ?? null,
          }),
        },
      });
    }

    await tx.planningDay.update({
      where: { id: ctx.planningDay.id },
      data: { status: "PLANNING" },
    });

    return plan.id;
  });

  return { planId, output };
}

/** The current draft or published plan for a depot-day, with everything a board needs. */
export async function loadPlan(planId: string) {
  return prisma.plan.findUnique({
    where: { id: planId },
    include: {
      planningDay: true,
      trips: {
        orderBy: [{ vehicleId: "asc" }, { tripNo: "asc" }],
        include: {
          vehicle: true,
          stops: {
            orderBy: { seq: "asc" },
            include: { outlet: true, orders: { include: { order: true } } },
          },
        },
      },
      assignments: { include: { order: { include: { outlet: true } } } },
    },
  });
}

export async function latestPlanFor(date: Date, depot: DepotCode) {
  return prisma.plan.findFirst({
    where: { planningDay: { date, depotCode: depot } },
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    select: { id: true, status: true },
  });
}
