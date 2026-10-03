import { prisma } from "../lib/db";
import { explainPriority, priorityScore, type PriorityContext } from "@katapatha/allocator/prioritise";
import {
  nextOperatingDate as nextOperatingDay,
  suggestDeferralReason,
} from "@katapatha/core/domain/deferral";
import { nextOperatingDate } from "./store";
import type { Brand, DepotCode, OrderRef, OutletRef } from "@katapatha/core/domain/types";
import { isoDate, type loadPlan } from "./plans";

/**
 * Owner: BE2
 *
 * What the dispatcher's "Defer order" drawer (Figma D-05) reads. Everything
 * here is derived from data the allocator already produced or the reference
 * tables already hold — nothing is invented for the screen.
 */

type LoadedPlan = NonNullable<Awaited<ReturnType<typeof loadPlan>>>;
type LoadedAssignment = LoadedPlan["assignments"][number];

interface StoredCause {
  reasonCode?: string;
  permanent?: boolean;
  explanation?: Array<{ code: string; count: number; sample?: string }>;
  nearMiss?: { vehicleId: string; metric: string; short: number; unit: string } | null;
  suggestion?: string | null;
}

/**
 * The first operating day after `date`. Uses the same calendar lookup as order
 * placement; past the end of the reference calendar it falls back to the
 * shared rule (skip Sundays) rather than returning nothing.
 */
export async function nextRunDate(date: Date): Promise<string> {
  const next = await nextOperatingDate(date);
  return next ? isoDate(next) : nextOperatingDay(isoDate(date), () => undefined);
}

function causeOf(assignment: LoadedAssignment) {
  const raw = (assignment.explanation ?? null) as StoredCause | null;
  if (!raw || typeof raw !== "object" || !raw.reasonCode) return null;
  return {
    rejectionCode: raw.reasonCode,
    permanent: Boolean(raw.permanent),
    explanation: (raw.explanation ?? []).map((line) => ({
      code: line.code,
      count: line.count,
      sample: line.sample ?? null,
    })),
    nearMiss: raw.nearMiss ?? null,
    suggestion: raw.suggestion ?? null,
  };
}

/** The `deferrals[]` rows of GET /plans/{planId}, with the drawer's additive fields. */
export async function describeDeferrals(plan: LoadedPlan) {
  const deferred = plan.assignments.filter((a) => a.decision === "DEFERRED");
  if (deferred.length === 0) return [];

  const outletIds = [...new Set(deferred.map((a) => a.order.outletId))];
  const [managers, movesToDate] = await Promise.all([
    prisma.user.findMany({
      where: { role: "STORE_MANAGER", outletId: { in: outletIds } },
      orderBy: { name: "asc" },
      select: { name: true, outletId: true },
    }),
    nextRunDate(plan.planningDay.date),
  ]);
  const managerByOutlet = new Map<string, string>();
  for (const m of managers) {
    if (m.outletId && !managerByOutlet.has(m.outletId)) managerByOutlet.set(m.outletId, m.name);
  }

  return deferred.map((a) => {
    const order = a.order;
    const cause = causeOf(a);
    const managerName = managerByOutlet.get(order.outletId);
    return {
      assignmentId: a.id,
      orderId: a.orderId,
      orderRef: order.ref,
      reasonCode: a.reasonCode ?? null,
      note: a.note ?? null,
      order: {
        outletId: order.outletId,
        outletName: order.outlet.displayName ?? null,
        brand: order.brand,
        districtName: order.districtName,
        tempRequirement: order.tempRequirement,
        units: order.units,
        volumeM3: order.volumeM3,
        windowOpen: order.windowOpen,
        windowClose: order.windowClose,
        deferredYesterday: order.deferredYesterday,
      },
      cause,
      suggestedReasonCode: suggestDeferralReason(
        cause?.rejectionCode,
        cause?.explanation.map((line) => line.code) ?? [],
      ),
      movesTo: {
        date: movesToDate,
        windowOpen: order.windowOpen,
        windowClose: order.windowClose,
        // Priority rule 1 in the allocator: an order deferred yesterday goes
        // ahead of everything else today. "First", not "guaranteed" — and not
        // at all when the cause is permanent (no vehicle in the fleet could
        // ever take it as it stands), because tomorrow will not fix that.
        firstOnRun: !cause?.permanent,
      },
      notifyRecipient: managerName ? { name: managerName, outletId: order.outletId } : null,
    };
  });
}

function orderRefOf(a: LoadedAssignment): OrderRef {
  const o = a.order;
  return {
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
  };
}

function outletRefOf(a: LoadedAssignment): OutletRef {
  const outlet = a.order.outlet;
  return {
    outletId: outlet.id,
    brand: outlet.brand as Brand,
    district: outlet.districtName,
    depot: outlet.depotCode as DepotCode,
    dockType: outlet.dockType,
    parkingConstraint: outlet.parkingConstraint,
    mallWindowOpen: outlet.mallWindowOpen,
    mallWindowClose: outlet.mallWindowClose,
    windowOpen: outlet.windowOpen,
    windowClose: outlet.windowClose,
  };
}

export type Impact = "lowest" | "protected" | "skipped_twice" | "high";

/** How many competing orders the drawer shows next to this one. */
const MAX_OTHERS = 4;

/** What kind of vehicle this order needed — the resource it competed for. */
function resourceFor(a: LoadedAssignment): "refrigerated vehicle" | "van" | "vehicle" {
  if (a.order.tempRequirement === "chilled") return "refrigerated vehicle";
  if (a.order.outlet.parkingConstraint === "van_only") return "van";
  return "vehicle";
}

/**
 * "Why this order and not another": the orders that were served on a vehicle
 * this order could also have used — the only ones whose deferral could have
 * made room for it. Competition for a vehicle is depot-wide, not per lane: a
 * reefer serving Colombo could have been sent to Puttalam instead.
 *
 * Ranked by the allocator's own priority policy; the lowest-priority served
 * order is the one that would have been cheapest to swap ("lowest").
 * Returns null when the assignment is not a deferral on this plan.
 */
export async function laneAlternatives(plan: LoadedPlan, assignmentId: string) {
  const target = plan.assignments.find((a) => a.id === assignmentId && a.decision === "DEFERRED");
  if (!target) return null;

  // Which vehicle each served order rode on. Every wave counts: a vehicle's
  // two trips are shared across waves, so a predawn order can use up the trip
  // a daytime order needed (VEH103 making two Fresh runs leaves no slot for
  // Tech).
  const vehicleByOrder = new Map<string, { type: string; temp: string }>();
  for (const trip of plan.trips) {
    for (const stop of trip.stops) {
      for (const link of stop.orders) vehicleByOrder.set(link.orderId, trip.vehicle);
    }
  }
  const resource = resourceFor(target);
  const couldCarryTarget = (v: { type: string; temp: string }) =>
    (resource !== "refrigerated vehicle" || v.temp === "reefer") &&
    (target.order.outlet.parkingConstraint !== "van_only" || v.type === "van");

  const competitors = plan.assignments.filter((a) => {
    if (a.decision !== "SERVED") return false;
    const vehicle = vehicleByOrder.get(a.orderId);
    return vehicle ? couldCarryTarget(vehicle) : false;
  });
  const field = [target, ...competitors];

  const fleet = await prisma.vehicle.aggregate({
    where: { depotCode: plan.planningDay.depotCode },
    _max: { volumeCapM3: true },
  });
  const ctx: PriorityContext = {
    outlets: new Map(field.map((a) => [a.order.outletId, outletRefOf(a)])),
    maxVolumeCapM3: fleet._max.volumeCapM3 ?? 0,
  };

  const scored = field
    .map((a) => {
      const ref = orderRefOf(a);
      return { a, ref, score: priorityScore(ref, ctx) };
    })
    .sort((x, y) => y.score - x.score || x.ref.ref.localeCompare(y.ref.ref));

  const lowestScore = scored.length > 0 ? scored[scored.length - 1]!.score : 0;
  const impactOf = (entry: (typeof scored)[number]): Impact => {
    // Deferred yesterday: protected when served, a second skip when not —
    // calling a twice-deferred order "protected" would contradict itself.
    if (entry.a.order.deferredYesterday) {
      return entry.a.decision === "DEFERRED" ? "skipped_twice" : "protected";
    }
    if (entry.score === lowestScore) return "lowest";
    return "high";
  };

  const ranked = scored.map((entry, i) => {
    const why = explainPriority(entry.ref, ctx);
    return {
      orderRef: entry.ref.ref,
      outletId: entry.a.order.outletId,
      outletName: entry.a.order.outlet.displayName ?? null,
      isThisOrder: entry.a.id === target.id,
      decision: entry.a.decision as "SERVED" | "DEFERRED",
      rank: i + 1,
      impact: impactOf(entry),
      why: why === "routine" ? "no priority flags" : why,
    };
  });

  // This order first, then the served orders most worth comparing: the
  // lowest-priority ones, i.e. the realistic swaps.
  const self = ranked.filter((r) => r.isThisOrder);
  const others = ranked
    .filter((r) => !r.isThisOrder)
    .reverse()
    .slice(0, MAX_OTHERS)
    .reverse();

  return {
    lane: {
      brand: target.order.brand,
      districtName: target.order.districtName,
      resource,
      competing: field.length,
    },
    items: [...self, ...others],
  };
}
