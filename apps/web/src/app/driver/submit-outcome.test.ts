import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { describeEventOutcome } from "./submit-outcome";

describe("Stop event outcome", () => {
  it("is saved when every event was accepted", () => {
    const outcome = describeEventOutcome({ results: [{ id: "a", status: "accepted" }], rejected: [] });
    assert.deepEqual(outcome, { kind: "saved", duplicate: false, staleAssignment: false });
  });

  it("treats a duplicate as a correct replay, still saved", () => {
    const outcome = describeEventOutcome({ results: [{ id: "a", status: "duplicate" }], rejected: [] });
    assert.deepEqual(outcome, { kind: "saved", duplicate: true, staleAssignment: false });
  });

  it("flags a stale assignment so the driver reloads the run", () => {
    const outcome = describeEventOutcome({
      results: [{ id: "a", status: "conflict", conflictState: "STALE_ASSIGNMENT" }],
      rejected: [],
    });
    assert.equal(outcome.kind === "saved" && outcome.staleAssignment, true);
  });

  it("never reports a refused event as saved, even if nothing else was sent", () => {
    const outcome = describeEventOutcome({
      results: [],
      rejected: [{ id: "a", code: "STOP_ALREADY_CLOSED", message: "closed" }],
    });
    assert.equal(outcome.kind, "rejected");
  });

  it("falls back to the server's own message for a code it does not know", () => {
    const outcome = describeEventOutcome({ results: [], rejected: [{ id: "a", code: "NEW_CODE", message: "Because." }] });
    assert.equal(outcome.kind === "rejected" && outcome.message, "Katapatha refused this record: Because.");
  });
});
