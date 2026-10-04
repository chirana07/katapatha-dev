import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createKatapathaClient } from "@katapatha/api-client/client";
import { openNodeSqlite } from "../../db/node-sqlite";
import { migrate } from "../../db/migrations";
import type { SqlDriver } from "../../db/driver";
import { createDrain } from "../../outbox/drain";
import { createTransport } from "../../outbox/transport";
import { deliveryIntent, newPageId, startDeliveryIntent } from "../../outbox/intents";
import { claimBatch, queuedBlobBytes, settleResults } from "../../outbox/repo";
import { snapshotProgress, createRunStore, deliveryRecord } from "../../state/store";
import { replaceRun, type Run } from "../../sync/runRepo";
import { addPage, EMPTY_PAGES, NO_TICKS, removePage, toPodPages, toggleTick } from "./pages";
import { defaultCounts, summariseUnits } from "./units";
import { draftProblem, headroomProblem } from "./validation";
import { nextStopCard, recordedView } from "./recorded";

/**
 * The non-UI core of the delivery flow, end to end over real SQLite: pages built
 * the way the Receipt step builds them, the intent the Complete button queues,
 * the projection and the recorded screen's view model while the delivery is only
 * on the phone, then the real drain and transport against a stand-in server, and
 * the same view model once it settles. No React, no network.
 */

const BASE = "http://localhost:3201/v1";
const DATE = "2026-10-01";
const NOW = new Date("2026-10-01T04:10:00.000Z");
const TAKEN = "2026-10-01T04:05:00.000Z";
const JPEG = "data:image/jpeg;base64,/9j/4AAQ";

const RUN: Run = {
  date: DATE,
  vehicleId: "VEH025",
  trips: [
    {
      tripId: "trip-1",
      tripNo: 1,
      wave: "PREDAWN",
      stops: [
        {
          id: "stop-2",
          seq: 2,
          outletId: "OUT074",
          status: "UNLOADING",
          accessNote: "Rear dock. Van only.",
          orders: [
            { orderId: "o-a", orderRef: "S1-082a", expectedUnits: 40 },
            { orderId: "o-b", orderRef: "S1-082b", expectedUnits: 29 },
          ],
        },
        {
          id: "stop-3",
          seq: 3,
          outletId: "OUT075",
          status: "PENDING",
          plannedArrivalAt: "08:00",
          accessNote: "Rear dock",
          orders: [{ orderId: "o-c", orderRef: "S1-083", expectedUnits: 24 }],
        },
      ],
    },
  ],
} as Run;

let sql: SqlDriver;

beforeEach(async () => {
  sql = openNodeSqlite();
  await migrate(sql);
  await replaceRun(sql, RUN, NOW.toISOString());
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await sql.close();
});

function build() {
  return { store: createRunStore({ sql, now: () => NOW }) };
}

function draftPages() {
  let list = addPage(EMPTY_PAGES, {
    id: newPageId(),
    kind: "RECEIPT",
    data: JPEG,
    capturedAt: TAKEN,
    ticks: { ...NO_TICKS },
  });
  list = toggleTick(toggleTick(list, list.pages[0].id, "corners"), list.pages[0].id, "text");
  return list;
}

async function complete(store: ReturnType<typeof createRunStore>, countOverrides: Record<string, number> = {}) {
  await store.refresh();
  const stop = store.stop("stop-2")!;
  const counts = { ...defaultCounts(stop.orders), ...countOverrides };
  const pages = draftPages();
  expect(draftProblem({ recipient: "Fathima Rizvi", orders: stop.orders, counts, pages })).toBe(null);
  expect(headroomProblem(await queuedBlobBytes(sql), pages)).toBe(null);

  const summary = summariseUnits(stop.orders, counts);
  const inserted = await store.submit(
    deliveryIntent({
      stopId: stop.id,
      occurredAt: "2026-10-01T04:09:00.000Z",
      recipientName: "Fathima Rizvi",
      lines: summary.rows.map((row) => ({ orderId: row.orderId, expectedUnits: row.expected, deliveredUnits: row.counted })),
      pages: toPodPages(pages),
    }),
  );
  return { inserted, pages };
}

const connected = { label: "Connected" as const, offlineSince: null, now: NOW };
const offline = { label: "Offline" as const, offlineSince: new Date("2026-10-01T00:58:00.000Z"), now: NOW };

describe("completing a delivery on the phone", () => {
  it("queues lines + POD, marks the stop done and unsent, and the record says what was typed", async () => {
    const { store } = build();
    const { inserted, pages } = await complete(store);

    // 2 lines + 1 POD.
    expect(inserted).toBe(3);
    const stop = store.stop("stop-2")!;
    expect(stop.projection).toMatchObject({ status: "DONE", unsent: 3, state: "unsent" });
    expect(snapshotProgress(store.getSnapshot()).nextStopId).toBe("stop-3");

    expect(deliveryRecord(stop)).toMatchObject({
      unitsDelivered: 69,
      unitsExpected: 69,
      recipientName: "Fathima Rizvi",
      pageCount: 1,
      sentState: "saved-on-phone",
      attention: "none",
    });

    // The ticked chips are not flagged; the one left unticked is.
    const stored = await sql.all<{ id: string; kind: string; quality_flags: string; captured_at: string }>(
      "SELECT id, kind, quality_flags, captured_at FROM outbox_page",
    );
    expect(stored).toEqual([
      { id: pages.pages[0].id, kind: "RECEIPT", quality_flags: '["SIGNATURE_NOT_CONFIRMED"]', captured_at: TAKEN },
    ]);
  });

  it("is idempotent: submitting the same intent twice queues nothing more", async () => {
    const { store } = build();
    await store.refresh();
    const stop = store.stop("stop-2")!;
    const intent = deliveryIntent({
      stopId: stop.id,
      occurredAt: NOW.toISOString(),
      recipientName: "Fathima Rizvi",
      lines: stop.orders.map((o) => ({ orderId: o.orderId, expectedUnits: o.expectedUnits, deliveredUnits: o.expectedUnits })),
      pages: toPodPages(draftPages()),
    });
    expect(await store.submit(intent)).toBe(3);
    expect(await store.submit(intent)).toBe(0);
    expect(store.stop("stop-2")!.projection.unsent).toBe(3);
  });

  it("refuses to queue with no page, whatever the screen did", async () => {
    const { store } = build();
    await store.refresh();
    const stop = store.stop("stop-2")!;
    const drafted = draftPages();
    const empty = removePage(drafted, drafted.pages[0].id);
    expect(() =>
      deliveryIntent({
        stopId: stop.id,
        occurredAt: NOW.toISOString(),
        recipientName: "F",
        lines: [],
        pages: toPodPages(empty),
      }),
    ).toThrow(/photo of the receipt/);
  });

  it("a short count is a part delivery, and the recorded screen says how many are short", async () => {
    const { store } = build();
    await complete(store, { "o-b": 24 });

    const stop = store.stop("stop-2")!;
    expect(stop.record.outcome).toBe("PART");
    const view = recordedView(stop, connected);
    expect(view.units).toBe("64 / 69 · 5 short");
  });
});

describe("the recorded screen, while it is only on the phone", () => {
  it("offline: saved on this phone, with the waiting banner from claims, never 'by themselves'", async () => {
    const { store } = build();
    await complete(store);
    const view = recordedView(store.stop("stop-2")!, offline);

    expect(view).toMatchObject({
      kind: "delivered",
      stopNumber: 2,
      outletId: "OUT074",
      subline: "Rear dock · 69 units",
      units: "69 / 69 · no issues",
      receivedBy: "Fathima Rizvi",
      receipt: "1 page",
      status: { label: "Saved on this phone", tone: "warn" },
      attentionBanner: null,
      heldNote: null,
    });
    expect(view.confirmation).toBe("Stop 2 · OUT074 · recorded on device at 09:39");
    expect(view.waitingBanner).toEqual({
      title: "No signal since 06:28 · 3 updates waiting",
      body: "They are sent when there is signal, while the app is open. Nothing to re-enter.",
    });
    expect(JSON.stringify(view)).not.toMatch(/by themselves|automatic|background|\blive\b|tracking/i);
  });

  it("connected but not yet sent: an info line, no alarm", async () => {
    const { store } = build();
    await complete(store);
    const view = recordedView(store.stop("stop-2")!, connected);
    expect(view.waitingBanner).toBe(null);
    expect(view.heldNote).toMatch(/3 records held on this phone/);
    expect(view.status.label).toBe("Saved on this phone");
  });

  it("offers the next unfinished stop as a plan figure, with no distance", async () => {
    const { store } = build();
    await complete(store);
    const snapshot = store.getSnapshot();
    const next = nextStopCard(snapshot.stops, snapshotProgress(snapshot).nextStopId, "stop-2");
    expect(next).toEqual({
      stopId: "stop-3",
      number: 3,
      outletId: "OUT075",
      detail: "planned 08:00 · Rear dock · 1 order",
    });
    expect(next!.detail).not.toMatch(/km/);
  });

  it("has no next card when this was the last stop", async () => {
    const { store } = build();
    await complete(store);
    await store.submit(
      deliveryIntent({
        stopId: "stop-3",
        occurredAt: NOW.toISOString(),
        recipientName: "Someone",
        lines: [{ orderId: "o-c", expectedUnits: 24, deliveredUnits: 24 }],
        pages: toPodPages(draftPages()),
      }),
    );
    const snapshot = store.getSnapshot();
    const progress = snapshotProgress(snapshot);
    expect(progress.nextStopId).toBe(null);
    expect(nextStopCard(snapshot.stops, progress.nextStopId, "stop-3")).toBe(null);
  });
});

describe("then the real drain", () => {
  function server(handler: (ids: string[]) => { accepted: string[]; rejected?: string[] }) {
    return (async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : null;
      const body = JSON.parse(request ? await request.text() : String(init?.body)) as {
        events: Array<{ id: string }>;
      };
      const { accepted, rejected = [] } = handler(body.events.map((e) => e.id));
      return new Response(
        JSON.stringify({
          accepted: accepted.length,
          duplicates: 0,
          conflicts: 0,
          results: accepted.map((id) => ({ id, status: "accepted", conflictState: "NONE" })),
          rejected: rejected.map((id) => ({ id, code: "STATE_MISMATCH", message: "x" })),
          clockSkewMs: 0,
          serverSeq: 1,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as unknown as typeof fetch;
  }

  function drainWith(fetchImpl: typeof fetch) {
    vi.stubGlobal("fetch", fetchImpl);
    return createDrain({
      sql,
      transport: createTransport({
        client: async () => createKatapathaClient({ baseUrl: BASE, getToken: () => "t" }),
        deviceId: async () => "device-1",
        now: () => NOW,
      }),
      now: () => NOW,
      random: () => 0.5,
    });
  }

  it("flips the record to Sent, with the same facts and no images left", async () => {
    const { store } = build();
    await complete(store);
    expect(recordedView(store.stop("stop-2")!, offline).status.label).toBe("Saved on this phone");

    const outcome = await drainWith(server((ids) => ({ accepted: ids }))).drain({ immediate: true });
    expect(outcome).toMatchObject({ outcome: "sent", accepted: 3 });
    await store.refresh();

    const view = recordedView(store.stop("stop-2")!, connected);
    expect(view.status).toEqual({ label: "Sent", tone: "good", icon: "check" });
    expect(view).toMatchObject({ units: "69 / 69 · no issues", receivedBy: "Fathima Rizvi", receipt: "1 page" });
    expect(view.waitingBanner).toBe(null);
    expect(view.heldNote).toBe(null);
    expect(await queuedBlobBytes(sql)).toBe(0);
  });

  it("a refused record is never a green Sent", async () => {
    const { store } = build();
    await complete(store);

    const claimed = await claimBatch(sql, NOW, { immediate: true });
    await settleResults(
      sql,
      claimed.map((row) => row.id),
      claimed.map((row) => ({ id: row.id, status: "rejected" as const, reason: "no" })),
      NOW,
    );
    await store.refresh();

    const view = recordedView(store.stop("stop-2")!, connected);
    expect(view.status.tone).toBe("bad");
    expect(view.status.label).not.toBe("Sent");
    expect(view.attentionBanner).toMatchObject({ tone: "bad" });
    expect(view.attentionBanner!.body).toMatch(/Unsent records/);
    expect(view.kind).toBe("delivered");
  });

  it("a conflict is not 'Sent' either", async () => {
    const { store } = build();
    await complete(store);

    const claimed = await claimBatch(sql, NOW, { immediate: true });
    await settleResults(
      sql,
      claimed.map((row) => row.id),
      claimed.map((row) => ({ id: row.id, status: "conflict" as const, conflictState: "STATE_MISMATCH" })),
      NOW,
    );
    await store.refresh();

    const view = recordedView(store.stop("stop-2")!, connected);
    expect(view.status.tone).toBe("info");
    expect(view.status.label).not.toBe("Sent");
    expect(view.attentionBanner).toMatchObject({ tone: "info" });
  });
});

describe("a stop with nothing recorded", () => {
  it("reports 'none' so the screen can say so instead of inventing a delivery", async () => {
    const { store } = build();
    await store.refresh();
    expect(recordedView(store.stop("stop-3")!, connected).kind).toBe("none");

    await store.submit(startDeliveryIntent({ stopId: "stop-3", status: "PENDING", occurredAt: NOW.toISOString() })!);
    expect(recordedView(store.stop("stop-3")!, connected).kind).toBe("none");
  });
});
