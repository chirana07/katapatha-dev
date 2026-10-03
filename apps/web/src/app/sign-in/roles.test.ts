import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { ROLE_COPY, ROLE_ORDER, parseSignInRole } from "./roles";

describe("Role-scoped sign-in", () => {
  it("accepts exactly the four role names", () => {
    for (const role of ROLE_ORDER) assert.equal(parseSignInRole(role), role);
  });

  it("treats anything else as no role, including prototype keys and repeated params", () => {
    assert.equal(parseSignInRole(undefined), null);
    assert.equal(parseSignInRole(""), null);
    assert.equal(parseSignInRole("admin"), null);
    assert.equal(parseSignInRole("constructor"), null);
    assert.equal(parseSignInRole("DRIVER"), null);
    assert.equal(parseSignInRole(["driver", "loader"]), null);
  });

  it("has copy for every role, with the button naming the workspace", () => {
    for (const role of ROLE_ORDER) {
      const copy = ROLE_COPY[role];
      assert.equal(copy.role, role);
      assert.equal(copy.points.length, 3);
      assert.match(copy.submit, /^Open .+ workspace$/);
    }
  });

  it("makes no offline or live claim on the driver's sign-in", () => {
    const text = JSON.stringify(ROLE_COPY.driver);
    assert.doesNotMatch(text, /offline|signal gap|\blive\b|real-time|saved|sync/i);
  });
});
