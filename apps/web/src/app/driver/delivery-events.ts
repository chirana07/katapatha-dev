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
  signatureData: null;
  photoData: null;
  reasonCode: null;
};

/** One delivery fact per order, followed by one stop-level POD fact. */
export function buildDeliveryEvents(input: {
  lines: DeliveryLine[];
  podEventId: string;
  occurredAt: string;
  recipientName: string;
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
      reasonCode: null,
    },
  ];
}
