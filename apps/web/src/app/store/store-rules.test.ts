import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mutationError, readError } from "./api-errors";
import { needsAttention, storeState } from "./order-state";
import { validateOrderQuantities, validateReceipt } from "./validation";

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
});

describe("Place Order validation", () => {
  it("builds only non-zero order lines", () => {
    assert.deepEqual(validateOrderQuantities("12", "0"), {
      ok: true,
      data: [{ tempRequirement: "ambient", units: 12 }],
    });
  });

  for (const [ambient, chilled] of [["0", "0"], ["-1", "2"], ["1.5", "2"], ["10001", "0"]]) {
    it(`rejects invalid quantities ${ambient} and ${chilled}`, () => {
      assert.equal(validateOrderQuantities(ambient, chilled).ok, false);
    });
  }
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

describe("API recovery messages", () => {
  it("does not describe an expired session as a network failure", () => {
    assert.match(mutationError(401, "place order"), /session expired/i);
    assert.equal(readError(401, "orders").title, "Session expired");
  });

  it("explains authorization and validation failures", () => {
    assert.match(mutationError(403, "confirm receipt"), /not allowed/i);
    assert.match(mutationError(422, "place order"), /rejected/i);
    assert.equal(readError(403, "order").title, "Access denied");
  });
});
