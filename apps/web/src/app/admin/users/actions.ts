"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { components } from "@katapatha/contracts/types";
import { api } from "@/lib/api";
import { writeFailure, type Failure } from "@/lib/failures";
import { adminOnly, safeReturn, type ApiRefusal } from "../admin-action";
import { readUserForm, validateNewUser, validateUserEdit, type FieldErrors, type UserFormValues } from "./user-form";
import { USERS_PATH } from "./user-view";

type CreateUserRequest = components["schemas"]["CreateUserRequest"];

export type SaveUserState = {
  fieldErrors?: FieldErrors;
  failure?: Failure;
  /** What was submitted, so a refused form keeps what the admin typed (never the password). */
  values?: UserFormValues;
};

export type ActiveState = { failure?: Failure };

/** A refused form comes back without the password or PIN: they should not travel back to the browser. */
function keep(values: UserFormValues): UserFormValues {
  return { ...values, password: "", pin: "" };
}

/**
 * Add an account, or edit one when `userId` is present. The email is only
 * ever sent on create: it is how they sign in, and the decision log names it.
 *
 * Validation runs here as well as in the browser because an action is a POST
 * anyone can send. An email already in use (409) is shown on the email field,
 * where the admin can fix it; any other refusal, such as an admin demoting
 * themselves, is shown above the buttons in the API's own words.
 */
export async function saveUser(_previous: SaveUserState, formData: FormData): Promise<SaveUserState> {
  const userId = formData.get("userId");
  const editing = typeof userId === "string" && userId !== "";
  const action = editing ? "save the account" : "add the account";
  const values = readUserForm(formData);

  const denied = await adminOnly(USERS_PATH, action);
  if (denied) return { failure: denied.failure, values: keep(values) };

  const checked = editing ? validateUserEdit(values) : validateNewUser(values);
  if (!checked.ok) return { fieldErrors: checked.errors, values: keep(values) };

  let status = 0;
  let refusal: ApiRefusal["error"];
  try {
    const client = await api();
    const result = editing
      ? await client.PATCH("/admin/users/{userId}", { params: { path: { userId } }, body: checked.data })
      : await client.POST("/admin/users", { body: checked.data as CreateUserRequest });
    status = result.response.status;
    if (result.error) refusal = (result.error as ApiRefusal).error;
    else if (!result.data) status = status || 500;
  } catch {
    return { failure: writeFailure(0, action), values: keep(values) };
  }

  if (status === 409 && refusal?.code === "EMAIL_TAKEN") {
    return { fieldErrors: { email: "That email is already in use, possibly by a disabled account. Re-enable that one, or use another." }, values: keep(values) };
  }
  if (status === 422 && refusal?.message) {
    return { failure: { title: "The account could not be saved", detail: refusal.message, outcome: "failed" }, values: keep(values) };
  }
  if (status < 200 || status >= 300) return { failure: writeFailure(status, action), values: keep(values) };

  revalidatePath(USERS_PATH);
  // Back to the list, which is how the dialog closes: the page re-renders without it.
  redirect(safeReturn(formData.get("returnTo"), USERS_PATH));
}

/**
 * Disable or re-enable. Never a delete: the decision log points at the
 * account. Disabling also ends every session it has, which the API does.
 */
export async function setUserActive(_previous: ActiveState, formData: FormData): Promise<ActiveState> {
  const userId = formData.get("userId");
  const active = formData.get("active") === "true";
  const action = active ? "re-enable the account" : "disable the account";
  if (typeof userId !== "string" || userId === "" || userId.length > 64) {
    return { failure: writeFailure(400, action) };
  }

  const denied = await adminOnly(USERS_PATH, action);
  if (denied) return { failure: denied.failure };

  let status = 0;
  let refusal: ApiRefusal["error"];
  try {
    const client = await api();
    const result = await client.PATCH("/admin/users/{userId}", { params: { path: { userId } }, body: { active } });
    status = result.response.status;
    if (result.error) refusal = (result.error as ApiRefusal).error;
    else if (!result.data) status = status || 500;
  } catch {
    return { failure: writeFailure(0, action) };
  }

  // The one refusal worth its own words: an admin cannot lock themselves out.
  if (status === 422 && refusal?.message) {
    return { failure: { title: active ? "The account could not be re-enabled" : "The account could not be disabled", detail: refusal.message, outcome: "failed" } };
  }
  if (status < 200 || status >= 300) return { failure: writeFailure(status, action) };

  revalidatePath(USERS_PATH);
  redirect(safeReturn(formData.get("returnTo"), USERS_PATH));
}
