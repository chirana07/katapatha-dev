import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  needsAttention,
  receivingWindowLabel,
  storeState,
  storeStateLabel,
} from "./order-state";
import { validateOrderItems, validateReceipt } from "./validation";

describe("Store order status", () => {
  const mappings = [
    ["DRAFT", "queued"],
    ["PLACED", "queued"],
    ["QUEUED", "queued"],
    ["PLANNED", "planned"],
    ["LOADED", "planned"],
    ["IN_TRANSIT", "on_the_way"],
    ["DELIVERED", "delivered"],
    ["PART_DELIVERED", "delivered"],
    ["FAILED", "failed"],
    ["DEFERRED", "deferred"],
    ["CANCELLED", "cancelled"],
  ] as const;

  for (const [status, expected] of mappings) {
    it(`maps ${status} to ${expected}`, () => {
      assert.equal(storeState({ status, storeState: undefined }), expected);
    });
  }

  it("prefers the server-owned Store projection", () => {
    assert.equal(storeState({ status: "FAILED", storeState: "on_the_way" }), "on_the_way");
  });

  for (const state of ["failed", "deferred", "cancelled"]) {
    it(`marks ${state} for attention`, () => assert.equal(needsAttention(state), true));
  }

  it("formats projected states for people", () => {
    assert.equal(storeStateLabel("on_the_way"), "On the way");
    assert.equal(storeStateLabel("queued"), "Queued");
  });

  it("explains when Dispatch has not assigned a window", () => {
    assert.equal(receivingWindowLabel({ windowOpen: undefined, windowClose: undefined }), "Awaiting plan");
    assert.equal(
      receivingWindowLabel({ windowOpen: "06:00", windowClose: "11:00" }),
      "06:00–11:00",
    );
  });
});

describe("Place Order validation", () => {
  it("passes a basket through as the API's items", () => {
    assert.deepEqual(validateOrderItems('[{"productId":"p1","quantity":12},{"productId":"p2","quantity":3}]'), {
      ok: true,
      data: [
        { productId: "p1", quantity: 12 },
        { productId: "p2", quantity: 3 },
      ],
    });
  });

  for (const [label, raw] of [
    ["nothing", null],
    ["not JSON", "{"],
    ["not a list", '{"productId":"p1","quantity":1}'],
    ["an empty basket", "[]"],
    ["a zero quantity", '[{"productId":"p1","quantity":0}]'],
    ["a negative quantity", '[{"productId":"p1","quantity":-1}]'],
    ["a fractional quantity", '[{"productId":"p1","quantity":1.5}]'],
    ["a quantity over 10,000", '[{"productId":"p1","quantity":10001}]'],
    ["a quantity sent as text", '[{"productId":"p1","quantity":"2"}]'],
    ["a missing product", '[{"quantity":2}]'],
    ["the same product twice", '[{"productId":"p1","quantity":1},{"productId":"p1","quantity":2}]'],
  ] as const) {
    it(`rejects ${label}`, () => {
      assert.equal(validateOrderItems(raw).ok, false);
    });
  }

  it("refuses more products than the API takes", () => {
    const many = JSON.stringify(Array.from({ length: 101 }, (_, i) => ({ productId: `p${i}`, quantity: 1 })));
    assert.equal(validateOrderItems(many).ok, false);
  });
});

describe("Receipt validation", () => {
  it("accepts a matching receipt without an issue", () => {
    assert.deepEqual(validateReceipt("120", "yes", null), {
      ok: true,
      data: { unitsReceived: 120, matches: true, issueKind: null },
    });
  });

  it("requires an issue for a difference", () => {
    const result = validateReceipt("100", "no", null);
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.error, /Choose what was wrong/);
  });

  it("accepts a contract issue code", () => {
    assert.deepEqual(validateReceipt("100", "no", "ITEMS_MISSING"), {
      ok: true,
      data: { unitsReceived: 100, matches: false, issueKind: "ITEMS_MISSING" },
    });
  });
});
