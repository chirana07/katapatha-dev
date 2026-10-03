"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { splitUnits } from "@katapatha/core/domain/orderSize";
import { api } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { writeFailure, type Failure } from "@/lib/failures";
import { validateOrderQuantities } from "../validation";

export type PlaceOrderState = { error?: Failure };

type ApiError = { error?: { code?: string; message?: string } };

/**
 * Place the order, once.
 *
 * `requestId` is minted when the page renders and rides in the form, so a
 * double click, a retry after a dropped response and a back-button resubmit all
 * carry the same key and the API answers the later ones with the first result
 * instead of creating a second order. On success the manager is redirected to
 * the confirmed page, which reads the orders back by id: a refresh there only
 * ever reads.
 */
export async function placeOrder(_previous: PlaceOrderState, formData: FormData): Promise<PlaceOrderState> {
  await requireRole("STORE_MANAGER", "/store/new");

  const requestId = formData.get("requestId");
  const forDate = formData.get("forDate");
  const quantities = validateOrderQuantities(formData.get("ambient"), formData.get("chilled"));

  if (typeof requestId !== "string" || typeof forDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(forDate)) {
    return { error: { title: "This order is no longer valid", detail: "Reload the page and start again.", outcome: "failed" } };
  }
  if (!quantities.ok) return { error: { title: "Check the quantities", detail: quantities.error, outcome: "failed" } };

  let status = 0;
  let placed: { id: string }[] | null = null;
  let refusal: ApiError["error"];
  try {
    const client = await api();

    // Rule 5: an order travels whole. A quantity bigger than any vehicle that
    // can reach this outlet is raised as several equal orders — the form told
    // the manager so before they pressed the button. If the limits can't be
    // read, send the lines as entered; the API refuses an impossible line.
    let lines = quantities.data;
    const limits = await client.GET("/orders/limits").catch(() => null);
    if (limits?.data) {
      const split: typeof lines = [];
      for (const line of lines) {
        const max = limits.data[line.tempRequirement].maxUnitsPerOrder;
        if (max <= 0) {
          return {
            error: {
              title: `${line.tempRequirement === "chilled" ? "Chilled" : "Ambient"} goods can't be delivered here`,
              detail: "No vehicle at your depot can carry them to this outlet. Contact your dispatcher.",
              outcome: "failed",
            },
          };
        }
        for (const units of splitUnits(line.units, max)) split.push({ ...line, units });
      }
      lines = split;
    }

    const result = await client.POST("/orders", { body: { requestId, forDate, lines } });
    status = result.response.status;
    if (!result.error && result.data) placed = result.data;
    else refusal = (result.error as ApiError | undefined)?.error;
  } catch {
    // No answer at all: the order may or may not exist. writeFailure says so.
  }

  if (!placed) {
    if (refusal?.code === "ORDER_TOO_LARGE" && refusal.message) {
      return { error: { title: "That order is too large", detail: refusal.message, outcome: "failed" } };
    }
    return { error: writeFailure(status, "place the order") };
  }

  revalidatePath("/store", "layout");
  // A replay of an earlier request answers 200 with nothing new to list.
  if (placed.length === 0) redirect("/store/new/confirmed?replayed=1");
  redirect(`/store/new/confirmed?ids=${placed.map((order) => order.id).join(",")}`);
}
