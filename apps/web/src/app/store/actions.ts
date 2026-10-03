"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { api } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { writeFailure, type Failure } from "@/lib/failures";
import { safeStorePath, validateReceipt } from "./validation";

export type ReceiptState = { error?: Failure };

/**
 * Confirm what arrived. The same action serves Today's receipt card and the
 * order page, which say where to return to in `returnTo`.
 *
 * A layout cannot guard a server action, so the role is checked here. The API
 * upserts one receipt per order, which is what makes a double click or a retry
 * after a dropped response harmless.
 */
export async function confirmReceipt(_previous: ReceiptState, formData: FormData): Promise<ReceiptState> {
  await requireRole("STORE_MANAGER", "/store");

  const orderId = formData.get("orderId");
  const returnTo = safeStorePath(formData.get("returnTo"));
  const receipt = validateReceipt(
    formData.get("unitsReceived"),
    formData.get("matches"),
    formData.get("issueKind"),
  );
  const noteValue = formData.get("note");

  if (typeof orderId !== "string" || !orderId) {
    return { error: { title: "This receipt is no longer valid", detail: "Return to the order and try again.", outcome: "failed" } };
  }
  if (!receipt.ok) {
    return { error: { title: "Check the receipt", detail: receipt.error, outcome: "failed" } };
  }

  let status = 0;
  let ok = false;
  try {
    const client = await api();
    const result = await client.PUT("/orders/{orderId}/receipt", {
      params: { path: { orderId } },
      body: {
        ...receipt.data,
        note: typeof noteValue === "string" && noteValue.trim() ? noteValue.trim() : null,
      },
    });
    status = result.response.status;
    ok = !result.error && Boolean(result.data);
  } catch {
    // No answer at all: the receipt may or may not have been recorded.
  }

  if (!ok) return { error: writeFailure(status, "confirm the receipt") };

  revalidatePath("/store", "layout");
  redirect(returnTo);
}

/** "Got it" on a notification. Idempotent on the API side; failing quietly is fine, it stays unread. */
export async function markNotificationRead(formData: FormData): Promise<void> {
  await requireRole("STORE_MANAGER", "/store");
  const id = formData.get("notificationId");
  const returnTo = safeStorePath(formData.get("returnTo"));
  if (typeof id === "string" && id) {
    try {
      const client = await api();
      await client.POST("/notifications/{notificationId}/read", { params: { path: { notificationId: id } } });
    } catch {
      // Left unread; the next load shows it again.
    }
  }
  revalidatePath("/store", "layout");
  redirect(returnTo);
}
