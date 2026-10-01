"use server";

import type { components } from "@katapatha/contracts/types";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { api } from "@/lib/api";

export type PlaceOrderState = { error?: string };

function unitsFrom(value: FormDataEntryValue | null): number | null {
  if (typeof value !== "string" || value.trim() === "") return 0;
  const units = Number(value);
  return Number.isInteger(units) && units >= 0 && units <= 10_000 ? units : null;
}

export async function placeOrder(
  _previous: PlaceOrderState,
  formData: FormData,
): Promise<PlaceOrderState> {
  const requestId = formData.get("requestId");
  const forDate = formData.get("forDate");
  const ambient = unitsFrom(formData.get("ambient"));
  const chilled = unitsFrom(formData.get("chilled"));

  if (
    typeof requestId !== "string" ||
    typeof forDate !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(forDate)
  ) {
    return { error: "This order session is no longer valid. Refresh the page and try again." };
  }

  if (ambient === null || chilled === null) {
    return { error: "Enter whole-number quantities between 0 and 10,000 units." };
  }

  if (ambient + chilled === 0) {
    return { error: "Enter at least one ambient or chilled unit before placing the order." };
  }

  const lines: components["schemas"]["PlaceOrdersRequest"]["lines"] = [];
  if (ambient > 0) lines.push({ tempRequirement: "ambient", units: ambient });
  if (chilled > 0) lines.push({ tempRequirement: "chilled", units: chilled });

  const client = await api();
  const result = await client.POST("/orders", {
    body: { requestId, forDate, lines },
  });

  if (result.error || !result.data) {
    return {
      error: "The order could not be placed. Check the connection and retry; your quantities are still here.",
    };
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
