import "server-only";
import { api } from "@/lib/api";
import { writeFailure } from "@/lib/failures";
import { describeEventOutcome } from "./submit-outcome";
import type { components } from "@katapatha/contracts/types";

export type StopEventInput = components["schemas"]["StopEvent"];

export type SubmitResult =
  | { ok: true; duplicate: boolean; staleAssignment: boolean }
  | { ok: false; error: string; /** True when the write may have landed anyway. */ unknown: boolean };

/**
 * The one place the driver's stop events go to the API, shared by the server
 * actions (arrive, unload, problem) and the delivery route (which carries the
 * receipt pages, too big for a server action).
 *
 * The idempotency lives in the events themselves: each carries a client-minted
 * ULID, so sending the same batch again after an unanswered request is safe,
 * and the API calls the repeat a `duplicate`.
 */
export async function submitStopEvents(args: {
  stopId: string;
  deviceId: string;
  events: StopEventInput[];
  /** The verb for "…so you can record arrival again", in the sentence about a failure. */
  action: string;
}): Promise<SubmitResult> {
  let response;
  try {
    const client = await api();
    response = await client.POST("/stops/{stopId}/events", {
      params: { path: { stopId: args.stopId } },
      body: { deviceId: args.deviceId, events: args.events },
    });
  } catch {
    const failure = writeFailure(0, args.action);
    return { ok: false, error: `${failure.title}. ${failure.detail}`, unknown: true };
  }

  if (response.error || !response.data) {
    const status = response.response.status;
    if (status === 422) {
      return { ok: false, error: "Katapatha rejected these details. Review the quantities, reason or recipient and try again.", unknown: false };
    }
    const failure = writeFailure(status, args.action);
    return { ok: false, error: `${failure.title}. ${failure.detail}`, unknown: failure.outcome === "unknown" };
  }

  const outcome = describeEventOutcome(response.data);
  if (outcome.kind === "rejected") return { ok: false, error: outcome.message, unknown: false };
  return { ok: true, duplicate: outcome.duplicate, staleAssignment: outcome.staleAssignment };
}
