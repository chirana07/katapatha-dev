import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { openNodeSqlite } from "../db/node-sqlite";
import { migrate } from "../db/migrations";
import type { SqlDriver } from "../db/driver";
import { replaceRun, replaceVocabulary, type Run } from "../sync/runRepo";
import { arrivalIntent, deliveryIntent } from "../outbox/intents";
import { createRunStore, snapshotProgress } from "./store";

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
        signatureData: "data:image/svg+xml;base64,PHN2Zz4=",
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
