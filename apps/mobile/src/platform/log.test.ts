import { describe, it, expect } from "vitest";
import { redactForTest } from "./log";

describe("log redaction", () => {
  it("redacts a signature and photo payload on a stop event", () => {
    const event = {
      id: "01JA0000000000000000000000",
      type: "POD_CAPTURED",
      recipientName: "Nimali Perera",
      signatureData: "data:image/svg+xml;base64,PHN2Zz4=",
      photoData: "data:image/jpeg;base64,/9j/4AAQ",
    };

    expect(redactForTest(event)).toEqual({
      id: "01JA0000000000000000000000",
      type: "POD_CAPTURED",
      // The recipient's name is on the delivery record by design; it is not a
      // credential and the driver needs it in a log to debug a stop.
      recipientName: "Nimali Perera",
      signatureData: "[redacted]",
      photoData: "[redacted]",
    });
  });

  it("redacts a password and a bearer token regardless of casing", () => {
    expect(
      redactForTest({
        email: "sunil@waypoint.lk",
        Password: "waypoint",
        Authorization: "Bearer abc123",
        token: "abc123",
      }),
    ).toEqual({
      email: "sunil@waypoint.lk",
      Password: "[redacted]",
      Authorization: "[redacted]",
      token: "[redacted]",
    });
  });

  it("redacts inside arrays and nested objects, which is how events arrive", () => {
    expect(
      redactForTest({
        deviceId: "device-7f3a91",
        events: [{ id: "A", signatureData: "secret" }, { id: "B", photoData: "secret" }],
      }),
    ).toEqual({
      deviceId: "device-7f3a91",
      events: [
        { id: "A", signatureData: "[redacted]" },
        { id: "B", photoData: "[redacted]" },
      ],
    });
  });

  it("passes primitives and null through untouched", () => {
    expect(redactForTest("plain")).toBe("plain");
    expect(redactForTest(42)).toBe(42);
    expect(redactForTest(null)).toBe(null);
    expect(redactForTest(undefined)).toBe(undefined);
  });
});
