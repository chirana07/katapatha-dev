import { describe, expect, it } from "vitest";
import {
  CONSENT_COPY,
  ageLabel,
  allPositionCopy,
  statusLine,
} from "./copy";

const NOW = new Date("2026-04-09T02:00:00.000Z");
const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000);

describe("ageLabel", () => {
  it("counts from when the fix was taken", () => {
    expect(ageLabel(minutesAgo(3), NOW)).toBe("3 min ago");
    expect(ageLabel(new Date(NOW.getTime() - 30_000), NOW)).toBe("just now");
    expect(ageLabel(minutesAgo(59), NOW)).toBe("59 min ago");
    expect(ageLabel(minutesAgo(60), NOW)).toBe("1 h ago");
    expect(ageLabel(minutesAgo(125), NOW)).toBe("2 h 5 min ago");
  });
  it("reads a clock that disagrees as just now, never negative", () => {
    expect(ageLabel(new Date(NOW.getTime() + 600_000), NOW)).toBe("just now");
  });
});

describe("statusLine", () => {
  const line = (over: Parameters<typeof statusLine>[0]) => statusLine(over);

  it("says when it last sent, as an age from the fix", () => {
    expect(line({ status: "reporting", lastReportedAt: minutesAgo(3), now: NOW })).toBe(
      "Last sent 3 min ago",
    );
  });
  it("keeps the age visible while offline", () => {
    expect(line({ status: "offline", lastReportedAt: minutesAgo(12), now: NOW })).toBe(
      "No signal. Last sent 12 min ago.",
    );
    expect(line({ status: "offline", lastReportedAt: null, now: NOW })).toBe(
      "No signal. Nothing has been sent yet.",
    );
  });
  it("tells the driver to check the phone's date and time", () => {
    expect(line({ status: "clock-wrong", lastReportedAt: null, now: NOW })).toMatch(
      /^Check the phone's date and time/,
    );
  });
  it("says what to do when location is blocked", () => {
    expect(line({ status: "denied", lastReportedAt: null, now: NOW })).toMatch(/settings/);
  });
  it("asks for a vehicle", () => {
    expect(
      line({ status: "waiting", detail: "no-vehicle", lastReportedAt: null, now: NOW }),
    ).toBe("Pick a vehicle to share its position.");
  });
  it("asks for a fresh sign-in when the session ended", () => {
    expect(
      line({ status: "offline", detail: "session-ended", lastReportedAt: minutesAgo(5), now: NOW }),
    ).toBe("Sign in again to keep sharing. Last sent 5 min ago.");
  });
});

describe("the consent explanation", () => {
  it("says what is sent, to whom, when, and how to stop", () => {
    expect(CONSENT_COPY).toBe(
      "Dispatch and the outlet see the last position this phone sent, with how long ago it was. Nothing is sent while the app is closed, and you can turn it off here at any time.",
    );
  });
});

describe("what position copy must never say", () => {
  const everything = allPositionCopy(NOW);

  it("covers every status", () => {
    expect(everything.length).toBeGreaterThan(40);
  });

  it("never says live, real-time or tracking (docs/DOMAIN.md)", () => {
    for (const text of everything) {
      expect(text).not.toMatch(/\b(live|real[- ]?time|tracking|tracked|track|trace|monitor\w*)\b/i);
    }
  });

  it("never implies background reporting", () => {
    for (const text of everything) {
      expect(text).not.toMatch(/\b(background|always|continuous\w*|automatic\w*)\b/i);
    }
  });

  it("always gives a position its age (no bare 'position known')", () => {
    for (const text of everything) {
      expect(text).not.toMatch(/\b(your|current) (position|location) is\b/i);
    }
  });
});
