import type { SqlDriver } from "../db/driver";
import type { Intent, OutboxEventInput } from "./intents";
import { payloadBytes } from "./intents";
import type { PendingEvent } from "./projection";
import { MAX_AUTOMATIC_ATTEMPTS, nextAttemptAt } from "./backoff";

/**
 * The outbox table's operations.
 *
 * Every driver action goes through enqueue() -- there is no path from a screen
 * straight to the network. Online and offline then differ only in how soon the
 * drain succeeds, which is what makes the README's "the online and offline paths
 * are the same request shape" true in the app and not just on the server.
 */

export type OutboxState = "queued" | "sending" | "confirmed" | "conflict" | "rejected";

export type OutboxRow = {
  id: string;
  batch_key: string;
  stop_id: string;
  type: OutboxEventInput["type"];
  occurred_at: string;
  order_id: string | null;
  delivered_units: number | null;
  recipient_name: string | null;
  reason_code: string | null;
  signature_data: string | null;
  photo_data: string | null;
  payload_bytes: number;
  state: OutboxState;
  attempts: number;
  next_attempt_at: string | null;
  last_error: string | null;
  server_status: string | null;
  conflict_state: string | null;
  created_at: string;
  settled_at: string | null;
};

/** How many events one request may carry, and how many bytes. */
export const MAX_BATCH_EVENTS = 50;
export const MAX_BATCH_BYTES = 1_500_000;

/** Rows left `sending` longer than this are assumed orphaned by a crash. */
const SENDING_STALE_MS = 120_000;

/**
 * Queues one intent.
 *
 * INSERT OR IGNORE, because the primary key is the client ULID: a double-tap
 * that re-submits the same intent is a no-op here for the same reason a replay
 * is a no-op on the server. One key, one rule, enforced at both ends.
 */
export async function enqueue(
  sql: SqlDriver,
  intent: Intent,
  now: Date,
): Promise<number> {
  const createdAt = now.toISOString();
  let inserted = 0;

  await sql.tx(async (tx) => {
    for (const event of intent.events) {
      inserted += await tx.run(
        `INSERT OR IGNORE INTO outbox_event
           (id, batch_key, stop_id, type, occurred_at, order_id, delivered_units,
            recipient_name, reason_code, signature_data, photo_data,
            payload_bytes, state, attempts, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued', 0, ?)`,
        [
          event.id,
          intent.batchKey,
          intent.stopId,
          event.type,
          event.occurredAt,
          event.orderId,
          event.deliveredUnits,
          event.recipientName,
          event.reasonCode,
          event.signatureData,
          event.photoData,
          payloadBytes(event),
          createdAt,
        ],
      );
    }
  });

  return inserted;
}

/** This stop's events, in ULID order, for the projection. */
export async function pendingForStop(
  sql: SqlDriver,
  stopId: string,
): Promise<PendingEvent[]> {
  // Deliberately does not select signature_data or photo_data: the projection
  // needs a type and a state, and a stop card must never pull a photo into
  // memory to render a status line.
  return sql.all<PendingEvent>(
    `SELECT id, type, state FROM outbox_event
      WHERE stop_id = ? AND state != 'confirmed'
      ORDER BY id ASC`,
    [stopId],
  );
}

/** Every unconfirmed event on the run, grouped by stop. */
export async function pendingByStop(
  sql: SqlDriver,
  date: string,
): Promise<Map<string, PendingEvent[]>> {
  const rows = await sql.all<PendingEvent & { stop_id: string }>(
    `SELECT e.id, e.type, e.state, e.stop_id
       FROM outbox_event e
       JOIN stop s ON s.id = e.stop_id
      WHERE s.date = ? AND e.state != 'confirmed'
      ORDER BY e.id ASC`,
    [date],
  );

  const grouped = new Map<string, PendingEvent[]>();
  for (const row of rows) {
    const list = grouped.get(row.stop_id) ?? [];
    list.push({ id: row.id, type: row.type, state: row.state });
    grouped.set(row.stop_id, list);
  }
  return grouped;
}

export type OutboxCounts = {
  /** Queued or sending: work the server has not accepted. */
  unsent: number;
  /** Eligible for an automatic drain right now. */
  ready: number;
  conflicts: number;
  rejected: number;
};

export async function counts(sql: SqlDriver, now: Date): Promise<OutboxCounts> {
  const row = await sql.first<OutboxCounts>(
    `SELECT
       SUM(CASE WHEN state IN ('queued','sending') THEN 1 ELSE 0 END) AS unsent,
       SUM(CASE WHEN state = 'queued'
                 AND attempts < ${MAX_AUTOMATIC_ATTEMPTS}
                 AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
                THEN 1 ELSE 0 END) AS ready,
       SUM(CASE WHEN state = 'conflict' THEN 1 ELSE 0 END) AS conflicts,
       SUM(CASE WHEN state = 'rejected' THEN 1 ELSE 0 END) AS rejected
     FROM outbox_event`,
    [now.toISOString()],
  );

  return {
    unsent: row?.unsent ?? 0,
    ready: row?.ready ?? 0,
    conflicts: row?.conflicts ?? 0,
    rejected: row?.rejected ?? 0,
  };
}

/**
 * Releases rows stranded in `sending` by a crash mid-request.
 *
 * Called at startup. Re-sending is safe -- the ULID makes it a duplicate, which
 * is a success -- so the risk being managed is work sitting invisible forever,
 * not work being written twice.
 */
export async function releaseStaleSending(sql: SqlDriver, now: Date): Promise<number> {
  const cutoff = new Date(now.getTime() - SENDING_STALE_MS).toISOString();
  return sql.run(
    `UPDATE outbox_event
        SET state = 'queued', next_attempt_at = NULL
      WHERE state = 'sending' AND created_at <= ?`,
    [cutoff],
  );
}

/**
 * Claims the next batch and marks it `sending` in the same transaction.
 *
 * Whole batch_key groups only, and capped by both event count and byte size.
 * Claiming inside a transaction is what stops two concurrent drains sending the
 * same row -- harmless, because of the ULID, but it would double the upload on a
 * connection that is already the constraint.
 *
 * `immediate` bypasses the backoff timer, including for rows that have
 * exhausted their automatic attempts.
 */
export async function claimBatch(
  sql: SqlDriver,
  now: Date,
  options: { immediate?: boolean } = {},
): Promise<OutboxRow[]> {
  return sql.tx(async (tx) => {
    // `immediate` skips the backoff gate entirely -- used by the manual "Send
    // now" and by the Offline -> Connected edge, where the schedule was set by a
    // failure the reconnect has just made obsolete. It is also the only way an
    // exhausted row is ever sent again.
    const candidates = await tx.all<OutboxRow>(
      `SELECT * FROM outbox_event
        WHERE state = 'queued'
          ${
            options.immediate
              ? ""
              : `AND attempts < ${MAX_AUTOMATIC_ATTEMPTS}
                 AND (next_attempt_at IS NULL OR next_attempt_at <= ?)`
          }
        ORDER BY id ASC`,
      options.immediate ? [] : [now.toISOString()],
    );

    const claimed: OutboxRow[] = [];
    let bytes = 0;

    // Group by batch_key and take whole groups, so a delivery's POD can never
    // be sent in a different request from its order lines.
    for (const group of groupByBatch(candidates)) {
      const groupBytes = group.reduce((sum, row) => sum + row.payload_bytes, 0);
      const wouldExceed =
        claimed.length + group.length > MAX_BATCH_EVENTS ||
        bytes + groupBytes > MAX_BATCH_BYTES;

      // Always take at least one group, even an oversized one: refusing would
      // strand a delivery with a large photo forever.
      if (wouldExceed && claimed.length > 0) break;

      claimed.push(...group);
      bytes += groupBytes;

      if (claimed.length >= MAX_BATCH_EVENTS || bytes >= MAX_BATCH_BYTES) break;
    }

    for (const row of claimed) {
      await tx.run(
        `UPDATE outbox_event
            SET state = 'sending', attempts = attempts + 1
          WHERE id = ?`,
        [row.id],
      );
    }

    return claimed;
  });
}

function groupByBatch(rows: readonly OutboxRow[]): OutboxRow[][] {
  const groups = new Map<string, OutboxRow[]>();
  for (const row of rows) {
    const list = groups.get(row.batch_key) ?? [];
    list.push(row);
    groups.set(row.batch_key, list);
  }
  return [...groups.values()];
}

export type SettleOutcome = {
  id: string;
  status: "accepted" | "duplicate" | "conflict";
  conflictState?: string | null;
};

/**
 * Records a successful request's per-event results.
 *
 * `accepted` and `duplicate` are both success: a correct replay reports every
 * event as a duplicate and changes nothing, which is the whole point of minting
 * the id on the device. They settle identically.
 *
 * The blobs are nulled the moment an event is confirmed. That reclaims the space
 * a photo took, and it means a signature cannot appear in a later log line or
 * crash report because it is no longer in the database to be read.
 *
 * A row we sent but that is absent from the response goes back to `queued`. The
 * server did not tell us what happened to it, so the only safe reading is that
 * it did not land -- and re-sending is free.
 */
export async function settleResults(
  sql: SqlDriver,
  sentIds: readonly string[],
  outcomes: readonly SettleOutcome[],
  now: Date,
  random: () => number = Math.random,
): Promise<{ settled: number; requeued: number; unknown: string[] }> {
  const settledAt = now.toISOString();
  const byId = new Map(outcomes.map((outcome) => [outcome.id, outcome]));
  const sent = new Set(sentIds);

  return sql.tx(async (tx) => {
    let settled = 0;
    let requeued = 0;

    for (const id of sentIds) {
      const outcome = byId.get(id);

      if (!outcome) {
        const row = await tx.first<{ attempts: number }>(
          "SELECT attempts FROM outbox_event WHERE id = ?",
          [id],
        );
        await tx.run(
          `UPDATE outbox_event
              SET state = 'queued',
                  next_attempt_at = ?,
                  last_error = 'The server did not report this event. Will retry.'
            WHERE id = ?`,
          [nextAttemptAt(row?.attempts ?? 1, now, random), id],
        );
        requeued += 1;
        continue;
      }

      if (outcome.status === "conflict") {
        await tx.run(
          `UPDATE outbox_event
              SET state = 'conflict',
                  conflict_state = ?,
                  server_status = 'conflict',
                  settled_at = ?,
                  signature_data = NULL,
                  photo_data = NULL,
                  payload_bytes = 0
            WHERE id = ?`,
          [outcome.conflictState ?? null, settledAt, id],
        );
      } else {
        await tx.run(
          `UPDATE outbox_event
              SET state = 'confirmed',
                  server_status = ?,
                  settled_at = ?,
                  last_error = NULL,
                  signature_data = NULL,
                  photo_data = NULL,
                  payload_bytes = 0
            WHERE id = ?`,
          [outcome.status, settledAt, id],
        );
      }
      settled += 1;
    }

    return {
      settled,
      requeued,
      // Ids the server reported that we never sent. Not an error we can act on,
      // but worth recording: it means the response did not match the request.
      unknown: outcomes.filter((outcome) => !sent.has(outcome.id)).map((o) => o.id),
    };
  });
}

/**
 * Returns a claimed batch to the queue after a failed request.
 *
 * `retryAt` null leaves the row eligible immediately -- used for an auth failure,
 * where the driver's work must survive untouched and the retry is gated on them
 * signing in again rather than on a timer.
 */
export async function releaseBatch(
  sql: SqlDriver,
  ids: readonly string[],
  retryAt: string | null,
  lastError: string,
): Promise<void> {
  if (ids.length === 0) return;
  await sql.tx(async (tx) => {
    for (const id of ids) {
      await tx.run(
        `UPDATE outbox_event
            SET state = 'queued', next_attempt_at = ?, last_error = ?
          WHERE id = ?`,
        [retryAt, lastError, id],
      );
    }
  });
}

/**
 * Marks a batch permanently rejected.
 *
 * Only a 422 reaches here: the server understood the request and refused the
 * content, so retrying cannot help. This is the one outcome that loses the
 * driver's record, which is why the row is kept with its reason and shown
 * permanently on the outbox screen rather than deleted.
 */
export async function rejectBatch(
  sql: SqlDriver,
  ids: readonly string[],
  reason: string,
  now: Date,
): Promise<void> {
  if (ids.length === 0) return;
  const settledAt = now.toISOString();
  await sql.tx(async (tx) => {
    for (const id of ids) {
      await tx.run(
        `UPDATE outbox_event
            SET state = 'rejected', last_error = ?, settled_at = ?
          WHERE id = ?`,
        [reason, settledAt, id],
      );
    }
  });
}

/** Drops confirmed rows older than a day. Conflicts and rejections are kept. */
export async function prune(sql: SqlDriver, now: Date): Promise<number> {
  const cutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  return sql.run(
    "DELETE FROM outbox_event WHERE state = 'confirmed' AND settled_at <= ?",
    [cutoff],
  );
}

/** One unconfirmed row, as the outbox screen shows it. */
export type PendingRow = {
  id: string;
  stop_id: string;
  type: OutboxEventInput["type"];
  occurred_at: string;
  state: OutboxState;
  attempts: number;
  last_error: string | null;
  conflict_state: string | null;
};

/**
 * Rows still to settle.
 *
 * Deliberately lists its columns instead of SELECT *: signature_data and
 * photo_data must not be read to render a list, and a blob that is never read
 * cannot end up in a log or a crash report.
 */
export async function readPendingRows(sql: SqlDriver): Promise<PendingRow[]> {
  return sql.all<PendingRow>(
    `SELECT id, stop_id, type, occurred_at, state, attempts, last_error, conflict_state
       FROM outbox_event
      WHERE state != 'confirmed'
      ORDER BY id ASC`,
  );
}

export type SyncLogRow = {
  at: string;
  endpoint: string;
  sent: number | null;
  accepted: number | null;
  duplicates: number | null;
  conflicts: number | null;
  outcome: string;
  note: string | null;
};

/** The last drain attempt, so the outbox screen can report what actually happened. */
export async function readLastSync(sql: SqlDriver): Promise<SyncLogRow | null> {
  return sql.first<SyncLogRow>(
    `SELECT at, endpoint, sent, accepted, duplicates, conflicts, outcome, note
       FROM sync_log ORDER BY seq DESC`,
  );
}
