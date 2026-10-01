import type { components } from "@katapatha/contracts/types";
import type { SqlDriver } from "../db/driver";
import { clearToken, getApi, saveToken } from "./client";

/**
 * Sign in, sign out, and who is signed in.
 *
 * POST /auth/session sets an httpOnly cookie AND returns a bearer token; the web
 * app uses the cookie, the device uses the token. Same session row either way.
 *
 * Nothing here ever logs or returns the password, and src/platform/log.ts redacts
 * `password` and `token` at the sink in case a caller passes a whole request
 * object to a logger.
 */

export type SessionUser = components["schemas"]["SessionUser"];

export type SignInResult =
  | { kind: "ok"; user: SessionUser; home: string }
  | { kind: "invalid" }
  | { kind: "throttled"; retryAfterSeconds: number | null }
  | { kind: "not-a-driver"; role: SessionUser["role"] }
  | { kind: "offline"; message: string }
  | { kind: "server"; status: number };

export async function signIn(
  sql: SqlDriver,
  credentials: { email: string; password: string },
): Promise<SignInResult> {
  const client = await getApi(sql);

  let result;
  try {
    result = await client.POST("/auth/session", {
      body: {
        email: credentials.email.trim().toLowerCase(),
        password: credentials.password,
      },
    });
  } catch (error) {
    return {
      kind: "offline",
      message:
        error instanceof Error && error.message
          ? "Katapatha could not be reached. Check the signal and try again."
          : "Katapatha could not be reached.",
    };
  }

  if (result.response.status === 401) return { kind: "invalid" };

  if (result.response.status === 429) {
    const header = result.response.headers.get("retry-after");
    const seconds = header === null ? null : Number.parseInt(header, 10);
    return {
      kind: "throttled",
      retryAfterSeconds: Number.isFinite(seconds) ? seconds : null,
    };
  }

  if (!result.response.ok || !result.data) {
    return { kind: "server", status: result.response.status };
  }

  // This app is the driver app. Signing a dispatcher in would leave them on a
  // run list that will always 403, so say so plainly rather than letting the
  // guard bounce them around.
  if (result.data.user.role !== "DRIVER") {
    return { kind: "not-a-driver", role: result.data.user.role };
  }

  await saveToken(result.data.token);
  return { kind: "ok", user: result.data.user, home: result.data.home };
}

/**
 * Signs out.
 *
 * The local token is cleared even if the server call fails: a driver who taps
 * Sign out must end up signed out on this handset regardless of signal. The
 * server session expires on its own.
 *
 * Queued outbox rows are deliberately NOT deleted. They are the driver's record
 * of work done, and the next sign-in drains them.
 */
export async function signOut(sql: SqlDriver): Promise<void> {
  try {
    const client = await getApi(sql);
    await client.DELETE("/auth/session", {});
  } catch {
    // Ignored on purpose; see above.
  } finally {
    await clearToken();
  }
}

export type MeResult =
  | { kind: "ok"; user: SessionUser }
  | { kind: "expired" }
  | { kind: "unreachable" };

/**
 * Confirms a stored token still works, at launch.
 *
 * `unreachable` is NOT `expired`, and the difference is the whole point: a driver
 * who opens the app with no signal must stay signed in and keep working from the
 * cache. Treating an unreachable server as a sign-out would empty the screen at
 * exactly the moment the app is supposed to prove its worth.
 */
export async function fetchMe(sql: SqlDriver): Promise<MeResult> {
  try {
    const client = await getApi(sql);
    const result = await client.GET("/auth/me", {});

    if (result.response.status === 401) return { kind: "expired" };
    if (!result.response.ok || !result.data) return { kind: "unreachable" };

    return { kind: "ok", user: result.data };
  } catch {
    return { kind: "unreachable" };
  }
}
