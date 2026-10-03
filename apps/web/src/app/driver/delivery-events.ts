export type DeliveryLine = {
  orderId: string;
  expectedUnits: number;
  deliveredUnits: number;
  eventId: string;
};

/** One captured page of proof of delivery. The id is client-minted, so a replay cannot store it twice. */
export type PodPage = {
  id: string;
  kind: "RECEIPT" | "SIGNATURE" | "PHOTO";
  /** A base64 image data URL. */
  data: string;
  /** Device clock, ISO. */
  capturedAt: string;
};

export type DeliveryEvent = {
  id: string;
  type: "DELIVERED" | "PART_DELIVERED" | "POD_CAPTURED";
  occurredAt: string;
  orderId: string | null;
  deliveredUnits: number | null;
  recipientName: string;
  signatureData: null;
  photoData: null;
  reasonCode: null;
  /** Only on POD_CAPTURED, and only when the driver added a page. */
  pages?: PodPage[];
};

/** One delivery fact per order, followed by one stop-level POD fact carrying the pages. */
export function buildDeliveryEvents(input: {
  lines: DeliveryLine[];
  podEventId: string;
  occurredAt: string;
  recipientName: string;
  pages?: PodPage[];
}): DeliveryEvent[] {
  const lineEvents = input.lines.map((line) => ({
    id: line.eventId,
    type: line.deliveredUnits >= line.expectedUnits ? ("DELIVERED" as const) : ("PART_DELIVERED" as const),
    occurredAt: input.occurredAt,
    orderId: line.orderId,
    deliveredUnits: line.deliveredUnits,
    recipientName: input.recipientName,
    signatureData: null,
    photoData: null,
    reasonCode: null,
  }));

  const pod: DeliveryEvent = {
    id: input.podEventId,
    type: "POD_CAPTURED",
    occurredAt: input.occurredAt,
    orderId: null,
    deliveredUnits: null,
    recipientName: input.recipientName,
    signatureData: null,
    photoData: null,
    reasonCode: null,
  };
  if (input.pages && input.pages.length > 0) pod.pages = input.pages;

  return [...lineEvents, pod];
}
