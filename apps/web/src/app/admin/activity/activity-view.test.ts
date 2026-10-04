import { describe, expect, it } from "vitest";
import { actionWords, activityHref, parseEntity, whenText } from "./activity-view";

describe("activity view", () => {
  it("keeps only the record kinds it offers", () => {
    expect(parseEntity("User")).toBe("User");
    expect(parseEntity(["Vehicle", "User"])).toBe("Vehicle");
    expect(parseEntity("Session")).toBeNull();
    expect(parseEntity(undefined)).toBeNull();
  });

  it("links a filter, and no filter to the bare path", () => {
    expect(activityHref("Outlet")).toBe("/admin/activity?entity=Outlet");
    expect(activityHref(null)).toBe("/admin/activity");
  });

  it("words the admin's own actions and shows any other code as it is", () => {
    expect(actionWords("user.disable")).toBe("Disabled an account");
    expect(actionWords("plan.publish")).toBe("plan.publish");
  });

  it("dates an entry in Colombo time", () => {
    expect(whenText("2026-10-03T20:00:00.000Z")).toBe("4 Oct, 01:30");
  });
});
