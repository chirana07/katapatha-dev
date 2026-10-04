import { colomboClock } from "../../driver/format";
import { MAX_AUTOMATIC_ATTEMPTS } from "../../outbox/backoff";

/**
 * The Unsent records screen's decisions, as plain functions.
 *
 * An unconfirmed record is never called "failed": the phone does not know what
 * happened to a record it has not had an answer for. A record the server REFUSED
 * is the opposite case -- a known outcome -- and is worded as one ("not accepted"),
 * using the sentence the transport stored. The groups are exclusive and together
 * cover every unconfirmed row, so nothing the driver recorded can fall off the
 * screen.
 */

export type OutboxRowInput = {
  id: string;
  stop_id: string;
  type: string;
  occurred_at: string;
  state: "queued" | "sending" | "confirmed" | "conflict" | "rejected";
  attempts: number;
  last_error: string | null;
  conflict_state: string | null;
};

const EVENT_LABEL: Record<string, string> = {
  ARRIVED: "Arrival",
  UNLOAD_START: "Unload started",
  DELIVERED: "Delivered",
  PART_DELIVERED: "Part delivered",
  POD_CAPTURED: "Proof of delivery",
  FAILED: "Delivery not made",
  SKIPPED: "Stop skipped",
};

/** What an event is called to the driver. Unknown types read as lower-case words, never raw codes. */
export function eventLabel(type: string): string {
  return EVENT_LABEL[type] ?? type.replace(/_/g, " ").toLowerCase();
}

export type OutboxGroups<T extends OutboxRowInput> = {
  rejected: T[];
  conflicts: T[];
  waiting: T[];
};

/** Splits unconfirmed rows by what is known about them. Confirmed rows are dropped. */
export function groupOutboxRows<T extends OutboxRowInput>(rows: readonly T[]): OutboxGroups<T> {
  return {
    rejected: rows.filter((row) => row.state === "rejected"),
    conflicts: rows.filter((row) => row.state === "conflict"),
    waiting: rows.filter((row) => row.state === "queued" || row.state === "sending"),
  };
}

/** The heading of the first card. */
export function outboxTitle(input: { unsent: number; rejected: number; conflicts: number }): string {
  if (input.unsent > 0) return `${input.unsent} waiting to send`;
  if (input.rejected + input.conflicts > 0) return "Nothing is waiting to send";
  return "Everything has been sent";
}

/** The word beside a waiting row. */
export function waitingStateLabel(state: OutboxRowInput["state"]): string {
  return state === "sending" ? "Sending" : "Waiting";
}

/** True once the app has stopped retrying a row by itself. The row is still held and Send now still picks it up. */
export function stoppedRetrying(attempts: number): boolean {
  return attempts >= MAX_AUTOMATIC_ATTEMPTS;
}

/** The sentence for a refused record. The transport stored one; a row without one gets a safe line. */
export function rejectionSentence(row: Pick<OutboxRowInput, "last_error">): string {
  return (
    row.last_error?.trim() ||
    "The server did not accept this record, so it was not applied. Tell dispatch."
  );
}

/** Why a conflicting record was set aside. */
export function conflictSentence(row: Pick<OutboxRowInput, "conflict_state">): string {
  return row.conflict_state === "STALE_ASSIGNMENT"
    ? "This stop had been reassigned, so the server kept its own record. Reload the run."
    : "A later record replaced this one on the server.";
}

/**
 * What to tell the driver after "Send now". It reports the count left, from the
 * snapshot read after the attempt, and nothing about why anything is left.
 */
export function sendNowResult(input: { remaining: number; attemptedAt: Date }): {
  tone: "good" | "info";
  text: string;
} {
  if (input.remaining <= 0) return { tone: "good", text: "Sent. Nothing is waiting." };
  return {
    tone: "info",
    text: `Tried at ${colomboClock(input.attemptedAt)} · ${input.remaining} still waiting.`,
  };
}

/** The "Last attempt" card's lines, from the last sync_log row. */
export function lastAttemptLines(log: {
  endpoint: string;
  outcome: string;
  sent: number | null;
  accepted: number | null;
  duplicates: number | null;
  conflicts: number | null;
  rejected: number | null;
}): { headline: string; counts: string | null } {
  const counts =
    log.sent !== null
      ? [
          `sent ${log.sent}`,
          `accepted ${log.accepted ?? 0}`,
          `already held ${log.duplicates ?? 0}`,
          `replaced ${log.conflicts ?? 0}`,
          `not accepted ${log.rejected ?? 0}`,
        ].join(" · ")
      : null;
  return { headline: `${log.endpoint} · ${log.outcome}`, counts };
}

/** "Last sent at 06:28 (this phone's clock)." from the device-clock ISO the drain stored. */
export function lastSentLine(lastDrainAt: string | null): string | null {
  if (!lastDrainAt) return null;
  const at = new Date(lastDrainAt);
  if (Number.isNaN(at.getTime())) return null;
  return `Last sent at ${colomboClock(at)} (this phone's clock).`;
}
