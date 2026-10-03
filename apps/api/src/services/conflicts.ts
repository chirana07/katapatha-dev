

import type { ConflictState, StopEventType } from "@prisma/client";
import { prisma } from "../lib/db";
import type { SessionUser } from "../lib/auth";
import { requireDriverStop } from "../lib/authorization";

/**
 * Who owned a stop when the driver's phone recorded a fact about it.
 *
 * A stop event is not a request to change state — it is a claim about
 * something that already happened, often hours earlier on a handset with no
 * signal. By the time it reaches the server the stop may have moved to another
 * vehicle, and another driver may already have delivered it. Applying the late
 * event would overwrite the truth with a stale one; rejecting the request
 * outright would throw the driver's record away and leave the outbox retrying
 * a batch that can never succeed.
 *
 * So a third answer: record the event, mark it `conflict`, and do not apply
 * it. `ConflictState` on the stored row says why, the dispatcher can see what
 * the driver claims, and the device settles the row terminally instead of
 * retrying forever. `StopReassignment` is the evidence — it is what makes
 * "which vehicle was carrying OUT107 at 05:52?" an answerable question.
 */

/**
 * The event types that close a stop. A row of one of these kinds, recorded by
 * somebody else, is what "another vehicle already delivered this" looks like
 * in the event log.
 */
const CLOSING_TYPES: readonly StopEventType[] = [
  "DELIVERED",
  "PART_DELIVERED",
  "POD_CAPTURED",
  "FAILED",
  "SKIPPED",
];

/** Whether the actor may write to this stop at all, and on what grounds. */
export type StopAccess =
  /** The stop is on the actor's run right now. */
  | "ALLOWED"
  /** Not theirs any more, but an ACTIVE reassignment proves it once was. */
  | "REASSIGNED_AWAY"
  /** Never theirs. */
  | "DENIED";

export type StopConflictContext = {
  /** The vehicle whose trip owns the stop right now. */
  currentVehicleId: string;
  /** ACTIVE reassignments for the stop, oldest first. */
  reassignments: Array<{ at: Date; fromVehicleId: string; toVehicleId: string }>;
  /** Closing events already on the stop that were actually applied. */
  closedBy: Array<{ deviceId: string | null; actorUserId: string | null }>;
};

/** Identity of whoever is submitting, as the request reports it. */
export type EventActor = {
  userId: string;
  /** The vehicle the actor is claiming. Null for a dispatcher. */
  vehicleId: string | null;
  deviceId: string;
};

/**
 * Can this actor write to this stop?
 *
 * `requireDriverStop` answers only for the stop's *current* owner, which is the
 * right rule online and the wrong one for an outbox: a dispatcher who moved the
 * stop while the phone was offline did not make the driver's records
 * unauthorised, only stale. So a denial is re-asked as a question about
 * history, and an ACTIVE reassignment away from a trip on the actor's own
 * vehicle — at the actor's own depot — is proof the stop really was theirs.
 * Without that proof it stays denied.
 */
export async function resolveStopAccess(
  user: SessionUser,
  stopId: string,
): Promise<StopAccess> {
  try {
    await requireDriverStop(user, stopId);
    return "ALLOWED";
  } catch {
    if (!user.defaultVehicleId || !user.depotCode) return "DENIED";
    const wasTheirs = await prisma.stopReassignment.findFirst({
      where: {
        tripStopId: stopId,
        status: "ACTIVE",
        fromTrip: {
          vehicleId: user.defaultVehicleId,
          plan: { status: "PUBLISHED", planningDay: { depotCode: user.depotCode } },
        },
      },
      select: { id: true },
    });
    return wasTheirs ? "REASSIGNED_AWAY" : "DENIED";
  }
}

/**
 * Ownership history for a set of stops, in one query.
 *
 * Loaded once per request and read per event, because a batch can carry several
 * events for the same stop and the history does not change while it is applied.
 * Previously-conflicted events are excluded from `closedBy`: an event that was
 * never applied cannot have superseded anybody.
 */
export async function loadConflictContexts(
  stopIds: readonly string[],
): Promise<Map<string, StopConflictContext>> {
  if (stopIds.length === 0) return new Map();

  const stops = await prisma.tripStop.findMany({
    where: { id: { in: [...stopIds] } },
    select: {
      id: true,
      trip: { select: { vehicleId: true } },
      reassignments: {
        where: { status: "ACTIVE" },
        orderBy: { at: "asc" },
        select: {
          at: true,
          fromTrip: { select: { vehicleId: true } },
          toTrip: { select: { vehicleId: true } },
        },
      },
      stopEvents: {
        where: { type: { in: [...CLOSING_TYPES] }, conflictState: "NONE" },
        select: { deviceId: true, actorUserId: true },
      },
    },
  });

  return new Map(
    stops.map((stop) => [
      stop.id,
      {
        currentVehicleId: stop.trip.vehicleId,
        reassignments: stop.reassignments.map((row) => ({
          at: row.at,
          fromVehicleId: row.fromTrip.vehicleId,
          toVehicleId: row.toTrip.vehicleId,
        })),
        closedBy: stop.stopEvents,
      },
    ]),
  );
}

/**
 * Was this stop still the actor's when their device recorded this?
 *
 * Two ways the answer is no:
 *
 * - `STALE_ASSIGNMENT` — the latest reassignment at or before `occurredAt`
 *   handed the stop to a different vehicle. The device was acting on an
 *   assignment that had already been withdrawn. A reassignment *after*
 *   `occurredAt` is not a conflict: the driver was the rightful owner at the
 *   moment they were at the outlet, which is the moment the event describes.
 *
 * - `SUPERSEDED` — somebody else, on another handset, has already closed the
 *   stop. The fact is established and this record cannot change it. Checked for
 *   every event type, not only closing ones, because an `ARRIVED` that lands
 *   after another driver finished the stop is just as unapplicable — the state
 *   machine would silently no-op it and the device would be told `accepted`.
 *
 * Reassignment is tested first: when both hold it is the cause and the other is
 * its consequence, so it is the more useful thing to show a dispatcher.
 */
export function detectConflict(
  context: StopConflictContext | undefined,
  event: { occurredAt: Date },
  actor: EventActor,
): ConflictState {
  if (!context) return "NONE";

  // A dispatcher has no claimed vehicle and speaks for whoever owns the stop
  // now, so their own correction never reads back as stale.
  const actorVehicleId = actor.vehicleId ?? context.currentVehicleId;

  const asOf = context.reassignments
    .filter((row) => row.at.getTime() <= event.occurredAt.getTime())
    .at(-1);
  if (asOf && asOf.toVehicleId !== actorVehicleId) return "STALE_ASSIGNMENT";

  const closedByAnother = context.closedBy.some(
    (row) =>
      row.actorUserId !== null &&
      row.actorUserId !== actor.userId &&
      row.deviceId !== actor.deviceId,
  );
  if (closedByAnother) return "SUPERSEDED";

  return "NONE";
}

/** What the device claims happened, as the request carries it. */
export type ConflictedFact = {
  id: string;
  type: StopEventType;
  occurredAt: Date;
  orderId?: string | null;
  deliveredUnits?: number | null;
  recipientName?: string | null;
  signatureData?: string | null;
  photoData?: string | null;
  reasonCode?: string | null;
};

/**
 * Store a conflicted event without applying it.
 *
 * The row matters for two reasons. The dispatcher unpicking "who actually
 * delivered OUT107?" needs to see what the other driver claims — including the
 * signature, since the device drops its copy the moment the server calls it a
 * conflict, which leaves this the only one. And because the primary key is the
 * client's ULID, the row is what makes a *replay* of a conflicted event
 * recognisable: the dedup query finds it and reports the stored
 * `conflictState` instead of counting the conflict a second time.
 *
 * Payload validation is deliberately skipped. A conflicted event is never
 * applied, so a missing `deliveredUnits` cannot corrupt anything, and
 * answering 422 would reject the whole batch and leave the outbox retrying it
 * forever. `orderId` is the one exception: it is a foreign key, so it is only
 * linked when the order is known to be on the stop.
 */
export async function recordConflictedEvent(input: {
  stopId: string;
  conflictState: Exclude<ConflictState, "NONE">;
  fact: ConflictedFact;
  /** True when `fact.orderId` names an order on this stop. */
  orderOnStop: boolean;
  actor: EventActor;
}): Promise<void> {
  const { fact } = input;
  await prisma.stopEvent.create({
    data: {
      id: fact.id,
      tripStopId: input.stopId,
      orderId: input.orderOnStop ? fact.orderId : null,
      type: fact.type,
      payload: fact.reasonCode ? { reasonCode: fact.reasonCode } : undefined,
      deliveredUnits: fact.deliveredUnits ?? null,
      recipientName: fact.recipientName ?? null,
      signatureData: fact.signatureData ?? null,
      photoData: fact.photoData ?? null,
      occurredAt: fact.occurredAt,
      deviceId: input.actor.deviceId,
      actorUserId: input.actor.userId,
      conflictState: input.conflictState,
    },
  });
}
