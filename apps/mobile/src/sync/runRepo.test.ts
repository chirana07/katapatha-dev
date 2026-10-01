import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { openNodeSqlite } from "../db/node-sqlite";
import { migrate } from "../db/migrations";
import type { SqlDriver } from "../db/driver";
import {
  readRun,
  readStop,
  readVocabulary,
  replaceRun,
  replaceVocabulary,
  type Run,
} from "./runRepo";
import { arrivalIntent } from "../outbox/intents";
import { enqueue } from "../outbox/repo";

let sql: SqlDriver;
const FETCHED_AT = "2026-10-01T03:00:00.000Z";

/** The example payload from packages/contracts/openapi/paths/driver.yaml. */
const RUN: Run = {
  date: "2026-09-30",
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
          plannedArrivalAt: "04:12",
          windowOpen: "06:00",
          windowClose: "11:00",
          accessNote: "Rear dock. Van only.",
          orders: [{ orderId: "order-1", orderRef: "ORD-004312", expectedUnits: 120 }],
        },
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

describe("replaceRun and readRun", () => {
  it("round-trips the contract's own example payload", async () => {
    await replaceRun(sql, RUN, FETCHED_AT);

    const cached = await readRun(sql, "2026-09-30");

    expect(cached).toMatchObject({
      date: "2026-09-30",
      vehicleId: "VEH043",
      fetchedAt: FETCHED_AT,
    });
    expect(cached?.stops).toHaveLength(1);
    expect(cached?.stops[0]).toMatchObject({
      id: "stop-1",
      tripId: "trip-1",
      tripNo: 1,
      wave: "PREDAWN",
      seq: 1,
      outletId: "OUT074",
      outletName: "Fresh Nugegoda",
      serverStatus: "PENDING",
      plannedArrivalAt: "04:12",
      windowOpen: "06:00",
      windowClose: "11:00",
      accessNote: "Rear dock. Van only.",
    });
    expect(cached?.stops[0].orders).toEqual([
      { orderId: "order-1", orderRef: "ORD-004312", expectedUnits: 120 },
    ]);
  });

  it("returns null for a date the device has never fetched", async () => {
    expect(await readRun(sql, "2026-01-01")).toBe(null);
  });

  it("stores the optional fields as null rather than dropping the stop", async () => {
    // Stop.outletName, plannedArrivalAt, windowOpen/Close and accessNote are all
    // optional in the contract.
    await replaceRun(
      sql,
      {
        date: "2026-09-30",
        vehicleId: "VEH043",
        trips: [
          {
            tripId: "trip-1",
            tripNo: 1,
            wave: "DAYTIME",
            stops: [{ id: "stop-bare", seq: 1, outletId: "OUT001", status: "PENDING" }],
          },
        ],
      },
      FETCHED_AT,
    );

    const cached = await readRun(sql, "2026-09-30");
    expect(cached?.stops[0]).toMatchObject({
      id: "stop-bare",
      outletName: null,
      plannedArrivalAt: null,
      windowOpen: null,
      accessNote: null,
      orders: [],
    });
  });

  it("flattens stops across trips in driving order", async () => {
    // The run list renders one flat sequence; the web console flattens the same
    // way. Trip 2's stops come after trip 1's regardless of insertion order.
    await replaceRun(
      sql,
      {
        date: "2026-09-30",
        vehicleId: "VEH043",
        trips: [
          {
            tripId: "trip-2",
            tripNo: 2,
            wave: "DAYTIME",
            stops: [
              { id: "b2", seq: 2, outletId: "O", status: "PENDING" },
              { id: "b1", seq: 1, outletId: "O", status: "PENDING" },
            ],
          },
          {
            tripId: "trip-1",
            tripNo: 1,
            wave: "PREDAWN",
            stops: [{ id: "a1", seq: 1, outletId: "O", status: "PENDING" }],
          },
        ],
      },
      FETCHED_AT,
    );

    const cached = await readRun(sql, "2026-09-30");
    expect(cached?.stops.map((stop) => stop.id)).toEqual(["a1", "b1", "b2"]);
  });

  it("replaces the previous run wholesale, so a removed stop disappears", async () => {
    // A stop reassigned to another vehicle must not linger in the cache.
    await replaceRun(sql, RUN, FETCHED_AT);
    await replaceRun(
      sql,
      {
        ...RUN,
        trips: [
          {
            tripId: "trip-1",
            tripNo: 1,
            wave: "PREDAWN",
            stops: [{ id: "stop-2", seq: 1, outletId: "OUT999", status: "PENDING" }],
          },
        ],
      },
      "2026-10-01T06:00:00.000Z",
    );

    const cached = await readRun(sql, "2026-09-30");
    expect(cached?.stops.map((stop) => stop.id)).toEqual(["stop-2"]);
    expect(await readStop(sql, "stop-1")).toBe(null);
  });

  it("never discards queued events when the run is replaced", async () => {
    // A re-bootstrap refreshes the server's view. The driver's unsent work is
    // not the server's to replace.
    await replaceRun(sql, RUN, FETCHED_AT);
    await enqueue(sql, arrivalIntent("stop-1", "2026-09-30T04:12:00.000Z"), new Date());

    await replaceRun(sql, RUN, "2026-10-01T06:00:00.000Z");

    const row = await sql.first<{ c: number }>("SELECT COUNT(*) AS c FROM outbox_event");
    expect(row?.c).toBe(1);
  });
});

describe("readStop", () => {
  it("reads one stop with its orders, for the stop detail screen", async () => {
    // The web console refetches the whole run per stop because it has no cache;
    // here the stop comes straight out of SQLite, so it works with no signal.
    await replaceRun(sql, RUN, FETCHED_AT);

    const stop = await readStop(sql, "stop-1");

    expect(stop).toMatchObject({ id: "stop-1", tripNo: 1, serverStatus: "PENDING" });
    expect(stop?.orders).toHaveLength(1);
  });

  it("returns null for a stop not on this device's run", async () => {
    await replaceRun(sql, RUN, FETCHED_AT);
    expect(await readStop(sql, "not-mine")).toBe(null);
  });
});

describe("vocabularies", () => {
  it("preserves the server's ordering", async () => {
    await replaceVocabulary(sql, "problemReasons", [
      "OUTLET_CLOSED",
      "ACCESS_DENIED",
      "VEHICLE_BREAKDOWN",
    ]);

    expect(await readVocabulary(sql, "problemReasons")).toEqual([
      "OUTLET_CLOSED",
      "ACCESS_DENIED",
      "VEHICLE_BREAKDOWN",
    ]);
  });

  it("returns an empty list when the device has never seen the server's", async () => {
    // The caller must then fall back to src/driver/reasons.ts AND say so on
    // screen, as the web console does with a banner.
    expect(await readVocabulary(sql, "problemReasons")).toEqual([]);
  });

  it("replaces rather than merges, so a withdrawn reason disappears", async () => {
    await replaceVocabulary(sql, "problemReasons", ["OUTLET_CLOSED", "ACCESS_DENIED"]);
    await replaceVocabulary(sql, "problemReasons", ["OUTLET_CLOSED"]);

    expect(await readVocabulary(sql, "problemReasons")).toEqual(["OUTLET_CLOSED"]);
  });
});
