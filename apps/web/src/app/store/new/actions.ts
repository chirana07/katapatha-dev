"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { api } from "@/lib/api";
import { mutationError } from "../api-errors";
import { validateOrderQuantities } from "../validation";

export type PlaceOrderState = { error?: string };

export async function placeOrder(
  _previous: PlaceOrderState,
  formData: FormData,
): Promise<PlaceOrderState> {
  const requestId = formData.get("requestId");
  const forDate = formData.get("forDate");
  const quantities = validateOrderQuantities(formData.get("ambient"), formData.get("chilled"));

  if (
    typeof requestId !== "string" ||
    typeof forDate !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(forDate)
  ) {
    return { error: "This order session is no longer valid. Refresh the page and try again." };
  }

  if (!quantities.ok) return { error: quantities.error };

  const client = await api();
  const result = await client.POST("/orders", {
    body: { requestId, forDate, lines: quantities.data },
  });

  if (result.error || !result.data) {
    return { error: mutationError(result.response.status, "place order") };
  }

  revalidatePath("/store");
  const references = result.data.map((order) => order.ref).join(",");
  const jar = await cookies();
  jar.set("katapatha_order_placed", references || "confirmed", {
    httpOnly: true,
    maxAge: 30,
    path: "/store",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });
  redirect("/store");
}
