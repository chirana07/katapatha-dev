import type { Prisma } from "@prisma/client";
import { operatingDaysBetween, previousOperatingDate } from "@katapatha/core/domain/deferral";

/**
 * The two fairness signals the allocator ranks on: whether an outlet was left
 * unserved on the last run, and how many operating days since it was last
 * served. The competition's scenario files supply them; for orders the stores
 * place themselves, nothing did, so every live order carried the defaults
 * (`false`, 1) and the fairness policy had nothing to act on.
 *
 * They are derived when the queue closes and written onto the order rows, not
 * computed on the fly: the dispatcher can re-run the allocator any number of
 * times and must get the same answer each time, and the numbers a decision was
 * made on are then on record.
 */

/** Never more than this: the priority score caps at a week, so older is the same. */
export const MAX_DAYS_SINCE_SERVED = 7;

/** How far back to look for a delivery. Past this an outlet counts as having no history. */
const LOOKBACK_DAYS = 60;

export interface PriorityInputs {
  deferredYesterday: boolean;
  daysSinceLastServed: number;
}

/**
 * The fairness signals for one order.
 *
 * `lastServed` is the day of the outlet's most recent served order in a
 * published plan, or null if there is none on record: then the stored value is
 * kept, because a brand-new outlet is not a starved one and treating it as one
 * would put its very first order ahead of everybody's. `deferredLastRun` is
 * whether any of the outlet's orders was deferred (for a reason that tomorrow
 * can fix) on the previous operating day. A flag already set stays set.
 */
export function derivePriority(args: {
  stored: PriorityInputs;
  date: string;
  lastServed: string | null;
  deferredLastRun: boolean;
  isOperating: (date: string) => boolean | undefined;
}): PriorityInputs {
  const days =
    args.lastServed === null
      ? args.stored.daysSinceLastServed
      : Math.min(MAX_DAYS_SINCE_SERVED, Math.max(1, operatingDaysBetween(args.lastServed, args.date, args.isOperating)));
  return {
    deferredYesterday: args.stored.deferredYesterday || args.deferredLastRun,
    daysSinceLastServed: days,
  };
}

const day = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Derive and store the fairness signals for the live orders of one depot-day.
 *
 * "Live" means placed through the app (`placedByUserId` is set). The
 * competition's scenario and the demo's hero day carry their own values, which
 * are the point of those datasets, and are left exactly as supplied.
 *
 * Returns how many orders changed.
 */
export async function derivePriorityInputs(
  tx: Prisma.TransactionClient,
  date: Date,
  depot: string,
): Promise<number> {
  const orders = await tx.order.findMany({
    where: { requestedDate: date, depotCode: depot, status: { not: "CANCELLED" }, placedByUserId: { not: null } },
    select: { id: true, outletId: true, deferredYesterday: true, daysSinceLastServed: true },
  });
  if (orders.length === 0) return 0;

  const outletIds = [...new Set(orders.map((o) => o.outletId))];
  const since = new Date(date);
  since.setUTCDate(since.getUTCDate() - LOOKBACK_DAYS);

  const [served, calendar] = await Promise.all([
    tx.assignment.findMany({
      where: {
        decision: "SERVED",
        order: { outletId: { in: outletIds } },
        plan: { status: "PUBLISHED", planningDay: { depotCode: depot, date: { gte: since, lt: date } } },
      },
      select: { order: { select: { outletId: true } }, plan: { select: { planningDay: { select: { date: true } } } } },
    }),
    tx.calendarDay.findMany({ where: { date: { gte: since, lte: date } }, select: { date: true, isOperating: true } }),
  ]);
  const operatingByDate = new Map(calendar.map((c) => [day(c.date), c.isOperating]));
  const isOperating = (d: string) => operatingByDate.get(d);

  const lastServed = new Map<string, string>();
  for (const a of served) {
    const d = day(a.plan.planningDay.date);
    const seen = lastServed.get(a.order.outletId);
    if (seen === undefined || d > seen) lastServed.set(a.order.outletId, d);
  }

  const previousRun = previousOperatingDate(day(date), isOperating);
  const deferred = await tx.deferral.findMany({
    where: {
      // A permanent cause has no next run, so it says nothing about being passed over.
      rolledToDate: { not: null },
      order: { outletId: { in: outletIds } },
      plan: { status: "PUBLISHED", planningDay: { depotCode: depot, date: new Date(`${previousRun}T00:00:00.000Z`) } },
    },
    select: { order: { select: { outletId: true } } },
  });
  const deferredOutlets = new Set(deferred.map((d) => d.order.outletId));

  let changed = 0;
  for (const order of orders) {
    const next = derivePriority({
      stored: order,
      date: day(date),
      lastServed: lastServed.get(order.outletId) ?? null,
      deferredLastRun: deferredOutlets.has(order.outletId),
      isOperating,
    });
    if (next.deferredYesterday === order.deferredYesterday && next.daysSinceLastServed === order.daysSinceLastServed) continue;
    await tx.order.update({ where: { id: order.id }, data: next });
    changed += 1;
  }
  return changed;
}
