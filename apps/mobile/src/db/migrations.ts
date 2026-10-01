import type { SqlDriver } from "./driver";

/**
 * The device schema, as an ordered list of migrations behind PRAGMA
 * user_version.
 *
 * This database is a cache plus a queue, never a second system of record. Two
 * rules follow from that and are enforced by the column layout rather than by
 * discipline:
 *
 * 1. `stop.server_status` is the ONLY status column. There is no local status to
 *    drift from the server's. A pending local action changes what the UI shows
 *    by being folded over this value at read time (see src/outbox/projection.ts),
 *    not by being written into it.
 *
 * 2. `outbox_event.id` is the client-minted ULID, which IS the server's primary
 *    key. Making it the local primary key too means INSERT OR IGNORE turns a
 *    double-tap into a no-op on the device for the same reason a replay is a
 *    no-op on the server: one rule, one key, enforced at both ends.
 *
 * Clock times stay TEXT in "HH:MM" and dates TEXT in "YYYY-MM-DD", never parsed
 * into a Date -- docs/CONVENTIONS.md forbids a Date for wall-clock time, because
 * an outlet's 06:00 opening is a wall-clock fact, not an instant.
 */

export const MIGRATIONS: readonly string[] = [
  // ---- 1 ----------------------------------------------------------------
  `
  CREATE TABLE meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  -- The cached run. One row per operating date; the driver works one day.
  CREATE TABLE run (
    date       TEXT PRIMARY KEY,
    vehicle_id TEXT NOT NULL,
    fetched_at TEXT NOT NULL
  );

  CREATE TABLE trip (
    trip_id TEXT PRIMARY KEY,
    date    TEXT NOT NULL REFERENCES run(date) ON DELETE CASCADE,
    trip_no INTEGER NOT NULL,
    wave    TEXT NOT NULL
  );

  CREATE TABLE stop (
    id                 TEXT PRIMARY KEY,
    trip_id            TEXT NOT NULL REFERENCES trip(trip_id) ON DELETE CASCADE,
    date               TEXT NOT NULL,
    seq                INTEGER NOT NULL,
    outlet_id          TEXT NOT NULL,
    outlet_name        TEXT,
    -- Server truth only. Never written from a local action.
    server_status      TEXT NOT NULL,
    planned_arrival_at TEXT,
    window_open        TEXT,
    window_close       TEXT,
    access_note        TEXT
  );
  CREATE INDEX idx_stop_order ON stop(date, trip_id, seq);

  CREATE TABLE stop_order (
    stop_id        TEXT NOT NULL REFERENCES stop(id) ON DELETE CASCADE,
    order_id       TEXT NOT NULL,
    order_ref      TEXT NOT NULL,
    expected_units INTEGER NOT NULL,
    PRIMARY KEY (stop_id, order_id)
  );

  -- Server vocabularies (problem reasons etc). Cached so a driver with no
  -- signal still gets the real list rather than the hardcoded fallback.
  CREATE TABLE vocabulary (
    kind     TEXT NOT NULL,
    code     TEXT NOT NULL,
    position INTEGER NOT NULL,
    PRIMARY KEY (kind, code)
  );

  CREATE TABLE outbox_event (
    -- The client ULID. Idempotency lives here, at both ends of the wire.
    id              TEXT PRIMARY KEY,
    -- One user intent. A delivery is N line events plus one POD_CAPTURED;
    -- the drain takes whole batch_keys or none, because a POD arriving without
    -- its lines would be a half-recorded delivery on the server.
    batch_key       TEXT NOT NULL,
    stop_id         TEXT NOT NULL,
    type            TEXT NOT NULL,
    -- Device clock, ISO 8601. Presented only via formatDeviceClock().
    occurred_at     TEXT NOT NULL,
    order_id        TEXT,
    delivered_units INTEGER,
    recipient_name  TEXT,
    reason_code     TEXT,
    -- Base64 data URLs, and the only large values in this database. Selected
    -- at drain time only, and nulled the moment the event is confirmed.
    signature_data  TEXT,
    photo_data      TEXT,
    -- Denormalised so batching can cap a request by size without loading the
    -- blobs it is trying to measure.
    payload_bytes   INTEGER NOT NULL DEFAULT 0,
    state           TEXT NOT NULL
                      CHECK (state IN ('queued','sending','confirmed','conflict','rejected')),
    attempts        INTEGER NOT NULL DEFAULT 0,
    next_attempt_at TEXT,
    last_error      TEXT,
    server_status   TEXT,
    conflict_state  TEXT,
    created_at      TEXT NOT NULL,
    settled_at      TEXT
  );
  CREATE INDEX idx_outbox_ready ON outbox_event(state, next_attempt_at);
  CREATE INDEX idx_outbox_stop  ON outbox_event(stop_id, id);
  CREATE INDEX idx_outbox_batch ON outbox_event(batch_key, id);

  -- Every drain attempt, so the outbox screen can show what actually happened
  -- rather than a reassuring spinner.
  CREATE TABLE sync_log (
    seq           INTEGER PRIMARY KEY AUTOINCREMENT,
    at            TEXT NOT NULL,
    endpoint      TEXT NOT NULL,
    sent          INTEGER,
    accepted      INTEGER,
    duplicates    INTEGER,
    conflicts     INTEGER,
    clock_skew_ms INTEGER,
    server_seq    INTEGER,
    outcome       TEXT NOT NULL,
    note          TEXT
  );
  `,
];

/** The user_version a fully migrated database reports. */
export const SCHEMA_VERSION = MIGRATIONS.length;

type VersionRow = { user_version: number };

export async function currentVersion(sql: SqlDriver): Promise<number> {
  const row = await sql.first<VersionRow>("PRAGMA user_version");
  return row?.user_version ?? 0;
}

/**
 * Applies every migration the database has not seen, in order.
 *
 * Idempotent: running it on an up-to-date database does nothing. Each migration
 * and its version bump go in one transaction, so an interrupted upgrade cannot
 * leave the schema half-applied -- on a handset that is a crash or a battery
 * death mid-launch, not a hypothetical.
 */
export async function migrate(sql: SqlDriver): Promise<number> {
  const from = await currentVersion(sql);

  for (let version = from; version < MIGRATIONS.length; version++) {
    const statements = MIGRATIONS[version];
    await sql.tx(async (tx) => {
      await tx.exec(statements);
      // PRAGMA will not take a bound parameter. The value is a loop index over a
      // module constant, never input.
      await tx.exec(`PRAGMA user_version = ${version + 1}`);
    });
  }

  return MIGRATIONS.length;
}
