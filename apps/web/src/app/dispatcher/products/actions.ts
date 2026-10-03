"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { components } from "@katapatha/contracts/types";
import { api } from "@/lib/api";
import { requireRole, WorkspaceUnavailableError } from "@/lib/auth";
import { writeFailure, type Failure } from "@/lib/failures";
import {
  readProductForm,
  validateNewProduct,
  validateProductEdit,
  type FieldErrors,
  type ProductFormValues,
} from "./product-form";
import { PRODUCTS_PATH, safeProductsPath } from "./product-view";

type CreateProductRequest = components["schemas"]["CreateProductRequest"];

export type SaveProductState = {
  fieldErrors?: FieldErrors;
  failure?: Failure;
  /** What was submitted, so a refused form keeps what the dispatcher typed. */
  values?: ProductFormValues;
};

export type ActiveState = { failure?: Failure };

type ApiRefusal = { error?: { code?: string; message?: string } };

/**
 * The role check every action here starts with. A layout cannot guard an
 * action, and the catalogue is Waypoint-wide, so unlike the depot actions this
 * needs a dispatcher but not a depot. An unreachable API is answered with the
 * honest "may not have saved" failure rather than an error page.
 */
async function dispatcherOnly(action: string): Promise<{ failure: Failure } | null> {
  try {
    await requireRole("DISPATCHER", PRODUCTS_PATH);
    return null;
  } catch (error) {
    if (error instanceof WorkspaceUnavailableError) return { failure: writeFailure(0, action) };
    throw error;
  }
}

/**
 * Add a product, or edit one when `productId` is present. The SKU is only ever
 * sent on create: it is immutable, and order lines refer to it.
 *
 * Validation runs here as well as in the browser because an action is a POST
 * anyone can send. A SKU already taken (409) is shown on the SKU field, where
 * the dispatcher can fix it; any other refusal is shown above the buttons with
 * the API's own words, since it names the thing that is wrong.
 */
export async function saveProduct(_previous: SaveProductState, formData: FormData): Promise<SaveProductState> {
  const productId = formData.get("productId");
  const editing = typeof productId === "string" && productId !== "";
  const action = editing ? "save the product" : "add the product";
  const values = readProductForm(formData);

  const denied = await dispatcherOnly(action);
  if (denied) return { failure: denied.failure, values };

  const checked = editing ? validateProductEdit(values) : validateNewProduct(values);
  if (!checked.ok) return { fieldErrors: checked.errors, values };

  let status = 0;
  let refusal: ApiRefusal["error"];
  try {
    const client = await api();
    const result = editing
      ? await client.PATCH("/products/{productId}", { params: { path: { productId } }, body: checked.data })
      : await client.POST("/products", { body: checked.data as CreateProductRequest });
    status = result.response.status;
    if (result.error) refusal = (result.error as ApiRefusal).error;
    else if (!result.data) status = status || 500;
  } catch {
    return { failure: writeFailure(0, action), values };
  }

  if (status === 409 && refusal?.code === "SKU_TAKEN") {
    return { fieldErrors: { sku: "That SKU is already in use, possibly by a deactivated product. Choose another." }, values };
  }
  if (status === 422 && refusal?.message) {
    return { failure: { title: "The product could not be saved", detail: refusal.message, outcome: "failed" }, values };
  }
  if (status < 200 || status >= 300) return { failure: writeFailure(status, action), values };

  revalidatePath(PRODUCTS_PATH);
  // Back to the list, which is how the dialog closes: the page re-renders without it.
  redirect(safeProductsPath(formData.get("returnTo")));
}

/**
 * Deactivate or reactivate. Never a delete: past orders point at the product.
 * Deactivating takes it out of every store's picker; orders already placed keep
 * it.
 */
export async function setProductActive(_previous: ActiveState, formData: FormData): Promise<ActiveState> {
  const productId = formData.get("productId");
  const active = formData.get("active") === "true";
  const action = active ? "reactivate the product" : "deactivate the product";
  if (typeof productId !== "string" || productId === "" || productId.length > 64) {
    return { failure: writeFailure(400, action) };
  }

  const denied = await dispatcherOnly(action);
  if (denied) return { failure: denied.failure };

  let status = 0;
  try {
    const client = await api();
    const result = await client.PATCH("/products/{productId}", { params: { path: { productId } }, body: { active } });
    status = result.response.status;
    if (result.error || !result.data) return { failure: writeFailure(status, action) };
  } catch {
    return { failure: writeFailure(0, action) };
  }

  revalidatePath(PRODUCTS_PATH);
  redirect(safeProductsPath(formData.get("returnTo")));
}
