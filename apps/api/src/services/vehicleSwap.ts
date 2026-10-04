import type { Prisma } from "@prisma/client";
import { prisma } from "../lib/db.js";
import type { SessionUser } from "../lib/auth.js";
import { recordDecisions } from "../lib/audit.js";
import { BAY_WINDOW_MINUTES, clockToMinutes, loadedUnitsByTrip, swapView } from "./dock.js";

/**
 * Owner: BE3 (dock)
 *
 * Moving a published trip onto another vehicle while the dock is loading it —
 * the L-04 "vehicle swapped mid-load" flow.
 *
 * The dispatcher decides (they own the plan); the dock carries it out. A swap
 * puts the trip on the new vehicle, keeps the old vehicle's checks and counts
 * on the swap record, and clears the trip's own so the reload is checked
 * again from zero — the goods are physically coming off one vehicle and going
 * onto another, so a check made on the old one says nothing about the new one.
 * The stores on the trip are told the new vehicle and departure.
 */

export class SwapError extends Error {
  constructor(
    readonly status: 404 | 409 | 422,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const OPEN: ("PLANNED" | "LOADING" | "READY" | "DEPARTED")[] = ["PLANNED", "LOADING", "READY", "DEPARTED"];

interface Window {
  start: number;
  end: number;
}

function windowOf(departAt: string | null, plannedMinutes: number): Window | null {
  if (!departAt) return null;
  const depart = clockToMinutes(departAt);
  return { start: depart - BAY_WINDOW_MINUTES, end: depart + plannedMinutes };
}

function overlaps(a: Window | null, b: Window | null): boolean {
  if (!a || !b) return true;
  return a.start < b.end && b.start < a.end;
}

async function tripForDispatcher(user: SessionUser, tripId: string) {
  if (!user.depotCode) throw new SwapError(404, "NOT_FOUND", "Trip not found at this depot.");
  const trip = await prisma.trip.findFirst({
    where: { id: tripId, plan: { status: "PUBLISHED", planningDay: { depotCode: user.depotCode } } },
    include: {
      plan: { include: { planningDay: true } },
      vehicle: true,
      stops: { select: { outletId: true, orders: { select: { order: { select: { tempRequirement: true } } } } } },
    },
  });
  if (!trip) throw new SwapError(404, "NOT_FOUND", "Trip not found at this depot.");
  return trip;
}

/**
 * Vehicles at the depot that could take this trip: not in the workshop that
 * day, cold enough for its orders, big enough for its load, and with no other
 * trip whose bay-to-return window overlaps this one's.
 */
export async function swapCandidates(user: SessionUser, tripId: string) {
  const trip = await tripForDispatcher(user, tripId);
  const day = trip.plan.planningDay.date;
  const needsCold = trip.stops.some((stop) => stop.orders.some((o) => o.order.tempRequirement === "chilled"));
  const [vehicles, statuses, busy] = await Promise.all([
    prisma.vehicle.findMany({ where: { depotCode: trip.plan.planningDay.depotCode, id: { not: trip.vehicleId } }, orderBy: { id: "asc" } }),
    prisma.vehicleDayStatus.findMany({ where: { date: day, status: "IN_WORKSHOP" }, select: { vehicleId: true } }),
    prisma.trip.findMany({
      where: { id: { not: trip.id }, status: { in: OPEN }, plan: { status: "PUBLISHED", planningDayId: trip.plan.planningDayId } },
      select: { vehicleId: true, plannedDepartAt: true, plannedMinutes: true },
    }),
  ]);
  const inWorkshop = new Set(statuses.map((s) => s.vehicleId));
  const ours = windowOf(trip.plannedDepartAt, trip.plannedMinutes);
  return vehicles.map((vehicle) => {
    let blocker: string | null = null;
    if (inWorkshop.has(vehicle.id)) blocker = "In the workshop that day";
    else if (needsCold && vehicle.temp !== "reefer") blocker = "Not refrigerated, and this trip carries chilled orders";
    else if (vehicle.weightCapKg < trip.sumWeightKg || vehicle.volumeCapM3 < trip.sumVolumeM3) blocker = "Too small for this load";
    else if (busy.some((other) => other.vehicleId === vehicle.id && overlaps(ours, windowOf(other.plannedDepartAt, other.plannedMinutes)))) {
      blocker = "Already on another trip at that time";
    }
    return {
      vehicleId: vehicle.id,
      type: vehicle.type,
      temp: vehicle.temp,
      weightCapKg: vehicle.weightCapKg,
      volumeCapM3: vehicle.volumeCapM3,
      available: blocker == null,
      reason: blocker,
    };
  });
}

export interface SwapInput {
  toVehicleId: string;
  reason: string;
  newDepartAt?: string | null;
  /** Mark the old vehicle in the workshop for the rest of the day. */
  outOfService?: boolean;
}

export async function createSwap(user: SessionUser, tripId: string, input: SwapInput) {
  const trip = await tripForDispatcher(user, tripId);
  if (trip.status !== "PLANNED" && trip.status !== "LOADING") {
    throw new SwapError(409, "TRIP_NOT_AT_DOCK", `The trip is already ${trip.status.toLowerCase()}; only a vehicle still at the dock can be swapped.`);
  }
  const candidates = await swapCandidates(user, tripId);
  const target = candidates.find((c) => c.vehicleId === input.toVehicleId);
  if (!target) throw new SwapError(422, "VEHICLE_NOT_AT_DEPOT", "That vehicle is not at this depot.");
  if (!target.available) throw new SwapError(409, "VEHICLE_UNAVAILABLE", `${target.vehicleId} cannot take this trip: ${target.reason?.toLowerCase()}.`);

  const previousDepartAt = trip.plannedDepartAt;
  const newDepartAt = input.newDepartAt ?? previousDepartAt;
  const day = trip.plan.planningDay.date;
  const units = (await loadedUnitsByTrip([trip.id])).get(trip.id) ?? 0;
  const [checks, progress] = await Promise.all([
    prisma.loadCheck.findMany({ where: { tripId }, select: { orderId: true, loadedUnits: true, condition: true, itemCounts: true, checkedByName: true, checkedAt: true } }),
    prisma.loadProgress.findMany({ where: { tripId }, select: { orderId: true, loadedUnits: true, itemCounts: true, updatedByName: true, updatedAt: true } }),
  ]);
  const outlets = [...new Set(trip.stops.map((stop) => stop.outletId))];

  const swap = await prisma.$transaction(async (tx) => {
    const created = await tx.vehicleSwap.create({
      data: {
        tripId,
        fromVehicleId: trip.vehicleId,
        toVehicleId: target.vehicleId,
        reason: input.reason.trim(),
        previousDepartAt,
        newDepartAt,
        unloadedUnits: units,
        previousLoad: { checks, progress } as unknown as Prisma.InputJsonValue,
        createdByUserId: user.id,
        // Nothing on board: nothing to take off.
        ...(units === 0 ? { unloadedAt: new Date(), unloadedByName: "Nothing was loaded" } : {}),
      },
    });
    // The reload is checked from zero. Shortfalls stay: they are about stock,
    // not about which vehicle it was going on, so they keep their decision.
    await tx.shortfall.updateMany({ where: { tripId }, data: { loadCheckId: null } });
    await tx.loadCheck.deleteMany({ where: { tripId } });
    await tx.loadProgress.deleteMany({ where: { tripId } });
    await tx.trip.update({
      where: { id: tripId },
      data: { vehicleId: target.vehicleId, plannedDepartAt: newDepartAt, status: "PLANNED", loadStartedAt: null },
    });
    if (input.outOfService) {
      await tx.vehicleDayStatus.upsert({
        where: { date_vehicleId: { date: day, vehicleId: trip.vehicleId } },
        create: { date: day, vehicleId: trip.vehicleId, status: "IN_WORKSHOP", note: input.reason.trim(), setByUserId: user.id },
        update: { status: "IN_WORKSHOP", note: input.reason.trim(), setByUserId: user.id, setAt: new Date() },
      });
    }
    const moved = newDepartAt !== previousDepartAt;
    await tx.notification.createMany({
      data: outlets.map((outletId) => ({
        outletId,
        kind: "trip.vehicle_swapped",
        title: moved ? `Your delivery now leaves at ${newDepartAt}` : `Your delivery is on ${target.vehicleId} now`,
        body: `${trip.vehicleId} was taken off the run (${input.reason.trim()}). ${target.vehicleId} is bringing it${
          moved ? `, leaving at ${newDepartAt} instead of ${previousDepartAt}` : ""
        }.`,
        payload: { tripId, swapId: created.id },
      })),
    });
    return created;
  });

  await recordDecisions([
    {
      actor: user,
      action: "trip.vehicle_swap",
      entityType: "Trip",
      entityId: tripId,
      note: input.reason.trim(),
      before: { vehicleId: trip.vehicleId, plannedDepartAt: previousDepartAt, loadedUnits: units },
      after: { vehicleId: target.vehicleId, plannedDepartAt: newDepartAt, outOfService: Boolean(input.outOfService) },
    },
  ]);

  return { ...swapView(swap), storesNotified: outlets.length };
}

export type SwapStep = "UNLOADED" | "ARRIVED" | "ACKNOWLEDGED";

/** The loader working the swap: unloaded the old vehicle, the new one is at
 *  the bay, and "I have read this". Each step is recorded once. */
export async function recordSwapStep(user: SessionUser, tripId: string, swapId: string, step: SwapStep, byName: string) {
  if (!user.depotCode) throw new SwapError(404, "NOT_FOUND", "Swap not found at this depot.");
  const swap = await prisma.vehicleSwap.findFirst({
    where: { id: swapId, tripId, trip: { plan: { planningDay: { depotCode: user.depotCode } } } },
  });
  if (!swap) throw new SwapError(404, "NOT_FOUND", "Swap not found at this depot.");
  const now = new Date();
  const name = byName.trim();
  const data: Prisma.VehicleSwapUpdateInput =
    step === "UNLOADED"
      ? swap.unloadedAt
        ? {}
        : { unloadedAt: now, unloadedByName: name }
      : step === "ARRIVED"
        ? swap.arrivedAt
          ? {}
          : { arrivedAt: now, arrivedByName: name }
        : swap.acknowledgedAt
          ? {}
          : { acknowledgedAt: now };
  const updated = Object.keys(data).length > 0 ? await prisma.vehicleSwap.update({ where: { id: swapId }, data }) : swap;
  if (Object.keys(data).length > 0) {
    await recordDecisions([{ actor: user, action: `trip.vehicle_swap.${step.toLowerCase()}`, entityType: "Trip", entityId: tripId, note: name }]);
  }
  return swapView(updated);
}
