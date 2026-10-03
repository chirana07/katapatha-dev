import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  INITIAL_CONNECTIVITY,
  applyProbe,
  backOnlineNotice,
  canSubmit,
  offlineNotice,
  probeIntervalMs,
  showBackOnline,
} from "./connectivity-state";

const T1 = "2026-04-09T00:58:00.000Z"; // 06:28 in Colombo
const T2 = "2026-04-09T01:04:00.000Z"; // 06:34
const T3 = "2026-04-09T01:05:00.000Z";

describe("Driver connectivity", () => {
  it("starts as checking and lets a first answer through without a recovery notice", () => {
    const state = applyProbe(INITIAL_CONNECTIVITY, true, T1);
    assert.equal(state.status, "connected");
    assert.equal(state.backOnlineAt, null);
    assert.equal(showBackOnline(state, Date.parse(T1)), false);
  });

  it("remembers when it last heard from the server, and names it in the offline notice", () => {
    const connected = applyProbe(INITIAL_CONNECTIVITY, true, T1);
    const offline = applyProbe(connected, false, T2);
    assert.equal(offline.status, "offline");
    assert.equal(offline.lastConnectedAt, T1);
    assert.match(offlineNotice(offline).title, /since 06:28 reaches Katapatha until you are back online/);
  });

  it("does not invent a time when it never connected", () => {
    const offline = applyProbe(INITIAL_CONNECTIVITY, false, T1);
    assert.doesNotMatch(offlineNotice(offline).title, /since/);
  });

  it("never claims anything was saved or will sync", () => {
    const offline = applyProbe(applyProbe(INITIAL_CONNECTIVITY, true, T1), false, T2);
    const text = JSON.stringify([offlineNotice(offline), backOnlineNotice({ ...offline, status: "connected", backOnlineAt: T3 })]);
    assert.doesNotMatch(text, /saved|sync|queued for|will be sent|uploads/i);
  });

  it("shows Back online only after a recovery, and only for two minutes", () => {
    const offline = applyProbe(applyProbe(INITIAL_CONNECTIVITY, true, T1), false, T2);
    const back = applyProbe(offline, true, T3);
    assert.equal(back.backOnlineAt, T3);
    assert.equal(showBackOnline(back, Date.parse(T3) + 60_000), true);
    assert.equal(showBackOnline(back, Date.parse(T3) + 121_000), false);
    assert.match(backOnlineNotice(back).title, /^Back online at 06:35\./);
  });

  it("clears the recovery notice if the connection drops again", () => {
    const back = applyProbe(applyProbe(applyProbe(INITIAL_CONNECTIVITY, true, T1), false, T2), true, T3);
    assert.equal(applyProbe(back, false, T3).backOnlineAt, null);
  });

  it("blocks submits only when offline, and probes faster then", () => {
    assert.equal(canSubmit("offline"), false);
    assert.equal(canSubmit("checking"), true);
    assert.equal(canSubmit("connected"), true);
    assert.ok(probeIntervalMs("offline") < probeIntervalMs("connected"));
  });
});
