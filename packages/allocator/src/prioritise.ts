/**
 * Which order goes first when the fleet cannot take them all.
 *
 * Stated plainly, because a dispatcher has to defend this to three brand
 * managers and the Datathon asks for the policy in writing:
 *
 *  1. An order deferred yesterday goes today. It has already cost a store a
 *     day of trading, and the brief names letting the same outlet slip twice
 *     as a failure of the current process. This dominates everything else.
 *  2. Then the outlets waiting longest, by days since last served.
 *  3. Then the tightest delivery window. Fresh mostly shuts by 08:00, and a
 *     mall bay may be open for only two hours, so those orders have the least
 *     room to be moved later in the day.
 *  4. Then the largest order first. That is best-fit-decreasing, the thing
 *     that makes greedy bin-packing close to optimal rather than merely quick.
 *  5. Then the order reference, so the output never depends on input order.
 *
 * The weights are spaced so each rule dominates the ones below it: nothing
 * about window tightness or size can outweigh having been skipped yesterday.
 */

import type { OrderRef, OutletRef } from "@katapatha/core/domain/types";
import { toMin } from "@katapatha/core/domain/time";

export interface PriorityContext {
  outlets: ReadonlyMap<string, OutletRef>;
  /** Largest volume capacity in the fleet, used to normalise order size. */
  maxVolumeCapM3: number;
}

/**
 * How little room an order has to be served later in the day, from 0 to 1.
 * Fresh is the tightest: most Fresh windows shut before stores open at 08:00.
 */
export function windowTightness(order: OrderRef, outlet: OutletRef | undefined): number {
  if (order.brand === "Fresh") return 1;
  if (outlet?.dockType === "mall_bay" || outlet?.parkingConstraint === "mall_dock") {
    return 0.6;
  }
  // Fall back to the measured width of the window for anything else.
  const width = toMin(order.windowClose) - toMin(order.windowOpen);
  if (width <= 0) return 0.6;
  const normalised = Math.min(width, 12 * 60) / (12 * 60);
  return 0.3 + 0.3 * (1 - normalised);
}

export function priorityScore(order: OrderRef, ctx: PriorityContext): number {
  const outlet = ctx.outlets.get(order.outletId);

  const skippedYesterday = order.deferredYesterday ? 1 : 0;
  const waiting = Math.min(order.daysSinceLastServed, 7) / 7;
  const tightness = windowTightness(order, outlet);
  const size =
    ctx.maxVolumeCapM3 > 0 ? Math.min(order.volumeM3 / ctx.maxVolumeCapM3, 1) : 0;

  return 1000 * skippedYesterday + 300 * waiting + 100 * tightness + 10 * size;
}

/** Highest priority first; ties broken by reference so runs are reproducible. */
export function byPriority(ctx: PriorityContext) {
  return (a: OrderRef, b: OrderRef): number => {
    const diff = priorityScore(b, ctx) - priorityScore(a, ctx);
    if (Math.abs(diff) > 1e-9) return diff;
    return a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : 0;
  };
}

/** A short sentence explaining why this order was ranked where it was. */
export function explainPriority(order: OrderRef, ctx: PriorityContext): string {
  const parts: string[] = [];
  if (order.deferredYesterday) parts.push("deferred yesterday");
  if (order.daysSinceLastServed >= 3) {
    parts.push(`${order.daysSinceLastServed} days since last served`);
  }
  const outlet = ctx.outlets.get(order.outletId);
  if (order.brand === "Fresh") parts.push(`window shuts ${order.windowClose}`);
  else if (outlet?.dockType === "mall_bay") parts.push("fixed mall window");
  if (parts.length === 0) return "routine";
  return parts.join(", ");
}
