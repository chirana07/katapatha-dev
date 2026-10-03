import { describe, expect, it } from "vitest";
import { decisionFailure } from "./decision-errors";

describe("decisionFailure", () => {
  it("says who decided what when someone got there first", () => {
    const failure = decisionFailure(409, "ALREADY_DECIDED", "x", { resolution: "HOLD_ORDER", decidedBy: "Nimal Perera" });
    expect(failure.detail).toContain("Nimal Perera already decided to hold the order for the next run");
    expect(failure.outcome).toBe("failed");
    expect(failure.refresh).toBe(true);
  });

  it("says a cleared condition is gone, not that the write failed oddly", () => {
    const failure = decisionFailure(404, "EXCEPTION_NOT_ACTIVE", null, null);
    expect(failure.title).toBe("That condition has cleared");
    expect(failure.refresh).toBe(true);
  });

  it("asks for a note without refreshing the panel", () => {
    const failure = decisionFailure(422, "NOTE_REQUIRED", "Needs note", null);
    expect(failure.title).toBe("A note is needed");
    expect(failure.refresh).toBe(false);
  });

  it("uses the API's wording for an option that is no longer offered", () => {
    expect(decisionFailure(409, "DECISION_NOT_AVAILABLE", "Only ACKNOWLEDGE is available.", null).detail).toBe("Only ACKNOWLEDGE is available.");
  });

  it("never claims failure when no answer came back", () => {
    expect(decisionFailure(0, null, null, null).outcome).toBe("unknown");
    expect(decisionFailure(502, null, null, null).outcome).toBe("unknown");
  });
});
