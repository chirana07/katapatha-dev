"use server";

import { revalidatePath } from "next/cache";
import { api } from "@/lib/api";
import { mutationError } from "../../api-errors";

type Condition = "OK" | "SHORT" | "DAMAGED" | "MISSING";

export type LoadCheckState = {
  tripId: string;
  orderId: string;
  error?: string;
  savedAt?: string;
};

export type ReadinessState = {
  tripId: string;
  error?: string;
  blocking?: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
  releasedAt?: string;
  status?: "READY" | "DEPARTED" | "COMPLETED";
};

const CONDITIONS: Condition[] = ["OK", "SHORT", "DAMAGED", "MISSING"];

function readInt(value: FormDataEntryValue | null): { ok: true; value: number } | { ok: false; error: string } {
  if (typeof value !== "string" || value.trim() === "") {
    return { ok: false, error: "Enter the units loaded. 0 is a valid value when the whole line is missing." };
  }
  if (!/^\d+$/.test(value.trim())) {
    return { ok: false, error: "Enter a whole number — no decimals and no negatives." };
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return { ok: false, error: "Loaded units must be zero or more." };
  }
  if (parsed > 999_999) {
    return { ok: false, error: "That is more units than this trip can carry — check the number." };
  }
  return { ok: true, value: parsed };
}

export async function recordLoadCheck(
  previous: LoadCheckState,
  formData: FormData,
): Promise<LoadCheckState> {
  const tripId = formData.get("tripId");
  const orderId = formData.get("orderId");
  if (typeof tripId !== "string" || typeof orderId !== "string" || !tripId || !orderId) {
    return { ...previous, error: "This line is no longer valid. Reload the trip and try again." };
  }

  const checkedByName = formData.get("checkedByName");
  if (typeof checkedByName !== "string" || checkedByName.trim().length < 2) {
    return {
      tripId,
      orderId,
      error:
        "Type the loader name before saving. The dock terminal is shared, so every check carries a real name.",
    };
  }

  const condition = formData.get("condition");
  if (typeof condition !== "string" || !CONDITIONS.includes(condition as Condition)) {
    return { tripId, orderId, error: "Pick OK, Short, Damaged, or Missing before saving." };
  }
  const typedCondition = condition as Condition;

  const loadedUnits = readInt(formData.get("loadedUnits"));
  if (!loadedUnits.ok) {
    return { tripId, orderId, error: loadedUnits.error };
  }

  let reasonCode: string | null = null;
  if (typedCondition !== "OK") {
    const raw = formData.get("reasonCode");
    if (typeof raw !== "string" || raw.trim() === "") {
      return {
        tripId,
        orderId,
        error: "Pick a reason — a non-OK condition opens a shortfall that blocks departure.",
      };
    }
    reasonCode = raw;
  }

  const clientRequestId = formData.get("clientRequestId");
  const requestId = typeof clientRequestId === "string" && clientRequestId ? clientRequestId : null;

  const client = await api();
  const result = await client.PUT("/trips/{tripId}/load-checks/{orderId}", {
    params: { path: { tripId, orderId } },
    body: {
      loadedUnits: loadedUnits.value,
      condition: typedCondition,
      checkedByName: checkedByName.trim(),
      reasonCode,
      clientRequestId: requestId,
    },
  });

  if (result.error || !result.data) {
    return { tripId, orderId, error: mutationError(result.response.status, "record load check") };
  }

  revalidatePath(`/loader/trips/${tripId}`);
  return { tripId, orderId, savedAt: new Date().toISOString() };
}

export async function markTripReady(
  previous: ReadinessState,
  formData: FormData,
): Promise<ReadinessState> {
  const tripId = formData.get("tripId");
  if (typeof tripId !== "string" || !tripId) {
    return { ...previous, error: "This trip is no longer open. Reload the dock board and try again." };
  }

  const client = await api();
  const result = await client.POST("/trips/{tripId}/readiness", {
    params: { path: { tripId } },
  });

  if (!result.error && result.data) {
    const data = result.data;
    revalidatePath(`/loader/trips/${tripId}`);
    revalidatePath("/loader");
    return {
      tripId,
      releasedAt: data.releasedAt,
      status: (data.status as ReadinessState["status"]) ?? "READY",
    };
  }

  const status = result.response.status;
  if (status === 409) {
    const payload = (result.error ?? {}) as { error?: { code?: string; message?: string; details?: Record<string, unknown> } };
    const blocking = payload.error ?? { code: "BLOCKED", message: "Readiness is blocked. Resolve open items first." };
    return {
      tripId,
      blocking: {
        code: typeof blocking.code === "string" ? blocking.code : "BLOCKED",
        message: typeof blocking.message === "string" ? blocking.message : "Readiness is blocked.",
        details: blocking.details,
      },
    };
  }
  return { tripId, error: mutationError(status, "mark the trip ready") };
}
