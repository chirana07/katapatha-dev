import { describe, expect, it } from "vitest";
import { stopSavedPillLabel } from "../../outbox/claims";
import type { StopStatus } from "../../driver/stop-state";
import {
  accessPlace,
  attentionText,
  clockSkewAdvisory,
  displayedTripIndex,
  finishedTripNote,
  footerModel,
  lastSentOutlet,
  nextStopOf,
  orderSummary,
  settledFacts,
  startLabel,
  stopBadge,
  stopRowModel,
  stopRowModels,
  stopTime,
  tripChipLabel,
  tripChoices,
  tripsTodayLabel,
  tryNowResult,
  windowText,
  type RowStop,
} from "./tripModel";

function stop(over: Partial<RowStop> & { status?: StopStatus; unsent?: number; state?: RowStop["projection"]["state"] } = {}): RowStop {
  const { status = "PENDING", unsent = 0, state = "clean", ...rest } = over;
  return {
    id: "stp_OUT074",
    outletId: "OUT074",
    outletName: null,
    plannedArrivalAt: "07:21",
    windowOpen: "05:30",
    windowClose: "08:00",
    accessNote: "Rear dock",
    orders: [{ orderRef: "S1-082", expectedUnits: 69 }],
    projection: { status, unsent, state },
    record: { completedAt: null },
    ...rest,
  };
}

describe("trip labels", () => {
  it("pluralises the trip count", () => {
    expect(tripsTodayLabel(1)).toBe("1 trip today");
    expect(tripsTodayLabel(2)).toBe("2 trips today");
  });

  it("numbers the chip by position in the day", () => {
    expect(tripChipLabel(0, 2)).toBe("Trip 1 of 2");
    expect(tripChipLabel(1, 2)).toBe("Trip 2 of 2");
  });

  const trips = [
    { tripId: "a", stops: [stop({ status: "DONE" }), stop()] },
    { tripId: "b", stops: [stop(), stop()] },
  ];

  it("describes each trip in the switch menu and marks the shown one", () => {
    expect(tripChoices(trips, 1)).toEqual([
      { tripId: "a", label: "Trip 1", detail: "1 of 2 stops completed", selected: false },
      { tripId: "b", label: "Trip 2", detail: "0 of 2 stops completed", selected: true },
    ]);
  });

  it("shows the driver's choice while it exists, else the active trip", () => {
    expect(displayedTripIndex(trips, "b", 0)).toBe(1);
    expect(displayedTripIndex(trips, null, 1)).toBe(1);
    expect(displayedTripIndex(trips, "gone", 0)).toBe(0);
    expect(displayedTripIndex([], null, 0)).toBe(0);
    expect(displayedTripIndex(trips, null, 9)).toBe(1);
  });

  it("points a driver on a finished trip at the one with stops left", () => {
    const done = [
      { tripId: "a", stops: [stop({ status: "DONE" })] },
      { tripId: "b", stops: [stop()] },
    ];
    expect(finishedTripNote(done, 0)).toEqual({
      title: "Trip 1 is finished",
      body: "Trip 2 still has stops to go. Choose it above.",
    });
    expect(finishedTripNote([done[0]!], 0).body).toBeNull();
  });

  it("finds the first open stop", () => {
    const stops = [stop({ status: "DONE" }), stop({ status: "FAILED" }), stop(), stop()];
    expect(nextStopOf(stops)).toBe(stops[2]);
    expect(nextStopOf([stop({ status: "DONE" })])).toBeNull();
  });
});

describe("the stop badge", () => {
  it("never shows a refused record as delivered", () => {
    const badge = stopBadge(stop({ status: "DONE", state: "rejected" }), false);
    expect(badge).toEqual({ kind: "failed", label: "Not accepted" });
  });

  it("shows a conflict as information, not as delivered", () => {
    expect(stopBadge(stop({ status: "DONE", state: "conflict" }), false)).toEqual({
      kind: "conflict",
      label: "Changed on server",
    });
  });

  it("says Saved on phone, from claims.ts, while events are unsent", () => {
    expect(stopBadge(stop({ status: "DONE", unsent: 2, state: "unsent" }), false)).toEqual({
      kind: "saved",
      label: stopSavedPillLabel(),
    });
    expect(stopBadge(stop({ status: "UNLOADING", unsent: 1, state: "unsent" }), true).kind).toBe("saved");
  });

  it("maps the closed statuses", () => {
    expect(stopBadge(stop({ status: "DONE" }), false).kind).toBe("delivered");
    expect(stopBadge(stop({ status: "FAILED" }), false).kind).toBe("failed");
    expect(stopBadge(stop({ status: "SKIPPED" }), false).kind).toBe("skipped");
  });

  it("maps the open statuses", () => {
    expect(stopBadge(stop(), true).kind).toBe("next");
    expect(stopBadge(stop(), false).kind).toBe("upcoming");
    expect(stopBadge(stop({ status: "ARRIVED" }), true).kind).toBe("onsite");
    expect(stopBadge(stop({ status: "UNLOADING" }), true).kind).toBe("onsite");
  });
});

describe("the stop row", () => {
  it("shows the plan, labelled as a plan, for a stop not closed here", () => {
    expect(stopTime(stop()).text).toBe("planned 07:21");
    expect(stopTime(stop({ plannedArrivalAt: null })).text).toBe("No planned time");
  });

  it("shows the recorded device clock for a stop completed on this phone", () => {
    // 01:12 UTC = 06:42 in Colombo.
    const done = stop({ status: "DONE", record: { completedAt: "2026-09-27T01:12:00.000Z" } });
    expect(stopTime(done)).toEqual({
      text: "06:42 on device",
      a11y: "Recorded on device at 06:42",
    });
  });

  it("falls back to the plan for a closed stop with no record here", () => {
    expect(stopTime(stop({ status: "DONE" })).text).toBe("planned 07:21");
  });

  it("takes the first segment of the access note", () => {
    expect(accessPlace("Rear dock. Ring twice.")).toBe("Rear dock");
    expect(accessPlace("Street")).toBe("Street");
    expect(accessPlace("  ")).toBeNull();
    expect(accessPlace(null)).toBeNull();
  });

  it("writes the window line from whatever halves exist", () => {
    expect(windowText("05:30", "08:00")).toBe("Window 05:30–08:00");
    expect(windowText("05:30", null)).toBe("Window from 05:30");
    expect(windowText(null, "08:00")).toBe("Window until 08:00");
    expect(windowText(null, null)).toBeNull();
    expect(windowText("soon", "later")).toBeNull();
  });

  it("builds the row for the next stop", () => {
    const row = stopRowModel(stop(), 2, true);
    expect(row).toMatchObject({
      number: 2,
      marker: "current",
      title: "OUT074",
      subtitle: null,
      place: "Rear dock",
      detail: "Window 05:30–08:00 · 1 order",
      isNext: true,
      startLabel: "Start delivery",
    });
    expect(row.badge.kind).toBe("next");
  });

  it("appends the outlet name only when it adds something", () => {
    expect(stopRowModel(stop({ outletName: "Puttalam Fresh" }), 1, false).subtitle).toBe("Puttalam Fresh");
    expect(stopRowModel(stop({ outletName: "OUT074" }), 1, false).subtitle).toBeNull();
  });

  it("uses the Continue label once the driver is on site", () => {
    expect(startLabel("ARRIVED")).toBe("Continue delivery");
    expect(startLabel("UNLOADING")).toBe("Continue delivery");
    expect(startLabel("PENDING")).toBe("Start delivery");
    expect(startLabel("DONE")).toBeNull();
    expect(startLabel("FAILED")).toBeNull();
  });

  it("numbers a trip and flags only the first open stop", () => {
    const rows = stopRowModels([
      stop({ id: "1", status: "DONE" }),
      stop({ id: "2" }),
      stop({ id: "3" }),
    ]);
    expect(rows.map((row) => [row.number, row.marker, row.isNext])).toEqual([
      [1, "done", false],
      [2, "current", true],
      [3, "upcoming", false],
    ]);
    expect(rows[0]!.startLabel).toBeNull();
  });

  it("marks a failed stop with the failed marker and skipped as upcoming grey", () => {
    expect(stopRowModel(stop({ status: "FAILED" }), 1, false).marker).toBe("failed");
    expect(stopRowModel(stop({ status: "SKIPPED" }), 1, false).marker).toBe("upcoming");
  });

  it("summarises orders without inventing item names", () => {
    expect(orderSummary([{ orderRef: "S1-082", expectedUnits: 69 }])).toEqual({
      title: "S1-082",
      detail: "69 units",
    });
    expect(
      orderSummary([
        { orderRef: "A", expectedUnits: 20 },
        { orderRef: "B", expectedUnits: 1 },
      ]),
    ).toEqual({ title: "2 orders", detail: "A, B · 21 units" });
    expect(orderSummary([{ orderRef: "A", expectedUnits: 1 }])!.detail).toBe("1 unit");
    expect(orderSummary([])).toBeNull();
    const many = Array.from({ length: 5 }, (_, i) => ({ orderRef: `O${i}`, expectedUnits: 1 }));
    expect(orderSummary(many)!.detail).toBe("O0, O1, O2 +2 · 5 units");
  });
});

describe("the foot of the screen", () => {
  const now = new Date("2026-09-27T02:04:00.000Z"); // 07:34 Colombo

  it("counts what is waiting and shows no all-sent line beside it", () => {
    const model = footerModel({ unsent: 3, rejected: 0, conflicts: 0, lastSettledAt: "2026-09-27T02:00:00.000Z", now });
    expect(model).toEqual({ waiting: 3, attention: null, allSentAt: null });
  });

  it("shows All updates sent after a recent send, with the clock of the send", () => {
    const model = footerModel({ unsent: 0, rejected: 0, conflicts: 0, lastSettledAt: "2026-09-27T02:04:00.000Z", now });
    expect(model).toEqual({ waiting: null, attention: null, allSentAt: "07:34" });
  });

  it("drops the all-sent line once the send is old, or when there never was one", () => {
    const old = footerModel({ unsent: 0, rejected: 0, conflicts: 0, lastSettledAt: "2026-09-27T00:00:00.000Z", now });
    expect(old.allSentAt).toBeNull();
    expect(footerModel({ unsent: 0, rejected: 0, conflicts: 0, lastSettledAt: null, now }).allSentAt).toBeNull();
    expect(footerModel({ unsent: 0, rejected: 0, conflicts: 0, lastSettledAt: "garbage", now }).allSentAt).toBeNull();
  });

  it("keeps refused and replaced records visible after everything else is sent", () => {
    const model = footerModel({ unsent: 0, rejected: 1, conflicts: 2, lastSettledAt: "2026-09-27T02:04:00.000Z", now });
    expect(model.attention).toBe(3);
    expect(attentionText(1)).toBe("1 record was not applied by the server.");
    expect(attentionText(3)).toBe("3 records were not applied by the server.");
  });

  it("reports a Try now that did not clear the queue, without guessing why", () => {
    expect(tryNowResult({ after: 3, attemptedAt: now })).toBe("Tried at 07:34 · 3 still waiting.");
    expect(tryNowResult({ after: 0, attemptedAt: now })).toBeNull();
    expect(tryNowResult({ after: 3, attemptedAt: now })).not.toMatch(/signal|offline|fail/i);
  });
});

describe("back online", () => {
  it("turns the store's last settle into the facts the notice reads", () => {
    expect(settledFacts("2026-09-27T02:04:00.000Z", 4)).toEqual({
      at: "2026-09-27T02:04:00.000Z",
      outcome: "sent",
      sent: 4,
      accepted: 4,
      duplicates: 0,
    });
    expect(settledFacts(null, 4)).toBeNull();
    expect(settledFacts("2026-09-27T02:04:00.000Z", 0)).toBeNull();
  });

  it("names the outlet of the most recently completed stop the server has taken", () => {
    const stops = [
      stop({ outletId: "OUT073", status: "DONE", record: { completedAt: "2026-09-27T01:12:00.000Z" } }),
      stop({ outletId: "OUT074", status: "DONE", record: { completedAt: "2026-09-27T01:50:00.000Z" } }),
      stop({ outletId: "OUT075" }),
    ];
    expect(lastSentOutlet(stops)).toBe("OUT074");
  });

  it("prefers the outlet name when there is one", () => {
    const stops = [
      stop({ outletName: "Puttalam Fresh", status: "DONE", record: { completedAt: "2026-09-27T01:12:00.000Z" } }),
    ];
    expect(lastSentOutlet(stops)).toBe("Puttalam Fresh");
  });

  it("skips stops that are unsent, refused, replaced, or not completed on this phone", () => {
    const at = { completedAt: "2026-09-27T01:50:00.000Z" };
    expect(lastSentOutlet([stop({ status: "DONE", unsent: 1, state: "unsent", record: at })])).toBeNull();
    expect(lastSentOutlet([stop({ status: "DONE", state: "rejected", record: at })])).toBeNull();
    expect(lastSentOutlet([stop({ status: "DONE", state: "conflict", record: at })])).toBeNull();
    expect(lastSentOutlet([stop({ status: "DONE" })])).toBeNull();
    expect(lastSentOutlet([])).toBeNull();
  });
});

describe("the clock advisory", () => {
  it("is quiet within two minutes and either side", () => {
    expect(clockSkewAdvisory(null)).toBeNull();
    expect(clockSkewAdvisory(120_000)).toBeNull();
    expect(clockSkewAdvisory(-90_000)).toBeNull();
  });

  it("says which way and by how much", () => {
    expect(clockSkewAdvisory(300_000)).toMatch(/5 minutes ahead of the server/);
    expect(clockSkewAdvisory(-600_000)).toMatch(/10 minutes behind the server/);
  });
});
