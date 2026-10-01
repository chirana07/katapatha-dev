"use server";

import type { components } from "@katapatha/contracts/types";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { api } from "@/lib/api";

export type ReceiptState = { error?: string };

const ISSUE_KINDS = ["ITEMS_MISSING", "ITEMS_DAMAGED", "ARRIVED_WARM", "WRONG_ITEMS"] as const;
type IssueKind = NonNullable<components["schemas"]["ReceiptRequest"]["issueKind"]>;

export async function confirmReceipt(
  _previous: ReceiptState,
  formData: FormData,
): Promise<ReceiptState> {
  const orderId = formData.get("orderId");
  const units = Number(formData.get("unitsReceived"));
  const matches = formData.get("matches") === "yes";
  const issueValue = formData.get("issueKind");
  const noteValue = formData.get("note");

  if (typeof orderId !== "string" || !orderId) {
    return { error: "This receipt session is no longer valid. Return to the order and try again." };
  }
  if (!Number.isInteger(units) || units < 0) {
    return { error: "Enter the whole number of units received." };
  }

  const issueKind: IssueKind | null =
    typeof issueValue === "string" && ISSUE_KINDS.includes(issueValue as IssueKind)
      ? (issueValue as IssueKind)
      : null;
  if (!matches && !issueKind) {
    return { error: "Choose what was wrong with the delivery before confirming receipt." };
  }

  const client = await api();
  const result = await client.PUT("/orders/{orderId}/receipt", {
    params: { path: { orderId } },
    body: {
      unitsReceived: units,
      matches,
      issueKind: matches ? null : issueKind,
      note: typeof noteValue === "string" && noteValue.trim() ? noteValue.trim() : null,
    },
  });

  if (result.error || !result.data) {
    return { error: "The receipt could not be recorded. Check the connection and try again." };
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
