import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { openNodeSqlite } from "../db/node-sqlite";
import { migrate } from "../db/migrations";
import type { SqlDriver } from "../db/driver";
import {
  CORNERS_NOT_CONFIRMED,
  MAX_POD_PAGES,
  QUALITY_FLAGS,
  SIGNATURE_NOT_CONFIRMED,
  TEXT_NOT_CONFIRMED,
  deliveryIntent,
  newPageId,
  payloadBytes,
  podPagesProblem,
  startDeliveryIntent,
} from "./intents";
import { enqueue, pendingForStop } from "./repo";
import { projectStopStatus } from "./projection";
import { receiptPage, signaturePage } from "./test-fixtures";

const NOW = new Date("2026-10-01T04:10:00.000Z");
const AT = NOW.toISOString();

let sql: SqlDriver;
beforeEach(async () => {
  sql = openNodeSqlite();
  await migrate(sql);
});
afterEach(async () => {
  await sql.close();
});

const delivery = (pages = [receiptPage()]) => ({
  stopId: "stop-1",
  occurredAt: AT,
  recipientName: "Nimali Perera",
  lines: [
    { orderId: "a", expectedUnits: 10, deliveredUnits: 10 },
    { orderId: "b", expectedUnits: 10, deliveredUnits: 4 },
  ],
  pages,
});

describe("quality flags", () => {
  it("are the contract's upper-case codes", () => {
    expect(QUALITY_FLAGS).toEqual([CORNERS_NOT_CONFIRMED, TEXT_NOT_CONFIRMED, SIGNATURE_NOT_CONFIRMED]);
    for (const flag of QUALITY_FLAGS) expect(flag).toMatch(/^[A-Z][A-Z0-9_]{1,31}$/);
  });
});

describe("newPageId", () => {
  it("mints a ULID, a new one each time, in sort order", () => {
    const ids = [newPageId(), newPageId(), newPageId()];
    for (const id of ids) expect(id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect([...ids].sort()).toEqual(ids);
    expect(new Set(ids).size).toBe(3);
  });
});

describe("deliveryIntent pages", () => {
  it("puts the pages on the POD event only, and the legacy fields nowhere", () => {
    const intent = deliveryIntent(delivery([receiptPage(), signaturePage()]));
    const pod = intent.events.at(-1);

    expect(pod?.type).toBe("POD_CAPTURED");
    expect(pod?.pages.map((page) => page.kind)).toEqual(["RECEIPT", "SIGNATURE"]);
    for (const event of intent.events) {
      expect(event.signatureData).toBe(null);
      expect(event.photoData).toBe(null);
    }
    for (const line of intent.events.slice(0, -1)) expect(line.pages).toEqual([]);
  });

  it("names the batch by the POD and mints ids in event order, lines before the POD", () => {
    const intent = deliveryIntent(delivery());
    const ids = intent.events.map((event) => event.id);
    expect([...ids].sort()).toEqual(ids);
    expect(intent.batchKey).toBe(intent.events.at(-1)?.id);
  });

  it("refuses a delivery with no page", () => {
    expect(() => deliveryIntent(delivery([]))).toThrow(/receipt|sign/i);
  });

  it("accepts exactly MAX_POD_PAGES and refuses one more", () => {
    const eight = Array.from({ length: MAX_POD_PAGES }, () => receiptPage());
    expect(MAX_POD_PAGES).toBe(8);
    expect(() => deliveryIntent(delivery(eight))).not.toThrow();
    expect(() => deliveryIntent(delivery([...eight, receiptPage()]))).toThrow(/at most 8/);
  });

  it("refuses what the server would 422 the whole request for", () => {
    expect(podPagesProblem([receiptPage({ data: "not a data url" })])).toMatch(/image/);
    expect(
      podPagesProblem([receiptPage({ data: `data:image/jpeg;base64,${"A".repeat(1_048_576)}` })]),
    ).toMatch(/too large/);
    expect(podPagesProblem([receiptPage({ qualityFlags: ["lowercase"] })])).toMatch(/flag/);
    expect(podPagesProblem([receiptPage({ qualityFlags: ["A"] })])).toMatch(/flag/);
    const dup = receiptPage();
    expect(podPagesProblem([dup, { ...dup }])).toMatch(/twice/);
    expect(podPagesProblem([receiptPage({ capturedAt: "yesterday-ish" })])).toMatch(/capture time/);
    expect(
      podPagesProblem([receiptPage({ qualityFlags: [CORNERS_NOT_CONFIRMED, TEXT_NOT_CONFIRMED] })]),
    ).toBe(null);
  });

  it("accepts a drawn signature as an svg data URL", () => {
    expect(podPagesProblem([signaturePage()])).toBe(null);
  });
});

describe("payloadBytes", () => {
  it("counts pages, so the batch cap sees them without reading the blobs", () => {
    const small = deliveryIntent(delivery([receiptPage({ data: `data:image/jpeg;base64,${"A".repeat(100)}` })]));
    const big = deliveryIntent(
      delivery([
        receiptPage({ data: `data:image/jpeg;base64,${"A".repeat(100)}` }),
        receiptPage({ data: `data:image/jpeg;base64,${"A".repeat(50_000)}` }),
      ]),
    );
    const bytes = (intent: ReturnType<typeof deliveryIntent>) => payloadBytes(intent.events.at(-1)!);
    expect(bytes(big) - bytes(small)).toBeGreaterThanOrEqual(50_000);
    expect(payloadBytes(small.events[0])).toBe(256);
  });
});

describe("startDeliveryIntent", () => {
  it("from PENDING records ARRIVED then UNLOAD_START as one intent", () => {
    const intent = startDeliveryIntent({ stopId: "stop-1", status: "PENDING", occurredAt: AT });

    expect(intent?.events.map((event) => event.type)).toEqual(["ARRIVED", "UNLOAD_START"]);
    expect(intent?.batchKey).toBe(intent?.events[0].id);
    // Same device clock on both, and ULID order is event order.
    expect(new Set(intent?.events.map((event) => event.occurredAt))).toEqual(new Set([AT]));
    const ids = intent!.events.map((event) => event.id);
    expect([...ids].sort()).toEqual(ids);
    expect(intent?.stopId).toBe("stop-1");
  });

  it("from ARRIVED records only UNLOAD_START", () => {
    const intent = startDeliveryIntent({ stopId: "stop-1", status: "ARRIVED", occurredAt: AT });
    expect(intent?.events.map((event) => event.type)).toEqual(["UNLOAD_START"]);
  });

  it("records nothing once the stop is unloading or closed", () => {
    for (const status of ["UNLOADING", "DONE", "FAILED", "SKIPPED"] as const) {
      expect(startDeliveryIntent({ stopId: "stop-1", status, occurredAt: AT })).toBe(null);
    }
  });

  it("is folded by the projection to UNLOADING", async () => {
    const intent = startDeliveryIntent({ stopId: "stop-1", status: "PENDING", occurredAt: AT })!;
    await enqueue(sql, intent, NOW);

    const projected = projectStopStatus("PENDING", await pendingForStop(sql, "stop-1"));

    expect(projected).toMatchObject({ status: "UNLOADING", unsent: 2, ahead: false });
  });

  it("is a no-op when replayed: the same intent enqueues zero new rows", async () => {
    const intent = startDeliveryIntent({ stopId: "stop-1", status: "PENDING", occurredAt: AT })!;
    expect(await enqueue(sql, intent, NOW)).toBe(2);
    expect(await enqueue(sql, intent, NOW)).toBe(0);

    const projected = projectStopStatus("PENDING", await pendingForStop(sql, "stop-1"));
    expect(projected).toMatchObject({ status: "UNLOADING", unsent: 2 });
  });

  it("two taps mint two different intents, which is why the screen asks the projected status first", () => {
    const first = startDeliveryIntent({ stopId: "stop-1", status: "PENDING", occurredAt: AT })!;
    const second = startDeliveryIntent({ stopId: "stop-1", status: "PENDING", occurredAt: AT })!;
    expect(first.batchKey).not.toBe(second.batchKey);
  });
});
