import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { openNodeSqlite } from "../db/node-sqlite";
import { migrate } from "../db/migrations";
import type { SqlDriver } from "../db/driver";
import { arrivalIntent, deliveryIntent } from "./intents";
import { MAX_AUTOMATIC_ATTEMPTS } from "./backoff";
import {
  MAX_BATCH_EVENTS,
  claimBatch,
  counts,
  enqueue,
  pendingForStop,
  prune,
  rejectBatch,
  releaseBatch,
  releaseStaleSending,
  settleResults,
  type OutboxRow,
} from "./repo";

let sql: SqlDriver;
const NOW = new Date("2026-10-01T04:10:00.000Z");
const noJitter = () => 0.5;

beforeEach(async () => {
  sql = openNodeSqlite();
  await migrate(sql);
});

afterEach(async () => {
  await sql.close();
});

async function rows(): Promise<OutboxRow[]> {
  return sql.all<OutboxRow>("SELECT * FROM outbox_event ORDER BY id ASC");
}

describe("enqueue", () => {
  it("stores every event of an intent under one batch key", async () => {
    const intent = deliveryIntent({
      stopId: "stop-1",
      occurredAt: NOW.toISOString(),
      recipientName: "Nimali Perera",
      lines: [
        { orderId: "a", expectedUnits: 10, deliveredUnits: 10 },
        { orderId: "b", expectedUnits: 10, deliveredUnits: 3 },
      ],
      signatureData: "data:image/svg+xml;base64,PHN2Zz4=",
    });

    expect(await enqueue(sql, intent, NOW)).toBe(3);

    const stored = await rows();
    expect(new Set(stored.map((row) => row.batch_key)).size).toBe(1);
    expect(stored.map((row) => row.type).sort()).toEqual([
      "DELIVERED",
      "PART_DELIVERED",
      "POD_CAPTURED",
    ]);
  });

  it("records payload_bytes so batching can cap size without reading blobs", async () => {
    await enqueue(
      sql,
      deliveryIntent({
        stopId: "stop-1",
        occurredAt: NOW.toISOString(),
        recipientName: "N",
        lines: [{ orderId: "a", expectedUnits: 1, deliveredUnits: 1 }],
        signatureData: "x".repeat(1000),
      }),
      NOW,
    );

    const pod = (await rows()).find((row) => row.type === "POD_CAPTURED");
    expect(pod?.payload_bytes).toBeGreaterThan(1000);
  });

  it("ignores a re-submitted intent, because the ULID is the primary key", async () => {
    const intent = arrivalIntent("stop-1", NOW.toISOString());
    expect(await enqueue(sql, intent, NOW)).toBe(1);
    expect(await enqueue(sql, intent, NOW)).toBe(0);
    expect(await rows()).toHaveLength(1);
  });
});

describe("counts", () => {
  it("separates unsent from ready, so a backoff is not reported as idle", async () => {
    await enqueue(sql, arrivalIntent("stop-1", NOW.toISOString()), NOW);
    const [row] = await rows();

    // Push it into the future: still unsent, no longer ready.
    await sql.run("UPDATE outbox_event SET next_attempt_at = ? WHERE id = ?", [
      new Date(NOW.getTime() + 60_000).toISOString(),
      row.id,
    ]);

    expect(await counts(sql, NOW)).toEqual({
      unsent: 1,
      ready: 0,
      conflicts: 0,
      rejected: 0,
    });
  });

  it("reports zeroes on an empty outbox rather than nulls", async () => {
    // SUM over no rows is NULL in SQLite; a null leaking into the UI would
    // render as "null records unsent".
    expect(await counts(sql, NOW)).toEqual({
      unsent: 0,
      ready: 0,
      conflicts: 0,
      rejected: 0,
    });
  });
});

describe("claimBatch", () => {
  it("marks claimed rows sending and increments attempts", async () => {
    await enqueue(sql, arrivalIntent("stop-1", NOW.toISOString()), NOW);

    const claimed = await claimBatch(sql, NOW);

    expect(claimed).toHaveLength(1);
    const [stored] = await rows();
    expect(stored.state).toBe("sending");
    expect(stored.attempts).toBe(1);
  });

  it("skips rows whose backoff has not elapsed", async () => {
    await enqueue(sql, arrivalIntent("stop-1", NOW.toISOString()), NOW);
    await sql.run("UPDATE outbox_event SET next_attempt_at = ?", [
      new Date(NOW.getTime() + 60_000).toISOString(),
    ]);

    expect(await claimBatch(sql, NOW)).toHaveLength(0);
  });

  it("ignores the schedule when the driver taps Send now", async () => {
    await enqueue(sql, arrivalIntent("stop-1", NOW.toISOString()), NOW);
    await sql.run("UPDATE outbox_event SET next_attempt_at = ?", [
      new Date(NOW.getTime() + 600_000).toISOString(),
    ]);

    expect(await claimBatch(sql, NOW, { immediate: true })).toHaveLength(1);
  });

  it("excludes a row that has exhausted its automatic attempts", async () => {
    // Regression: next_attempt_at IS NULL means "never attempted, send now", so
    // when nextAttemptAt() returned null for an exhausted row, that row became
    // the FIRST thing every drain picked up -- an endless retry loop on exactly
    // the rows meant to stop being retried. Exhaustion is now an attempts check.
    await enqueue(sql, arrivalIntent("stop-1", NOW.toISOString()), NOW);
    await sql.run(
      "UPDATE outbox_event SET attempts = ?, next_attempt_at = NULL",
      [MAX_AUTOMATIC_ATTEMPTS],
    );

    expect(await claimBatch(sql, NOW)).toHaveLength(0);
    expect((await counts(sql, NOW)).ready).toBe(0);
    // Still unsent, though: the work is held, not discarded.
    expect((await counts(sql, NOW)).unsent).toBe(1);
  });

  it("still sends an exhausted row when the driver asks", async () => {
    await enqueue(sql, arrivalIntent("stop-1", NOW.toISOString()), NOW);
    await sql.run("UPDATE outbox_event SET attempts = ?", [MAX_AUTOMATIC_ATTEMPTS]);

    expect(await claimBatch(sql, NOW, { immediate: true })).toHaveLength(1);
  });

  it("claims a never-attempted row immediately", async () => {
    // The other meaning of NULL, which must keep working.
    await enqueue(sql, arrivalIntent("stop-1", NOW.toISOString()), NOW);
    const [row] = await rows();
    expect(row.next_attempt_at).toBe(null);
    expect(await claimBatch(sql, NOW)).toHaveLength(1);
  });

  it("never splits one intent across two batches", async () => {
    // Enough intents to exceed the event cap, each with several events: the cut
    // must land on a batch boundary, never inside a delivery.
    for (let index = 0; index < 30; index++) {
      await enqueue(
        sql,
        deliveryIntent({
          stopId: "stop-1",
          occurredAt: NOW.toISOString(),
          recipientName: "N",
          lines: [
            { orderId: `a${index}`, expectedUnits: 1, deliveredUnits: 1 },
            { orderId: `b${index}`, expectedUnits: 1, deliveredUnits: 1 },
          ],
        }),
        NOW,
      );
    }

    const claimed = await claimBatch(sql, NOW);

    const byBatch = new Map<string, number>();
    for (const row of claimed) {
      byBatch.set(row.batch_key, (byBatch.get(row.batch_key) ?? 0) + 1);
    }
    // Every claimed batch is complete: 3 events each (2 lines + 1 POD).
    for (const count of byBatch.values()) expect(count).toBe(3);
    expect(claimed.length).toBeLessThanOrEqual(MAX_BATCH_EVENTS);
  });

  it("takes an oversized intent alone rather than stranding it forever", async () => {
    // A delivery with a large photo can exceed the byte cap on its own. Refusing
    // it would mean that delivery never reaches the server.
    await enqueue(
      sql,
      deliveryIntent({
        stopId: "stop-1",
        occurredAt: NOW.toISOString(),
        recipientName: "N",
        lines: [{ orderId: "a", expectedUnits: 1, deliveredUnits: 1 }],
        photoData: "x".repeat(2_000_000),
      }),
      NOW,
    );

    expect(await claimBatch(sql, NOW)).toHaveLength(2);
  });
});

describe("settleResults", () => {
  async function claimOne(): Promise<OutboxRow> {
    await enqueue(sql, arrivalIntent("stop-1", NOW.toISOString()), NOW);
    const [claimed] = await claimBatch(sql, NOW);
    return claimed;
  }

  it("treats a duplicate exactly like an accept, because it is a success", async () => {
    const row = await claimOne();

    await settleResults(sql, [row.id], [{ id: row.id, status: "duplicate" }], NOW);

    const [stored] = await rows();
    expect(stored.state).toBe("confirmed");
    expect(stored.server_status).toBe("duplicate");
    expect(stored.last_error).toBe(null);
  });

  it("clears the blobs the moment an event is confirmed", async () => {
    // Reclaims the space, and means a signature cannot surface in a later log or
    // crash report because it is no longer in the database to read.
    await enqueue(
      sql,
      deliveryIntent({
        stopId: "stop-1",
        occurredAt: NOW.toISOString(),
        recipientName: "N",
        lines: [{ orderId: "a", expectedUnits: 1, deliveredUnits: 1 }],
        signatureData: "data:image/svg+xml;base64,PHN2Zz4=",
        photoData: "data:image/jpeg;base64,/9j/4AAQ",
      }),
      NOW,
    );
    const claimed = await claimBatch(sql, NOW);
    await settleResults(
      sql,
      claimed.map((row) => row.id),
      claimed.map((row) => ({ id: row.id, status: "accepted" as const })),
      NOW,
    );

    for (const stored of await rows()) {
      expect(stored.signature_data).toBe(null);
      expect(stored.photo_data).toBe(null);
      expect(stored.payload_bytes).toBe(0);
    }
  });

  it("marks a conflict terminal and keeps the reason", async () => {
    const row = await claimOne();

    await settleResults(
      sql,
      [row.id],
      [{ id: row.id, status: "conflict", conflictState: "STALE_ASSIGNMENT" }],
      NOW,
    );

    const [stored] = await rows();
    expect(stored.state).toBe("conflict");
    expect(stored.conflict_state).toBe("STALE_ASSIGNMENT");
  });

  it("re-queues a row the server did not mention", async () => {
    // The server did not say what happened, so the only safe reading is that it
    // did not land -- and re-sending is free, because of the ULID.
    const row = await claimOne();

    const result = await settleResults(sql, [row.id], [], NOW, noJitter);

    expect(result.requeued).toBe(1);
    const [stored] = await rows();
    expect(stored.state).toBe("queued");
    expect(stored.next_attempt_at).not.toBe(null);
  });

  it("reports ids the server returned that we never sent", async () => {
    const row = await claimOne();

    const result = await settleResults(
      sql,
      [row.id],
      [
        { id: row.id, status: "accepted" },
        { id: "01JSOMETHINGELSE0000000000", status: "accepted" },
      ],
      NOW,
    );

    expect(result.unknown).toEqual(["01JSOMETHINGELSE0000000000"]);
  });
});

describe("releaseBatch and rejectBatch", () => {
  it("returns rows to the queue with no schedule when retryAt is null", async () => {
    // The auth path: a driver's work is never discarded over an expired session.
    await enqueue(sql, arrivalIntent("stop-1", NOW.toISOString()), NOW);
    const claimed = await claimBatch(sql, NOW);

    await releaseBatch(sql, claimed.map((r) => r.id), null, "session expired");

    const [stored] = await rows();
    expect(stored.state).toBe("queued");
    expect(stored.next_attempt_at).toBe(null);
    expect(stored.last_error).toBe("session expired");
  });

  it("keeps a rejected row with its reason instead of deleting it", async () => {
    // This is the only outcome that loses the driver's record, so the evidence
    // must stay on screen for them to phone the depot about.
    await enqueue(sql, arrivalIntent("stop-1", NOW.toISOString()), NOW);
    const claimed = await claimBatch(sql, NOW);

    await rejectBatch(sql, claimed.map((r) => r.id), "The server rejected these details.", NOW);

    const [stored] = await rows();
    expect(stored.state).toBe("rejected");
    expect(stored.last_error).toMatch(/rejected these details/);
    expect(stored.settled_at).not.toBe(null);
  });
});

describe("releaseStaleSending", () => {
  it("recovers rows stranded by a crash mid-request", async () => {
    await enqueue(sql, arrivalIntent("stop-1", NOW.toISOString()), NOW);
    await claimBatch(sql, NOW);

    // Ten minutes later, on a fresh launch.
    const later = new Date(NOW.getTime() + 600_000);
    expect(await releaseStaleSending(sql, later)).toBe(1);

    const [stored] = await rows();
    expect(stored.state).toBe("queued");
  });

  it("leaves a request that is still in flight alone", async () => {
    await enqueue(sql, arrivalIntent("stop-1", NOW.toISOString()), NOW);
    await claimBatch(sql, NOW);

    expect(await releaseStaleSending(sql, new Date(NOW.getTime() + 1_000))).toBe(0);
    expect((await rows())[0].state).toBe("sending");
  });
});

describe("prune", () => {
  it("drops confirmed rows after a day but keeps conflicts and rejections", async () => {
    await enqueue(sql, arrivalIntent("stop-1", NOW.toISOString()), NOW);
    const claimed = await claimBatch(sql, NOW);
    await settleResults(
      sql,
      claimed.map((r) => r.id),
      claimed.map((r) => ({ id: r.id, status: "accepted" as const })),
      NOW,
    );
    await sql.run("INSERT INTO outbox_event (id,batch_key,stop_id,type,occurred_at,state,created_at,settled_at) VALUES ('01JCONFLICT','b','stop-1','ARRIVED',?, 'conflict',?,?)", [
      NOW.toISOString(),
      NOW.toISOString(),
      NOW.toISOString(),
    ]);

    const twoDaysLater = new Date(NOW.getTime() + 2 * 24 * 60 * 60 * 1000);
    expect(await prune(sql, twoDaysLater)).toBe(1);

    const remaining = await rows();
    expect(remaining).toHaveLength(1);
    expect(remaining[0].state).toBe("conflict");
  });
});

describe("pendingForStop", () => {
  it("excludes confirmed rows, which is what keeps the projection honest", async () => {
    await enqueue(sql, arrivalIntent("stop-1", NOW.toISOString()), NOW);
    const claimed = await claimBatch(sql, NOW);
    await settleResults(
      sql,
      claimed.map((r) => r.id),
      claimed.map((r) => ({ id: r.id, status: "accepted" as const })),
      NOW,
    );

    expect(await pendingForStop(sql, "stop-1")).toHaveLength(0);
  });

  it("returns events in ULID order", async () => {
    await enqueue(sql, arrivalIntent("stop-1", NOW.toISOString()), NOW);
    await enqueue(sql, arrivalIntent("stop-1", NOW.toISOString()), NOW);

    const pending = await pendingForStop(sql, "stop-1");
    expect(pending).toHaveLength(2);
    expect([...pending].sort((a, b) => a.id.localeCompare(b.id))).toEqual(pending);
  });
});
