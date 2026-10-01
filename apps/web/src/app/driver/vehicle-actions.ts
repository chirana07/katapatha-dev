"use server";

import { revalidatePath } from "next/cache";
import { api } from "@/lib/api";
import { mutationError } from "./api-errors";

export type ClaimState = { error?: string; claimedVehicleId?: string };
export type ReleaseState = { error?: string; released?: boolean };

export async function claimVehicle(_previous: ClaimState, formData: FormData): Promise<ClaimState> {
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
  const result = await client.PUT("/drivers/me/vehicle", { body: { vehicleId } });
  if (result.error || !result.data) {
    return { error: mutationError(result.response.status, "claim this vehicle") };
  }
  revalidatePath("/driver");
  return { claimedVehicleId: result.data.vehicleId };
}

export async function releaseVehicle(previous: ReleaseState, formData: FormData): Promise<ReleaseState> {
  void previous;
  void formData;
  const client = await api();
  const result = await client.DELETE("/drivers/me/vehicle", {});
  if (result.response.status >= 400) {
    return { error: mutationError(result.response.status, "release the vehicle") };
  }
  revalidatePath("/driver");
  return { released: true };
}
