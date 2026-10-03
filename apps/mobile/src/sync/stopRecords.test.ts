import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { openNodeSqlite } from "../db/node-sqlite";
import { migrate } from "../db/migrations";
import type { SqlDriver } from "../db/driver";
import { deliveryIntent, problemIntent, startDeliveryIntent } from "../outbox/intents";
import { enqueue } from "../outbox/repo";
import { receiptPage, signaturePage } from "../outbox/test-fixtures";
import { readStopRecords } from "./stopRecords";

let sql: SqlDriver;
const NOW = new Date("2026-10-01T04:10:00.000Z");
const DATE = "2026-10-01";

beforeEach(async () => {
  sql = openNodeSqlite();
  await migrate(sql);
  await sql.run("INSERT INTO run (date, vehicle_id, fetched_at) VALUES (?, 'V', 'now')", [DATE]);
  await sql.run("INSERT INTO trip (trip_id, date, trip_no, wave) VALUES ('t1', ?, 1, 'PREDAWN')", [DATE]);
  for (const [id, date] of [
    ["stop-1", DATE],
    ["stop-2", DATE],
  ]) {
    await sql.run(
      "INSERT INTO stop (id, trip_id, date, seq, outlet_id, server_status) VALUES (?, 't1', ?, 1, 'O', 'PENDING')",
      [id, date],
    );
  }
});

afterEach(async () => {
  await sql.close();
});

describe("readStopRecords", () => {
  it("returns nothing for a day with no records", async () => {
    expect((await readStopRecords(sql, DATE)).size).toBe(0);
  });

  it("reads arrival and unload times from the device clock", async () => {
    await enqueue(
      sql,
      startDeliveryIntent({ stopId: "stop-1", status: "PENDING", occurredAt: "2026-10-01T04:01:00.000Z" })!,
      NOW,
    );
    expect((await readStopRecords(sql, DATE)).get("stop-1")).toMatchObject({
      arrivedAt: "2026-10-01T04:01:00.000Z",
      unloadStartedAt: "2026-10-01T04:01:00.000Z",
      completedAt: null,
      outcome: null,
    });
  });

  it("reports a delivery: lines, recipient, completedAt, page count, DELIVERED", async () => {
    await enqueue(
      sql,
      deliveryIntent({
        stopId: "stop-1",
        occurredAt: "2026-10-01T04:30:00.000Z",
        recipientName: "Nimali Perera",
        lines: [
          { orderId: "a", expectedUnits: 10, deliveredUnits: 10 },
          { orderId: "b", expectedUnits: 5, deliveredUnits: 5 },
        ],
        pages: [receiptPage(), signaturePage(), receiptPage()],
      }),
      NOW,
    );

    expect((await readStopRecords(sql, DATE)).get("stop-1")).toEqual({
      arrivedAt: null,
      unloadStartedAt: null,
      completedAt: "2026-10-01T04:30:00.000Z",
      recipientName: "Nimali Perera",
      lines: [
        { orderId: "a", deliveredUnits: 10 },
        { orderId: "b", deliveredUnits: 5 },
      ],
      pageCount: 3,
      outcome: "DELIVERED",
      reasonCode: null,
    });
  });

  it("calls a delivery with any PART_DELIVERED line a PART", async () => {
    await enqueue(
      sql,
      deliveryIntent({
        stopId: "stop-1",
        occurredAt: NOW.toISOString(),
        recipientName: "N",
        lines: [
          { orderId: "a", expectedUnits: 10, deliveredUnits: 10 },
          { orderId: "b", expectedUnits: 5, deliveredUnits: 2 },
        ],
        pages: [receiptPage()],
      }),
      NOW,
    );
    expect((await readStopRecords(sql, DATE)).get("stop-1")?.outcome).toBe("PART");
  });

  it("keeps stops apart and ignores another day", async () => {
    await sql.run("INSERT INTO run (date, vehicle_id, fetched_at) VALUES ('2026-10-02', 'V', 'now')");
    await sql.run("INSERT INTO trip (trip_id, date, trip_no, wave) VALUES ('t2', '2026-10-02', 1, 'PREDAWN')");
    await sql.run(
      "INSERT INTO stop (id, trip_id, date, seq, outlet_id, server_status) VALUES ('tomorrow', 't2', '2026-10-02', 1, 'O', 'PENDING')",
    );
    await enqueue(sql, problemIntent({ stopId: "stop-2", occurredAt: NOW.toISOString(), reasonCode: "OUTLET_CLOSED" }), NOW);
    await enqueue(sql, problemIntent({ stopId: "tomorrow", occurredAt: NOW.toISOString(), reasonCode: "OUTLET_CLOSED" }), NOW);

    const records = await readStopRecords(sql, DATE);
    expect([...records.keys()]).toEqual(["stop-2"]);
    expect(records.get("stop-2")).toMatchObject({ outcome: "FAILED", reasonCode: "OUTLET_CLOSED" });
  });

  it("excludes rejected and conflicted rows: they are not what the driver recorded", async () => {
    await enqueue(
      sql,
      startDeliveryIntent({ stopId: "stop-1", status: "ARRIVED", occurredAt: NOW.toISOString() })!,
      NOW,
    );
    await sql.run("UPDATE outbox_event SET state = 'rejected'");
    expect((await readStopRecords(sql, DATE)).size).toBe(0);
    await sql.run("UPDATE outbox_event SET state = 'conflict'");
    expect((await readStopRecords(sql, DATE)).size).toBe(0);
  });

  it("never selects an image: it works with the blobs already nulled, and counts legacy images", async () => {
    // A row queued by the previous build: one signature, no pages.
    await sql.run(
      `INSERT INTO outbox_event (id, batch_key, stop_id, type, occurred_at, recipient_name, signature_data, state, created_at)
       VALUES ('01LEGACY', '01LEGACY', 'stop-1', 'POD_CAPTURED', ?, 'N', 'data:image/svg+xml;base64,PHN2Zz4=', 'queued', 'now')`,
      [NOW.toISOString()],
    );
    expect((await readStopRecords(sql, DATE)).get("stop-1")?.pageCount).toBe(1);
  });
});
