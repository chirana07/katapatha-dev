import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createKatapathaClient } from "@katapatha/api-client/client";
import { openNodeSqlite } from "../db/node-sqlite";
import { migrate } from "../db/migrations";
import type { SqlDriver } from "../db/driver";
import { createDrain } from "./drain";
import { createTransport } from "./transport";
import { deliveryIntent, startDeliveryIntent } from "./intents";
import { enqueue, counts, readLastSync, readPendingRows } from "./repo";
import { readStopRecords } from "../sync/stopRecords";
import { receiptPage, signaturePage } from "./test-fixtures";

/**
 * The whole device path for a multi-page delivery, with the REAL transport and
 * the REAL drain over real SQLite; only the network is a stand-in. The stand-in
 * is a tiny applier that behaves as the contract says the server does: the event
 * id is the key (so an id it already holds is a duplicate), a stop it does not
 * know is `rejected` for that event alone, and a POD is stored with its pages.
 *
 * It exists to prove the device half of the contract the real API was exercised
 * against by hand (src/outbox/README.md, "Verified against the API").
 */

const BASE = "http://localhost:3201/v1";
const NOW = new Date("2026-10-01T04:10:00.000Z");
const noJitter = () => 0.5;

type Body = {
  events: Array<{
    id: string;
    type: string;
    tripStopId: string | null;
    pages?: Array<{ id: string; data: string; qualityFlags: string[] }>;
    signatureData: string | null;
  }>;
};

function fakeServer(knownStops: string[]) {
  const held = new Set<string>();
  const storedPages: string[] = [];
  const requests: Body[] = [];
  let online = true;

  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (!online) throw new TypeError("Network request failed");
    const request = input instanceof Request ? input : null;
    const text = request ? await request.text() : String(init?.body);
    const body = JSON.parse(text) as Body;
    requests.push(body);

    const results: unknown[] = [];
    const rejected: unknown[] = [];
    let accepted = 0;
    let duplicates = 0;
    for (const event of body.events) {
      if (!event.tripStopId || !knownStops.includes(event.tripStopId)) {
        rejected.push({
          id: event.id,
          code: "STOP_NOT_ON_RUN",
          message: `Stop ${event.tripStopId} is not on this driver's run.`,
        });
        continue;
      }
      if (held.has(event.id)) {
        duplicates += 1;
        results.push({ id: event.id, status: "duplicate", conflictState: "NONE" });
        continue;
      }
      held.add(event.id);
      for (const page of event.pages ?? []) storedPages.push(page.id);
      accepted += 1;
      results.push({ id: event.id, status: "accepted", conflictState: "NONE" });
    }
    return new Response(
      JSON.stringify({ accepted, duplicates, conflicts: 0, results, rejected, clockSkewMs: 5, serverSeq: held.size }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }) as unknown as typeof fetch;

  return {
    fetchImpl,
    held,
    storedPages,
    requests,
    goOffline: () => {
      online = false;
    },
    goOnline: () => {
      online = true;
    },
  };
}

let sql: SqlDriver;

beforeEach(async () => {
  sql = openNodeSqlite();
  await migrate(sql);
  await sql.run("INSERT INTO run (date, vehicle_id, fetched_at) VALUES ('2026-10-01', 'V', 'now')");
  await sql.run("INSERT INTO trip (trip_id, date, trip_no, wave) VALUES ('t1', '2026-10-01', 1, 'PREDAWN')");
  for (const id of ["stop-1", "stop-gone"]) {
    await sql.run(
      "INSERT INTO stop (id, trip_id, date, seq, outlet_id, server_status) VALUES (?, 't1', '2026-10-01', 1, 'O', 'PENDING')",
      [id],
    );
  }
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await sql.close();
});

function drainFor(server: ReturnType<typeof fakeServer>) {
  vi.stubGlobal("fetch", server.fetchImpl);
  return createDrain({
    sql,
    transport: createTransport({
      client: async () => createKatapathaClient({ baseUrl: BASE, getToken: () => "t" }),
      deviceId: async () => "device-1",
      now: () => NOW,
    }),
    now: () => NOW,
    random: noJitter,
  });
}

async function queueDelivery(stopId: string, pages = [receiptPage(), signaturePage()]) {
  const start = startDeliveryIntent({ stopId, status: "PENDING", occurredAt: "2026-10-01T04:00:00.000Z" })!;
  const done = deliveryIntent({
    stopId,
    occurredAt: "2026-10-01T04:30:00.000Z",
    recipientName: "Nimali Perera",
    lines: [
      { orderId: "a", expectedUnits: 10, deliveredUnits: 10 },
      { orderId: "b", expectedUnits: 10, deliveredUnits: 4 },
    ],
    pages,
  });
  await enqueue(sql, start, NOW);
  await enqueue(sql, done, NOW);
  return { start, done };
}

describe("a two-page delivery through the real drain and transport", () => {
  it("sends start + lines + POD with pages, settles all, drops the images, keeps the page count", async () => {
    const server = fakeServer(["stop-1"]);
    const drain = drainFor(server);
    const { done } = await queueDelivery("stop-1");

    const outcomes = await drain.drainAll({ immediate: true });

    // ARRIVED, UNLOAD_START, 2 lines, 1 POD. Everything accepted.
    expect(outcomes.reduce((sum, o) => sum + o.accepted, 0)).toBe(5);
    expect(server.held.size).toBe(5);
    expect(server.storedPages).toEqual(done.events.at(-1)!.pages.map((page) => page.id));
    expect((await counts(sql, NOW)).unsent).toBe(0);

    const pod = server.requests.flatMap((r) => r.events).find((e) => e.type === "POD_CAPTURED")!;
    expect(pod.pages).toHaveLength(2);
    expect(pod.signatureData).toBe(null);

    const blobs = await sql.all<{ data: string | null }>("SELECT data FROM outbox_page");
    expect(blobs).toHaveLength(2);
    expect(blobs.every((page) => page.data === null)).toBe(true);
    expect((await readStopRecords(sql, "2026-10-01")).get("stop-1")?.pageCount).toBe(2);
  });

  it("holds the delivery whole while offline, then sends it whole, with its pages intact", async () => {
    const server = fakeServer(["stop-1"]);
    const drain = drainFor(server);
    server.goOffline();
    await queueDelivery("stop-1");

    const offline = await drain.drain({ immediate: true });
    expect(offline.outcome).toBe("offline");
    expect((await counts(sql, NOW)).unsent).toBe(5);
    const kept = await sql.all<{ data: string | null }>("SELECT data FROM outbox_page");
    expect(kept.every((page) => page.data !== null)).toBe(true);

    server.goOnline();
    const online = await drain.drain({ immediate: true });
    expect(online).toMatchObject({ outcome: "sent", accepted: 5, rejected: 0 });
    // One request carried the lines and the POD together.
    expect(server.requests.at(-1)!.events).toHaveLength(5);
  });

  it("replays as duplicates and changes no local row", async () => {
    const server = fakeServer(["stop-1"]);
    const drain = drainFor(server);
    await queueDelivery("stop-1");
    await drain.drainAll({ immediate: true });

    const before = await sql.all("SELECT id, state, settled_at FROM outbox_event ORDER BY id");
    // Put the same events back in the queue, as a lost response would.
    await sql.run("UPDATE outbox_event SET state = 'queued', settled_at = NULL");
    const replay = await drain.drain({ immediate: true });

    expect(replay).toMatchObject({ accepted: 0, duplicates: 5, rejected: 0 });
    const after = await sql.all("SELECT id, state, settled_at FROM outbox_event ORDER BY id");
    expect(after.map((row) => (row as { id: string }).id)).toEqual(
      before.map((row) => (row as { id: string }).id),
    );
    expect(server.held.size).toBe(5);
  });
});

describe("one bad event does not take the batch down with it", () => {
  it("lands the refused event as rejected with a readable reason, and settles the rest", async () => {
    const server = fakeServer(["stop-1"]);
    const drain = drainFor(server);
    await queueDelivery("stop-1");
    const bad = startDeliveryIntent({ stopId: "stop-gone", status: "PENDING", occurredAt: NOW.toISOString() })!;
    await enqueue(sql, bad, NOW);

    const outcome = await drain.drain({ immediate: true });

    // A "sent" drain: the server answered, and most of it applied.
    expect(outcome).toMatchObject({ outcome: "sent", accepted: 5, rejected: 2, requeued: 0 });

    const rejected = await sql.all<{ state: string; last_error: string; stop_id: string }>(
      "SELECT state, last_error, stop_id FROM outbox_event WHERE state = 'rejected'",
    );
    expect(rejected).toHaveLength(2);
    for (const row of rejected) {
      expect(row.stop_id).toBe("stop-gone");
      expect(row.last_error).toMatch(/not on your run/i);
      expect(row.last_error).not.toMatch(/failed/i);
    }
    expect((await counts(sql, NOW)).unsent).toBe(0);
    expect((await counts(sql, NOW)).rejected).toBe(2);
  });

  it("does not retry a rejected row, not even on Send now", async () => {
    const server = fakeServer([]);
    const drain = drainFor(server);
    await enqueue(sql, startDeliveryIntent({ stopId: "stop-gone", status: "ARRIVED", occurredAt: NOW.toISOString() })!, NOW);

    await drain.drain({ immediate: true });
    const requestsAfterFirst = server.requests.length;
    const again = await drain.drain({ immediate: true });

    expect(again.outcome).toBe("idle");
    expect(server.requests).toHaveLength(requestsAfterFirst);
  });

  it("drops the images of a rejected POD", async () => {
    const server = fakeServer([]);
    const drain = drainFor(server);
    await queueDelivery("stop-gone");

    await drain.drain({ immediate: true });

    const blobs = await sql.all<{ data: string | null }>("SELECT data FROM outbox_page");
    expect(blobs.every((page) => page.data === null)).toBe(true);
  });

  it("records the rejected count in sync_log, and shows the reason on the pending list", async () => {
    const server = fakeServer(["stop-1"]);
    const drain = drainFor(server);
    await queueDelivery("stop-1");
    await enqueue(sql, startDeliveryIntent({ stopId: "stop-gone", status: "ARRIVED", occurredAt: NOW.toISOString() })!, NOW);

    await drain.drain({ immediate: true });

    expect(await readLastSync(sql)).toMatchObject({ outcome: "sent", accepted: 5, rejected: 1 });
    const pending = await readPendingRows(sql);
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ state: "rejected" });
    expect(pending[0].last_error).toBeTruthy();
  });
});

describe("an event the server did not report", () => {
  it("is requeued with backoff, because 'not reported' means not applied", async () => {
    vi.stubGlobal(
      "fetch",
      (async () =>
        new Response(
          JSON.stringify({ accepted: 0, duplicates: 0, conflicts: 0, results: [], rejected: [] }),
          { status: 200, headers: { "content-type": "application/json" } },
        )) as unknown as typeof fetch,
    );
    const drain = createDrain({
      sql,
      transport: createTransport({
        client: async () => createKatapathaClient({ baseUrl: BASE, getToken: () => "t" }),
        deviceId: async () => "device-1",
      }),
      now: () => NOW,
      random: noJitter,
    });
    await enqueue(sql, startDeliveryIntent({ stopId: "stop-1", status: "ARRIVED", occurredAt: NOW.toISOString() })!, NOW);

    const outcome = await drain.drain({ immediate: true });

    expect(outcome).toMatchObject({ outcome: "sent", requeued: 1, rejected: 0 });
    const [row] = await sql.all<{ state: string; next_attempt_at: string | null }>(
      "SELECT state, next_attempt_at FROM outbox_event",
    );
    expect(row.state).toBe("queued");
    expect(row.next_attempt_at).not.toBe(null);
  });
});
