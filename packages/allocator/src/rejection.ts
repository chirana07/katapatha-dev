/**
 * The rejection ledger — how a deferral learns to explain itself.
 *
 * Every time a candidate vehicle is rejected for an order, the first failing
 * predicate is recorded here. At the end each unplaced order can answer four
 * questions a dispatcher actually asks:
 *
 *   what stopped it        the code that blocked the most candidates
 *   how badly              the top three reasons with counts
 *   how close was it       the single candidate with the smallest shortfall
 *   what would fix it      a sentence derived from the dominant code
 *
 * That turns "9 orders deferred" into something defensible. It is also what
 * gets written to `Assignment.explanation`, so the record survives the day.
 */

import type {
  DeferredOrder,
  ExplanationLine,
  NearMiss,
  Rejection,
  RejectionCode,
} from "./types";
import { PERMANENT_CODES } from "./types";
import type { OrderRef } from "@katapatha/core/domain/types";

/**
 * How much a code matters when several apply. A permanent impossibility
 * outranks a busy fleet, which outranks a near miss on capacity — the
 * dispatcher should hear the most fundamental cause first, not the commonest.
 */
const CODE_WEIGHT: Record<RejectionCode, number> = {
  ORDER_EXCEEDS_FLEET_CAPACITY: 100,
  NO_REEFER_IN_FLEET: 95,
  NO_VAN_IN_FLEET: 95,
  DISTRICT_UNREACHABLE_IN_BUDGET: 90,
  NO_REEFER_AVAILABLE: 80,
  NO_VAN_AVAILABLE: 80,
  WINDOW_UNREACHABLE: 60,
  PREDAWN_BUDGET_EXCEEDED: 55,
  DAYTIME_BUDGET_EXCEEDED: 55,
  NO_TRIP_SLOT: 50,
  FUEL_QUOTA_EXCEEDED: 45,
  VOLUME_CAP_EXCEEDED: 40,
  WEIGHT_CAP_EXCEEDED: 40,
  VEHICLE_IN_WORKSHOP: 20,
  WRONG_DEPOT: 10,
  YIELDED_TO_HIGHER_PRIORITY: 5,
};

export class RejectionLedger {
  private byOrder = new Map<string, Rejection[]>();

  record(orderRef: string, rejection: Rejection): void {
    const list = this.byOrder.get(orderRef);
    if (list) list.push(rejection);
    else this.byOrder.set(orderRef, [rejection]);
  }

  /** Wipe an order's history — used when the repair pass places it after all. */
  clear(orderRef: string): void {
    this.byOrder.delete(orderRef);
  }

  for(orderRef: string): Rejection[] {
    return this.byOrder.get(orderRef) ?? [];
  }

  /** Assemble the full explanation for an order that never found a vehicle. */
  explain(order: OrderRef): DeferredOrder {
    const rejections = this.for(order.ref);

    const counts = new Map<RejectionCode, { count: number; sample?: string }>();
    for (const r of rejections) {
      const entry = counts.get(r.code) ?? { count: 0, sample: r.vehicleId };
      entry.count += 1;
      entry.sample ??= r.vehicleId;
      counts.set(r.code, entry);
    }

    const lines: ExplanationLine[] = [...counts.entries()]
      .map(([code, { count, sample }]) => ({ code, count, sample }))
      .sort(
        (a, b) =>
          CODE_WEIGHT[b.code] - CODE_WEIGHT[a.code] ||
          b.count - a.count ||
          a.code.localeCompare(b.code),
      );

    const reasonCode: RejectionCode = lines[0]?.code ?? "NO_TRIP_SLOT";

    return {
      orderRef: order.ref,
      outletId: order.outletId,
      brand: order.brand,
      district: order.district,
      reasonCode,
      permanent: PERMANENT_CODES.has(reasonCode),
      explanation: lines.slice(0, 3),
      nearMiss: findNearMiss(rejections),
      suggestion: suggest(reasonCode, order, rejections),
    };
  }
}

/**
 * The candidate that came closest. Only capacity-like codes qualify — being
 * the wrong depot is not "nearly" right, so reporting a near miss there would
 * be misleading.
 */
function findNearMiss(rejections: readonly Rejection[]): NearMiss | undefined {
  const measurable = rejections.filter(
    (r) =>
      r.metric !== undefined &&
      r.vehicleId !== undefined &&
      (r.code === "VOLUME_CAP_EXCEEDED" ||
        r.code === "WEIGHT_CAP_EXCEEDED" ||
        r.code === "PREDAWN_BUDGET_EXCEEDED" ||
        r.code === "DAYTIME_BUDGET_EXCEEDED" ||
        r.code === "FUEL_QUOTA_EXCEEDED"),
  );
  if (measurable.length === 0) return undefined;

  let best: Rejection | null = null;
  let bestShort = Infinity;
  for (const r of measurable) {
    const short = r.metric!.have - r.metric!.limit;
    if (short > 0 && short < bestShort) {
      bestShort = short;
      best = r;
    }
  }
  if (!best) return undefined;

  return {
    vehicleId: best.vehicleId!,
    metric: best.metric!,
    short: Number(bestShort.toFixed(2)),
    unit: best.metric!.unit,
  };
}

function fmt(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function suggest(
  code: RejectionCode,
  order: OrderRef,
  rejections: readonly Rejection[],
): string | undefined {
  const workshopVehicles = [
    ...new Set(
      rejections.filter((r) => r.code === "VEHICLE_IN_WORKSHOP").map((r) => r.vehicleId),
    ),
  ].filter(Boolean) as string[];

  switch (code) {
    case "ORDER_EXCEEDS_FLEET_CAPACITY": {
      // Plain words for the dispatcher: what doesn't fit, by how much, and
      // who can fix it. Rule 5 (an order travels whole) is why dispatch can't
      // split it themselves.
      const metric = rejections.find((r) => r.code === code)?.metric;
      if (metric?.name === "weight") {
        return `No vehicle can carry ${fmt(metric.have)} kg in one trip — the largest that can take it holds ${fmt(metric.limit)} kg. An order travels whole on one vehicle, so the store needs to place it as smaller orders.`;
      }
      const have = metric?.have ?? order.volumeM3;
      const largest = metric ? ` — the largest that can take it holds ${fmt(metric.limit)} m³` : "";
      return `No vehicle can carry ${fmt(have)} m³ in one trip${largest}. An order travels whole on one vehicle, so the store needs to place it as smaller orders.`;
    }
    case "NO_REEFER_IN_FLEET":
      return "This depot has no refrigerated vehicle at all. The order has to move to a depot that does.";
    case "NO_VAN_IN_FLEET":
      return `${order.outletId} can only be reached by van, and this depot has none.`;
    case "DISTRICT_UNREACHABLE_IN_BUDGET":
      return `${order.district} cannot be reached and served inside the operating window, even on an empty vehicle.`;
    case "NO_REEFER_AVAILABLE":
      return workshopVehicles.length > 0
        ? `Every refrigerated vehicle is committed. This fits if ${workshopVehicles[0]} returns from the workshop.`
        : "Every refrigerated vehicle is already committed today.";
    case "NO_VAN_AVAILABLE":
      return "Every van is already committed, and this outlet cannot take a truck.";
    case "VOLUME_CAP_EXCEEDED":
    case "WEIGHT_CAP_EXCEEDED":
      return "No committed vehicle has room left. Freeing a smaller order from one of them would let this on.";
    case "PREDAWN_BUDGET_EXCEEDED":
      return `Adding this stop pushes a vehicle past the pre-dawn window. A second vehicle on ${order.district} would absorb it.`;
    case "DAYTIME_BUDGET_EXCEEDED":
      return `Adding this stop pushes a vehicle past the trading day on ${order.district}.`;
    case "NO_TRIP_SLOT":
      return "Every compatible vehicle has already used both its trips.";
    case "FUEL_QUOTA_EXCEEDED":
      return "The vehicles that could take this have no weekly fuel left. Raising the quota or spreading the long runs would free it.";
    case "WINDOW_UNREACHABLE":
      return `${order.outletId} closes at ${order.windowClose} and cannot be reached in time from the depot.`;
    case "YIELDED_TO_HIGHER_PRIORITY":
      return "Space went to an outlet that had already been skipped.";
    default:
      return undefined;
  }
}
