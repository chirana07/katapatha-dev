"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { api } from "@/lib/api";

export async function signOut() {
  try {
    const client = await api();
    await client.DELETE("/auth/session");
  } catch {
    // Clearing the browser session remains safe when the API is unreachable.
  }

  const jar = await cookies();
  jar.delete("katapatha_session");
  redirect("/sign-in");
}
