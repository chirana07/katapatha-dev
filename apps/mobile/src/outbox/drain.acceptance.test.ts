import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { openNodeSqlite } from "../db/node-sqlite";
import { migrate } from "../db/migrations";
import type { SqlDriver } from "../db/driver";
import { arrivalIntent, deliveryIntent, problemIntent, unloadIntent } from "./intents";
import { enqueue, counts, pendingForStop, type OutboxRow } from "./repo";
import { projectStopStatus } from "./projection";
import { createDrain } from "./drain";
import type { Transport, TransportResult } from "./transport";

/**
 * THE ACCEPTANCE TEST.
 *
 * src/outbox/README.md states it verbatim:
 *
 *   "queue three events offline, reconnect, drain, assert accepted=3,
 *    duplicates=0; then replay the identical batch and assert duplicates=3"
 *
 * and makes it a release gate: "Do not claim offline durability in the UI until
 * that test passes." src/outbox/claims.ts holds that claim as one constant, and
 * it may only be true while this file is green.
 *
 * Two deliberate choices about how it is written:
 *
 * 1. Real SQLite, via node:sqlite, running the real DDL from src/db/migrations.ts
 *    and the real statements from src/outbox/repo.ts. expo-sqlite is a native
 *    module and cannot run here, but the SQL is identical -- only the binding
 *    differs -- so this exercises the queue rather than a model of it.
 *
 * 2. The fake sits at the Transport port, not at fetch. What is under test is the
 *    device's state machine against a server that behaves as the contract says.
 *    The Prism mock CANNOT stand in: it returns a static example (accepted: 3,
 *    duplicates: 0) with three hard-coded ULIDs whatever it is sent, so a replay
 *    against it can never report duplicates=3. The request *shape* is asserted
 *    separately in transport.test.ts.
 */

/**
 * A server that behaves the way the contract says the applier does: the event id
 * is the primary key, so an id it has seen before is a duplicate and changes
 * nothing.
 */
function createFakeApplier() {
  const seen = new Set<string>();
  let online = true;
  let requests = 0;

  const transport: Transport = {
    async send(rows: readonly OutboxRow[]): Promise<TransportResult> {
      requests += 1;
      if (!online) throw_offline();

      let accepted = 0;
      let duplicates = 0;
      const outcomes = rows.map((row) => {
        if (seen.has(row.id)) {
          duplicates += 1;
          return { id: row.id, status: "duplicate" as const, conflictState: null };
        }
        seen.add(row.id);
        accepted += 1;
        return { id: row.id, status: "accepted" as const, conflictState: null };
      });

      return {
        kind: "ok",
        endpoint: "/sync/stop-events",
        accepted,
        duplicates,
        conflicts: 0,
        outcomes,
        clockSkewMs: 0,
        serverSeq: seen.size,
        note: null,
      };
    },
  };

  // Offline is a thrown fetch, which is what the real transport reports.
  function throw_offline(): never {
    throw new Error("Network request failed");
  }

  return {
    transport: {
      async send(rows: readonly OutboxRow[]) {
        try {
          return await transport.send(rows);
        } catch (error) {
          return {
            kind: "offline" as const,
            error: error instanceof Error ? error.message : "offline",
          };
        }
      },
    } satisfies Transport,
    goOffline: () => {
      online = false;
    },
    goOnline: () => {
      online = true;
    },
    /** Replays a batch the server has already seen, as a reconnecting phone would. */
    replay: (rows: readonly OutboxRow[]) => transport.send(rows),
    get requests() {
      return requests;
    },
  };
}

let sql: SqlDriver;
const NOW = new Date("2026-10-01T04:10:00.000Z");
const STOP = "stop-1";

/** Fixed, so the backoff schedule in the assertions is deterministic. */
const noJitter = () => 0.5;

async function seedStop(): Promise<void> {
  await sql.run("INSERT INTO run (date, vehicle_id, fetched_at) VALUES (?, ?, ?)", [
    "2026-10-01",
    "VEH043",
    NOW.toISOString(),
  ]);
  await sql.run("INSERT INTO trip (trip_id, date, trip_no, wave) VALUES (?, ?, ?, ?)", [
    "trip-1",
    "2026-10-01",
    1,
    "PREDAWN",
  ]);
  await sql.run(
    `INSERT INTO stop
       (id, trip_id, date, seq, outlet_id, outlet_name, server_status,
        planned_arrival_at, window_open, window_close, access_note)
     VALUES (?, 'trip-1', '2026-10-01', 1, 'OUT074', 'Fresh Nugegoda', 'PENDING',
             '04:12', '06:00', '11:00', 'Rear dock. Van only.')`,
    [STOP],
  );
  await sql.run(
    "INSERT INTO stop_order (stop_id, order_id, order_ref, expected_units) VALUES (?, ?, ?, ?)",
    [STOP, "order-1", "ORD-004312", 120],
  );
}

beforeEach(async () => {
  sql = openNodeSqlite();
  await migrate(sql);
  await seedStop();
});

afterEach(async () => {
  await sql.close();
});

describe("the acceptance test from src/outbox/README.md", () => {
  it("queues three events offline, drains accepted=3, then replays duplicates=3", async () => {
    const server = createFakeApplier();
    const drain = createDrain({
      sql,
      transport: server.transport,
      now: () => NOW,
      random: noJitter,
    });

    // ---- offline: three single-event intents -----------------------------
    server.goOffline();

    await enqueue(sql, arrivalIntent(STOP, "2026-10-01T04:12:00.000Z"), NOW);
    await enqueue(sql, unloadIntent(STOP, "2026-10-01T04:20:00.000Z"), NOW);
    await enqueue(
      sql,
      problemIntent({
        stopId: STOP,
        occurredAt: "2026-10-01T04:30:00.000Z",
        reasonCode: "OUTLET_CLOSED",
      }),
      NOW,
    );

    expect((await counts(sql, NOW)).unsent).toBe(3);

    // A drain while offline must change nothing but the retry schedule.
    const offlineAttempt = await drain.drain();
    expect(offlineAttempt.outcome).toBe("offline");
    expect((await counts(sql, NOW)).unsent).toBe(3);

    // ---- reconnect and drain --------------------------------------------
    // immediate, because this stands in for the Offline -> Connected edge: the
    // backoff was set by the failed send above and regaining signal makes it
    // obsolete.
    server.goOnline();
    const results = await drain.drainAll({ immediate: true });

    const totals = results.reduce(
      (sum, result) => ({
        accepted: sum.accepted + result.accepted,
        duplicates: sum.duplicates + result.duplicates,
        conflicts: sum.conflicts + result.conflicts,
      }),
      { accepted: 0, duplicates: 0, conflicts: 0 },
    );

    expect(totals).toEqual({ accepted: 3, duplicates: 0, conflicts: 0 });
    expect((await counts(sql, NOW)).unsent).toBe(0);

    // ---- replay the identical batch -------------------------------------
    // What a phone does when it cannot tell whether its last request landed.
    const sent = await sql.all<OutboxRow>(
      "SELECT * FROM outbox_event ORDER BY id ASC",
    );
    const replay = await server.replay(sent);

    expect(replay.kind).toBe("ok");
    if (replay.kind !== "ok") return;
    expect(replay.accepted).toBe(0);
    expect(replay.duplicates).toBe(3);
    expect(replay.conflicts).toBe(0);
  });

  it("holds a realistic run -- arrive, unload, deliver with POD -- to the same guarantee", async () => {
    // The README's literal case is three single events. A real stop is an
    // arrival, an unload and a delivery that is itself several events.
    const server = createFakeApplier();
    const drain = createDrain({
      sql,
      transport: server.transport,
      now: () => NOW,
      random: noJitter,
    });

    server.goOffline();

    await enqueue(sql, arrivalIntent(STOP, "2026-10-01T04:12:00.000Z"), NOW);
    await enqueue(sql, unloadIntent(STOP, "2026-10-01T04:20:00.000Z"), NOW);
    await enqueue(
      sql,
      deliveryIntent({
        stopId: STOP,
        occurredAt: "2026-10-01T04:40:00.000Z",
        recipientName: "Nimali Perera",
        lines: [{ orderId: "order-1", expectedUnits: 120, deliveredUnits: 118 }],
        signatureData: "data:image/svg+xml;base64,PHN2Zz4=",
        photoData: "data:image/jpeg;base64,/9j/4AAQ",
      }),
      NOW,
    );

    // arrival + unload + (1 line + 1 POD) = 4 events across 3 intents.
    const queued = await counts(sql, NOW);
    expect(queued.unsent).toBe(4);

    // The driver sees the stop as delivered while the server still says PENDING.
    const pending = await pendingForStop(sql, STOP);
    const projected = projectStopStatus("PENDING", pending);
    expect(projected.status).toBe("DONE");
    expect(projected.unsent).toBe(4);
    expect(projected.state).toBe("unsent");

    server.goOnline();
    const results = await drain.drainAll({ immediate: true });
    const accepted = results.reduce((sum, r) => sum + r.accepted, 0);
    const duplicates = results.reduce((sum, r) => sum + r.duplicates, 0);

    expect(accepted).toBe(4);
    expect(duplicates).toBe(0);
    expect((await counts(sql, NOW)).unsent).toBe(0);

    // Every row confirmed, and the blobs gone.
    const rows = await sql.all<OutboxRow>("SELECT * FROM outbox_event");
    expect(rows).toHaveLength(4);
    for (const row of rows) {
      expect(row.state).toBe("confirmed");
      expect(row.signature_data).toBe(null);
      expect(row.photo_data).toBe(null);
      expect(row.payload_bytes).toBe(0);
    }

    // And the replay still reports every one as a duplicate.
    const replay = await server.replay(rows);
    if (replay.kind !== "ok") throw new Error("expected ok");
    expect(replay.accepted).toBe(0);
    expect(replay.duplicates).toBe(4);
  });

  it("records the counts in sync_log, so the outbox screen can show the truth", async () => {
    const server = createFakeApplier();
    const drain = createDrain({
      sql,
      transport: server.transport,
      now: () => NOW,
      random: noJitter,
    });

    await enqueue(sql, arrivalIntent(STOP, "2026-10-01T04:12:00.000Z"), NOW);
    await drain.drain();

    const row = await sql.first<{
      endpoint: string;
      sent: number;
      accepted: number;
      duplicates: number;
      outcome: string;
    }>("SELECT endpoint, sent, accepted, duplicates, outcome FROM sync_log ORDER BY seq DESC");

    expect(row).toMatchObject({
      endpoint: "/sync/stop-events",
      sent: 1,
      accepted: 1,
      duplicates: 0,
      outcome: "sent",
    });
  });
});

describe("a double-tap", () => {
  it("is a no-op locally, for the same reason a replay is on the server", async () => {
    // One intent, submitted twice: the id is minted once and stored, so the
    // second insert collides on the primary key and is ignored. Minting a fresh
    // id per attempt would write the arrival twice.
    const intent = arrivalIntent(STOP, "2026-10-01T04:12:00.000Z");

    expect(await enqueue(sql, intent, NOW)).toBe(1);
    expect(await enqueue(sql, intent, NOW)).toBe(0);

    expect((await counts(sql, NOW)).unsent).toBe(1);
  });
});

describe("concurrent drains", () => {
  it("send each event once, because the drain is single-flight", async () => {
    const server = createFakeApplier();
    const drain = createDrain({
      sql,
      transport: server.transport,
      now: () => NOW,
      random: noJitter,
    });

    await enqueue(sql, arrivalIntent(STOP, "2026-10-01T04:12:00.000Z"), NOW);

    // Three triggers at once: enqueue, the connectivity edge, and the ticker.
    const [a, b, c] = await Promise.all([drain.drain(), drain.drain(), drain.drain()]);

    expect(server.requests).toBe(1);
    // All three callers observe the same outcome.
    expect(a).toEqual(b);
    expect(b).toEqual(c);
    expect(a.accepted).toBe(1);
  });
});

describe("a delivery's events", () => {
  it("are never split across two requests", async () => {
    // A POD_CAPTURED arriving without its order lines would be a half-recorded
    // delivery on the server, so claimBatch takes whole batch_keys.
    const sentBatches: string[][] = [];
    const transport: Transport = {
      async send(rows) {
        sentBatches.push(rows.map((row) => row.id));
        return {
          kind: "ok",
          endpoint: "/sync/stop-events",
          accepted: rows.length,
          duplicates: 0,
          conflicts: 0,
          outcomes: rows.map((row) => ({
            id: row.id,
            status: "accepted" as const,
            conflictState: null,
          })),
          clockSkewMs: 0,
          serverSeq: 1,
          note: null,
        };
      },
    };

    const drain = createDrain({ sql, transport, now: () => NOW, random: noJitter });

    const intent = deliveryIntent({
      stopId: STOP,
      occurredAt: "2026-10-01T04:40:00.000Z",
      recipientName: "Nimali Perera",
      lines: [
        { orderId: "a", expectedUnits: 10, deliveredUnits: 10 },
        { orderId: "b", expectedUnits: 10, deliveredUnits: 4 },
      ],
      signatureData: "data:image/svg+xml;base64,PHN2Zz4=",
    });
    await enqueue(sql, intent, NOW);

    await drain.drainAll({ immediate: true });

    // 2 lines + 1 POD, all in the first request.
    expect(sentBatches[0]).toHaveLength(3);
    expect(new Set(sentBatches[0])).toEqual(new Set(intent.events.map((e) => e.id)));
  });
});
