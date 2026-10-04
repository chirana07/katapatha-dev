"use server";

import { revalidatePath } from "next/cache";
import { api } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { writeFailure } from "@/lib/failures";
import { validateChillerTemp, validateLoadCheck, type LoadCheckInput } from "./shortage";

/**
 * The dock's writes.
 *
 * Every action re-checks the session: a layout cannot guard an action, and a
 * server action is a public POST endpoint whatever the page above it renders.
 * Inputs are plain objects rather than FormData because the dock is driven
 * from client state (the steppers, the shared "checking as" name); they are
 * validated again here because nothing about the client can be trusted.
 *
 * A failure keeps `outcome`: a request that got no answer may have landed, and
 * the screen must not tell a loader it failed and invite a second check.
 */

export type Failed = { ok: false; title: string; detail: string; outcome: "failed" | "unknown" };

function failed(title: string, detail: string): Failed {
  return { ok: false, title, detail, outcome: "failed" };
}

function fromStatus(status: number, action: string): Failed {
  const failure = writeFailure(status, action);
  return { ok: false, title: failure.title, detail: failure.detail, outcome: failure.outcome === "unknown" ? "unknown" : "failed" };
}

/** Anything refreshed by a load check, a release or a reading: all the dock. */
function refreshDock() {
  revalidatePath("/loader", "layout");
}

export async function recordLoadCheck(input: LoadCheckInput): Promise<{ ok: true } | Failed> {
  await requireRole("LOADER", "/loader");

  const invalid = validateLoadCheck(input);
  if (invalid) return failed("This check cannot be saved", invalid);

  let result;
  try {
    const client = await api();
    result = await client.PUT("/trips/{tripId}/load-checks/{orderId}", {
      params: { path: { tripId: input.tripId, orderId: input.orderId } },
      body: {
        loadedUnits: input.loadedUnits,
        condition: input.condition,
        checkedByName: input.checkedByName.trim(),
        reasonCode: input.condition === "OK" ? null : input.reasonCode,
        clientRequestId: input.clientRequestId,
        ...(input.itemCounts ? { itemCounts: input.itemCounts } : {}),
        ...(input.productSku ? { productSku: input.productSku } : {}),
        ...(input.photoData ? { photoData: input.photoData } : {}),
        ...(input.holdSealing === false ? { holdSealing: false } : {}),
      },
    });
  } catch {
    return fromStatus(0, "record this check");
  }
  if (result.error || !result.data) return fromStatus(result.response.status, "record this check");

  refreshDock();
  return { ok: true };
}

export type Release =
  | { ok: true; status: "READY" | "DEPARTED" | "COMPLETED" | "PLANNED" | "LOADING" | "CANCELLED"; releasedAt: string | null }
  | { ok: false; blocked: { code: string; message: string; count: number | null } }
  | Failed;

/**
 * Asks the server to release the vehicle. The server owns the gate — every line
 * checked, no open shortfall blocking — and answers 409 with the reason, which
 * is how the loader learns a dispatcher has not decided yet.
 */
export async function markTripReady(tripId: string): Promise<Release> {
  await requireRole("LOADER", "/loader");
  if (typeof tripId !== "string" || !tripId) return failed("This trip is not open", "Reload the dock and try again.");

  let result;
  try {
    const client = await api();
    result = await client.POST("/trips/{tripId}/readiness", { params: { path: { tripId } } });
  } catch {
    return fromStatus(0, "mark this vehicle ready");
  }

  if (!result.error && result.data) {
    refreshDock();
    return { ok: true, status: result.data.status, releasedAt: result.data.releasedAt ?? null };
  }

  if (result.response.status === 409) {
    const body = result.error as { error?: { code?: unknown; message?: unknown; details?: Record<string, unknown> } } | undefined;
    const details = body?.error?.details;
    const count = Array.isArray(details?.shortfallIds) ? details.shortfallIds.length : null;
    // A 409 can mean the dispatcher cleared it or another terminal released it
    // while this screen was open; refresh so the page shows the truth.
    refreshDock();
    return {
      ok: false,
      blocked: {
        code: typeof body?.error?.code === "string" ? body.error.code : "BLOCKED",
        message: typeof body?.error?.message === "string" ? body.error.message : "The vehicle cannot be released yet.",
        count,
      },
    };
  }
  return fromStatus(result.response.status, "mark this vehicle ready");
}

export type ChillerSaved = {
  ok: true;
  source: "LOADER_AT_BAY" | "DRIVER_ON_ARRIVAL";
  tempC: number;
  inRange: boolean;
  targetMinC: number;
  targetMaxC: number;
  recordedAt: string;
  recordedByName: string | null;
};

/**
 * A loader at the bay reading the gauge. It is a person's reading, stored with
 * their name and the time — never a sensor value — and an out-of-range figure
 * blocks nothing by itself; the dispatcher sees it in Exceptions.
 */
export async function recordChillerReading(input: {
  tripId: string;
  tempC: number;
  clientReadingId: string;
}): Promise<ChillerSaved | Failed> {
  await requireRole("LOADER", "/loader");
  const invalid = validateChillerTemp(input.tempC);
  if (invalid) return failed("That reading cannot be saved", invalid);
  if (typeof input.tripId !== "string" || !input.tripId) return failed("This trip is not open", "Reload the dock and try again.");
  if (typeof input.clientReadingId !== "string" || input.clientReadingId.length < 8 || input.clientReadingId.length > 64) {
    return failed("That reading cannot be saved", "Reload the page and try again.");
  }

  let result;
  try {
    const client = await api();
    result = await client.POST("/trips/{tripId}/chiller-readings", {
      params: { path: { tripId: input.tripId } },
      body: { tempC: input.tempC, source: "LOADER_AT_BAY", clientReadingId: input.clientReadingId },
    });
  } catch {
    return fromStatus(0, "record this reading");
  }

  if (result.error || !result.data) {
    if (result.response.status === 422) {
      const code = (result.error as { error?: { code?: string } } | undefined)?.error?.code;
      if (code === "CHILLER_NOT_APPLICABLE") return failed("No chiller on this vehicle", "Only refrigerated vehicles take a gauge reading.");
    }
    return fromStatus(result.response.status, "record this reading");
  }

  refreshDock();
  const reading = result.data;
  return {
    ok: true,
    tempC: reading.tempC,
    source: reading.source,
    inRange: reading.inRange,
    targetMinC: reading.targetMinC,
    targetMaxC: reading.targetMaxC,
    recordedAt: reading.recordedAt,
    recordedByName: reading.recordedByName,
  };
}

/**
 * A count in progress: the steppers on an order not yet checked. Saved as the
 * loader works so every other screen sees the vehicle filling up; it is never
 * a check, so it cannot release a vehicle.
 */
export async function saveLoadProgress(input: {
  tripId: string;
  orderId: string;
  loadedUnits: number;
  itemCounts: Record<string, number> | null;
  updatedByName: string;
}): Promise<{ ok: true } | Failed> {
  await requireRole("LOADER", "/loader");
  if (!input.tripId || !input.orderId) return failed("This line is no longer valid", "Reload the trip and try again.");
  if (!Number.isInteger(input.loadedUnits) || input.loadedUnits < 0) return failed("That count cannot be saved", "Counts are whole numbers, zero or more.");
  if (typeof input.updatedByName !== "string" || input.updatedByName.trim().length < 2) {
    return failed("Who is loading?", "Enter who is loading. The dock terminal is shared, so every count carries a real name.");
  }

  let result;
  try {
    const client = await api();
    result = await client.PUT("/trips/{tripId}/load-progress/{orderId}", {
      params: { path: { tripId: input.tripId, orderId: input.orderId } },
      body: {
        loadedUnits: input.loadedUnits,
        updatedByName: input.updatedByName.trim(),
        ...(input.itemCounts ? { itemCounts: input.itemCounts } : {}),
      },
    });
  } catch {
    return fromStatus(0, "save this count");
  }
  if (result.error || !result.data) return fromStatus(result.response.status, "save this count");
  refreshDock();
  return { ok: true };
}

/** The dock working a vehicle swap: unloaded, the new vehicle is here, read. */
export async function recordSwapStep(input: {
  tripId: string;
  swapId: string;
  step: "UNLOADED" | "ARRIVED" | "ACKNOWLEDGED";
  byName: string;
}): Promise<{ ok: true } | Failed> {
  await requireRole("LOADER", "/loader");
  if (!input.tripId || !input.swapId) return failed("This swap is no longer open", "Reload the dock and try again.");
  if (!["UNLOADED", "ARRIVED", "ACKNOWLEDGED"].includes(input.step)) return failed("Unknown step", "Reload the dock and try again.");
  if (typeof input.byName !== "string" || input.byName.trim().length < 2) {
    return failed("Who did this?", "Enter your name. The dock terminal is shared.");
  }

  let result;
  try {
    const client = await api();
    result = await client.POST("/trips/{tripId}/vehicle-swap/{swapId}/steps", {
      params: { path: { tripId: input.tripId, swapId: input.swapId } },
      body: { step: input.step, byName: input.byName.trim() },
    });
  } catch {
    return fromStatus(0, "record this step");
  }
  if (result.error || !result.data) return fromStatus(result.response.status, "record this step");
  refreshDock();
  return { ok: true };
}

/** The shift handover note. One per day; the latest edit wins. */
export async function saveHandoverNote(input: { date: string; body: string; authorName: string }): Promise<{ ok: true } | Failed> {
  await requireRole("LOADER", "/loader");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) return failed("That day is not valid", "Reload the page and try again.");
  const body = typeof input.body === "string" ? input.body.trim() : "";
  if (body.length === 0) return failed("The note is empty", "Write what the next shift needs to know.");
  if (body.length > 2000) return failed("The note is too long", "Keep it under 2000 characters.");
  if (typeof input.authorName !== "string" || input.authorName.trim().length < 2) return failed("Who is writing?", "Enter your name.");

  let result;
  try {
    const client = await api();
    result = await client.PUT("/dock/handover", { body: { date: input.date, body, authorName: input.authorName.trim() } });
  } catch {
    return fromStatus(0, "save the handover note");
  }
  if (result.error || !result.data) return fromStatus(result.response.status, "save the handover note");
  refreshDock();
  return { ok: true };
}
