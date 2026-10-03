"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { api } from "@/lib/api";
import { requireRole, WorkspaceUnavailableError } from "@/lib/auth";
import { isDateOnly } from "@/lib/dates";
import { writeFailure, type Failure } from "@/lib/failures";

const HOME = "/dispatcher/vehicles";

export type AvailabilityState = { failure?: Failure };

function text(formData: FormData, name: string) {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Mark a vehicle in the workshop, or back in service, for a day that is still
 * editable.
 *
 * The dashboard's fleet action finishes on the dashboard, which is the wrong
 * place to land after a change made from this panel, so this screen has its own.
 * It answers with a `Failure` for the form to show where the dispatcher is
 * looking, and redirects only on success — so a failure never discards what
 * they typed, and `writeFailure` keeps "may or may not have saved" honest.
 */
export async function setAvailability(_previous: AvailabilityState, formData: FormData): Promise<AvailabilityState> {
  const date = text(formData, "date");
  const vehicleId = text(formData, "vehicleId");
  const status = text(formData, "status");
  const note = text(formData, "note").slice(0, 200);
  const action = status === "IN_WORKSHOP" ? "mark the vehicle unavailable" : "put the vehicle back in service";

  if (!isDateOnly(date) || !vehicleId || vehicleId.length > 32 || (status !== "AVAILABLE" && status !== "IN_WORKSHOP")) {
    return { failure: writeFailure(400, action) };
  }

  // A layout cannot guard an action, so the role is re-checked here.
  try {
    await requireRole("DISPATCHER", HOME);
  } catch (error) {
    if (error instanceof WorkspaceUnavailableError) return { failure: writeFailure(0, action) };
    throw error;
  }

  const client = await api();
  let result;
  try {
    result = await client.PUT("/fleet/status/{vehicleId}", {
      params: { path: { vehicleId } },
      body: { date, status, note: note || null },
    });
  } catch {
    return { failure: writeFailure(0, action) };
  }

  if (result.error || !result.data) return { failure: writeFailure(result.response.status, action) };

  revalidatePath(HOME);
  const params = new URLSearchParams({ date, vehicle: vehicleId, notice: status === "IN_WORKSHOP" ? "unavailable" : "available" });
  redirect(`${HOME}?${params.toString()}`);
}
