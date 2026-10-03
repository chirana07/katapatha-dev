import { describe, expect, it } from "vitest";
import { formatDeviceClock } from "./format";
import { alreadyClosedNote, consequenceLines, otherOutcome, reasonRequiredNote } from "./problem-wording";
import {
  accessSegment,
  arrivalInfoLine,
  closedSummary,
  deviceTimeText,
  orderRefsLabel,
  recordedFactRows,
  statusBadge,
  stopNotices,
  stopPrimary,
  stopSubline,
  syncStatus,
  STOP_HINT,
} from "./stop-detail";

// 07:58 in Asia/Colombo is 02:28 UTC.
const ARRIVED = "2026-09-27T02:28:00.000Z";
const clean = { unsent: 0, state: "clean", ahead: false } as const;

describe("the header subline", () => {
  it("is the first access segment, the units and the order refs (R-11, units first so a cut-off line keeps the count)", () => {
    expect(
      stopSubline({ accessNote: "Rear dock", orders: [{ orderRef: "S1-084", expectedUnits: 24 }] }),
    ).toBe("Rear dock · 24 units · S1-084");
  });

  it("keeps only the first segment of a long note and shortens it to one line", () => {
    expect(accessSegment("Rear dock · ask for the manager")).toBe("Rear dock");
    expect(accessSegment("Gate 2, behind the market")).toBe("Gate 2");
    expect(accessSegment("Unit 4, 12.5 Main Rd")).toBe("Unit 4");
    expect(accessSegment("Use the side entrance on Galle Road opposite the temple")).toMatch(/…$/);
    expect(accessSegment("Use the side entrance on Galle Road opposite the temple")!.length).toBeLessThanOrEqual(28);
    expect(accessSegment("  ")).toBeNull();
    expect(accessSegment(null)).toBeNull();
  });

  it("leaves out what it does not know instead of inventing it", () => {
    expect(stopSubline({ accessNote: null, orders: [{ orderRef: "S1-084", expectedUnits: 1 }] })).toBe(
      "1 unit · S1-084",
    );
    expect(stopSubline({ accessNote: "Rear dock", orders: [] })).toBe("Rear dock");
    expect(stopSubline({ accessNote: null, orders: [] })).toBe("");
  });

  it("abbreviates many orders and sums their units", () => {
    expect(orderRefsLabel(["A", "B"])).toBe("A, B");
    expect(orderRefsLabel(["S1-082a", "S1-082b", "S1-082c", "S1-082d"])).toBe("S1-082a +3");
    expect(
      stopSubline({
        accessNote: "Rear dock",
        orders: [20, 18, 16, 15].map((n, i) => ({ orderRef: `S1-082${"abcd"[i]}`, expectedUnits: n })),
      }),
    ).toBe("Rear dock · 69 units · S1-082a +3");
  });
});

describe("the arrival info line", () => {
  it("reads 'Arrived 07:58 ... window 03:00–08:00' and says it is the device clock", () => {
    const line = arrivalInfoLine({ arrivedAt: ARRIVED, windowOpen: "03:00", windowClose: "08:00" });
    expect(line).toBe("Arrived 07:58 (recorded on device) · window 03:00–08:00");
    expect(formatDeviceClock(ARRIVED)).toContain("07:58");
  });

  it("is the window alone when no arrival is recorded, and null with neither", () => {
    expect(arrivalInfoLine({ arrivedAt: null, windowOpen: "03:00", windowClose: "08:00" })).toBe(
      "Window 03:00–08:00",
    );
    expect(arrivalInfoLine({ arrivedAt: null, windowOpen: null, windowClose: null })).toBeNull();
    expect(arrivalInfoLine({ arrivedAt: ARRIVED, windowOpen: null, windowClose: null })).toBe(
      "Arrived 07:58 (recorded on device)",
    );
  });

  it("ignores an unreadable time rather than printing it", () => {
    expect(deviceTimeText("not a date")).toBeNull();
    expect(arrivalInfoLine({ arrivedAt: "nope", windowOpen: null, windowClose: null })).toBeNull();
  });

  it("never shows a device time bare", () => {
    expect(deviceTimeText(ARRIVED)).toBe("07:58 · recorded on device");
    for (const row of recordedFactRows({ arrivedAt: ARRIVED, unloadStartedAt: ARRIVED })) {
      expect(row.value).toMatch(/recorded on device/);
    }
  });
});

describe("status", () => {
  it("has a badge with text for every status, and Next only for the next stop", () => {
    expect(statusBadge("PENDING", true).label).toBe("Next stop");
    expect(statusBadge("PENDING", false).label).toBe("Upcoming");
    expect(statusBadge("ARRIVED", false)).toEqual({ label: "On site", tone: "warn" });
    expect(statusBadge("UNLOADING", true).label).toBe("Unloading");
    expect(statusBadge("DONE", false)).toEqual({ label: "Delivered", tone: "good" });
    expect(statusBadge("FAILED", false)).toEqual({ label: "Failed", tone: "bad" });
    expect(statusBadge("SKIPPED", false).label).toBe("Skipped");
  });

  it("has one dominant action for open stops and none for closed ones", () => {
    expect(stopPrimary("PENDING")).toEqual({ kind: "start", label: "Start delivery" });
    expect(stopPrimary("ARRIVED")).toEqual({ kind: "continue", label: "Continue delivery" });
    expect(stopPrimary("UNLOADING")).toEqual({ kind: "continue", label: "Continue delivery" });
    for (const closed of ["DONE", "FAILED", "SKIPPED"] as const) expect(stopPrimary(closed)).toBeNull();
  });

  it("describes the current flow, not the old Record arrival / Start unload buttons", () => {
    for (const hint of Object.values(STOP_HINT)) {
      expect(hint).not.toMatch(/Record arrival|Start unload/);
    }
    expect(STOP_HINT.PENDING).toMatch(/Start delivery/);
    expect(STOP_HINT.UNLOADING).toMatch(/Continue delivery/);
  });
});

describe("notices", () => {
  it("lists the server's disagreements, worst first, and nothing when clean", () => {
    expect(stopNotices(clean)).toEqual([]);
    const all = stopNotices({ unsent: 1, state: "rejected", ahead: true });
    expect(all.map((n) => n.id)).toEqual(["rejected", "ahead"]);
    expect(all[0]!.tone).toBe("bad");
    expect(stopNotices({ unsent: 0, state: "conflict", ahead: false })[0]!.id).toBe("conflict");
  });

  it("does not say a record failed when the server refused it", () => {
    for (const notice of stopNotices({ unsent: 1, state: "rejected", ahead: true })) {
      expect(notice.text.toLowerCase()).not.toMatch(/fail|lost/);
    }
  });
});

describe("sync status", () => {
  it("is Sent only when nothing is waiting and the server has not refused anything", () => {
    expect(syncStatus(clean)).toEqual({ label: "Sent", tone: "good", phone: false });
    expect(syncStatus({ unsent: 2, state: "unsent", ahead: false })).toEqual({
      label: "Saved on this phone",
      tone: "warn",
      phone: true,
    });
    expect(syncStatus({ unsent: 0, state: "rejected", ahead: false }).label).not.toBe("Sent");
    expect(syncStatus({ unsent: 0, state: "conflict", ahead: false }).label).not.toBe("Sent");
    expect(syncStatus({ unsent: 1, state: "rejected", ahead: false }).tone).toBe("bad");
  });
});

describe("closed-stop summary", () => {
  const record = {
    arrivedAt: ARRIVED,
    unloadStartedAt: ARRIVED,
    completedAt: ARRIVED,
    recipientName: "Fathima Rizvi",
    pageCount: 1,
    outcome: "DELIVERED" as const,
    reasonCode: null,
    lines: [{ deliveredUnits: 69 }],
  };

  it("summarises a delivery: units, receiver, pages, when", () => {
    const summary = closedSummary({ status: "DONE", record, expectedUnits: 69, projection: clean })!;
    expect(summary.rows).toEqual([
      { label: "Units", value: "69 / 69 units" },
      { label: "Received by", value: "Fathima Rizvi" },
      { label: "Receipt", value: "1 page" },
      { label: "Recorded", value: "07:58 · recorded on device" },
    ]);
    expect(summary.status.label).toBe("Sent");
  });

  it("says how many units were short, and does not invent counts the phone lacks", () => {
    const short = closedSummary({
      status: "DONE",
      record: { ...record, lines: [{ deliveredUnits: 66 }] },
      expectedUnits: 69,
      projection: clean,
    })!;
    expect(short.rows[0]!.value).toBe("66 / 69 units · 3 short");

    const unknown = closedSummary({
      status: "DONE",
      record: { ...record, lines: [], recipientName: null, pageCount: 0, completedAt: null },
      expectedUnits: 69,
      projection: clean,
    })!;
    expect(unknown.rows).toEqual([{ label: "Units", value: "69 units expected" }]);
  });

  it("summarises a failed or skipped stop with its reason", () => {
    const failed = closedSummary({
      status: "FAILED",
      record: { ...record, outcome: "FAILED", reasonCode: "OUTLET_CLOSED", lines: [] },
      expectedUnits: 24,
      projection: { unsent: 1, state: "unsent", ahead: false },
    })!;
    expect(failed.rows[0]).toEqual({ label: "Outcome", value: "Failed delivery" });
    expect(failed.rows[1]).toEqual({ label: "Reason", value: "Store closed · shutter down" });
    expect(failed.status.label).toBe("Saved on this phone");
    expect(
      closedSummary({ status: "SKIPPED", record: { ...record, reasonCode: null }, expectedUnits: 1, projection: clean })!
        .rows[0],
    ).toEqual({ label: "Outcome", value: "Skipped" });
  });

  it("is null for an open stop", () => {
    expect(closedSummary({ status: "UNLOADING", record, expectedUnits: 1, projection: clean })).toBeNull();
  });
});

describe("the failed-delivery wording", () => {
  it("says only what the server does, and never what it does not", () => {
    const text = [...consequenceLines("FAILED"), ...consequenceLines("SKIPPED")].join(" ").toLowerCase();
    // None of these is done by apps/api's FAILED/SKIPPED path (see problem-wording.ts).
    for (const forbidden of ["tomorrow", "redeliver", "return", "on board", "told now", "notified", "first on", "units stay"]) {
      expect(text).not.toContain(forbidden);
    }
    expect(consequenceLines("FAILED")[0]).toBe("The stop is closed as failed.");
    expect(consequenceLines("SKIPPED")[0]).toBe("The stop is closed as skipped.");
  });

  it("explains the difference between failed and skipped from both sides", () => {
    expect(otherOutcome("FAILED").label).toBe("Skip this stop instead");
    expect(otherOutcome("SKIPPED").label).toBe("Record a failed delivery instead");
    expect(otherOutcome("FAILED").explanation).toMatch(/without trying/);
  });

  it("explains the disabled button and the closed stop", () => {
    expect(reasonRequiredNote("FAILED")).toMatch(/Choose/);
    expect(reasonRequiredNote("SKIPPED")).toMatch(/skipping/);
    expect(alreadyClosedNote("DONE")).toMatch(/delivered/);
    expect(alreadyClosedNote("FAILED")).toMatch(/failed/);
  });
});
