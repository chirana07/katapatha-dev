import type { Prisma } from "@prisma/client";
import { asDate } from "./plans";

type OrderRow = Prisma.OrderGetPayload<{ include: { lines: true } }> | Prisma.OrderGetPayload<object>;

function round(value: number, places: number): number {
  const f = 10 ** places;
  return Math.round(value * f) / f;
}

/**
 * A next-day order that carries on from an earlier one.
 *
 * Used when a shortfall leaves units behind (a share of the order) and when a
 * plan defers a whole order to the next run (all of it). Same conventions as
 * POST /orders: an `ORD-` ref allocated from the highest existing one, QUEUED,
 * outlet/brand/district/depot/window copied from the order it follows, weight
 * and volume scaled from it (the same goods, so the same size per unit).
 * `rolledFromOrderId` links it back, and `deferredYesterday` is true: the store
 * was let down on its day, and the allocator's first priority rule exists for
 * exactly an outlet in that position.
 *
 * Two things the order needs in order to be plannable at all, both done here so
 * no caller can forget them: the depot's planning day for the new date exists,
 * and, for a whole order, the product lines it was placed with are copied (an
 * order must never exist without its contents).
 *
 * `clientRequestId` is the idempotency key. Callers pass one derived from what
 * they are rolling over, so a repeat can find the order instead of making a
 * second.
 */
export async function createFollowUpOrder(
  tx: Prisma.TransactionClient,
  order: OrderRow,
  units: number,
  forDate: string,
  userId: string,
  clientRequestId: string,
  options: { copyLines?: boolean } = {},
) {
  const requestedDate = asDate(forDate);
  await tx.planningDay.upsert({
    where: { date_depotCode: { date: requestedDate, depotCode: order.depotCode } },
    create: { date: requestedDate, depotCode: order.depotCode },
    update: {},
  });

  const latest = await tx.order.findFirst({
    where: { ref: { startsWith: "ORD-" } },
    orderBy: { ref: "desc" },
    select: { ref: true },
  });
  const start = latest ? Number.parseInt(latest.ref.slice(4), 10) : 4000;
  const ref = `ORD-${String((Number.isFinite(start) ? start : 4000) + 1).padStart(6, "0")}`;
  const share = units / order.units;

  const lines = options.copyLines
    ? await tx.orderLine.findMany({ where: { orderId: order.id } })
    : [];

  return tx.order.create({
    data: {
      ref,
      outletId: order.outletId,
      brand: order.brand,
      districtName: order.districtName,
      depotCode: order.depotCode,
      tempRequirement: order.tempRequirement,
      units,
      weightKg: round(order.weightKg * share, 1),
      volumeM3: round(order.volumeM3 * share, 2),
      windowOpen: order.windowOpen,
      windowClose: order.windowClose,
      requestedDate,
      placedByUserId: userId,
      status: "QUEUED",
      deferredYesterday: true,
      rolledFromOrderId: order.id,
      clientRequestId,
      ...(lines.length > 0
        ? {
            lines: {
              create: lines.map((l) => ({
                productId: l.productId,
                sku: l.sku,
                productName: l.productName,
                unitLabel: l.unitLabel,
                kgPerUnit: l.kgPerUnit,
                m3PerUnit: l.m3PerUnit,
                quantity: l.quantity,
              })),
            },
          }
        : {}),
    },
  });
}
