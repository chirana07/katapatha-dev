import { describe, it, expect } from "vitest";
import { KNOWN_REJECTION_CODES, describeRejection } from "./rejections";

/** The codes the contract's EventRejection lists (stops.yaml). */
const CONTRACT_CODES = [
  "STOP_NOT_ON_RUN",
  "MISSING_TRIP_STOP_ID",
  "ID_REUSED",
  "ID_COLLISION",
  "DELIVERED_INCOMPLETE",
  "ORDER_NOT_ON_STOP",
  "RECIPIENT_REQUIRED",
  "POD_WITHOUT_DELIVERY",
  "POD_REJECTED",
  "POD_ALREADY_IN_REQUEST",
  "STOP_ALREADY_CLOSED",
  "STATE_MISMATCH",
  "PAGES_ON_NON_POD",
  "TOO_MANY_PAGES",
  "DUPLICATE_PAGE_ID",
  "PAGE_DATA_INVALID",
  "PAGE_TOO_LARGE",
  "INVALID_OCCURRED_AT",
];

describe("describeRejection", () => {
  it("has plain wording for every code in the contract", () => {
    expect([...KNOWN_REJECTION_CODES].sort()).toEqual([...CONTRACT_CODES].sort());
    for (const code of CONTRACT_CODES) {
      const text = describeRejection({ code, message: "Stop clx0abc is not on this driver's run." });
      expect(text.length).toBeGreaterThan(20);
      expect(text).toMatch(/[.!]$/);
    }
  });

  it("never says 'failed' or 'could not send': a rejection is a known outcome", () => {
    for (const code of [...CONTRACT_CODES, "WHAT_IS_THIS"]) {
      const text = describeRejection({ code, message: "" });
      expect(text.toLowerCase()).not.toMatch(/fail|could not send|unable|try again|error/);
      expect(text.toLowerCase()).toMatch(/not (accepted|applied|take|on your run)|did not|refused/);
    }
  });

  it("does not show the server's developer message for a known code", () => {
    const text = describeRejection({
      code: "STOP_NOT_ON_RUN",
      message: "Stop clx0stp9z8y7x6w5v4u3t2s is not on this driver's run.",
    });
    expect(text).not.toContain("clx0stp");
  });

  it("treats an unknown code as terminal with generic wording, and shows a short server message", () => {
    expect(describeRejection({ code: "BRAND_NEW", message: "" })).toMatch(/did not accept/);
    expect(describeRejection({ code: "BRAND_NEW", message: "Quantity is odd." })).toContain(
      "The server said: Quantity is odd.",
    );
    expect(describeRejection({ code: "BRAND_NEW", message: "x".repeat(500) })).not.toContain("xxxx");
    expect(describeRejection({})).toMatch(/did not accept/);
  });

  it("says where to take it for codes the driver cannot fix", () => {
    expect(describeRejection({ code: "STOP_NOT_ON_RUN" })).toMatch(/dispatch/i);
  });
});
