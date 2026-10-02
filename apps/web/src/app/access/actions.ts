"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { api } from "@/lib/api";

export type AccessState = { error?: string };

const SESSION_COOKIE = "katapatha_session";
const SESSION_MAX_AGE = 30 * 24 * 60 * 60;
const DEMO_PASSWORD = "waypoint";

const ALLOWED_EMAILS = new Set([
  "fathima@waypoint.lk",
  "nimal@waypoint.lk",
  "ranjith@waypoint.lk",
  "sunil@waypoint.lk",
]);

const SAFE_HOMES = new Set(["/store", "/dispatcher", "/loader", "/driver"]);

/**
 * Dev-only quick sign-in. Refuses to run in production builds, and only
 * accepts the four seeded demo emails — a request for anything else goes
 * through the real /sign-in page.
 */
function demoAccessEnabled(): boolean {
  return (
    process.env.ALLOW_DEMO_ACCESS === "1" ||
    String(process.env.NODE_ENV) !== "production"
  );
}

export async function signInAs(
  _previous: AccessState,
  formData: FormData,
): Promise<AccessState> {
  if (!demoAccessEnabled()) {
    return { error: "Demo access is not enabled on this deployment." };
  }

  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const home = String(formData.get("home") ?? "");
  if (!ALLOWED_EMAILS.has(email)) {
    return { error: "That account is not one of the demo accounts." };
  }
  if (!SAFE_HOMES.has(home)) {
    return { error: "That home path is not one of the role workspaces." };
  }

  let result;
  try {
    const client = await api();
    result = await client.POST("/auth/session", {
      body: { email, password: DEMO_PASSWORD },
    });
  } catch {
    return {
      error:
        "Katapatha API is unreachable. Confirm the API is running and the seed has been applied before using /access.",
    };
  }

  if (result.error || !result.data) {
    return {
      error: `Sign-in failed (status ${result.response.status}). Check that \`pnpm db:seed\` has been run against this database.`,
    };
  }

  const jar = await cookies();
  jar.set(SESSION_COOKIE, result.data.token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
  redirect(home);
}
