"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { api } from "@/lib/api";
import { writeFailure, type Failure } from "@/lib/failures";
import { adminOnly, safeReturn, type ApiRefusal } from "../admin-action";
import { readOutletForm, validateNewOutlet, validateOutletEdit, type FieldErrors, type OutletFormValues } from "./outlet-form";
import { OUTLETS_PATH } from "./outlet-view";

export type SaveOutletState = {
  fieldErrors?: FieldErrors;
  failure?: Failure;
  /** What was submitted, so a refused form keeps what the admin typed. */
  values?: OutletFormValues;
};

/**
 * Add an outlet, or edit one when `outletId` is present. The id, brand and
 * district are only ever sent on create: orders, plans and the depot
 * assignment hang on them, so the API will not change them afterwards.
 *
 * Validation runs here as well as in the browser because an action is a POST
 * anyone can send. An id already taken (409) is shown on the id field, where
 * the admin can fix it; any other refusal with a message is shown above the
 * buttons in the API's own words, since it names the thing that is wrong (an
 * unknown district, say).
 */
export async function saveOutlet(_previous: SaveOutletState, formData: FormData): Promise<SaveOutletState> {
  const outletId = formData.get("outletId");
  const editing = typeof outletId === "string" && outletId !== "";
  const action = editing ? "save the outlet" : "add the outlet";
  const values = readOutletForm(formData);

  const denied = await adminOnly(OUTLETS_PATH, action);
  if (denied) return { failure: denied.failure, values };

  let status = 0;
  let refusal: ApiRefusal["error"];
  try {
    const client = await api();
    let result;
    if (editing) {
      const checked = validateOutletEdit(values);
      if (!checked.ok) return { fieldErrors: checked.errors, values };
      result = await client.PATCH("/admin/outlets/{outletId}", { params: { path: { outletId } }, body: checked.data });
    } else {
      const checked = validateNewOutlet(values);
      if (!checked.ok) return { fieldErrors: checked.errors, values };
      result = await client.POST("/admin/outlets", { body: checked.data });
    }
    status = result.response.status;
    if (result.error) refusal = (result.error as ApiRefusal).error;
    else if (!result.data) status = status || 500;
  } catch {
    return { failure: writeFailure(0, action), values };
  }

  if (status === 409 && refusal?.code === "OUTLET_TAKEN") {
    return { fieldErrors: { id: "An outlet already has that id. Choose another." }, values };
  }
  if (status === 422 && refusal?.message) {
    return { failure: { title: "The outlet could not be saved", detail: refusal.message, outcome: "failed" }, values };
  }
  if (status < 200 || status >= 300) return { failure: writeFailure(status, action), values };

  revalidatePath(OUTLETS_PATH);
  // Back to the list, which is how the dialog closes: the page re-renders without it.
  redirect(safeReturn(formData.get("returnTo"), OUTLETS_PATH));
}
