"use server";

import { revalidatePath } from "next/cache";
import { api } from "@/lib/api";
import { mutationError, type DriverMutation } from "../../api-errors";
import { buildDeliveryEvents, type DeliveryLine } from "../../delivery-events";

type EventType =
  | "ARRIVED"
  | "UNLOAD_START"
  | "DELIVERED"
  | "PART_DELIVERED"
  | "FAILED";

type StopEventInput = {
  id: string;
  type: EventType | "POD_CAPTURED";
  occurredAt: string;
  orderId: string | null;
  deliveredUnits: number | null;
  recipientName: string | null;
  signatureData: string | null;
  photoData: string | null;
  reasonCode: string | null;
};

export type EventState = {
  stopId: string;
  savedAt?: string;
  savedEventId?: string;
  savedStatus?: "accepted" | "duplicate" | "conflict";
  savedConflictState?: string | null;
  error?: string;
};

const MUTATION_LABEL: Record<EventType, DriverMutation> = {
  ARRIVED: "record arrival",
  UNLOAD_START: "start unloading",
  DELIVERED: "complete the delivery",
  PART_DELIVERED: "complete the delivery",
  FAILED: "report the problem",
};

function readUlid(value: FormDataEntryValue | null): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!/^[0-9A-HJKMNP-TV-Z]{26}$/.test(trimmed)) return null;
  return trimmed;
}

function readOccurredAt(value: FormDataEntryValue | null): string {
  if (typeof value === "string" && value.trim() !== "") return value;
  return new Date().toISOString();
}

function readDeviceId(value: FormDataEntryValue | null): string {
  if (typeof value === "string" && value.trim() !== "") return value.trim();
  return "device-unknown";
}

async function submitEvents(args: {
  stopId: string;
  deviceId: string;
  mutation: DriverMutation;
  events: StopEventInput[];
}): Promise<EventState> {
  const client = await api();
  const result = await client.POST("/stops/{stopId}/events", {
    params: { path: { stopId: args.stopId } },
    body: {
      deviceId: args.deviceId,
      events: args.events,
    },
  });

  if (result.error || !result.data) {
    return {
      stopId: args.stopId,
      error: mutationError(result.response.status, args.mutation),
    };
  }

  const results = result.data.results;
  const conflict = results.find((item) => item.status === "conflict");
  const duplicate = results.find((item) => item.status === "duplicate");
  const representative = conflict ?? duplicate ?? results[0];
  revalidatePath(`/driver/stops/${args.stopId}`);
  revalidatePath("/driver");
  return {
    stopId: args.stopId,
    savedAt: new Date().toISOString(),
    savedEventId: representative?.id,
    savedStatus: (representative?.status as EventState["savedStatus"]) ?? "accepted",
    savedConflictState: representative?.conflictState ?? null,
  };
}

function event(input: {
  id: string;
  type: EventType | "POD_CAPTURED";
  occurredAt: string;
  orderId?: string | null;
  deliveredUnits?: number | null;
  recipientName?: string | null;
  reasonCode?: string | null;
}): StopEventInput {
  return {
    id: input.id,
    type: input.type,
    occurredAt: input.occurredAt,
    orderId: input.orderId ?? null,
    deliveredUnits: input.deliveredUnits ?? null,
    recipientName: input.recipientName ?? null,
    signatureData: null,
    photoData: null,
    reasonCode: input.reasonCode ?? null,
  };
}

async function handleBasicTransition(
  previous: EventState,
  formData: FormData,
  type: EventType,
): Promise<EventState> {
  const stopId = formData.get("stopId");
  const eventId = readUlid(formData.get("eventId"));
  if (typeof stopId !== "string" || !stopId || !eventId) {
    return { ...previous, error: "This action is no longer valid. Reload the stop and try again." };
  }
  const occurredAt = readOccurredAt(formData.get("occurredAt"));
  return submitEvents({
    stopId,
    deviceId: readDeviceId(formData.get("deviceId")),
    mutation: MUTATION_LABEL[type],
    events: [event({ id: eventId, type, occurredAt })],
  });
}

export async function recordArrival(previous: EventState, formData: FormData): Promise<EventState> {
  return handleBasicTransition(previous, formData, "ARRIVED");
}

export async function startUnload(previous: EventState, formData: FormData): Promise<EventState> {
  return handleBasicTransition(previous, formData, "UNLOAD_START");
}

export async function completeDelivery(previous: EventState, formData: FormData): Promise<EventState> {
  const stopId = formData.get("stopId");
  const eventId = readUlid(formData.get("eventId"));
  if (typeof stopId !== "string" || !stopId || !eventId) {
    return { ...previous, error: "This delivery is no longer valid. Reload the stop and try again." };
  }

  const recipient = formData.get("recipientName");
  if (typeof recipient !== "string" || recipient.trim().length < 2) {
    return {
      stopId,
      error: "Type the recipient's name before saving. Every delivery is signed off to a real person at the outlet.",
    };
  }

  const orderIds = formData
    .getAll("orderId")
    .filter((value): value is string => typeof value === "string" && value.trim() !== "")
    .map((value) => value.trim());
  if (orderIds.length === 0) {
    return { stopId, error: "This stop has no order lines to deliver. Reload the run and try again." };
  }

  const occurredAt = readOccurredAt(formData.get("occurredAt"));
  const deliveryLines: DeliveryLine[] = [];
  for (const orderId of orderIds) {
    const lineEventId = readUlid(formData.get(`eventId:${orderId}`));
    const unitsRaw = formData.get(`deliveredUnits:${orderId}`);
    const expectedRaw = formData.get(`expectedUnits:${orderId}`);
    if (!lineEventId || typeof unitsRaw !== "string" || typeof expectedRaw !== "string") {
      return { stopId, error: "This delivery is missing order details. Reload the stop and try again." };
    }
    if (!/^\d+$/.test(unitsRaw.trim()) || !/^\d+$/.test(expectedRaw.trim())) {
      return { stopId, error: "Delivered units must be whole numbers, zero or more." };
    }
    const deliveredUnits = Number(unitsRaw);
    const expectedUnits = Number(expectedRaw);
    if (!Number.isSafeInteger(deliveredUnits) || !Number.isSafeInteger(expectedUnits)) {
      return { stopId, error: "Delivered quantities are too large to save safely. Check the figures and try again." };
    }
    if (deliveredUnits > expectedUnits) {
      return {
        stopId,
        error: `${deliveredUnits} is more than the ${expectedUnits} units on this order. Check the figure before saving.`,
      };
    }
    deliveryLines.push({ orderId, expectedUnits, deliveredUnits, eventId: lineEventId });
  }

  const podEventId = readUlid(formData.get("podEventId"));
  if (!podEventId) {
    return { stopId, error: "The proof-of-delivery record is no longer valid. Reload the stop and try again." };
  }
  const events = buildDeliveryEvents({
    lines: deliveryLines,
    podEventId,
    occurredAt,
    recipientName: recipient.trim(),
  });

  return submitEvents({
    stopId,
    deviceId: readDeviceId(formData.get("deviceId")),
    mutation: "complete the delivery",
    events,
  });
}

export async function reportProblem(previous: EventState, formData: FormData): Promise<EventState> {
  const stopId = formData.get("stopId");
  const eventId = readUlid(formData.get("eventId"));
  if (typeof stopId !== "string" || !stopId || !eventId) {
    return { ...previous, error: "This problem report is no longer valid. Reload the stop and try again." };
  }

  const reasonCode = formData.get("reasonCode");
  if (typeof reasonCode !== "string" || reasonCode.trim() === "") {
    return { stopId, error: "Pick a reason — the problem report cannot be filed without one." };
  }

  const occurredAt = readOccurredAt(formData.get("occurredAt"));
  return submitEvents({
    stopId,
    deviceId: readDeviceId(formData.get("deviceId")),
    mutation: "report the problem",
    events: [event({ id: eventId, type: "FAILED", occurredAt, reasonCode: reasonCode.trim() })],
  });
}
