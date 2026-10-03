import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { openNodeSqlite } from "../db/node-sqlite";
import { migrate } from "../db/migrations";
import type { SqlDriver } from "../db/driver";
import { arrivalIntent, deliveryIntent } from "./intents";
import { receiptPage, signaturePage } from "./test-fixtures";
import { MAX_AUTOMATIC_ATTEMPTS } from "./backoff";
import {
  MAX_BATCH_BYTES,
  MAX_BATCH_EVENTS,
  claimBatch,
  counts,
  enqueue,
  pendingForStop,
  prune,
  queuedBlobBytes,
  readLastDelivered,
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

/** Pages stay (so "2 pages" is still true) but their images are gone. */
async function expectPageBlobsGone(expectedPages: number): Promise<void> {
  const pages = await sql.all<{ data: string | null; payload_bytes: number }>(
    "SELECT data, payload_bytes FROM outbox_page",
  );
  expect(pages).toHaveLength(expectedPages);
  for (const page of pages) {
    expect(page.data).toBe(null);
    expect(page.payload_bytes).toBe(0);
  }
}

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
      pages: [signaturePage()],
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
        pages: [receiptPage({ data: `data:image/jpeg;base64,${"A".repeat(1000)}` })],
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
          pages: [receiptPage()],
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
    // A delivery with eight 400 KB pages exceeds the byte cap on its own, by
    // design (the server allows 12 MiB). Refusing it would mean that delivery
    // never reaches the server.
    const big = `data:image/jpeg;base64,${"A".repeat(400_000)}`;
    await enqueue(
      sql,
      deliveryIntent({
        stopId: "stop-1",
        occurredAt: NOW.toISOString(),
        recipientName: "N",
        lines: [{ orderId: "a", expectedUnits: 1, deliveredUnits: 1 }],
        pages: Array.from({ length: 8 }, () => receiptPage({ data: big })),
      }),
      NOW,
    );

    const claimed = await claimBatch(sql, NOW);
    expect(claimed).toHaveLength(2);
    expect(claimed.reduce((sum, row) => sum + row.payload_bytes, 0)).toBeGreaterThan(MAX_BATCH_BYTES);
    expect(claimed.find((row) => row.type === "POD_CAPTURED")?.pages).toHaveLength(8);
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
        pages: [receiptPage(), signaturePage()],
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
    await expectPageBlobsGone(2);
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

describe("proof-of-delivery pages", () => {
  const pod = (pages = [receiptPage({ qualityFlags: ["TEXT_NOT_CONFIRMED"] }), signaturePage()]) =>
    deliveryIntent({
      stopId: "stop-1",
      occurredAt: NOW.toISOString(),
      recipientName: "N",
      lines: [{ orderId: "a", expectedUnits: 1, deliveredUnits: 1 }],
      pages,
    });

  it("stores the pages with the events, in capture order, and nothing in the legacy columns", async () => {
    const intent = pod();
    await enqueue(sql, intent, NOW);

    const stored = await sql.all<{ id: string; seq: number; kind: string; quality_flags: string; data: string }>(
      "SELECT id, seq, kind, quality_flags, data FROM outbox_page ORDER BY seq",
    );
    expect(stored.map((page) => [page.seq, page.kind])).toEqual([[0, "RECEIPT"], [1, "SIGNATURE"]]);
    expect(stored[0].quality_flags).toBe('["TEXT_NOT_CONFIRMED"]');
    expect(stored[0].id).toBe(intent.events.at(-1)?.pages[0].id);

    for (const row of await rows()) {
      expect(row.signature_data).toBe(null);
      expect(row.photo_data).toBe(null);
    }
  });

  it("writes events and pages in one transaction: a failing page leaves neither", async () => {
    const intent = pod();
    // The second page reuses the first one's id, which the primary key refuses
    // only if it is a different row; force a hard failure with a bad kind.
    (intent.events.at(-1)?.pages[1] as { kind: string }).kind = "SELFIE";

    await expect(enqueue(sql, intent, NOW)).rejects.toThrow();

    expect(await rows()).toHaveLength(0);
    expect(await sql.all("SELECT id FROM outbox_page")).toHaveLength(0);
  });

  it("is a no-op for the pages when the same intent is enqueued twice", async () => {
    const intent = pod();
    expect(await enqueue(sql, intent, NOW)).toBe(2);
    expect(await enqueue(sql, intent, NOW)).toBe(0);
    expect(await sql.all("SELECT id FROM outbox_page")).toHaveLength(2);
  });

  it("counts every page's bytes in the POD's payload_bytes", async () => {
    const a = receiptPage({ data: `data:image/jpeg;base64,${"A".repeat(5000)}` });
    const b = receiptPage({ data: `data:image/jpeg;base64,${"B".repeat(7000)}` });
    await enqueue(sql, pod([a, b]), NOW);

    const row = (await rows()).find((r) => r.type === "POD_CAPTURED");
    expect(row?.payload_bytes).toBeGreaterThan(a.data.length + b.data.length);
  });

  it("attaches pages to claimed POD rows only, ordered by seq", async () => {
    await enqueue(sql, pod(), NOW);
    const claimed = await claimBatch(sql, NOW);

    const podRow = claimed.find((row) => row.type === "POD_CAPTURED");
    expect(podRow?.pages?.map((page) => page.kind)).toEqual(["RECEIPT", "SIGNATURE"]);
    expect(podRow?.pages?.every((page) => page.data !== null)).toBe(true);
    expect(claimed.find((row) => row.type === "DELIVERED")?.pages).toBeUndefined();
  });

  it("does not read page data when nothing is claimed", async () => {
    await enqueue(sql, pod(), NOW);
    await sql.run("UPDATE outbox_event SET next_attempt_at = ?", [
      new Date(NOW.getTime() + 60_000).toISOString(),
    ]);
    expect(await claimBatch(sql, NOW)).toHaveLength(0);
  });

  it("drops page images on a conflict, a rejection and a whole-request rejection", async () => {
    for (const settle of ["conflict", "rejected", "whole"] as const) {
      await sql.exec("DELETE FROM outbox_event");
      await enqueue(sql, pod(), NOW);
      const claimed = await claimBatch(sql, NOW);
      const ids = claimed.map((row) => row.id);

      if (settle === "whole") {
        await rejectBatch(sql, ids, "refused", NOW);
      } else {
        await settleResults(
          sql,
          ids,
          claimed.map((row) =>
            settle === "conflict"
              ? { id: row.id, status: "conflict" as const, conflictState: "SUPERSEDED" }
              : { id: row.id, status: "rejected" as const, reason: "no" },
          ),
          NOW,
        );
      }
      await expectPageBlobsGone(2);
    }
  });

  it("keeps the images while a failed send is waiting to be retried", async () => {
    await enqueue(sql, pod(), NOW);
    const claimed = await claimBatch(sql, NOW);
    await releaseBatch(sql, claimed.map((row) => row.id), null, "offline");

    const kept = await sql.all<{ data: string | null }>("SELECT data FROM outbox_page");
    expect(kept.every((page) => page.data !== null)).toBe(true);
    // And a second claim carries them again.
    const again = await claimBatch(sql, NOW, { immediate: true });
    expect(again.find((row) => row.type === "POD_CAPTURED")?.pages).toHaveLength(2);
  });

  it("deletes pages with their event when a confirmed row is pruned", async () => {
    await enqueue(sql, pod(), NOW);
    const claimed = await claimBatch(sql, NOW);
    await settleResults(
      sql,
      claimed.map((row) => row.id),
      claimed.map((row) => ({ id: row.id, status: "accepted" as const })),
      NOW,
    );

    await prune(sql, new Date(NOW.getTime() + 2 * 24 * 60 * 60 * 1000));

    expect(await sql.all("SELECT id FROM outbox_page")).toHaveLength(0);
  });
});

describe("settling a rejected event", () => {
  it("settles it terminally with the reason, and does not count it as requeued", async () => {
    await enqueue(sql, arrivalIntent("stop-1", NOW.toISOString()), NOW);
    const [row] = await claimBatch(sql, NOW);

    const result = await settleResults(
      sql,
      [row.id],
      [{ id: row.id, status: "rejected", reason: "This stop is not on your run." }],
      NOW,
    );

    expect(result).toMatchObject({ settled: 0, requeued: 0, rejected: 1 });
    const [stored] = await rows();
    expect(stored.state).toBe("rejected");
    expect(stored.last_error).toBe("This stop is not on your run.");
    expect(stored.settled_at).not.toBe(null);
    // Terminal: nothing claims it again, even on "Send now".
    expect(await claimBatch(sql, NOW, { immediate: true })).toHaveLength(0);
    expect((await counts(sql, NOW)).rejected).toBe(1);
    expect((await counts(sql, NOW)).unsent).toBe(0);
  });
});

describe("readLastDelivered", () => {
  async function log(outcome: string, sent: number, accepted: number | null, duplicates: number | null, at: string) {
    await sql.run(
      "INSERT INTO sync_log (at, endpoint, sent, accepted, duplicates, outcome) VALUES (?, 'e', ?, ?, ?, ?)",
      [at, sent, accepted, duplicates, outcome],
    );
  }

  it("is the last drain that put records on the server, whatever came after", async () => {
    await log("sent", 3, 3, 0, "2026-10-01T04:00:00.000Z");
    await log("offline", 2, null, null, "2026-10-01T04:05:00.000Z");

    expect((await readLastDelivered(sql))?.at).toBe("2026-10-01T04:00:00.000Z");
  });

  it("ignores a drain in which the server took nothing", async () => {
    await log("sent", 2, 0, 0, "2026-10-01T04:10:00.000Z");
    expect(await readLastDelivered(sql)).toBe(null);
  });
});

describe("queuedBlobBytes", () => {
  const delivery = (stopId: string) =>
    deliveryIntent({
      stopId,
      occurredAt: NOW.toISOString(),
      recipientName: "N",
      lines: [{ orderId: "a", expectedUnits: 1, deliveredUnits: 1 }],
      pages: [receiptPage(), signaturePage()],
    });

  it("is 0 on an empty queue", async () => {
    expect(await queuedBlobBytes(sql)).toBe(0);
  });

  it("counts what is queued, including the pages, and no more", async () => {
    const intent = delivery("stop-1");
    await enqueue(sql, intent, NOW);
    const expected = await sql.first<{ n: number }>("SELECT SUM(payload_bytes) AS n FROM outbox_event");
    const pageChars = intent.events.at(-1)!.pages.reduce((sum, page) => sum + page.data.length, 0);

    const bytes = await queuedBlobBytes(sql);
    expect(bytes).toBe(expected!.n);
    expect(bytes).toBeGreaterThanOrEqual(pageChars);
  });

  it("drops to 0 once the events settle and their images are dropped", async () => {
    await enqueue(sql, delivery("stop-1"), NOW);
    expect(await queuedBlobBytes(sql)).toBeGreaterThan(0);

    const claimed = await claimBatch(sql, NOW);
    await settleResults(
      sql,
      claimed.map((row) => row.id),
      claimed.map((row) => ({ id: row.id, status: "accepted" as const })),
      NOW,
    );

    expect(await queuedBlobBytes(sql)).toBe(0);
  });
});
