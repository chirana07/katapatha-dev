import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { api } from "@/lib/api";

const SESSION_COOKIE = "katapatha_session";

/**
 * Shared sign-out endpoint for every workspace shell.
 *
 * Tells the API to invalidate the session server-side (DELETE /auth/session),
 * then clears the httpOnly cookie on the web origin, then redirects to
 * /sign-in?signedOut=1 so the next load lands on a clean form.
 *
 * Reached as a GET so the shell's sign-out link (components/shell/app-shell.tsx) and any
 * other caller works without a <form> wrapper or JS.
 */
export async function GET(request: Request) {
  try {
    const client = await api();
    await client.DELETE("/auth/session", {});
  } catch {
    /* best effort; the cookie still gets cleared below */
  }
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
  const url = new URL("/sign-in?signedOut=1", request.url);
  return NextResponse.redirect(url);
}
