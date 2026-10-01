import { ulid } from "@katapatha/core/offline/ulid";
import { buildDeliveryEvents } from "../driver/delivery-events";

/**
 * Turns a driver's tap into the events it records.
 *
 * This is the ONLY module that calls ulid(). Every id in the system that the
 * server will treat as a primary key is minted here, which means there is one
 * place to look when asking "could this event be minted twice for one intent?".
 *
 * The id is minted once per intent and then stored. A retry re-sends the stored
 * id, so the server recognises the replay and reports a duplicate -- which is a
 * success. Minting a fresh id per attempt would defeat the entire mechanism and
 * write the same delivery twice; the web console's event-form.tsx makes the same
 * point about rotating a ULID only after a confirmed save.
 *
 * A `batchKey` groups the events of one intent. A delivery is N line events plus
 * one POD_CAPTURED, and the drain must send them together or not at all: a POD
 * arriving without its lines would be a half-recorded delivery on the server.
 */

export type EventType =
  | "ARRIVED"
  | "UNLOAD_START"
  | "DELIVERED"
  | "PART_DELIVERED"
  | "FAILED"
  | "SKIPPED"
  | "POD_CAPTURED";

/** One event, in the shape the contract's StopEvent expects. */
export type OutboxEventInput = {
  id: string;
  type: EventType;
  occurredAt: string;
  orderId: string | null;
  deliveredUnits: number | null;
  recipientName: string | null;
  signatureData: string | null;
  photoData: string | null;
  reasonCode: string | null;
};

export type Intent = {
  /** Groups the events of one tap. Never split across requests. */
  batchKey: string;
  stopId: string;
  events: OutboxEventInput[];
};

function blank(): Omit<OutboxEventInput, "id" | "type" | "occurredAt"> {
  return {
    orderId: null,
    deliveredUnits: null,
    recipientName: null,
    signatureData: null,
    photoData: null,
    reasonCode: null,
  };
}

/** "Record arrival". */
export function arrivalIntent(stopId: string, occurredAt: string): Intent {
  const id = ulid();
  return {
    batchKey: id,
    stopId,
    events: [{ id, type: "ARRIVED", occurredAt, ...blank() }],
  };
}

/** "Start unload". */
export function unloadIntent(stopId: string, occurredAt: string): Intent {
  const id = ulid();
  return {
    batchKey: id,
    stopId,
    events: [{ id, type: "UNLOAD_START", occurredAt, ...blank() }],
  };
}

/**
 * "Complete delivery": one fact per order, then one stop-level proof of
 * delivery carrying the recipient, signature and optional photo.
 *
 * The per-order split is not cosmetic -- it is how a short delivery is recorded,
 * because PART_DELIVERED applies to one order's line, not to the stop.
 */
export function deliveryIntent(input: {
  stopId: string;
  occurredAt: string;
  recipientName: string;
  lines: Array<{ orderId: string; expectedUnits: number; deliveredUnits: number }>;
  signatureData?: string | null;
  photoData?: string | null;
}): Intent {
  const podEventId = ulid();
  const lines = input.lines.map((line) => ({ ...line, eventId: ulid() }));

  const events = buildDeliveryEvents({
    lines,
    podEventId,
    occurredAt: input.occurredAt,
    recipientName: input.recipientName,
    signatureData: input.signatureData ?? null,
    photoData: input.photoData ?? null,
  });

  return {
    // The POD's id names the batch: it is the one event guaranteed to exist.
    batchKey: podEventId,
    stopId: input.stopId,
    events: events.map((event) => ({
      id: event.id,
      type: event.type,
      occurredAt: event.occurredAt,
      orderId: event.orderId,
      deliveredUnits: event.deliveredUnits,
      recipientName: event.recipientName,
      signatureData: event.signatureData,
      photoData: event.photoData,
      reasonCode: null,
    })),
  };
}

/**
 * "Report problem". FAILED closes the stop; SKIPPED records that it was passed
 * over. The reason code comes from the server's vocabulary, not a local list.
 */
export function problemIntent(input: {
  stopId: string;
  occurredAt: string;
  reasonCode: string;
  type?: "FAILED" | "SKIPPED";
}): Intent {
  const id = ulid();
  return {
    batchKey: id,
    stopId: input.stopId,
    events: [
      {
        ...blank(),
        id,
        type: input.type ?? "FAILED",
        occurredAt: input.occurredAt,
        reasonCode: input.reasonCode,
      },
    ],
  };
}

/**
 * Bytes this event will occupy, used to cap a request by size without having to
 * load the blobs back out of SQLite to measure them. Approximate on purpose:
 * it only has to be good enough to keep a batch under the limit.
 */
export function payloadBytes(event: OutboxEventInput): number {
  return (
    (event.signatureData?.length ?? 0) + (event.photoData?.length ?? 0) + 256
  );
}
