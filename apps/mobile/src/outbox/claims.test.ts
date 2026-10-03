import { describe, it, expect } from "vitest";
import {
  OFFLINE_DURABILITY_VERIFIED,
  allSentFooterCopy,
  backOnlineCopy,
  claimsCopy,
  countStepStatusCopy,
  lampBannerCopy,
  outboxExplainer,
  outboxHeldHeading,
  releaseVehicleNote,
  receiptStepHint,
  recordedStatusLabel,
  recordedWaitingNotice,
  sessionEndedNotice,
  signInClaimsCopy,
  signInNote,
  signInSubcopy,
  signOutKeepsRecordsNote,
  stopSavedPillLabel,
  unsentCopy,
  waitingFooterCopy,
} from "./claims";

/**
 * Guards on the wording itself, because docs/PRODUCT.md and docs/DESIGN.md make
 * these sentences binding rather than editorial.
 */

describe("the durability claim", () => {
  it("is only true while the acceptance test is passing", () => {
    // This assertion is a tripwire, not a tautology: if someone deletes or skips
    // drain.acceptance.test.ts, the claim it licenses should be reconsidered
    // here. The test file and this constant are meant to move together.
    expect(OFFLINE_DURABILITY_VERIFIED).toBe(true);
  });
});

describe("what the copy must never say", () => {
  const everything = [
    unsentCopy(1),
    unsentCopy(3),
    outboxExplainer(),
  ].join(" ").toLowerCase();

  it("never implies background sync", () => {
    // Every drain is foreground-only; no background task is registered and
    // expo-background-task is deliberately not a dependency.
    for (const forbidden of ["background", "automatic", "automatically"]) {
      expect(everything).not.toContain(forbidden);
    }
  });

  it("never implies a vehicle's position is known", () => {
    // There is no GPS in this product.
    for (const forbidden of ["location", "gps", "position", "tracking"]) {
      expect(everything).not.toContain(forbidden);
    }
  });

  it("never promises the server will deduplicate", () => {
    // Server-side idempotency is not implemented yet (delivery.ts mints its own
    // id), so the copy must not lean on it.
    for (const forbidden of ["duplicate", "safely", "guaranteed"]) {
      expect(everything).not.toContain(forbidden);
    }
  });
});

describe("unsentCopy", () => {
  it("agrees with itself about one record versus several", () => {
    expect(unsentCopy(1)).toMatch(/\b1 record\b(?! s)/);
    expect(unsentCopy(3)).toContain("3 records");
  });

  it("says where the records are and when they go", () => {
    const copy = unsentCopy(2);
    expect(copy).toMatch(/on this phone/i);
    expect(copy).toMatch(/signal/i);
  });
});

/**
 * The gate is applied in one place, claimsCopy(verified), so both states are
 * tested here whatever the constant says. The exported functions are the
 * constant's state of it.
 */
function everyString(verified: boolean): string[] {
  const c = claimsCopy(verified);
  const flat = (value: { title: string; body: string }) => [value.title, value.body];
  return [
    c.unsentCopy(1),
    c.unsentCopy(4),
    c.outboxExplainer(),
    ...flat(c.lampBannerCopy({ lamp: true, sinceClock: "06:28" })),
    ...flat(c.lampBannerCopy({ lamp: false, sinceClock: "06:28" })),
    ...flat(c.lampBannerCopy({ lamp: false, sinceClock: null })),
    c.waitingFooterCopy(0),
    c.waitingFooterCopy(1),
    c.waitingFooterCopy(3),
    c.countStepStatusCopy(false) ?? "",
    c.receiptStepHint(true),
    c.receiptStepHint(false),
    c.recordedStatusLabel(true),
    c.recordedStatusLabel(false),
    ...flat(c.recordedWaitingNotice({ sinceClock: "06:28", count: 4 })),
    ...flat(c.recordedWaitingNotice({ sinceClock: null, count: 1 })),
    ...flat(c.backOnlineCopy({ atClock: "07:34", outletName: "OUT074" })),
    ...flat(c.backOnlineCopy({ atClock: "07:34", outletName: null })),
    c.allSentFooterCopy("07:34"),
    c.allSentFooterCopy(null),
    c.stopSavedPillLabel(),
  ];
}

describe("the new screens' wording, with the gate true", () => {
  it("says what the design says, in the words it was specified in", () => {
    expect(lampBannerCopy({ lamp: true, sinceClock: "06:28" })).toEqual({
      title: "Lamp Mode is on · no signal since 06:28",
      body: "Keep working. Everything is saved on this phone.",
    });
    expect(lampBannerCopy({ lamp: false, sinceClock: "06:28" }).title).toBe(
      "Offline · no signal since 06:28",
    );
    expect(waitingFooterCopy(3)).toBe("3 updates waiting to send");
    expect(waitingFooterCopy(1)).toBe("1 update waiting to send");
    expect(countStepStatusCopy(false)).toBe("Offline · saved on phone");
    expect(countStepStatusCopy(true)).toBe(null);
    expect(receiptStepHint(true)).toBe("No signal? The photo is saved on this phone and sent later.");
    expect(receiptStepHint(false)).toBe(
      "Offline · the photo is saved on this phone and sent when there is signal.",
    );
    expect(recordedStatusLabel(false)).toBe("Saved on this phone");
    expect(recordedStatusLabel(true)).toBe("Sent");
    expect(recordedWaitingNotice({ sinceClock: "06:28", count: 4 })).toEqual({
      title: "No signal since 06:28 · 4 updates waiting",
      body: "They are sent when there is signal, while the app is open. Nothing to re-enter.",
    });
    expect(backOnlineCopy({ atClock: "07:34", outletName: "OUT074" })).toEqual({
      title: "Back online · sent at 07:34",
      body: "Dispatch and OUT074 can now see your work.",
    });
    expect(allSentFooterCopy("07:34")).toBe("All updates sent · 07:34");
    expect(stopSavedPillLabel()).toBe("Saved on phone");
  });

  it("agrees with itself about singular and plural, and says no more than it knows", () => {
    expect(recordedWaitingNotice({ sinceClock: "06:28", count: 1 }).title).toBe(
      "No signal since 06:28 · 1 update waiting",
    );
    expect(recordedWaitingNotice({ sinceClock: null, count: 2 }).title).toBe(
      "No signal · 2 updates waiting",
    );
    expect(lampBannerCopy({ lamp: false, sinceClock: null }).title).toBe("Offline · no signal");
    expect(backOnlineCopy({ atClock: "07:34", outletName: null }).body).toBe(
      "Dispatch can now see your work.",
    );
  });

  it("matches the gate's own state through the exported functions", () => {
    expect(OFFLINE_DURABILITY_VERIFIED).toBe(true);
    expect(unsentCopy(2)).toBe(claimsCopy(true).unsentCopy(2));
    expect(waitingFooterCopy(2)).toBe(claimsCopy(true).waitingFooterCopy(2));
  });
});

describe("the same wording with the gate false: nothing claims durability", () => {
  const c = claimsCopy(false);

  it("falls back to 'recorded on this phone, send before you close the app'", () => {
    expect(c.outboxExplainer()).toMatch(/send them before you close the app/i);
    expect(c.lampBannerCopy({ lamp: true, sinceClock: "06:28" }).body).toMatch(
      /send them before you close the app/i,
    );
    expect(c.recordedWaitingNotice({ sinceClock: "06:28", count: 4 }).body).toMatch(
      /before you close the app/i,
    );
    expect(c.receiptStepHint(false)).toMatch(/not sent/i);
    expect(c.waitingFooterCopy(3)).toBe("3 updates recorded on this phone, not sent yet");
    expect(c.recordedStatusLabel(false)).toBe("Recorded on this phone, not sent");
    expect(c.stopSavedPillLabel()).toBe("Not sent");
  });

  it("never says 'saved' or 'held', which are the durability claim", () => {
    for (const text of everyString(false)) {
      expect(text.toLowerCase()).not.toMatch(/\bsaved\b|\bheld\b|everything is|sent later|sent when there is signal/);
    }
  });

  it("keeps the facts that are about the server, not the phone", () => {
    expect(c.recordedStatusLabel(true)).toBe("Sent");
    expect(c.backOnlineCopy({ atClock: "07:34", outletName: "OUT074" })).toEqual(
      backOnlineCopy({ atClock: "07:34", outletName: "OUT074" }),
    );
  });

  it("still has no chip while connected", () => {
    expect(c.countStepStatusCopy(true)).toBe(null);
    expect(c.countStepStatusCopy(false)).toBe("Offline · not sent yet");
  });
});

describe("what no wording may ever say, in either gate state", () => {
  for (const verified of [true, false]) {
    const everything = everyString(verified).join(" ").toLowerCase();

    it(`never implies background sync (gate ${verified})`, () => {
      for (const forbidden of [
        "background",
        "automatic",
        "automatically",
        "by themselves",
        "by itself",
        "syncs",
        "syncing",
      ]) {
        expect(everything).not.toContain(forbidden);
      }
    });

    it(`never implies a position is known or live (gate ${verified})`, () => {
      for (const forbidden of ["live", "real-time", "tracking", "gps", "location"]) {
        expect(everything).not.toMatch(new RegExp(`\\b${forbidden}\\b`));
      }
    });

    it(`never says a write failed or that the outcome is unknown (gate ${verified})`, () => {
      expect(everything).not.toMatch(/fail|unknown|lost/);
    });

    it(`never promises the server will deduplicate (gate ${verified})`, () => {
      for (const forbidden of ["duplicate", "safely", "guaranteed"]) {
        expect(everything).not.toContain(forbidden);
      }
    });
  }
});

describe("sign-in and sign-out wording", () => {
  const strings = (verified: boolean) => {
    const c = signInClaimsCopy(verified);
    return [
      c.signInSubcopy(),
      c.signInNote(),
      c.sessionEndedNotice(),
      c.signOutKeepsRecordsNote(1),
      c.signOutKeepsRecordsNote(3),
      c.outboxHeldHeading(),
      c.releaseVehicleNote("VEH025"),
    ];
  };

  it("says what the design says, with the gate true", () => {
    expect(signInSubcopy()).toBe(
      "See your route and record every delivery, even through a signal gap.",
    );
    expect(signInNote()).toBe("Lamp Mode saves your work if the signal drops.");
    expect(sessionEndedNotice()).toMatch(/still on this phone/);
    expect(signOutKeepsRecordsNote(1)).toMatch(/^1 record still to send/);
    expect(signOutKeepsRecordsNote(3)).toMatch(/^3 records still to send/);
  });

  it("words the release note by the gate", () => {
    expect(releaseVehicleNote("VEH025")).toMatch(/stays on this phone/);
    expect(signInClaimsCopy(false).releaseVehicleNote("VEH025")).not.toMatch(/stays|saved|held/);
  });

  it("words the held-records heading by the gate", () => {
    expect(outboxHeldHeading()).toBe("Held on this phone");
    expect(signInClaimsCopy(false).outboxHeldHeading()).toBe("Recorded on this phone, not sent");
  });

  it("claims nothing about a signal gap or saved work with the gate false", () => {
    const c = signInClaimsCopy(false);
    expect(c.signInSubcopy()).toBe("See your route and record every delivery.");
    for (const text of strings(false)) {
      expect(text.toLowerCase()).not.toMatch(
        /\bsaves?\b|\bsaved\b|\bheld\b|signal gap|still on this phone|everything is|sent later|sent when there is signal/,
      );
    }
    expect(c.signInNote()).toMatch(/send it before you close the app/i);
    expect(c.signOutKeepsRecordsNote(2)).toMatch(/not sent/);
  });

  for (const verified of [true, false]) {
    it(`never implies background sync, live position or a failed write (gate ${verified})`, () => {
      const everything = strings(verified).join(" ").toLowerCase();
      for (const forbidden of [
        "background",
        "automatic",
        "by themselves",
        "by itself",
        "syncs",
        "syncing",
        "tracking",
        "real-time",
        "gps",
      ]) {
        expect(everything).not.toContain(forbidden);
      }
      expect(everything).not.toMatch(/\blive\b|fail|unknown|lost|duplicate|guaranteed/);
    });
  }
});

import { problemClaimsCopy, problemSendNote } from "./claims";

describe("failed-delivery and skipped-stop wording", () => {
  it("says what happens to the record, with the gate true", () => {
    expect(problemSendNote(true)).toBe(
      "It is sent straight away. If that does not go through, it is held on this phone and sent when there is signal, while the app is open.",
    );
    expect(problemSendNote(false)).toBe(
      "You are offline. It is held on this phone and sent when there is signal, while the app is open.",
    );
  });

  it("claims nothing about the phone keeping the record with the gate false", () => {
    const c = problemClaimsCopy(false);
    for (const text of [c.sendNote(true), c.sendNote(false)]) {
      expect(text).toMatch(/Unsent records/);
      expect(text.toLowerCase()).not.toMatch(/\bsaved\b|\bheld\b|sent when there is signal|sent later/);
    }
  });

  for (const verified of [true, false]) {
    it(`never implies background sync or an unknown outcome (gate ${verified})`, () => {
      const c = problemClaimsCopy(verified);
      const everything = [c.sendNote(true), c.sendNote(false)].join(" ").toLowerCase();
      for (const forbidden of ["background", "automatic", "by themselves", "syncs", "tracking", "live"]) {
        expect(everything).not.toContain(forbidden);
      }
      expect(everything).not.toMatch(/fail|unknown|lost|duplicate|guaranteed/);
      // Offline says so; connected never promises the server will have it.
      expect(c.sendNote(false)).toMatch(/offline/i);
      expect(c.sendNote(true)).not.toMatch(/offline/i);
    });
  }
});
