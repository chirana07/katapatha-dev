import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  MIN_PING_INTERVAL_MS,
  buildPingPayload,
  geolocationErrorCopy,
  pingRefusalCopy,
  shouldSendPing,
} from "./position-share";

describe("Position sharing", () => {
  it("sends the first fix at once, then at most once a minute", () => {
    assert.equal(shouldSendPing(null, 1000), true);
    assert.equal(shouldSendPing(1000, 1000 + MIN_PING_INTERVAL_MS - 1), false);
    assert.equal(shouldSendPing(1000, 1000 + MIN_PING_INTERVAL_MS), true);
  });

  it("builds the ping the API expects and rounds to a metre", () => {
    const ping = buildPingPayload(
      { latitude: 7.123456789, longitude: 79.987654321, accuracy: 17.6 },
      Date.UTC(2026, 3, 9, 1, 11),
      "01JBX3Q7W2R8M5T9K4N6P0ZYAB",
    );
    assert.deepEqual(ping, {
      clientPingId: "01JBX3Q7W2R8M5T9K4N6P0ZYAB",
      lat: 7.12346,
      lng: 79.98765,
      accuracyM: 18,
      recordedAt: "2026-04-09T01:11:00.000Z",
    });
  });

  it("leaves accuracy out rather than inventing it", () => {
    const ping = buildPingPayload({ latitude: 7, longitude: 79, accuracy: null }, 0, "id");
    assert.equal(ping && "accuracyM" in ping, false);
  });

  it("rejects fixes that cannot be real", () => {
    assert.equal(buildPingPayload({ latitude: NaN, longitude: 79 }, 0, "id"), null);
    assert.equal(buildPingPayload({ latitude: 91, longitude: 79 }, 0, "id"), null);
    assert.equal(buildPingPayload({ latitude: 7, longitude: 181 }, 0, "id"), null);
    assert.equal(buildPingPayload({ latitude: 7, longitude: 79 }, NaN, "id"), null);
  });

  it("explains a denied permission so the driver can fix it", () => {
    assert.match(geolocationErrorCopy(1), /Allow location/);
    assert.match(geolocationErrorCopy(99), /could not report/);
  });

  it("names the phone clock when the server says the report is from the future", () => {
    assert.match(pingRefusalCopy(422, "PING_IN_FUTURE"), /clock/);
    assert.match(pingRefusalCopy(403), /Claim a vehicle/);
    assert.match(pingRefusalCopy(503), /not confirmed/);
  });

  it("never describes this as tracking or live", () => {
    const text = [1, 2, 3, 0].map(geolocationErrorCopy).join(" ") + pingRefusalCopy(500) + pingRefusalCopy(403);
    assert.doesNotMatch(text, /track|live|real-time|background/i);
  });
});
