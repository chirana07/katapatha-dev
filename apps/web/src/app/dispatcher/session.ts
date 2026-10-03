import "server-only";

import { api } from "@/lib/api";
import { requireRole, WorkspaceUnavailableError, type SessionUser } from "@/lib/auth";

type Session = { error: "unreachable" | "depot" } | { error?: never; client: Awaited<ReturnType<typeof api>>; user: SessionUser };

/**
 * The session check every dispatcher server action starts with.
 *
 * A layout cannot guard an action — an action is a POST anyone can send — so
 * each one re-checks the role. `requireRole` redirects for "not signed in" and
 * "wrong role", and throws when the API cannot be reached; an action must turn
 * that last case into an honest message on the page rather than an error
 * boundary, because for a write the useful thing to say is that nothing was
 * attempted. Redirects are rethrown untouched.
 */
export async function dispatcherSession(next: string): Promise<Session> {
  let user;
  try {
    user = await requireRole("DISPATCHER", next);
  } catch (error) {
    if (error instanceof WorkspaceUnavailableError) return { error: "unreachable" };
    throw error;
  }
  if (!user.depotCode) return { error: "depot" };
  return { client: await api(), user };
}
