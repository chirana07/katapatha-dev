import "server-only";

import { cache } from "react";
import { redirect } from "next/navigation";
import type { components } from "@katapatha/contracts/types";
import { HOME_FOR_ROLE } from "@katapatha/core/domain/authPaths";
import type { Role } from "@katapatha/core/domain/roles";
import { api } from "./api";

export type SessionUser = components["schemas"]["SessionUser"];

/**
 * Thrown when the API cannot be reached at all.
 *
 * Distinct from "not signed in", which redirects, and from "wrong role", which
 * also redirects. This one means we do not know, so the route group's
 * error.tsx renders rather than bouncing the operator somewhere misleading.
 */
export class WorkspaceUnavailableError extends Error {
  constructor() {
    super("Katapatha could not verify your session.");
    this.name = "WorkspaceUnavailableError";
  }
}

/**
 * /auth/me, fetched once per request.
 *
 * The layout guards the workspace and the page underneath needs the same user
 * (for the depot or the outlet), so without this every page paid for the call
 * twice. React's `cache` scopes it to the render, so one request never sees
 * another's session.
 *
 * `api()` is called outside the try: it reads cookies(), and Next signals "this
 * render is dynamic" by throwing from it. Catching that turns a static page
 * under a guarded layout into a build-time WorkspaceUnavailableError.
 */
const sessionOnce = cache(async () => {
  const client = await api();
  try {
    return await client.GET("/auth/me");
  } catch {
    throw new WorkspaceUnavailableError();
  }
});

/**
 * The one session-and-role gate.
 *
 * Before this, the dispatcher checked its role in three separate places and
 * the loader, driver and store checked nothing at all — a signed-out store
 * manager saw an error panel instead of the sign-in page, because the only
 * thing standing between them and the data was the API returning 401.
 *
 * It lives in lib rather than in the shell because a layout cannot guard a
 * server action. Pages and actions call the same function.
 *
 * One behaviour worth preserving deliberately: a 403 from a *data* endpoint is
 * not an auth failure in this product — `GET /drivers/me/run` returns 403 to
 * mean "no vehicle claimed yet", and the driver page renders a claim form for
 * it. So this only ever reacts to 401 and to the role not matching.
 */
export async function requireRole(role: Role, next: string): Promise<SessionUser> {
  const result = await sessionOnce();

  if (result.response.status === 401) redirect(`/sign-in?next=${encodeURIComponent(next)}`);
  if (result.error || !result.data) throw new WorkspaceUnavailableError();

  const user = result.data;
  if (user.role !== role) redirect(HOME_FOR_ROLE[user.role]);

  return user;
}

/**
 * The line under the role name in the rail's chip.
 *
 * Deliberately not a generic "welcome" string: it names the depot, dock or
 * outlet this session is scoped to, which is the same scope every
 * authorization predicate in the API enforces. An operator should never have
 * to guess which records they are about to change.
 */
export function scopeLabel(user: SessionUser): string {
  switch (user.role) {
    case "DISPATCHER":
      return user.depotCode ? `${user.depotCode} DC` : "No depot assigned";
    case "LOADER":
      return user.depotCode ? `${user.depotCode} dock` : "No dock assigned";
    case "STORE_MANAGER":
      return user.outletId ?? "No outlet assigned";
    case "DRIVER":
      return user.defaultVehicleId ?? "No vehicle claimed";
    case "ADMIN":
      return "All depots";
  }
}
