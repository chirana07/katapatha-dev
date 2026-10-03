import { ulid } from "@katapatha/core/offline/ulid";
import { buildDeliveryEvents } from "../driver/delivery-events";
import type { StopStatus } from "../driver/stop-state";

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

export type PodPageKind = "RECEIPT" | "SIGNATURE" | "PHOTO";

/**
 * One page of proof of delivery, as the contract's PodPage has it. `id` is a
 * client ULID minted by newPageId(), so a replayed page cannot be stored twice.
 */
export type PodPageInput = {
  id: string;
  kind: PodPageKind;
  /** Base64 image data URL: png, jpeg, webp or svg+xml. */
  data: string;
  /** Upper-case codes, e.g. CORNERS_NOT_CONFIRMED. Empty when nothing was flagged. */
  qualityFlags: string[];
  /** Device clock when the page was captured, ISO 8601. */
  capturedAt: string;
};

/** The contract's `maxItems` for `pages`, and the server's MAX_POD_PAGES. */
export const MAX_POD_PAGES = 8;

/**
 * Quality flags this app records. They are the DRIVER's own confirmation that a
 * capture is usable -- nothing here is machine analysis -- so an unticked chip is
 * recorded as the matching *_NOT_CONFIRMED flag instead of blocking completion.
 * All match the contract's `^[A-Z][A-Z0-9_]{1,31}$`.
 */
export const CORNERS_NOT_CONFIRMED = "CORNERS_NOT_CONFIRMED";
export const TEXT_NOT_CONFIRMED = "TEXT_NOT_CONFIRMED";
export const SIGNATURE_NOT_CONFIRMED = "SIGNATURE_NOT_CONFIRMED";
export const QUALITY_FLAGS = [
  CORNERS_NOT_CONFIRMED,
  TEXT_NOT_CONFIRMED,
  SIGNATURE_NOT_CONFIRMED,
] as const;

const QUALITY_FLAG_PATTERN = /^[A-Z][A-Z0-9_]{1,31}$/;
const DATA_URL_PATTERN = /^data:image\/(png|jpeg|webp|svg\+xml);base64,/;
/** The contract's PodPage.data maxLength. A longer page is a 422 for the whole request. */
const MAX_PAGE_CHARS = 1_048_576;
const MAX_FLAGS_PER_PAGE = 8;

/** A fresh page id. Pages are ids the server keys on, so they are minted here with the rest. */
export function newPageId(): string {
  return ulid();
}

/**
 * Why these pages cannot be sent, or null. Pure, so a screen can call it before
 * building the intent. A malformed page is a whole-request 422 on the wire, which
 * is the one outcome that loses a driver's record, so it is refused here instead.
 */
export function podPagesProblem(pages: readonly PodPageInput[]): string | null {
  if (pages.length === 0) {
    return "Add a photo of the receipt, or sign on the phone, before completing.";
  }
  if (pages.length > MAX_POD_PAGES) {
    return `A delivery can carry at most ${MAX_POD_PAGES} pages.`;
  }
  const seen = new Set<string>();
  for (const page of pages) {
    if (seen.has(page.id)) return "The same page was added twice.";
    seen.add(page.id);
    if (!DATA_URL_PATTERN.test(page.data)) return "A page is not an image this app can send.";
    if (page.data.length > MAX_PAGE_CHARS) return "A page is too large to send.";
    if (page.qualityFlags.length > MAX_FLAGS_PER_PAGE) return "A page has too many flags.";
    for (const flag of page.qualityFlags) {
      if (!QUALITY_FLAG_PATTERN.test(flag)) return "A page has a flag this app cannot send.";
    }
    if (!Number.isFinite(Date.parse(page.capturedAt))) return "A page has no capture time.";
  }
  return null;
}

/** One event, in the shape the contract's StopEvent expects. */
export type OutboxEventInput = {
  id: string;
  type: EventType;
  occurredAt: string;
  orderId: string | null;
  deliveredUnits: number | null;
  recipientName: string | null;
  /**
   * Legacy single-image fields. New intents never set them (pages replace both);
   * they exist so a row queued by an older build can still be read and sent.
   */
  signatureData: string | null;
  photoData: string | null;
  reasonCode: string | null;
  /** POD_CAPTURED only; empty on every other event. */
  pages: PodPageInput[];
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
    pages: [],
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
 * "Start delivery": ARRIVED (only from PENDING) and UNLOAD_START (from PENDING or
 * ARRIVED) as ONE intent, so one tap is one batch key and the two events cannot
 * be sent in different requests. Both carry the same device clock; the ids are
 * minted in order, so ULID order is event order and the projection and the
 * server (which applies ties in batch order) agree.
 *
 * Returns null when there is nothing to record -- the stop is already UNLOADING
 * or closed -- so a double-tap or a stale screen cannot queue a doomed event.
 */
export function startDeliveryIntent(input: {
  stopId: string;
  status: StopStatus;
  occurredAt: string;
}): Intent | null {
  const types: EventType[] =
    input.status === "PENDING"
      ? ["ARRIVED", "UNLOAD_START"]
      : input.status === "ARRIVED"
        ? ["UNLOAD_START"]
        : [];
  if (types.length === 0) return null;

  const events = types.map(
    (type): OutboxEventInput => ({
      ...blank(),
      id: ulid(),
      type,
      occurredAt: input.occurredAt,
    }),
  );
  return { batchKey: events[0].id, stopId: input.stopId, events };
}

/**
 * "Complete delivery": one fact per order, then one stop-level proof of
 * delivery carrying the recipient and 1..8 pages (receipt photo, signature,
 * photo of the goods).
 *
 * The per-order split is not cosmetic -- it is how a short delivery is recorded,
 * because PART_DELIVERED applies to one order's line, not to the stop.
 */
export function deliveryIntent(input: {
  stopId: string;
  occurredAt: string;
  recipientName: string;
  lines: Array<{ orderId: string; expectedUnits: number; deliveredUnits: number }>;
  pages: readonly PodPageInput[];
}): Intent {
  const problem = podPagesProblem(input.pages);
  if (problem) throw new Error(problem);

  // Lines first, POD last: ULID order is event order, which is the order the
  // drain sends them in and the order the server's applier would meet them.
  const lines = input.lines.map((line) => ({ ...line, eventId: ulid() }));
  const podEventId = ulid();

  const events = buildDeliveryEvents({
    lines,
    podEventId,
    occurredAt: input.occurredAt,
    recipientName: input.recipientName,
    pages: [...input.pages],
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
      signatureData: null,
      photoData: null,
      reasonCode: null,
      pages: event.pages,
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
 * it only has to be good enough to keep a batch under the limit. Pages count.
 */
export function payloadBytes(event: OutboxEventInput): number {
  const pages = event.pages.reduce((sum, page) => sum + page.data.length + 64, 0);
  return (event.signatureData?.length ?? 0) + (event.photoData?.length ?? 0) + pages + 256;
}
