/**
 * Builds the event batch for a completed delivery.
 *
 * Ported from apps/web/src/app/driver/delivery-events.ts with ONE intended
 * change: the web console hard-codes signatureData and photoData to null,
 * because a browser form has no signature pad or camera. Capturing them for
 * real is the native app's job, so both fields widen to `string | null` and are
 * threaded onto the stop-level POD event.
 *
 * They go on the POD event only, not on the per-order lines. The contract allows
 * them anywhere, but one delivery produces one signature: repeating a 200 KB
 * photo on every order line would multiply the payload by the number of orders
 * for no added fact.
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
  /** Base64 data URL. Set on the POD event only. */
  signatureData: string | null;
  /** Base64 data URL. Set on the POD event only, and optional. */
  photoData: string | null;
  reasonCode: null;
};

/** One delivery fact per order, followed by one stop-level POD fact. */
export function buildDeliveryEvents(input: {
  lines: DeliveryLine[];
  podEventId: string;
  occurredAt: string;
  recipientName: string;
  signatureData?: string | null;
  photoData?: string | null;
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
      signatureData: input.signatureData ?? null,
      photoData: input.photoData ?? null,
      reasonCode: null,
    },
  ];
}
