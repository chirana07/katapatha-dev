

import type { ProblemKind } from "@prisma/client";
import { prisma } from "../lib/db";
import { ulid } from "@katapatha/core/offline/ulid";
import { recordDecision } from "../lib/audit";
import type { SessionUser } from "../lib/auth";
import { requireDriverStop } from "../lib/authorization";

/**
 * What a driver does on the road.
 *
 * Every action writes a `StopEvent` whose primary key is a ULID generated at
 * the point of action. Online that is generated here; offline it will be
 * generated on the phone and replayed. Either way the write is idempotent, so
 * the same event can be sent twice without creating two records — which is the
 * whole foundation the offline outbox will stand on.
 */

function clock(at: Date): string {
  return at.toISOString().slice(11, 16);
}

export async function arriveAtStop(stopId: string, actor: SessionUser) {
  await requireDriverStop(actor, stopId);
  const stop = await prisma.tripStop.findUnique({
    where: { id: stopId },
    include: { trip: true },
  });
  if (!stop || stop.status !== "PENDING") return;

  const at = new Date();
  await prisma.$transaction([
    prisma.stopEvent.create({
      data: {
        id: ulid(),
        tripStopId: stopId,
        type: "ARRIVED",
        occurredAt: at,
        actorUserId: actor.id,
      },
    }),
    prisma.tripStop.update({
      where: { id: stopId },
      data: { status: "ARRIVED", arrivedAt: at },
    }),
    prisma.trip.update({
      where: { id: stop.tripId },
      data: { status: "DEPARTED", departedAt: stop.trip.departedAt ?? at },
    }),
  ]);
}

export async function startUnloading(stopId: string, actor: SessionUser) {
  await requireDriverStop(actor, stopId);
  const stop = await prisma.tripStop.findUnique({ where: { id: stopId } });
  if (!stop || stop.status !== "ARRIVED") return;

  await prisma.$transaction([
    prisma.stopEvent.create({
      data: {
        id: ulid(),
        tripStopId: stopId,
        type: "UNLOAD_START",
        occurredAt: new Date(),
        actorUserId: actor.id,
      },
    }),
    prisma.tripStop.update({ where: { id: stopId }, data: { status: "UNLOADING" } }),
  ]);
}

/**
 * Close a stop with proof of delivery.
 *
 * `delivered` carries the units actually handed over per order, which is not
 * always what was loaded: the loader may have flagged a shortfall and the
 * dispatcher may have said send it short. Recording the real number here is
 * what lets the store confirm against reality rather than against the plan.
 */
export async function completeStop(
  stopId: string,
  actor: SessionUser,
  input: {
    recipientName: string;
    delivered: { orderId: string; units: number; expected: number }[];
    signatureData?: string;
    photoData?: string;
  },
) {
  await requireDriverStop(actor, stopId);
  const stop = await prisma.tripStop.findUnique({
    where: { id: stopId },
    include: { trip: true, outlet: true, orders: { include: { order: true } } },
  });
  if (!stop || stop.status === "DONE") return;

  const at = new Date();

  await prisma.$transaction(async (tx) => {
    for (const line of input.delivered) {
      const short = line.units < line.expected;
      await tx.stopEvent.create({
        data: {
          id: ulid(),
          tripStopId: stopId,
          orderId: line.orderId,
          type: short ? "PART_DELIVERED" : "DELIVERED",
          deliveredUnits: line.units,
          recipientName: input.recipientName,
          occurredAt: at,
          actorUserId: actor.id,
        },
      });
      await tx.order.update({
        where: { id: line.orderId },
        data: { status: short ? "PART_DELIVERED" : "DELIVERED" },
      });
    }

    await tx.stopEvent.create({
      data: {
        id: ulid(),
        tripStopId: stopId,
        type: "POD_CAPTURED",
        recipientName: input.recipientName,
        signatureData: input.signatureData,
        photoData: input.photoData,
        occurredAt: at,
        actorUserId: actor.id,
      },
    });

    await tx.tripStop.update({
      where: { id: stopId },
      data: { status: "DONE", leftAt: at },
    });

    // The store hears about it as soon as the vehicle leaves, so receiving
    // staff are not the last to know what actually turned up.
    await tx.notification.create({
      data: {
        outletId: stop.outletId,
        kind: "delivered",
        title: "Your delivery has arrived",
        body: `${stop.trip.vehicleId} delivered at ${clock(at)}. Please confirm what you received.`,
        payload: { tripStopId: stopId },
      },
    });

    const remaining = await tx.tripStop.count({
      where: { tripId: stop.tripId, status: { in: ["PENDING", "ARRIVED", "UNLOADING"] } },
    });
    if (remaining === 0) {
      await tx.trip.update({
        where: { id: stop.tripId },
        data: { status: "COMPLETED", completedAt: at },
      });
    }
  });

  await recordDecision({
    actor,
    action: "stop.deliver",
    entityType: "Outlet",
    entityId: stop.outletId,
    note:
      `${stop.trip.vehicleId} delivered ${input.delivered.reduce((n, l) => n + l.units, 0)} ` +
      `of ${input.delivered.reduce((n, l) => n + l.expected, 0)} units, signed by ${input.recipientName}`,
  });
}

export async function reportProblem(
  actor: SessionUser,
  input: {
    kind: ProblemKind;
    note: string;
    tripId?: string;
    tripStopId?: string;
    orderId?: string;
  },
) {
  if (input.tripStopId) await requireDriverStop(actor, input.tripStopId);
  const at = new Date();
  const id = ulid();

  await prisma.problem.create({
    data: {
      id,
      kind: input.kind,
      note: input.note,
      tripId: input.tripId,
      tripStopId: input.tripStopId,
      orderId: input.orderId,
      raisedByUserId: actor.id,
      occurredAt: at,
    },
  });

  if (input.tripStopId) {
    await prisma.tripStop.update({
      where: { id: input.tripStopId },
      data: { status: "FAILED" },
    });
  }

  await recordDecision({
    actor,
    action: "problem.raise",
    entityType: "Problem",
    entityId: id,
    reasonCode: input.kind,
    note: input.note,
  });

  return id;
}

/** The driver's run for a day: their vehicle's published trips, in order. */
export async function loadRun(vehicleId: string, date: Date) {
  return prisma.trip.findMany({
    where: {
      vehicleId,
      plan: { status: "PUBLISHED", planningDay: { date } },
    },
    orderBy: { tripNo: "asc" },
    include: {
      vehicle: true,
      stops: {
        orderBy: { seq: "asc" },
        include: {
          outlet: true,
          orders: { include: { order: true } },
          stopEvents: { orderBy: { occurredAt: "asc" } },
        },
      },
    },
  });
}
