import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { buildDeliveryEvents } from "./delivery-events";
import { parseDeliveryRequest } from "./delivery-request";

const ULID_A = "01JBX3Q7W2R8M5T9K4N6P0ZYAB";
const ULID_B = "01JBX3Q7W2R8M5T9K4N6P0ZYAC";
const ULID_C = "01JBX3Q7W2R8M5T9K4N6P0ZYAD";
const PAGE = "data:image/jpeg;base64,/9j/4AAQ";

function request(overrides: Record<string, unknown> = {}) {
  return {
    deviceId: "device-1",
    occurredAt: "2026-04-09T01:51:00.000Z",
    recipientName: "Fathima Rizvi",
    podEventId: ULID_C,
    lines: [{ orderId: "ord1", eventId: ULID_A, deliveredUnits: 69, expectedUnits: 69 }],
    pages: [{ id: ULID_B, kind: "RECEIPT", data: PAGE, capturedAt: "2026-04-09T01:50:00.000Z" }],
    ...overrides,
  };
}

describe("Delivery request", () => {
  it("accepts a complete delivery with a receipt page", () => {
    const parsed = parseDeliveryRequest(request());
    assert.equal(parsed.ok, true);
  });

  it("accepts a delivery with no page; the receipt is encouraged, not required", () => {
    assert.equal(parseDeliveryRequest(request({ pages: [] })).ok, true);
    assert.equal(parseDeliveryRequest(request({ pages: undefined })).ok, true);
  });

  it("requires the recipient's name", () => {
    const parsed = parseDeliveryRequest(request({ recipientName: " a " }));
    assert.equal(parsed.ok, false);
  });

  it("refuses more units than the order holds, and fractions", () => {
    const over = parseDeliveryRequest(request({ lines: [{ orderId: "o", eventId: ULID_A, deliveredUnits: 70, expectedUnits: 69 }] }));
    assert.equal(over.ok, false);
    const fraction = parseDeliveryRequest(request({ lines: [{ orderId: "o", eventId: ULID_A, deliveredUnits: 1.5, expectedUnits: 69 }] }));
    assert.equal(fraction.ok, false);
  });

  it("refuses a ninth page, a repeated page id, and something that is not an image", () => {
    const page = (id: string) => ({ id, kind: "RECEIPT", data: PAGE, capturedAt: "2026-04-09T01:50:00.000Z" });
    const nine = Array.from({ length: 9 }, (_, i) => page(`01JBX3Q7W2R8M5T9K4N6P0ZY${String(i).padStart(2, "0")}`));
    assert.equal(parseDeliveryRequest(request({ pages: nine })).ok, false);
    assert.equal(parseDeliveryRequest(request({ pages: [page(ULID_B), page(ULID_B)] })).ok, false);
    assert.equal(
      parseDeliveryRequest(request({ pages: [{ ...page(ULID_B), data: "data:text/html;base64,PGI+" }] })).ok,
      false,
    );
  });

  it("refuses a page over the API's size limit", () => {
    const big = "data:image/jpeg;base64," + "A".repeat(1_048_576);
    const parsed = parseDeliveryRequest(request({ pages: [{ id: ULID_B, kind: "RECEIPT", data: big, capturedAt: "2026-04-09T01:50:00.000Z" }] }));
    assert.equal(parsed.ok, false);
  });

  it("puts the pages on the POD event only", () => {
    const parsed = parseDeliveryRequest(request());
    assert.ok(parsed.ok);
    const events = buildDeliveryEvents({
      lines: parsed.value.lines,
      podEventId: parsed.value.podEventId,
      occurredAt: parsed.value.occurredAt,
      recipientName: parsed.value.recipientName,
      pages: parsed.value.pages,
    });
    assert.equal(events.at(-1)?.type, "POD_CAPTURED");
    assert.equal(events.at(-1)?.pages?.length, 1);
    assert.ok(events.slice(0, -1).every((event) => event.pages === undefined));
  });
});
