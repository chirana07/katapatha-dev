"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { api } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { writeFailure, type Failure } from "@/lib/failures";
import { validateOrderItems } from "../validation";
import { placeRefusal, type ApiRefusal } from "./place-refusal";

export type PlaceOrderState = { error?: Failure };

type ApiError = { error?: ApiRefusal };

/**
 * Place the order, once.
 *
 * `requestId` is minted when the page renders and rides in the form, so a
 * double click, a retry after a dropped response and a back-button resubmit all
 * carry the same key and the API answers the later ones with the first result
 * instead of creating a second order. On success the manager is redirected to
 * the confirmed page, which reads the orders back by id: a refresh there only
 * ever reads.
 *
 * The basket goes as `items`. The API splits it by temperature into one order
 * each and checks that each fits a vehicle using the products' real sizes, so
 * this action no longer splits anything itself: a basket that is too large
 * comes back as a refusal the manager fixes by choosing less.
 */
export async function placeOrder(_previous: PlaceOrderState, formData: FormData): Promise<PlaceOrderState> {
  await requireRole("STORE_MANAGER", "/store/new");

  const requestId = formData.get("requestId");
  const forDate = formData.get("forDate");
  const items = validateOrderItems(formData.get("items"));

  if (typeof requestId !== "string" || typeof forDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(forDate)) {
    return { error: { title: "This order is no longer valid", detail: "Reload the page and start again.", outcome: "failed" } };
  }
  if (!items.ok) return { error: { title: "Check the order", detail: items.error, outcome: "failed" } };

  let status = 0;
  let placed: { id: string }[] | null = null;
  let refusal: ApiRefusal | undefined;
  try {
    const client = await api();
    const result = await client.POST("/orders", { body: { requestId, forDate, items: items.data } });
    status = result.response.status;
    if (!result.error && result.data) placed = result.data;
    else refusal = (result.error as ApiError | undefined)?.error;
  } catch {
    // No answer at all: the order may or may not exist. writeFailure says so.
  }

  if (!placed) {
    return { error: (status === 422 ? placeRefusal(refusal) : null) ?? writeFailure(status, "place the order") };
  }

  revalidatePath("/store", "layout");
  // A replay of an earlier request answers 200 with nothing new to list.
  if (placed.length === 0) redirect("/store/new/confirmed?replayed=1");
  redirect(`/store/new/confirmed?ids=${placed.map((order) => order.id).join(",")}`);
}
