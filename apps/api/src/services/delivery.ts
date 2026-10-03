

import type { ConflictState, PodPageKind, ProblemKind, StopEventType } from "@prisma/client";
import { prisma } from "../lib/db";
import { ulid } from "@katapatha/core/offline/ulid";
import { recordDecision } from "../lib/audit";
import type { SessionUser } from "../lib/auth";
import { requireDriverStop } from "../lib/authorization";

/**
 * What a driver does on the road.
 *
 * Every action writes a `StopEvent` whose primary key is a ULID generated at the
 * point of action. When the caller supplies that id — which the route does, from
 * the client's own event — it becomes the row's primary key, so replaying the
 * same event cannot create a second record. That is the foundation the offline
 * outbox stands on, and it only holds if the CLIENT's id is the one stored: a
 * server-generated id would make the dedup check on POST /stops/:stopId/events
 * look for ids that are never in the table, so every replay would report
 * `accepted` and the contract's "`duplicate` is a success" signal would never
 * appear.
 *
 * `occurredAt` is likewise the caller's to supply. The contract is explicit that
 * it is the DEVICE clock and that the server records its own receipt time
 * separately — which `StopEvent.recordedAt` does, via @default(now()). Stamping
 * server time into `occurredAt` would mean a delivery made offline at 04:12 and
 * drained at 09:40 was recorded as happening at 09:40.
 */

/**
 * Identity and timing for one recorded fact, as the client reported them.
 * Every field is optional so a server-initiated write still works; the route
 * fills all of them from the request.
 */
export type EventMeta = {
  /** The client-minted ULID. Becomes the StopEvent primary key. */
  id?: string;
  /** The device clock, not the server's. */
  occurredAt?: Date;
  /** Which handset recorded it. Not a credential. */
  deviceId?: string;
};

/**
 * A transition the stop's current state does not allow. The applier turns it
 * into a per-event rejection: it is a fact about the stop, so retrying the same
 * event cannot change the answer.
 */
export class StopStateError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** One page of proof of delivery, already validated by the applier. */
export type PodPageInput = {
  /** The client's ULID. Becomes PodPage.id, so a replayed page cannot be stored twice. */
  id: string;
  kind: PodPageKind;
  data: string;
  qualityFlags: string[];
  capturedAt: Date;
};

/** `seq` is the position in the array: that is the order the driver captured them in. */
function pageRows(pages: readonly PodPageInput[]) {
  return pages.map((page, seq) => ({
    id: page.id,
    seq,
    kind: page.kind,
    data: page.data,
    qualityFlags: page.qualityFlags,
    capturedAt: page.capturedAt,
  }));
}

function clock(at: Date): string {
  return at.toISOString().slice(11, 16);
}

/**
 * Record that the vehicle is at the stop.
 *
 * The event row is written whatever the stop's state, because the driver's fact
 * is true whether or not it still moves anything: an ARRIVED that reaches the
 * server after UNLOAD_START (two batches, the second one first) adds nothing to
 * the state machine but is still what happened, and storing it is what lets a
 * replay be recognised. The transition itself only fires from PENDING. Before
 * this the row was skipped whenever the state was ahead, so the event was
 * reported accepted without existing and a retry was "accepted" again forever.
 */
export async function arriveAtStop(stopId: string, actor: SessionUser, meta: EventMeta = {}) {
  await requireDriverStop(actor, stopId);
  const stop = await prisma.tripStop.findUnique({
    where: { id: stopId },
    include: { trip: true },
  });
  if (!stop) throw new StopStateError("STOP_NOT_FOUND", "That stop no longer exists.");

  const at = new Date();
  const event = prisma.stopEvent.create({
    data: {
      id: meta.id ?? ulid(),
      tripStopId: stopId,
      type: "ARRIVED",
      occurredAt: meta.occurredAt ?? at,
      deviceId: meta.deviceId,
      actorUserId: actor.id,
    },
  });
  if (stop.status !== "PENDING") {
    await event;
    return;
  }

  await prisma.$transaction([
    event,
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

/** Record that unloading began. Same rule as arrival: stored always, applied from ARRIVED. */
export async function startUnloading(stopId: string, actor: SessionUser, meta: EventMeta = {}) {
  await requireDriverStop(actor, stopId);
  const stop = await prisma.tripStop.findUnique({ where: { id: stopId } });
  if (!stop) throw new StopStateError("STOP_NOT_FOUND", "That stop no longer exists.");

  // Unloading a stop nobody has arrived at, or one that was failed or skipped,
  // is not a late fact but a wrong one; the device should be told, not agreed with.
  if (stop.status === "PENDING" || stop.status === "FAILED" || stop.status === "SKIPPED") {
    throw new StopStateError(
      "STATE_MISMATCH",
      `Unloading cannot start at a stop that is ${stop.status}.`,
    );
  }

  const event = prisma.stopEvent.create({
    data: {
      id: meta.id ?? ulid(),
      tripStopId: stopId,
      type: "UNLOAD_START",
      occurredAt: meta.occurredAt ?? new Date(),
      deviceId: meta.deviceId,
      actorUserId: actor.id,
    },
  });
  if (stop.status !== "ARRIVED") {
    await event;
    return;
  }
  await prisma.$transaction([
    event,
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
    /** `eventId` is the client's ULID for that line's event, when it sent one. */
    delivered: { orderId: string; units: number; expected: number; eventId?: string }[];
    signatureData?: string;
    photoData?: string;
    /** The client's ULID for the stop-level POD_CAPTURED event. */
    podEventId?: string;
    /**
     * Multi-page proof of delivery, written with the POD event in the same
     * transaction. When present the applier has already dropped the legacy
     * signatureData/photoData for this event, so a picture is stored once.
     */
    pages?: PodPageInput[];
  },
  meta: EventMeta = {},
) {
  await requireDriverStop(actor, stopId);
  const stop = await prisma.tripStop.findUnique({
    where: { id: stopId },
    include: { trip: true, outlet: true, orders: { include: { order: true } } },
  });
  if (!stop) throw new StopStateError("STOP_NOT_FOUND", "That stop no longer exists.");
  // A delivery for a stop that is already closed is not applied and not
  // swallowed: reporting it accepted would store nothing, so every retry would
  // be accepted again and the driver would believe a second delivery happened.
  if (stop.status === "DONE") {
    throw new StopStateError("STOP_ALREADY_CLOSED", "This stop has already been completed.");
  }

  const at = new Date();

  await prisma.$transaction(async (tx) => {
    for (const line of input.delivered) {
      const short = line.units < line.expected;
      await tx.stopEvent.create({
        data: {
          id: line.eventId ?? ulid(),
          tripStopId: stopId,
          orderId: line.orderId,
          type: short ? "PART_DELIVERED" : "DELIVERED",
          deliveredUnits: line.units,
          recipientName: input.recipientName,
          occurredAt: meta.occurredAt ?? at,
          deviceId: meta.deviceId,
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
        id: input.podEventId ?? ulid(),
        tripStopId: stopId,
        type: "POD_CAPTURED",
        recipientName: input.recipientName,
        signatureData: input.signatureData,
        photoData: input.photoData,
        occurredAt: meta.occurredAt ?? at,
        deviceId: meta.deviceId,
        actorUserId: actor.id,
        // Nested, so the pages exist if and only if the event does.
        ...(input.pages?.length ? { podPages: { create: pageRows(input.pages) } } : {}),
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
    /**
     * Which outcome the driver reported. SKIPPED and FAILED are distinct
     * StopStatus values in DOMAIN.md -- a stop passed over is not a stop that
     * failed -- and this used to force FAILED for both.
     */
    outcome?: "FAILED" | "SKIPPED";
  },
  meta: EventMeta = {},
) {
  if (input.tripStopId) {
    const stop = await requireDriverStop(actor, input.tripStopId);
    // A completed stop cannot then fail: that would overwrite a delivery with a
    // problem. Said out loud rather than skipped, for the same reason as above.
    if (stop.status === "DONE") {
      throw new StopStateError("STOP_ALREADY_CLOSED", "This stop has already been completed.");
    }
  }
  const at = new Date();
  const id = ulid();
  const outcome = input.outcome ?? "FAILED";

  await prisma.$transaction(async (tx) => {
    await tx.problem.create({
      data: {
        id,
        kind: input.kind,
        note: input.note,
        tripId: input.tripId,
        tripStopId: input.tripStopId,
        orderId: input.orderId,
        raisedByUserId: actor.id,
        occurredAt: meta.occurredAt ?? at,
      },
    });

    // Also record the driver's fact as a StopEvent, keyed on the client's ULID.
    // Without this a replayed FAILED or SKIPPED was never recognised as a
    // duplicate -- nothing carrying that id existed -- so it was applied again
    // and wrote a SECOND Problem row for one reported problem. The contract also
    // defines FAILED and SKIPPED as StopEvent types, so they belong in the event
    // log next to every other thing the driver did.
    if (input.tripStopId) {
      await tx.stopEvent.create({
        data: {
          id: meta.id ?? ulid(),
          tripStopId: input.tripStopId,
          type: outcome,
          // StopEvent has no reasonCode column (the contract's StopEvent does;
          // the Prisma model carries `payload` instead), so the reason lives there.
          payload: { reasonCode: input.kind },
          occurredAt: meta.occurredAt ?? at,
          deviceId: meta.deviceId,
          actorUserId: actor.id,
        },
      });

      await tx.tripStop.update({
        where: { id: input.tripStopId },
        data: { status: outcome },
      });
    }
  });

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

/**
 * Store a conflicted event without applying it, pages included.
 *
 * services/conflicts.ts has the same function without pages. This one exists
 * because a conflicted POD must keep its pages, for the reason it keeps its
 * signature: the device drops its copy the moment the server calls the event a
 * conflict, and the dispatcher unpicking "who actually delivered?" needs what
 * the other driver claims. Pages are nested in the event's own insert so they
 * cannot be lost between two writes.
 */
export async function recordConflictedFact(input: {
  stopId: string;
  conflictState: Exclude<ConflictState, "NONE">;
  fact: {
    id: string;
    type: StopEventType;
    occurredAt: Date;
    orderId?: string | null;
    deliveredUnits?: number | null;
    recipientName?: string | null;
    signatureData?: string | null;
    photoData?: string | null;
    reasonCode?: string | null;
    pages: PodPageInput[];
  };
  /** True when `fact.orderId` names an order on this stop. */
  orderOnStop: boolean;
  actor: { userId: string; deviceId: string };
}): Promise<void> {
  const { fact } = input;
  const hasPages = fact.pages.length > 0;
  await prisma.stopEvent.create({
    data: {
      id: fact.id,
      tripStopId: input.stopId,
      orderId: input.orderOnStop ? fact.orderId : null,
      type: fact.type,
      payload: fact.reasonCode ? { reasonCode: fact.reasonCode } : undefined,
      deliveredUnits: fact.deliveredUnits ?? null,
      recipientName: fact.recipientName ?? null,
      // Pages and the legacy columns are alternatives, as on an applied event.
      signatureData: hasPages ? null : (fact.signatureData ?? null),
      photoData: hasPages ? null : (fact.photoData ?? null),
      occurredAt: fact.occurredAt,
      deviceId: input.actor.deviceId,
      actorUserId: input.actor.userId,
      conflictState: input.conflictState,
      ...(hasPages ? { podPages: { create: pageRows(fact.pages) } } : {}),
    },
  });
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
