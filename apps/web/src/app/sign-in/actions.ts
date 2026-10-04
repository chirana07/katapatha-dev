"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { safePostLoginPath } from "@katapatha/core/domain/authPaths";
import { api } from "@/lib/api";

export type SignInState = { error?: string };

const SESSION_COOKIE = "katapatha_session";
const SESSION_MAX_AGE = 30 * 24 * 60 * 60;

export async function signIn(
  _previous: SignInState,
  formData: FormData,
): Promise<SignInState> {
  const requestedNext = String(formData.get("next") ?? "");
  const byStaff = formData.has("staffId");
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const staffId = String(formData.get("staffId") ?? "").trim().toUpperCase();
  const pin = String(formData.get("pin") ?? "").trim();

  if (byStaff) {
    if (!staffId || !pin) return { error: "Enter your staff ID and PIN." };
    if (!/^[0-9]{4,8}$/.test(pin)) return { error: "Your PIN is 4 to 8 digits." };
  } else if (!email || !password) {
    return { error: "Enter your work email and password." };
  }

  let result;
  try {
    const client = await api();
    result = await client.POST("/auth/session", {
      body: byStaff ? { staffId, pin } : { email, password },
    });
  } catch {
    return { error: "Katapatha is temporarily unreachable. Check your connection and try again." };
  }

  if (result.error || !result.data) {
    if (result.response.status === 401) {
      return { error: "Those details do not match an account." };
    }
    if (result.response.status === 429) {
      return { error: "Too many sign-in attempts. Wait a minute before trying again." };
    }
    return { error: "Sign-in could not be completed. Try again shortly." };
  }

  const jar = await cookies();
  jar.set(SESSION_COOKIE, result.data.token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });

  redirect(safePostLoginPath(requestedNext, result.data.user.role));
}
