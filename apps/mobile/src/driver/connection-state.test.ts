import { describe, it, expect } from "vitest";
import {
  LAMP_AFTER_MINUTES,
  backOnlineNotice,
  lampState,
  nextStopLine,
} from "./connection-state";

// 06:30 in Colombo is 01:00 UTC.
const T = (clock: string) => new Date(`2026-10-01T${clock}:00.000Z`);
const NOW = T("01:00");
const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000);

describe("LAMP_AFTER_MINUTES", () => {
  it("mirrors apps/api/src/services/positions.ts", () => {
    expect(LAMP_AFTER_MINUTES).toBe(10);
  });
});

describe("lampState", () => {
  it("connected and checking carry no time", () => {
    expect(lampState({ label: "Connected", offlineSince: null, now: NOW })).toEqual({
      kind: "connected",
      sinceClock: null,
    });
    expect(lampState({ label: "Checking", offlineSince: minutesAgo(30), now: NOW })).toEqual({
      kind: "checking",
      sinceClock: null,
    });
  });

  it("is plain offline before ten minutes, with the Colombo time of last contact", () => {
    // Last contact 01:00 - 9 min = 00:51 UTC = 06:21 Colombo.
    expect(lampState({ label: "Offline", offlineSince: minutesAgo(9), now: NOW })).toEqual({
      kind: "offline",
      sinceClock: "06:21",
    });
  });

  it("is Lamp from exactly ten minutes", () => {
    expect(lampState({ label: "Offline", offlineSince: minutesAgo(10), now: NOW })).toEqual({
      kind: "lamp",
      sinceClock: "06:20",
    });
    expect(lampState({ label: "Offline", offlineSince: minutesAgo(180), now: NOW }).kind).toBe("lamp");
  });

  it("does not invent a time when it does not know one", () => {
    expect(lampState({ label: "Offline", offlineSince: null, now: NOW })).toEqual({
      kind: "offline",
      sinceClock: null,
    });
    expect(lampState({ label: "Offline", offlineSince: new Date("nope"), now: NOW })).toEqual({
      kind: "offline",
      sinceClock: null,
    });
  });
});

describe("nextStopLine", () => {
  it("counts down only when connected, positive and under four hours", () => {
    // NOW is 06:30 Colombo; planned 07:09 is 39 minutes away.
    expect(nextStopLine({ plannedClock: "07:09", now: NOW, connected: true })).toEqual({
      kind: "countdown",
      text: "in 39 min · planned 07:09",
    });
    expect(nextStopLine({ plannedClock: "08:35", now: NOW, connected: true })).toEqual({
      kind: "countdown",
      text: "in 2 h 5 min · planned 08:35",
    });
    expect(nextStopLine({ plannedClock: "08:30", now: NOW, connected: true }).text).toBe(
      "in 2 h · planned 08:30",
    );
  });

  it("says only 'planned' offline, however near", () => {
    expect(nextStopLine({ plannedClock: "07:09", now: NOW, connected: false })).toEqual({
      kind: "planned",
      text: "planned 07:09",
    });
    // And offline AND overdue: still no claim about lateness.
    expect(nextStopLine({ plannedClock: "05:00", now: NOW, connected: false }).text).toBe(
      "planned 05:00",
    );
  });

  it("has no countdown at four hours or more", () => {
    expect(nextStopLine({ plannedClock: "10:30", now: NOW, connected: true })).toEqual({
      kind: "planned",
      text: "planned 10:30",
    });
    expect(nextStopLine({ plannedClock: "10:29", now: NOW, connected: true }).kind).toBe("countdown");
  });

  it("says 'was planned for' when connected and past, and nothing about how late", () => {
    expect(nextStopLine({ plannedClock: "06:00", now: NOW, connected: true })).toEqual({
      kind: "late",
      text: "was planned for 06:00",
    });
  });

  it("does not count down to the minute it is already", () => {
    expect(nextStopLine({ plannedClock: "06:30", now: NOW, connected: true })).toEqual({
      kind: "planned",
      text: "planned 06:30",
    });
  });

  it("is unknown without a valid planned time", () => {
    for (const plannedClock of [null, "", "7:9", "25:00", "soon"]) {
      expect(nextStopLine({ plannedClock, now: NOW, connected: true }).kind).toBe("unknown");
    }
  });
});

describe("backOnlineNotice", () => {
  const sync = (over: Record<string, unknown> = {}) => ({
    at: minutesAgo(4).toISOString(),
    outcome: "sent",
    sent: 4,
    accepted: 4,
    duplicates: 0,
    ...over,
  });
  const ask = (over: Record<string, unknown> = {}) =>
    backOnlineNotice({
      unsent: 0,
      lastSync: sync(),
      now: NOW,
      label: "Connected",
      ...over,
    } as Parameters<typeof backOnlineNotice>[0]);

  it("shows the Colombo time of the send and how many records the server took", () => {
    // 00:56 UTC = 06:26 Colombo.
    expect(ask()).toEqual({ atClock: "06:26", count: 4 });
  });

  it("counts records the server already held as taken", () => {
    expect(ask({ lastSync: sync({ accepted: 1, duplicates: 2, sent: 4 }) })?.count).toBe(3);
  });

  it("needs Connected and nothing left waiting", () => {
    expect(ask({ label: "Offline" })).toBe(null);
    expect(ask({ label: "Checking" })).toBe(null);
    expect(ask({ unsent: 1 })).toBe(null);
  });

  it("needs the last attempt to be a send that carried records", () => {
    expect(ask({ lastSync: null })).toBe(null);
    expect(ask({ lastSync: sync({ outcome: "offline" }) })).toBe(null);
    expect(ask({ lastSync: sync({ sent: 0 }) })).toBe(null);
    expect(ask({ lastSync: sync({ sent: null }) })).toBe(null);
  });

  it("is not shown when the server refused everything it was sent", () => {
    expect(ask({ lastSync: sync({ accepted: 0, duplicates: 0, sent: 2 }) })).toBe(null);
  });

  it("expires after thirty minutes", () => {
    expect(ask({ lastSync: sync({ at: minutesAgo(30).toISOString() }) })).not.toBe(null);
    expect(ask({ lastSync: sync({ at: minutesAgo(31).toISOString() }) })).toBe(null);
  });

  it("falls back to `sent` when an old log row has no accepted/duplicates", () => {
    expect(ask({ lastSync: { at: minutesAgo(1).toISOString(), outcome: "sent", sent: 3 } })?.count).toBe(3);
  });

  it("ignores an unreadable timestamp", () => {
    expect(ask({ lastSync: sync({ at: "garbage" }) })).toBe(null);
  });
});
