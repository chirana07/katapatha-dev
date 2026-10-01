"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { api } from "@/lib/api";
import { mutationError } from "../../api-errors";
import { validateReceipt } from "../../validation";

export type ReceiptState = { error?: string };

export async function confirmReceipt(
  _previous: ReceiptState,
  formData: FormData,
): Promise<ReceiptState> {
  const orderId = formData.get("orderId");
  const receipt = validateReceipt(
    formData.get("unitsReceived"),
    formData.get("matches"),
    formData.get("issueKind"),
  );
  const noteValue = formData.get("note");

  if (typeof orderId !== "string" || !orderId) {
    return { error: "This receipt session is no longer valid. Return to the order and try again." };
  }
  if (!receipt.ok) return { error: receipt.error };

  const client = await api();
  const result = await client.PUT("/orders/{orderId}/receipt", {
    params: { path: { orderId } },
    body: {
      ...receipt.data,
      note: typeof noteValue === "string" && noteValue.trim() ? noteValue.trim() : null,
    },
  });

  if (result.error || !result.data) {
    return { error: mutationError(result.response.status, "confirm receipt") };
  }

  revalidatePath(`/store/orders/${orderId}`);
  const jar = await cookies();
  jar.set("katapatha_receipt_confirmed", orderId, {
    httpOnly: true,
    maxAge: 30,
    path: "/store/orders",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });
  redirect(`/store/orders/${orderId}`);
}
