import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  defaultReason,
  formatTemp,
  shortBy,
  validateChillerTemp,
  validateLoadCheck,
  type LoadCheckInput,
} from "./shortage";

const ok: LoadCheckInput = {
  tripId: "trip1",
  orderId: "order1",
  expectedUnits: 55,
  loadedUnits: 55,
  condition: "OK",
  checkedByName: "Ranjith Silva",
  reasonCode: null,
  clientRequestId: "6f1c9a52-3b7e-4d1a-9c2e-0a8b7d6e5f40",
};

describe("validateLoadCheck", () => {
  it("accepts a line loaded in full", () => {
    assert.equal(validateLoadCheck(ok), null);
  });

  it("accepts a short line with a reason", () => {
    assert.equal(validateLoadCheck({ ...ok, condition: "SHORT", loadedUnits: 44, reasonCode: "SHORT_QUANTITY" }), null);
  });

  it("refuses a non-OK line with no reason, because it opens a shortfall that holds the vehicle", () => {
    assert.match(validateLoadCheck({ ...ok, condition: "DAMAGED", loadedUnits: 50 }) ?? "", /Pick a reason/);
  });

  it("refuses 'short' that is not short, and 'loaded' that is", () => {
    assert.match(validateLoadCheck({ ...ok, condition: "SHORT", loadedUnits: 55, reasonCode: "SHORT_QUANTITY" }) ?? "", /fewer units/);
    assert.match(validateLoadCheck({ ...ok, loadedUnits: 44 }) ?? "", /match what was ordered/);
  });

  it("requires a missing line to have zero units", () => {
    assert.match(validateLoadCheck({ ...ok, condition: "MISSING", loadedUnits: 3, reasonCode: "MISSING" }) ?? "", /0/);
    assert.equal(validateLoadCheck({ ...ok, condition: "MISSING", loadedUnits: 0, reasonCode: "MISSING" }), null);
  });

  it("needs a real name: the terminal is shared, so the session cannot say who checked", () => {
    assert.match(validateLoadCheck({ ...ok, checkedByName: " R " }) ?? "", /who is checking/);
  });

  it("refuses fractional, negative or absurd unit counts", () => {
    assert.ok(validateLoadCheck({ ...ok, condition: "DAMAGED", loadedUnits: 1.5, reasonCode: "DAMAGED" }));
    assert.ok(validateLoadCheck({ ...ok, condition: "DAMAGED", loadedUnits: -1, reasonCode: "DAMAGED" }));
    assert.ok(validateLoadCheck({ ...ok, condition: "DAMAGED", loadedUnits: 1_000_000, reasonCode: "DAMAGED" }));
  });

  it("refuses a request id that is not a uuid, since the API would", () => {
    assert.ok(validateLoadCheck({ ...ok, clientRequestId: "abc" }));
  });
});

describe("helpers", () => {
  it("computes shortage without going below zero", () => {
    assert.equal(shortBy(55, 44), 11);
    assert.equal(shortBy(55, 60), 0);
  });

  it("preselects the natural reason when the server offers it, else the first", () => {
    const reasons = ["MISSING", "DAMAGED", "SHORT_QUANTITY", "NOT_COLD_ENOUGH"];
    assert.equal(defaultReason("SHORT", reasons), "SHORT_QUANTITY");
    assert.equal(defaultReason("DAMAGED", reasons), "DAMAGED");
    assert.equal(defaultReason("MISSING", reasons), "MISSING");
    assert.equal(defaultReason("SHORT", ["OTHER"]), "OTHER");
    assert.equal(defaultReason("SHORT", []), "");
  });

  it("bounds a gauge reading to what the API accepts", () => {
    assert.equal(validateChillerTemp(3.8), null);
    assert.ok(validateChillerTemp(Number.NaN));
    assert.ok(validateChillerTemp(41));
    assert.ok(validateChillerTemp(-31));
  });

  it("formats a temperature without a trailing zero", () => {
    assert.equal(formatTemp(6), "6 °C");
    assert.equal(formatTemp(3.84), "3.8 °C");
    assert.equal(formatTemp(-2), "−2 °C");
  });
});
