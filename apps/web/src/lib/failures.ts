/**
 * What to say when the API did not give us what we asked for.
 *
 * Each workspace used to carry its own `api-errors.ts` with its own wording.
 * They agreed on one thing worth keeping, and this module keeps it: **never say
 * a write failed when we do not know**. A request that timed out may have
 * landed, and telling the operator it failed invites them to record a delivery
 * or place an order twice. `status` 0 — no response at all — is therefore
 * "unknown" for a write, and an honest "could not be loaded" for a read.
 */

export interface Failure {
  title: string;
  detail: string;
  /** Feeds `ErrorPanel`'s `outcome`. */
  outcome: "failed" | "unknown" | "read";
}

/** A read that did not come back. Nothing was at stake. */
export function readFailure(status: number, what: string): Failure {
  if (status === 401) {
    return { title: "Your session expired", detail: "Sign in again to see " + what + ".", outcome: "read" };
  }
  if (status === 403) {
    return { title: "Access denied", detail: `This account cannot see ${what}.`, outcome: "read" };
  }
  if (status === 404) {
    return { title: "Not found", detail: `${capitalise(what)} may have been removed, or belongs to someone else.`, outcome: "read" };
  }
  return {
    title: `${capitalise(what)} could not be loaded`,
    detail: "Check the connection to Katapatha and reload.",
    outcome: "read",
  };
}

/**
 * A write that did not come back as success.
 *
 * `status` 0 and 5xx mean the request may have been applied; anything the
 * server answered with a 4xx means it refused, so nothing changed.
 */
export function writeFailure(status: number, action: string): Failure {
  if (status === 401) {
    return { title: "Your session expired", detail: `Sign in again, then ${action}.`, outcome: "failed" };
  }
  if (status === 403) {
    return { title: "Not allowed", detail: `This account cannot ${action}.`, outcome: "failed" };
  }
  if (status === 409) {
    return {
      title: "That has already changed",
      detail: `Someone else may have just done this. Reload to see the latest, then ${action} if it is still needed.`,
      outcome: "failed",
    };
  }
  if (status >= 400 && status < 500) {
    return { title: "The server refused this", detail: `Review the details and ${action} again.`, outcome: "failed" };
  }
  return {
    title: "We could not confirm that",
    detail: `Katapatha did not answer, so it may or may not have saved. Check before you ${action} again.`,
    outcome: "unknown",
  };
}

function capitalise(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
