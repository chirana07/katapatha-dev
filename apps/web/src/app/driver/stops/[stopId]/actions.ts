"use server";

import { revalidatePath } from "next/cache";
import { api } from "@/lib/api";
import { mutationError, type DriverMutation } from "../../api-errors";

type EventType =
  | "ARRIVED"
  | "UNLOAD_START"
  | "DELIVERED"
  | "PART_DELIVERED"
  | "FAILED";

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

async function submitEvent(args: {
  stopId: string;
  type: EventType;
  eventId: string;
  occurredAt: string;
  deviceId: string;
  extras?: {
    orderId?: string | null;
    deliveredUnits?: number | null;
    recipientName?: string | null;
    signatureData?: string | null;
    photoData?: string | null;
    reasonCode?: string | null;
  };
}): Promise<EventState> {
  const client = await api();
  const result = await client.POST("/stops/{stopId}/events", {
    params: { path: { stopId: args.stopId } },
    body: {
      deviceId: args.deviceId,
      events: [
        {
          id: args.eventId,
          type: args.type,
          occurredAt: args.occurredAt,
          orderId: args.extras?.orderId ?? null,
          deliveredUnits: args.extras?.deliveredUnits ?? null,
          recipientName: args.extras?.recipientName ?? null,
          signatureData: args.extras?.signatureData ?? null,
          photoData: args.extras?.photoData ?? null,
          reasonCode: args.extras?.reasonCode ?? null,
        },
      ],
    },
  });

  if (result.error || !result.data) {
    return {
      stopId: args.stopId,
      error: mutationError(result.response.status, MUTATION_LABEL[args.type]),
    };
  }

  const first = result.data.results[0];
  revalidatePath(`/driver/stops/${args.stopId}`);
  revalidatePath("/driver");
  return {
    stopId: args.stopId,
    savedAt: new Date().toISOString(),
    savedEventId: args.eventId,
    savedStatus: (first?.status as EventState["savedStatus"]) ?? "accepted",
    savedConflictState: first?.conflictState ?? null,
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
  return submitEvent({
    stopId,
    type,
    eventId,
    occurredAt: readOccurredAt(formData.get("occurredAt")),
    deviceId: readDeviceId(formData.get("deviceId")),
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

  const unitsRaw = formData.get("deliveredUnits");
  const expectedRaw = formData.get("expectedUnits");
  if (typeof unitsRaw !== "string" || typeof expectedRaw !== "string") {
    return { stopId, error: "This delivery is missing quantity details. Reload the stop and try again." };
  }
  if (!/^\d+$/.test(unitsRaw.trim())) {
    return { stopId, error: "Delivered units must be a whole number, zero or more." };
  }
  const deliveredUnits = Number(unitsRaw);
  const expectedUnits = Number(expectedRaw);
  if (!Number.isFinite(deliveredUnits) || deliveredUnits < 0) {
    return { stopId, error: "Delivered units must be zero or more." };
  }
  if (deliveredUnits > expectedUnits + expectedUnits * 0.5 + 50) {
    return { stopId, error: `${deliveredUnits} is more than this stop ordered (${expectedUnits}). Check the figure before saving.` };
  }

  const orderId = formData.get("orderId");
  const typedOrderId = typeof orderId === "string" && orderId.trim() !== "" ? orderId.trim() : null;

  return submitEvent({
    stopId,
    type: deliveredUnits >= expectedUnits ? "DELIVERED" : "PART_DELIVERED",
    eventId,
    occurredAt: readOccurredAt(formData.get("occurredAt")),
    deviceId: readDeviceId(formData.get("deviceId")),
    extras: {
      orderId: typedOrderId,
      deliveredUnits,
      recipientName: recipient.trim(),
    },
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

  return submitEvent({
    stopId,
    type: "FAILED",
    eventId,
    occurredAt: readOccurredAt(formData.get("occurredAt")),
    deviceId: readDeviceId(formData.get("deviceId")),
    extras: { reasonCode: reasonCode.trim() },
  });
}
