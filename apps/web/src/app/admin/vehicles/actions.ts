"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { components } from "@katapatha/contracts/types";
import { api } from "@/lib/api";
import { writeFailure, type Failure } from "@/lib/failures";
import { adminOnly, safeReturn, type ApiRefusal } from "../admin-action";
import { readVehicleForm, validateNewVehicle, validateVehicleEdit, type FieldErrors, type VehicleFormValues } from "./vehicle-form";
import { VEHICLES_PATH } from "./vehicle-view";

type CreateVehicleRequest = components["schemas"]["CreateVehicleRequest"];
type UpdateVehicleRequest = components["schemas"]["UpdateVehicleRequest"];

export type SaveVehicleState = {
  fieldErrors?: FieldErrors;
  failure?: Failure;
  /** What was submitted, so a refused form keeps what the admin typed. */
  values?: VehicleFormValues;
};

/**
 * Add a vehicle, or edit one when `vehicleId` is present. The id and depot are
 * only ever sent on create: plans, trips and fuel ledgers hang on both, so
 * neither changes afterwards. There is no delete for the same reason.
 *
 * Validation runs here as well as in the browser because an action is a POST
 * anyone can send. A depot that does not exist is left to the API, whose 422
 * names it. An id already taken (409) is shown on the id field, where the
 * admin can fix it; any other refusal is shown above the buttons with the
 * API's own words, since it names the thing that is wrong.
 */
export async function saveVehicle(_previous: SaveVehicleState, formData: FormData): Promise<SaveVehicleState> {
  const vehicleId = formData.get("vehicleId");
  const editing = typeof vehicleId === "string" && vehicleId !== "";
  const action = editing ? "save the vehicle" : "add the vehicle";
  const values = readVehicleForm(formData);

  const denied = await adminOnly(VEHICLES_PATH, action);
  if (denied) return { failure: denied.failure, values };

  let request: { kind: "edit"; vehicleId: string; body: UpdateVehicleRequest } | { kind: "create"; body: CreateVehicleRequest };
  if (editing) {
    const checked = validateVehicleEdit(values);
    if (!checked.ok) return { fieldErrors: checked.errors, values };
    request = { kind: "edit", vehicleId, body: checked.data };
  } else {
    const checked = validateNewVehicle(values);
    if (!checked.ok) return { fieldErrors: checked.errors, values };
    request = { kind: "create", body: checked.data };
  }

  let status = 0;
  let refusal: ApiRefusal["error"];
  try {
    const client = await api();
    const result =
      request.kind === "edit"
        ? await client.PATCH("/admin/vehicles/{vehicleId}", { params: { path: { vehicleId: request.vehicleId } }, body: request.body })
        : await client.POST("/admin/vehicles", { body: request.body });
    status = result.response.status;
    if (result.error) refusal = (result.error as ApiRefusal).error;
    else if (!result.data) status = status || 500;
  } catch {
    return { failure: writeFailure(0, action), values };
  }

  if (status === 409 && refusal?.code === "VEHICLE_TAKEN") {
    return { fieldErrors: { id: "A vehicle already has that id. Choose another." }, values };
  }
  if (status === 422 && refusal?.message) {
    return { failure: { title: "The vehicle could not be saved", detail: refusal.message, outcome: "failed" }, values };
  }
  if (status < 200 || status >= 300) return { failure: writeFailure(status, action), values };

  revalidatePath(VEHICLES_PATH);
  // Back to the list, which is how the dialog closes: the page re-renders without it.
  redirect(safeReturn(formData.get("returnTo"), VEHICLES_PATH));
}
