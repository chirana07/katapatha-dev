"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { submitStopEvents, type StopEventInput } from "../../submit-events.server";

type SimpleType = "ARRIVED" | "UNLOAD_START" | "FAILED";

export type EventState = {
  stopId: string;
  savedAt?: string;
  savedDuplicate?: boolean;
  staleAssignment?: boolean;
  error?: string;
};

const ACTION_WORDS: Record<SimpleType, string> = {
  ARRIVED: "record the arrival",
  UNLOAD_START: "start the unload",
  FAILED: "report the problem",
};

function readUlid(value: FormDataEntryValue | null): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return /^[0-9A-HJKMNP-TV-Z]{26}$/.test(trimmed) ? trimmed : null;
}

function readOccurredAt(value: FormDataEntryValue | null): string {
  if (typeof value === "string" && value.trim() !== "" && !Number.isNaN(Date.parse(value))) return value;
  return new Date().toISOString();
}

function readDeviceId(value: FormDataEntryValue | null): string {
  if (typeof value === "string" && value.trim() !== "") return value.trim();
  return "device-unknown";
}

function simpleEvent(id: string, type: SimpleType, occurredAt: string, reasonCode: string | null): StopEventInput {
  return {
    id,
    type,
    occurredAt,
    orderId: null,
    deliveredUnits: null,
    recipientName: null,
    signatureData: null,
    photoData: null,
    reasonCode,
  };
}

async function recordSimple(
  previous: EventState,
  formData: FormData,
  type: SimpleType,
  reasonCode: string | null,
): Promise<EventState> {
  const stopId = formData.get("stopId");
  const eventId = readUlid(formData.get("eventId"));
  if (typeof stopId !== "string" || !stopId || !eventId) {
    return { ...previous, error: "This action is no longer valid. Reload the stop and try again." };
  }

  const result = await submitStopEvents({
    stopId,
    deviceId: readDeviceId(formData.get("deviceId")),
    action: ACTION_WORDS[type],
    events: [simpleEvent(eventId, type, readOccurredAt(formData.get("occurredAt")), reasonCode)],
  });
  if (!result.ok) return { stopId, error: result.error };

  revalidatePath(`/driver/stops/${stopId}`);
  revalidatePath("/driver");
  return {
    stopId,
    savedAt: new Date().toISOString(),
    savedDuplicate: result.duplicate,
    staleAssignment: result.staleAssignment,
  };
}

export async function recordArrival(previous: EventState, formData: FormData): Promise<EventState> {
  await requireRole("DRIVER", "/driver");
  return recordSimple(previous, formData, "ARRIVED", null);
}

export async function startUnload(previous: EventState, formData: FormData): Promise<EventState> {
  await requireRole("DRIVER", "/driver");
  return recordSimple(previous, formData, "UNLOAD_START", null);
}

export async function reportProblem(previous: EventState, formData: FormData): Promise<EventState> {
  await requireRole("DRIVER", "/driver");
  const reasonCode = formData.get("reasonCode");
  if (typeof reasonCode !== "string" || reasonCode.trim() === "") {
    const stopId = formData.get("stopId");
    return { stopId: typeof stopId === "string" ? stopId : previous.stopId, error: "Pick a reason. The problem cannot be reported without one." };
  }
  return recordSimple(previous, formData, "FAILED", reasonCode.trim());
}
