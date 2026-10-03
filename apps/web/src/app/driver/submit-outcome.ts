/**
 * What the API's answer to a batch of stop events means for the driver.
 *
 * The old code looked only at `results`, so an event the stop's state refused
 * (a delivery for a stop another device had already closed) came back in
 * `rejected`, left `results` empty, and was shown as "saved". A refusal is not
 * a save, so it is read first.
 */
export interface EventOutcomeInput {
  results: { id: string; status: "accepted" | "duplicate" | "conflict"; conflictState?: string | null }[];
  rejected: { id: string; code: string; message: string }[];
}

export type EventOutcome =
  | { kind: "saved"; duplicate: boolean; staleAssignment: boolean }
  | { kind: "rejected"; message: string };

const REJECTION_COPY: Record<string, string> = {
  STOP_NOT_ON_RUN: "This stop is not on your run any more. Reload the run.",
  STOP_ALREADY_CLOSED: "This stop was already closed, possibly from another phone. Reload to see how it ended.",
  STATE_MISMATCH: "This stop is not at the step this action needs. Reload the stop and check its status.",
  DELIVERED_INCOMPLETE: "The counts do not match what is on the vehicle for this stop. Reload the stop and count again.",
  RECIPIENT_REQUIRED: "Type the recipient's name before saving.",
  POD_REJECTED: "Katapatha could not store the receipt pages. Remove them and add them again.",
  PAGE_TOO_LARGE: "A receipt page is too large. Remove it and add it again.",
  PAGE_DATA_INVALID: "A receipt page is not a picture Katapatha can store. Remove it and add it again.",
  TOO_MANY_PAGES: "A delivery can carry at most eight pages.",
};

export function describeEventOutcome(result: EventOutcomeInput): EventOutcome {
  if (result.rejected.length > 0) {
    const first = result.rejected[0]!;
    return { kind: "rejected", message: REJECTION_COPY[first.code] ?? `Katapatha refused this record: ${first.message}` };
  }
  const duplicate = result.results.some((item) => item.status === "duplicate");
  const staleAssignment = result.results.some((item) => item.conflictState === "STALE_ASSIGNMENT");
  return { kind: "saved", duplicate, staleAssignment };
}
