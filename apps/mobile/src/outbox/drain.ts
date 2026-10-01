import type { SqlDriver } from "../db/driver";
import { nextAttemptAt } from "./backoff";
import {
  claimBatch,
  prune,
  rejectBatch,
  releaseBatch,
  releaseStaleSending,
  settleResults,
  type OutboxRow,
} from "./repo";
import type { Transport } from "./transport";

/**
 * Sends queued events, settles what the server said, and records what happened.
 *
 * Single-flight: concurrent triggers await the one in-flight drain. Overlapping
 * drains would be *safe* -- the ULID makes a double-send a duplicate, which is a
 * success -- but they would double the upload on the connection that is already
 * the constraint, and make the unsent count flicker.
 *
 * Every drain is foreground-only. No background task is registered and
 * expo-background-task is deliberately not a dependency, because docs/DESIGN.md
 * forbids implying background sync and the honest thing is to only claim what
 * the app actually does while it is open.
 */

export type DrainOutcome = {
  attempted: number;
  accepted: number;
  duplicates: number;
  conflicts: number;
  requeued: number;
  rejected: number;
  /** Set when the session is no longer valid; the caller routes to sign-in. */
  authExpired: boolean;
  clockSkewMs: number | null;
  serverSeq: number | null;
  note: string | null;
  outcome: "sent" | "offline" | "auth" | "forbidden" | "rejected" | "server" | "idle";
};

export type DrainDeps = {
  sql: SqlDriver;
  transport: Transport;
  now?: () => Date;
  random?: () => number;
  /** Called after a successful drain so the cached run can be refreshed. */
  onSettled?: (result: { serverSeq: number | null }) => Promise<void>;
};

const idle = (): DrainOutcome => ({
  attempted: 0,
  accepted: 0,
  duplicates: 0,
  conflicts: 0,
  requeued: 0,
  rejected: 0,
  authExpired: false,
  clockSkewMs: null,
  serverSeq: null,
  note: null,
  outcome: "idle",
});

export function createDrain(deps: DrainDeps) {
  const now = deps.now ?? (() => new Date());
  const random = deps.random ?? Math.random;
  let inFlight: Promise<DrainOutcome> | null = null;
  let released = false;

  async function runOnce(options: { immediate: boolean }): Promise<DrainOutcome> {
    // Once per process: rows stranded in `sending` by a crash mid-request are
    // invisible to the claim query until they go back to `queued`.
    if (!released) {
      await releaseStaleSending(deps.sql, now());
      released = true;
    }

    const rows = await claimBatch(deps.sql, now(), {
      immediate: options.immediate,
    });
    if (rows.length === 0) return idle();

    const ids = rows.map((row) => row.id);
    const result = await deps.transport.send(rows);

    switch (result.kind) {
      case "offline":
        await releaseBatch(
          deps.sql,
          ids,
          nextAttemptAt(attemptsOf(rows), now(), random),
          result.error,
        );
        await logSync(deps.sql, now(), {
          endpoint: "unsent",
          sent: rows.length,
          outcome: "offline",
          note: result.error,
        });
        return { ...idle(), attempted: rows.length, outcome: "offline" };

      case "auth":
        // The driver's work is never discarded over an expired session. The rows
        // go back to the queue with no backoff, and the retry is gated on
        // signing in again rather than on a timer.
        await releaseBatch(
          deps.sql,
          ids,
          null,
          "Your driver session expired. Sign in again before saving this action.",
        );
        await logSync(deps.sql, now(), {
          endpoint: "unsent",
          sent: rows.length,
          outcome: "auth",
          note: "session expired",
        });
        return { ...idle(), attempted: rows.length, authExpired: true, outcome: "auth" };

      case "forbidden":
        // Most likely the vehicle was released, so the run is no longer this
        // driver's. Hold the rows, and let the caller re-bootstrap.
        await releaseBatch(
          deps.sql,
          ids,
          new Date(now().getTime() + 60_000).toISOString(),
          "This account cannot record against this run right now.",
        );
        await logSync(deps.sql, now(), {
          endpoint: "unsent",
          sent: rows.length,
          outcome: "forbidden",
          note: "403",
        });
        return { ...idle(), attempted: rows.length, outcome: "forbidden" };

      case "rejected":
        // A 422 means the server understood and refused. Retrying cannot help,
        // so the rows are kept with their reason and shown permanently -- this
        // is the only outcome that loses the driver's record, so it is loud.
        await rejectBatch(deps.sql, ids, result.reason, now());
        await logSync(deps.sql, now(), {
          endpoint: "unsent",
          sent: rows.length,
          outcome: "rejected",
          note: result.reason,
        });
        return {
          ...idle(),
          attempted: rows.length,
          rejected: rows.length,
          outcome: "rejected",
        };

      case "server":
        await releaseBatch(
          deps.sql,
          ids,
          nextAttemptAt(attemptsOf(rows), now(), random),
          "Katapatha is temporarily unavailable. The last confirmed state is shown.",
        );
        await logSync(deps.sql, now(), {
          endpoint: "unsent",
          sent: rows.length,
          outcome: "server",
          note: `status ${result.status}`,
        });
        return { ...idle(), attempted: rows.length, outcome: "server" };

      case "ok": {
        const settled = await settleResults(
          deps.sql,
          ids,
          result.outcomes,
          now(),
          random,
        );

        if (result.clockSkewMs !== null) {
          await setMeta(deps.sql, "clock_skew_ms", String(result.clockSkewMs));
        }
        if (result.serverSeq !== null) {
          await advanceServerSeq(deps.sql, result.serverSeq);
        }
        await setMeta(deps.sql, "last_drain_at", now().toISOString());

        const note = [result.note, unknownNote(settled.unknown)]
          .filter(Boolean)
          .join("; ");

        await logSync(deps.sql, now(), {
          endpoint: result.endpoint,
          sent: rows.length,
          accepted: result.accepted,
          duplicates: result.duplicates,
          conflicts: result.conflicts,
          clockSkewMs: result.clockSkewMs,
          serverSeq: result.serverSeq,
          outcome: "sent",
          note: note || null,
        });

        await prune(deps.sql, now());
        await deps.onSettled?.({ serverSeq: result.serverSeq });

        return {
          attempted: rows.length,
          accepted: result.accepted,
          // A duplicate is a SUCCESS: a correct replay reports every event as a
          // duplicate and changes nothing. It never counts as an error.
          duplicates: result.duplicates,
          conflicts: result.conflicts,
          requeued: settled.requeued,
          rejected: 0,
          authExpired: false,
          clockSkewMs: result.clockSkewMs,
          serverSeq: result.serverSeq,
          note: note || null,
          outcome: "sent",
        };
      }
    }
  }

  return {
    /**
     * Drains one batch. Concurrent callers share the in-flight attempt.
     *
     * `immediate` ignores the backoff schedule, including for rows that have
     * exhausted their automatic attempts. Pass it from the manual "Send now" and
     * from the Offline -> Connected edge: a backoff set by a failed send is
     * obsolete the moment signal returns, and making a driver who just
     * reconnected wait out a five-minute timer would be absurd.
     *
     * The 15s ticker does NOT pass it. That is what the schedule is for.
     */
    async drain(options: { immediate?: boolean } = {}): Promise<DrainOutcome> {
      if (inFlight) return inFlight;
      inFlight = runOnce({ immediate: options.immediate ?? false }).finally(() => {
        inFlight = null;
      });
      return inFlight;
    },

    /** Drains repeatedly until nothing is ready, so a backlog clears in one go. */
    async drainAll(
      options: { immediate?: boolean; limit?: number } = {},
    ): Promise<DrainOutcome[]> {
      const limit = options.limit ?? 20;
      const results: DrainOutcome[] = [];
      for (let round = 0; round < limit; round++) {
        const result = await this.drain({ immediate: options.immediate });
        results.push(result);
        if (result.outcome !== "sent" || result.attempted === 0) break;
      }
      return results;
    },
  };
}

function attemptsOf(rows: readonly OutboxRow[]): number {
  // claimBatch already incremented, so these are the attempts made so far.
  return Math.max(...rows.map((row) => row.attempts)) + 1;
}

function unknownNote(unknown: readonly string[]): string | null {
  return unknown.length === 0
    ? null
    : `server reported ${unknown.length} id(s) we did not send`;
}

async function setMeta(sql: SqlDriver, key: string, value: string): Promise<void> {
  await sql.run(
    `INSERT INTO meta (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [key, value],
  );
}

/** server_seq only ever moves forward: an older batch must not rewind the cursor. */
async function advanceServerSeq(sql: SqlDriver, seq: number): Promise<void> {
  const row = await sql.first<{ value: string }>(
    "SELECT value FROM meta WHERE key = 'server_seq'",
  );
  const current = row ? Number(row.value) : 0;
  if (seq > current) await setMeta(sql, "server_seq", String(seq));
}

async function logSync(
  sql: SqlDriver,
  at: Date,
  entry: {
    endpoint: string;
    sent: number;
    accepted?: number;
    duplicates?: number;
    conflicts?: number;
    clockSkewMs?: number | null;
    serverSeq?: number | null;
    outcome: string;
    note: string | null;
  },
): Promise<void> {
  await sql.run(
    `INSERT INTO sync_log
       (at, endpoint, sent, accepted, duplicates, conflicts, clock_skew_ms,
        server_seq, outcome, note)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      at.toISOString(),
      entry.endpoint,
      entry.sent,
      entry.accepted ?? null,
      entry.duplicates ?? null,
      entry.conflicts ?? null,
      entry.clockSkewMs ?? null,
      entry.serverSeq ?? null,
      entry.outcome,
      entry.note,
    ],
  );
}
