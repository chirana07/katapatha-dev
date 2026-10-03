

import type { PlanSnapshot } from "@katapatha/core/validation/types";
import { DEFAULT_PLAN_CONFIG } from "@katapatha/core/validation/types";
import { prisma } from "../lib/db";
import type { DayContext } from "./plans";
import type { loadPlan } from "./plans";
import type { DepotCode, TripNo } from "@katapatha/core/domain/types";

type LoadedPlan = NonNullable<Awaited<ReturnType<typeof loadPlan>>>;

/**
 * Turn database rows into the plain object the validator works on.
 *
 * This is the only place Prisma meets the validator, and it goes one way. The
 * validator itself never imports a database type, which is what lets the exact
 * same function run in the allocator's self-check, in a Vitest fixture, and in
 * the browser while a dispatcher is mid-drag.
 */
export async function snapshotFromPlan(
  plan: LoadedPlan,
  ctx: DayContext,
): Promise<PlanSnapshot> {
  const orders = new Map(ctx.input.orders.map((o) => [o.ref, o]));
  const idToRef = new Map([...ctx.orderIdByRef].map(([ref, id]) => [id, ref]));

  // Shortfalls raised on this planning day's published trips that still await
  // a decision. A draft being published over them would decide the orders
  // again while the dock is still arguing about them, which is what
  // OPEN_SHORTFALL_AT_PUBLISH exists to flag. This was declared and returned
  // but never filled, so the rule could not fire.
  const openShortfalls = await prisma.shortfall.findMany({
    where: {
      status: "OPEN",
      trip: { plan: { planningDayId: plan.planningDayId, id: { not: plan.id } } },
    },
    select: { order: { select: { ref: true } } },
  });
  const openShortfallOrderRefs = [...new Set(openShortfalls.map((s) => s.order.ref))];

  return {
    date: ctx.input.date,
    depot: ctx.input.depot as DepotCode,
    config: DEFAULT_PLAN_CONFIG,
    reference: {
      vehicles: new Map(ctx.input.vehicles.map((v) => [v.vehicleId, v])),
      outlets: ctx.input.outlets,
      districts: ctx.input.districts,
      allowance: ctx.input.allowance,
      vehicleStatus: new Map(
        ctx.input.vehicles.map((v) => [
          v.vehicleId,
          v.available ? ("AVAILABLE" as const) : ("IN_WORKSHOP" as const),
        ]),
      ),
      fuel: ctx.input.fuel,
    },
    orders,
    trips: plan.trips.map((trip) => ({
      vehicleId: trip.vehicleId,
      tripNo: trip.tripNo as TripNo,
      departAt: trip.plannedDepartAt,
      stops: trip.stops.map((stop) => ({
        seq: stop.seq,
        outletId: stop.outletId,
        orderRefs: stop.orders
          .map(({ order }) => idToRef.get(order.id) ?? order.ref)
          .filter((ref): ref is string => Boolean(ref)),
      })),
    })),
    deferred: plan.assignments
      .filter((a) => a.decision === "DEFERRED")
      .map((a) => ({
        orderRef: idToRef.get(a.orderId) ?? a.order.ref,
        reasonCode: a.reasonCode ?? undefined,
      })),
    openShortfallOrderRefs,
  };
}
