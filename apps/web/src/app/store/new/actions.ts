"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { splitUnits } from "@katapatha/core/domain/orderSize";
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

  // Rule 5: an order travels whole. A quantity bigger than any vehicle that
  // can reach this outlet is raised as several equal orders — the form told
  // the store manager this before they pressed the button. If the limits
  // can't be read, send the lines as entered; the API refuses an impossible
  // line on its own.
  let lines = quantities.data;
  const limits = await client.GET("/orders/limits").catch(() => null);
  if (limits?.data) {
    const split: typeof lines = [];
    for (const line of lines) {
      const max = limits.data[line.tempRequirement].maxUnitsPerOrder;
      if (max <= 0) {
        return { error: `No vehicle at your depot can carry ${line.tempRequirement} goods to this outlet. Contact your dispatcher.` };
      }
      for (const units of splitUnits(line.units, max)) split.push({ ...line, units });
    }
    lines = split;
  }

  const result = await client.POST("/orders", {
    body: { requestId, forDate, lines },
  });

  if (result.error || !result.data) {
    const apiError = (result.error as { error?: { code?: string; message?: string } } | undefined)?.error;
    if (apiError?.code === "ORDER_TOO_LARGE" && apiError.message) return { error: apiError.message };
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
