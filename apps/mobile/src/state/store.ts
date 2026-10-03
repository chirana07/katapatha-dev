import type { SqlDriver } from "../db/driver";
import { colomboToday } from "../driver/format";
import type { StopStatus } from "../driver/stop-state";
import {
  counts,
  enqueue,
  pendingByStop,
  readLastDelivered,
  readLastSync,
  readPendingRows,
  type OutboxCounts,
  type PendingRow,
  type SyncLogRow,
} from "../outbox/repo";
import { projectRun, type Projection } from "../outbox/projection";
import type { Intent } from "../outbox/intents";
import { readRun, readVocabulary, type CachedStop } from "../sync/runRepo";
import { emptyStopRecord, readStopRecords, type StopRecord } from "../sync/stopRecords";

/**
 * The run, as the screens see it.
 *
 * SQLite is the cache, so there is no second in-memory cache in front of it and
 * no react-query. A snapshot is simply "what the last database read said, with
 * the pending events folded in", which makes it auditable: if a screen shows
 * something, a SELECT explains why.
 *
 * Writes are not request/response from a screen's point of view. submit() inserts
 * into the outbox and recomputes the snapshot; whether the network is reachable
 * changes only when the drain succeeds, not what the driver sees.
 *
 * Dependencies are arguments, which is what lets this be exercised without React.
 */

export type ProjectedStop = CachedStop & {
  projection: Projection;
  /**
   * What this phone recorded for the stop (outbox rows only, no blobs). Always
   * present: an untouched stop has an empty record, never null.
   */
  record: StopRecord;
};

export type RunSnapshot = {
  date: string;
  /** Null until the first successful bootstrap for this date. */
  vehicleId: string | null;
  fetchedAt: string | null;
  stops: ProjectedStop[];
  outbox: OutboxCounts;
  problemReasons: string[];
  /** True when problemReasons came from the local fallback, not the server. */
  reasonsAreFallback: boolean;
  clockSkewMs: number | null;
  lastDrainAt: string | null;
  /**
   * Every unconfirmed row, for the outbox screen. Held on the snapshot rather than
   * fetched by that screen, so there is one read path into SQLite and the screen
   * cannot show a different set of records from the badge counting them.
   */
  pending: PendingRow[];
  /** The last drain ATTEMPT (any outcome), as the outbox screen reports it. */
  lastSync: SyncLogRow | null;
  /**
   * When the last drain that put records on the server finished (the server's
   * `sent` sync_log row, device clock), and how many records it took (accepted
   * plus already-held). Null until one has. Source for the "Back online" notice.
   */
  lastSettledAt: string | null;
  lastSettledCount: number;
};

export type StoreDeps = {
  sql: SqlDriver;
  now?: () => Date;
};

export function createRunStore(deps: StoreDeps) {
  const now = deps.now ?? (() => new Date());
  const listeners = new Set<() => void>();

  let date = colomboToday(now());
  let snapshot: RunSnapshot = empty(date);

  function emit(): void {
    for (const listener of listeners) listener();
  }

  async function read(): Promise<RunSnapshot> {
    const [run, pending, outbox, reasons, meta, pendingRows, lastSync, delivered, records] =
      await Promise.all([
        readRun(deps.sql, date),
        pendingByStop(deps.sql, date),
        counts(deps.sql, now()),
        readVocabulary(deps.sql, "problemReasons"),
        readMeta(deps.sql),
        readPendingRows(deps.sql),
        readLastSync(deps.sql),
        readLastDelivered(deps.sql),
        readStopRecords(deps.sql, date),
      ]);

    const stops = run
      ? projectRun(
          run.stops.map((stop) => ({ ...stop, serverStatus: stop.serverStatus })),
          pending,
        ).map((stop) => ({ ...stop, record: records.get(stop.id) ?? emptyStopRecord() }))
      : [];

    return {
      date,
      vehicleId: run?.vehicleId ?? null,
      fetchedAt: run?.fetchedAt ?? null,
      stops: stops as ProjectedStop[],
      outbox,
      // An empty cached vocabulary means the device has never seen the server's
      // list. The screen must then say it is using a local fallback.
      problemReasons: reasons,
      reasonsAreFallback: reasons.length === 0,
      clockSkewMs: meta.clockSkewMs,
      lastDrainAt: meta.lastDrainAt,
      pending: pendingRows,
      lastSync,
      lastSettledAt: delivered?.at ?? null,
      lastSettledCount: delivered ? (delivered.accepted ?? 0) + (delivered.duplicates ?? 0) : 0,
    };
  }

  return {
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    getSnapshot(): RunSnapshot {
      return snapshot;
    },

    /** Re-reads from SQLite and notifies. Called after any write or drain. */
    async refresh(): Promise<RunSnapshot> {
      snapshot = await read();
      emit();
      return snapshot;
    },

    /** Switches operating date. Rarely used; a driver works one day. */
    async setDate(next: string): Promise<void> {
      if (next === date) return;
      date = next;
      await this.refresh();
    },

    getDate(): string {
      return date;
    },

    /**
     * Queues one driver action and recomputes the view.
     *
     * Returns the number of events actually inserted: zero means this exact
     * intent was already queued, which is what a double-tap looks like.
     */
    async submit(intent: Intent): Promise<number> {
      const inserted = await enqueue(deps.sql, intent, now());
      await this.refresh();
      return inserted;
    },

    /** One stop from the current snapshot, without touching the database. */
    stop(stopId: string): ProjectedStop | null {
      return snapshot.stops.find((candidate) => candidate.id === stopId) ?? null;
    },
  };
}

export type RunStore = ReturnType<typeof createRunStore>;

function empty(date: string): RunSnapshot {
  return {
    date,
    vehicleId: null,
    fetchedAt: null,
    stops: [],
    outbox: { unsent: 0, ready: 0, conflicts: 0, rejected: 0 },
    problemReasons: [],
    reasonsAreFallback: true,
    clockSkewMs: null,
    lastDrainAt: null,
    pending: [],
    lastSync: null,
    lastSettledAt: null,
    lastSettledCount: 0,
  };
}

async function readMeta(
  sql: SqlDriver,
): Promise<{ clockSkewMs: number | null; lastDrainAt: string | null }> {
  const rows = await sql.all<{ key: string; value: string }>(
    "SELECT key, value FROM meta WHERE key IN ('clock_skew_ms', 'last_drain_at')",
  );
  const map = new Map(rows.map((row) => [row.key, row.value]));
  const skew = map.get("clock_skew_ms");
  const parsed = skew === undefined ? null : Number(skew);
  return {
    clockSkewMs: parsed !== null && Number.isFinite(parsed) ? parsed : null,
    lastDrainAt: map.get("last_drain_at") ?? null,
  };
}

/** Progress over the projected statuses, so unsent work counts as done locally. */
export function snapshotProgress(snapshot: RunSnapshot): {
  done: number;
  total: number;
  remaining: number;
  nextStopId: string | null;
} {
  const terminal = new Set<StopStatus>(["DONE", "SKIPPED", "FAILED"]);
  const total = snapshot.stops.length;
  const done = snapshot.stops.filter((stop) => terminal.has(stop.projection.status)).length;
  const next = snapshot.stops.find((stop) => !terminal.has(stop.projection.status));
  return { done, total, remaining: total - done, nextStopId: next?.id ?? null };
}

/** What the "Delivery recorded" screen shows for one stop. */
export type DeliveryRecord = {
  /** Sum of the recorded lines, or null when this phone has no delivery lines for the stop. */
  unitsDelivered: number | null;
  /** What was on the vehicle for the stop's orders (the run payload's expectedUnits). */
  unitsExpected: number;
  recipientName: string | null;
  /** Device clock (ISO); present through formatDeviceClock(). */
  completedAt: string | null;
  pageCount: number;
  /**
   * 'saved-on-phone' while any of the stop's events is queued or sending, else
   * 'sent'. 'sent' means the server has nothing left to take from this phone for
   * the stop -- see `attention` for the two cases where that is not good news.
   */
  sentState: "saved-on-phone" | "sent";
  /**
   * 'rejected' or 'conflict' when the server refused or did not apply one of the
   * stop's events. A screen must not show a green "Sent" over either.
   */
  attention: "none" | "conflict" | "rejected";
};

export function deliveryRecord(stop: ProjectedStop): DeliveryRecord {
  const { record, projection } = stop;
  const unitsDelivered =
    record.lines.length > 0
      ? record.lines.reduce((sum, line) => sum + line.deliveredUnits, 0)
      : null;
  return {
    unitsDelivered,
    unitsExpected: stop.orders.reduce((sum, order) => sum + order.expectedUnits, 0),
    recipientName: record.recipientName,
    completedAt: record.completedAt,
    pageCount: record.pageCount,
    sentState: projection.unsent > 0 ? "saved-on-phone" : "sent",
    attention:
      projection.state === "rejected"
        ? "rejected"
        : projection.state === "conflict"
          ? "conflict"
          : "none",
  };
}
