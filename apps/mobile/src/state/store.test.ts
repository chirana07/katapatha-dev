import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { openNodeSqlite } from "../db/node-sqlite";
import { migrate } from "../db/migrations";
import type { SqlDriver } from "../db/driver";
import { replaceRun, replaceVocabulary, type Run } from "../sync/runRepo";
import { arrivalIntent, deliveryIntent, problemIntent, startDeliveryIntent } from "../outbox/intents";
import { claimBatch, settleResults } from "../outbox/repo";
import { receiptPage, signaturePage } from "../outbox/test-fixtures";
import { createRunStore, deliveryRecord, snapshotProgress } from "./store";

let sql: SqlDriver;
const NOW = new Date("2026-10-01T04:10:00.000Z");
const DATE = "2026-10-01";

const RUN: Run = {
  date: DATE,
  vehicleId: "VEH043",
  trips: [
    {
      tripId: "trip-1",
      tripNo: 1,
      wave: "PREDAWN",
      stops: [
        {
          id: "stop-1",
          seq: 1,
          outletId: "OUT074",
          outletName: "Fresh Nugegoda",
          status: "PENDING",
          orders: [{ orderId: "order-1", orderRef: "ORD-004312", expectedUnits: 120 }],
        },
        { id: "stop-2", seq: 2, outletId: "OUT075", status: "PENDING" },
      ],
    },
  ],
};

beforeEach(async () => {
  sql = openNodeSqlite();
  await migrate(sql);
});

afterEach(async () => {
  await sql.close();
});

function store() {
  return createRunStore({ sql, now: () => NOW });
}

describe("the snapshot", () => {
  it("is empty and safe before the first bootstrap", async () => {
    const run = store();
    const snapshot = await run.refresh();

    expect(snapshot.vehicleId).toBe(null);
    expect(snapshot.stops).toEqual([]);
    expect(snapshot.outbox).toEqual({ unsent: 0, ready: 0, conflicts: 0, rejected: 0 });
  });

  it("reads the cached run with each stop projected", async () => {
    await replaceRun(sql, RUN, NOW.toISOString());
    const run = store();

    const snapshot = await run.refresh();

    expect(snapshot.vehicleId).toBe("VEH043");
    expect(snapshot.stops.map((stop) => stop.id)).toEqual(["stop-1", "stop-2"]);
    expect(snapshot.stops[0].projection).toMatchObject({
      status: "PENDING",
      unsent: 0,
      state: "clean",
    });
  });

  it("flags the reason list as a fallback until the server's has been cached", async () => {
    // The screen must say so, as the web console's banner does.
    const run = store();
    expect((await run.refresh()).reasonsAreFallback).toBe(true);

    await replaceVocabulary(sql, "problemReasons", ["OUTLET_CLOSED"]);
    const after = await run.refresh();
    expect(after.reasonsAreFallback).toBe(false);
    expect(after.problemReasons).toEqual(["OUTLET_CLOSED"]);
  });
});

describe("submit", () => {
  it("shows the action immediately, with the server status untouched", async () => {
    await replaceRun(sql, RUN, NOW.toISOString());
    const run = store();
    await run.refresh();

    await run.submit(arrivalIntent("stop-1", NOW.toISOString()));

    const stop = run.stop("stop-1");
    expect(stop?.projection.status).toBe("ARRIVED");
    expect(stop?.projection.unsent).toBe(1);
    // Server truth is unchanged: the cache holds only what the server said.
    expect(stop?.serverStatus).toBe("PENDING");
  });

  it("reports zero inserted for a double-tap", async () => {
    await replaceRun(sql, RUN, NOW.toISOString());
    const run = store();
    const intent = arrivalIntent("stop-1", NOW.toISOString());

    expect(await run.submit(intent)).toBe(1);
    expect(await run.submit(intent)).toBe(0);
    expect(run.stop("stop-1")?.projection.unsent).toBe(1);
  });

  it("counts a whole delivery's events as unsent", async () => {
    await replaceRun(sql, RUN, NOW.toISOString());
    const run = store();

    await run.submit(
      deliveryIntent({
        stopId: "stop-1",
        occurredAt: NOW.toISOString(),
        recipientName: "Nimali Perera",
        lines: [{ orderId: "order-1", expectedUnits: 120, deliveredUnits: 120 }],
        pages: [signaturePage()],
      }),
    );

    expect(run.stop("stop-1")?.projection.status).toBe("DONE");
    // 1 line + 1 POD.
    expect(run.getSnapshot().outbox.unsent).toBe(2);
  });

  it("leaves other stops alone", async () => {
    await replaceRun(sql, RUN, NOW.toISOString());
    const run = store();

    await run.submit(arrivalIntent("stop-1", NOW.toISOString()));

    expect(run.stop("stop-2")?.projection).toMatchObject({
      status: "PENDING",
      state: "clean",
    });
  });
});

describe("subscribe", () => {
  it("notifies subscribers after a write, so every screen agrees", async () => {
    // The run list and the stop detail share one snapshot; without this they
    // could show different statuses for the same stop.
    await replaceRun(sql, RUN, NOW.toISOString());
    const run = store();
    let notifications = 0;
    const unsubscribe = run.subscribe(() => {
      notifications += 1;
    });

    await run.refresh();
    await run.submit(arrivalIntent("stop-1", NOW.toISOString()));

    expect(notifications).toBe(2);

    unsubscribe();
    await run.refresh();
    expect(notifications).toBe(2);
  });
});

describe("snapshotProgress", () => {
  it("counts locally-recorded work as done, which is what the driver has done", async () => {
    await replaceRun(sql, RUN, NOW.toISOString());
    const run = store();
    await run.refresh();

    expect(snapshotProgress(run.getSnapshot())).toEqual({
      done: 0,
      total: 2,
      remaining: 2,
      nextStopId: "stop-1",
    });

    await run.submit(
      deliveryIntent({
        stopId: "stop-1",
        occurredAt: NOW.toISOString(),
        recipientName: "N",
        lines: [{ orderId: "order-1", expectedUnits: 120, deliveredUnits: 120 }],
        pages: [receiptPage()],
      }),
    );

    expect(snapshotProgress(run.getSnapshot())).toEqual({
      done: 1,
      total: 2,
      remaining: 1,
      nextStopId: "stop-2",
    });
  });

  it("reports no next stop once every stop is closed", async () => {
    await replaceRun(
      sql,
      {
        ...RUN,
        trips: [
          {
            tripId: "trip-1",
            tripNo: 1,
            wave: "PREDAWN",
            stops: [{ id: "only", seq: 1, outletId: "O", status: "DONE" }],
          },
        ],
      },
      NOW.toISOString(),
    );
    const run = store();
    await run.refresh();

    expect(snapshotProgress(run.getSnapshot()).nextStopId).toBe(null);
  });
});

describe("the stop record", () => {
  const T0 = "2026-10-01T04:00:00.000Z";
  const T1 = "2026-10-01T04:30:00.000Z";

  async function deliver(run: ReturnType<typeof store>, delivered = 100) {
    await run.submit(startDeliveryIntent({ stopId: "stop-1", status: "PENDING", occurredAt: T0 })!);
    await run.submit(
      deliveryIntent({
        stopId: "stop-1",
        occurredAt: T1,
        recipientName: "Nimali Perera",
        lines: [{ orderId: "order-1", expectedUnits: 120, deliveredUnits: delivered }],
        pages: [receiptPage(), signaturePage()],
      }),
    );
  }

  it("is an empty record, not null, for a stop the driver has not touched", async () => {
    await replaceRun(sql, RUN, NOW.toISOString());
    const run = store();
    await run.refresh();

    expect(run.stop("stop-1")?.record).toEqual({
      arrivedAt: null,
      unloadStartedAt: null,
      completedAt: null,
      recipientName: null,
      lines: [],
      pageCount: 0,
      outcome: null,
      reasonCode: null,
    });
  });

  it("folds what was recorded onto the stop, without a blob in the snapshot", async () => {
    await replaceRun(sql, RUN, NOW.toISOString());
    const run = store();
    await run.refresh();
    await deliver(run);

    const record = run.stop("stop-1")!.record;
    expect(record).toMatchObject({
      arrivedAt: T0,
      unloadStartedAt: T0,
      completedAt: T1,
      recipientName: "Nimali Perera",
      lines: [{ orderId: "order-1", deliveredUnits: 100 }],
      pageCount: 2,
      outcome: "PART",
      reasonCode: null,
    });
    expect(JSON.stringify(run.getSnapshot())).not.toContain("base64");
  });

  it("builds the Delivery recorded view: units, recipient, time, pages, saved on phone", async () => {
    await replaceRun(sql, RUN, NOW.toISOString());
    const run = store();
    await run.refresh();
    await deliver(run, 120);

    expect(deliveryRecord(run.stop("stop-1")!)).toEqual({
      unitsDelivered: 120,
      unitsExpected: 120,
      recipientName: "Nimali Perera",
      completedAt: T1,
      pageCount: 2,
      sentState: "saved-on-phone",
      attention: "none",
    });
  });

  it("turns 'sent' once every event is confirmed, and still has the facts", async () => {
    await replaceRun(sql, RUN, NOW.toISOString());
    const run = store();
    await run.refresh();
    await deliver(run);

    const claimed = await claimBatch(sql, NOW, { immediate: true });
    await settleResults(
      sql,
      claimed.map((row) => row.id),
      claimed.map((row) => ({ id: row.id, status: "accepted" as const })),
      NOW,
    );
    await run.refresh();

    expect(deliveryRecord(run.stop("stop-1")!)).toMatchObject({
      sentState: "sent",
      attention: "none",
      pageCount: 2,
      recipientName: "Nimali Perera",
      unitsDelivered: 100,
    });
  });

  it("never reads as a clean 'sent' over a rejected record", async () => {
    await replaceRun(sql, RUN, NOW.toISOString());
    const run = store();
    await run.refresh();
    await deliver(run);

    const claimed = await claimBatch(sql, NOW, { immediate: true });
    await settleResults(
      sql,
      claimed.map((row) => row.id),
      claimed.map((row) => ({ id: row.id, status: "rejected" as const, reason: "no" })),
      NOW,
    );
    await run.refresh();

    const view = deliveryRecord(run.stop("stop-1")!);
    expect(view.attention).toBe("rejected");
    // And the rejected rows are not presented as what the driver recorded.
    expect(view.unitsDelivered).toBe(null);
    expect(view.pageCount).toBe(0);
  });

  it("has null units, not zero, when this phone has no delivery lines", async () => {
    await replaceRun(
      sql,
      {
        ...RUN,
        trips: [
          {
            ...RUN.trips[0],
            stops: [{ id: "s", seq: 1, outletId: "O", status: "DONE", orders: [{ orderId: "o", orderRef: "R", expectedUnits: 5 }] }],
          },
        ],
      },
      NOW.toISOString(),
    );
    const run = store();
    await run.refresh();

    expect(deliveryRecord(run.stop("s")!)).toMatchObject({
      unitsDelivered: null,
      unitsExpected: 5,
      sentState: "sent",
    });
  });

  it("records a failed stop's reason and time", async () => {
    await replaceRun(sql, RUN, NOW.toISOString());
    const run = store();
    await run.refresh();
    await run.submit(problemIntent({ stopId: "stop-1", occurredAt: T1, reasonCode: "OUTLET_CLOSED" }));

    expect(run.stop("stop-1")!.record).toMatchObject({
      outcome: "FAILED",
      reasonCode: "OUTLET_CLOSED",
      completedAt: T1,
    });
    await run.submit(
      problemIntent({ stopId: "stop-2", occurredAt: T1, reasonCode: "ROAD_BLOCKED", type: "SKIPPED" }),
    );
    expect(run.stop("stop-2")!.record.outcome).toBe("SKIPPED");
  });
});

describe("what the last send did", () => {
  it("is null/zero until a drain has put records on the server", async () => {
    const run = store();
    const snapshot = await run.refresh();
    expect(snapshot.lastSettledAt).toBe(null);
    expect(snapshot.lastSettledCount).toBe(0);
  });

  it("reports the last drain that delivered, not a later failed attempt", async () => {
    await sql.run(
      "INSERT INTO sync_log (at, endpoint, sent, accepted, duplicates, rejected, outcome) VALUES ('2026-10-01T04:00:00.000Z','e',4,3,1,0,'sent')",
    );
    await sql.run(
      "INSERT INTO sync_log (at, endpoint, sent, outcome) VALUES ('2026-10-01T04:05:00.000Z','unsent',2,'offline')",
    );
    const run = store();
    const snapshot = await run.refresh();

    expect(snapshot.lastSettledAt).toBe("2026-10-01T04:00:00.000Z");
    expect(snapshot.lastSettledCount).toBe(4);
    // lastSync is still the last ATTEMPT, as the outbox screen reports it.
    expect(snapshot.lastSync?.outcome).toBe("offline");
  });
});
