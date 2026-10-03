"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { api } from "@/lib/api";
import { writeFailure } from "@/lib/failures";

export type ClaimState = { error?: string; claimedVehicleId?: string };
export type ReleaseState = { error?: string; released?: boolean };

export async function claimVehicle(_previous: ClaimState, formData: FormData): Promise<ClaimState> {
  await requireRole("DRIVER", "/driver");

  const raw = formData.get("vehicleId");
  if (typeof raw !== "string" || raw.trim() === "") {
    return { error: "Enter the vehicle id from the dock card before claiming." };
  }
  const vehicleId = raw.trim().toUpperCase();
  if (!/^[A-Z]{2,4}\d{2,5}$/.test(vehicleId)) {
    return {
      error:
        "Vehicle id should look like VEH043 (letters then digits). Check the dock card and try again.",
    };
  }

  const client = await api();
  const result = await client.PUT("/drivers/me/vehicle", { body: { vehicleId } }).catch(() => null);
  if (!result) {
    const failure = writeFailure(0, "claim the vehicle");
    return { error: `${failure.title}. ${failure.detail}` };
  }
  if (result.error || !result.data) {
    const failure = writeFailure(result.response.status, "claim the vehicle");
    return { error: `${failure.title}. ${failure.detail}` };
  }
  revalidatePath("/driver");
  return { claimedVehicleId: result.data.vehicleId };
}

export async function releaseVehicle(previous: ReleaseState, formData: FormData): Promise<ReleaseState> {
  void previous;
  void formData;
  await requireRole("DRIVER", "/driver");

  const client = await api();
  const result = await client.DELETE("/drivers/me/vehicle", {}).catch(() => null);
  if (!result) {
    const failure = writeFailure(0, "change the vehicle");
    return { error: `${failure.title}. ${failure.detail}` };
  }
  if (result.response.status >= 400) {
    const failure = writeFailure(result.response.status, "change the vehicle");
    return { error: `${failure.title}. ${failure.detail}` };
  }
  revalidatePath("/driver");
  return { released: true };
}
