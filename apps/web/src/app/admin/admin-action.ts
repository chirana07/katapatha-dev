import "server-only";

import { requireRole, WorkspaceUnavailableError } from "@/lib/auth";
import { writeFailure, type Failure } from "@/lib/failures";

/** The `error` body every API refusal carries. */
export type ApiRefusal = { error?: { code?: string; message?: string } };

/**
 * The role check every admin server action starts with. A layout cannot guard
 * an action — it is a POST anyone can send — so each one re-checks. An
 * unreachable API becomes the honest "may not have saved" failure rather than
 * an error page; the redirects for "signed out" and "wrong role" pass through.
 */
export async function adminOnly(next: string, action: string): Promise<{ failure: Failure } | null> {
  try {
    await requireRole("ADMIN", next);
    return null;
  } catch (error) {
    if (error instanceof WorkspaceUnavailableError) return { failure: writeFailure(0, action) };
    throw error;
  }
}

/** A `returnTo` from a form, kept inside the section it came from. */
export function safeReturn(value: FormDataEntryValue | null, base: string): string {
  if (typeof value !== "string") return base;
  if (value !== base && !value.startsWith(`${base}?`)) return base;
  if (value.includes("\\") || value.includes("//")) return base;
  return value;
}
