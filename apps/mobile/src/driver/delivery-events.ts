/**
 * Builds the event batch for a completed delivery.
 *
 * Ported from apps/web/src/app/driver/delivery-events.ts with ONE intended
 * change: the web console sends no proof of delivery images, because a browser
 * form has no signature pad or camera. The native app captures them, as PAGES
 * (the contract's multi-page POD: a receipt photo, a signature, a photo of the
 * goods), and threads them onto the stop-level POD event.
 *
 * They go on the POD event only, not on the per-order lines. One delivery
 * produces one set of pages: repeating a 200 KB photo on every order line would
 * multiply the payload by the number of orders for no added fact. The legacy
 * single-image fields signatureData / photoData are always null here -- they
 * remain on the wire format only for rows queued by an older build.
 */
export type DeliveryLine = {
  orderId: string;
  expectedUnits: number;
  deliveredUnits: number;
  eventId: string;
};

export type DeliveryEvent = {
  id: string;
  type: "DELIVERED" | "PART_DELIVERED" | "POD_CAPTURED";
  occurredAt: string;
  orderId: string | null;
  deliveredUnits: number | null;
  recipientName: string;
  /** Legacy single image. Always null for a new delivery; pages replace it. */
  signatureData: null;
  /** Legacy single image. Always null for a new delivery; pages replace it. */
  photoData: null;
  /** Set on the POD event only; empty on the lines. */
  pages: DeliveryPage[];
  reasonCode: null;
};

/** Structurally a PodPageInput (src/outbox/intents.ts), declared here so this pure module imports nothing. */
export type DeliveryPage = {
  id: string;
  kind: "RECEIPT" | "SIGNATURE" | "PHOTO";
  data: string;
  qualityFlags: string[];
  capturedAt: string;
};

/** One delivery fact per order, followed by one stop-level POD fact. */
export function buildDeliveryEvents(input: {
  lines: DeliveryLine[];
  podEventId: string;
  occurredAt: string;
  recipientName: string;
  pages: readonly DeliveryPage[];
}): DeliveryEvent[] {
  const lineEvents = input.lines.map((line) => ({
    id: line.eventId,
    type:
      line.deliveredUnits >= line.expectedUnits
        ? ("DELIVERED" as const)
        : ("PART_DELIVERED" as const),
    occurredAt: input.occurredAt,
    orderId: line.orderId,
    deliveredUnits: line.deliveredUnits,
    recipientName: input.recipientName,
    signatureData: null,
    photoData: null,
    pages: [],
    reasonCode: null,
  }));

  return [
    ...lineEvents,
    {
      id: input.podEventId,
      type: "POD_CAPTURED",
      occurredAt: input.occurredAt,
      orderId: null,
      deliveredUnits: null,
      recipientName: input.recipientName,
      signatureData: null,
      photoData: null,
      pages: input.pages.map((page) => ({ ...page, qualityFlags: [...page.qualityFlags] })),
      reasonCode: null,
    },
  ];
}
