import type { Prisma } from "@prisma/client";
import { createFollowUpOrder } from "./followUp";

/**
 * Carry deferred orders over to the next run.
 *
 * Publishing a plan tells each deferred outlet "your order moves to Monday",
 * and records a Deferral with that date. Nothing, until now, then put the order
 * on Monday's queue: the promise lived in a notification and a row nobody read,
 * and the goods were simply never planned again. This makes the promise true by
 * queuing a follow-up order for the next operating day, the whole order and its
 * contents, flagged `deferredYesterday` so the allocator ranks it first.
 *
 * The original stays DEFERRED: it is the record of what happened on its day.
 * The follow-up points back at it (`rolledFromOrderId`).
 *
 * Idempotent per plan and order, through the follow-up's `clientRequestId`, so
 * a repeated publish transaction cannot queue a second copy.
 */
export async function rollDeferredOrders(
  tx: Prisma.TransactionClient,
  args: { planId: string; orderIds: readonly string[]; forDate: string; userId: string },
): Promise<string[]> {
  if (args.orderIds.length === 0) return [];

  const orders = await tx.order.findMany({
    where: { id: { in: [...args.orderIds] } },
    orderBy: { ref: "asc" },
  });

  const created: string[] = [];
  for (const order of orders) {
    const key = `rollover:${args.planId}:${order.id}`;
    const already = await tx.order.findUnique({ where: { clientRequestId: key }, select: { id: true } });
    if (already) continue;
    const next = await createFollowUpOrder(tx, order, order.units, args.forDate, args.userId, key, { copyLines: true });
    created.push(next.ref);
  }
  return created;
}
