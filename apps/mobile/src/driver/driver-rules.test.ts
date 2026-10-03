import { describe, it, expect } from "vitest";
import { mutationError, readError } from "./api-errors";
import { buildDeliveryEvents } from "./delivery-events";
import {
  clockToMinutes,
  colomboClock,
  colomboClockNow,
  colomboDateFallback,
  colomboToday,
  formatClock,
  formatDeviceClock,
  formatWindow,
  isIsoDate,
} from "./format";
import { FALLBACK_PROBLEM_REASONS, labelFor } from "./reasons";
import {
  STOP_STATUS_LABEL,
  STOP_STATUS_TONE,
  isTerminal,
  stopsProgress,
} from "./stop-state";

/**
 * Ported from apps/web/src/app/driver/driver-rules.test.ts, which uses
 * node:test and -- because apps/web declares no `test` script -- has never once
 * run in CI. This is the first version of these assertions that actually runs.
 */

describe("Terminal state detection", () => {
  for (const status of ["DONE", "SKIPPED", "FAILED"] as const) {
    it(`treats ${status} as terminal — a driver can't change it from the phone`, () => {
      expect(isTerminal(status)).toBe(true);
    });
  }
  for (const status of ["PENDING", "ARRIVED", "UNLOADING"] as const) {
    it(`treats ${status} as still open`, () => {
      expect(isTerminal(status)).toBe(false);
    });
  }
});

describe("Run progress", () => {
  it("counts terminal stops as done", () => {
    const result = stopsProgress([
      { status: "DONE" },
      { status: "FAILED" },
      { status: "PENDING" },
      { status: "ARRIVED" },
    ]);
    expect(result).toMatchObject({ done: 2, total: 4, remaining: 2 });
  });

  it("names the next still-open stop so the driver knows where to go", () => {
    expect(
      stopsProgress([{ status: "DONE" }, { status: "PENDING" }, { status: "PENDING" }])
        .nextIndex,
    ).toBe(1);
  });

  it("returns a null next index when every stop is closed", () => {
    const result = stopsProgress([{ status: "DONE" }, { status: "DONE" }]);
    expect(result.nextIndex).toBe(null);
    expect(result.remaining).toBe(0);
  });

  it("still works on an empty run", () => {
    expect(stopsProgress([])).toMatchObject({ done: 0, total: 0, nextIndex: null });
  });
});

describe("Status tone", () => {
  // Replaces the web copy's STOP_STATUS_STYLE, which held Tailwind classes.
  it("gives every status a tone, so StatusDot can never fall through", () => {
    for (const status of Object.keys(STOP_STATUS_LABEL) as Array<
      keyof typeof STOP_STATUS_LABEL
    >) {
      expect(STOP_STATUS_TONE[status]).toBeDefined();
    }
  });

  it("marks only a failure as bad and only a delivery as good", () => {
    expect(STOP_STATUS_TONE.FAILED).toBe("bad");
    expect(STOP_STATUS_TONE.DONE).toBe("good");
    // A skipped stop is an outcome, not an error: it must not read as a failure.
    expect(STOP_STATUS_TONE.SKIPPED).toBe("neutral");
  });
});

describe("Driver API error mapping", () => {
  it("marks 401 reads as expired so the UI picks the gentler role", () => {
    expect(readError(401, "run").expired).toBe(true);
    expect(readError(500, "run").expired).toBe(false);
  });

  it("names the resource for 404 on a stop", () => {
    expect(readError(404, "stop").title).toMatch(/Stop not on this run/);
    expect(readError(404, "run").title).toMatch(/Run unavailable/);
  });

  it("maps mutation statuses to driver copy, not generic http", () => {
    expect(mutationError(401, "record arrival")).toMatch(/driver session expired/i);
    expect(mutationError(409, "complete the delivery")).toMatch(/newer record/i);
    expect(mutationError(422, "report the problem")).toMatch(/recipient/i);
    expect(mutationError(500, "release the vehicle")).toMatch(/temporarily unavailable/i);
  });

  it("never blames the driver for losing signal", () => {
    // The fallback is reached when there is no status to reason about at all.
    expect(mutationError(0, "record arrival")).toMatch(/check the signal/i);
  });
});

describe("Problem reasons", () => {
  it("declares a non-empty fallback so the phone is never silent", () => {
    expect(FALLBACK_PROBLEM_REASONS.length).toBeGreaterThanOrEqual(1);
  });

  it("labels known reasons and falls back to the raw code for unknown ones", () => {
    expect(labelFor("OUTLET_CLOSED")).toBe("Outlet closed");
    expect(labelFor("UNKNOWN_REASON")).toBe("UNKNOWN_REASON");
  });
});

describe("Driver formatters", () => {
  it("shows a window as open–close when both exist", () => {
    expect(formatWindow("06:00", "11:00")).toBe("06:00–11:00");
    expect(formatWindow("06:00", undefined)).toBe("From 06:00");
    expect(formatWindow(undefined, "11:00")).toBe("Until 11:00");
    expect(formatWindow(undefined, undefined)).toBe("No window set");
  });

  it("renders a well-formed clock time and nothing else", () => {
    expect(formatClock("04:12")).toBe("04:12");
    expect(formatClock(undefined)).toBe("—");
    expect(formatClock("4:12")).toBe("—");
    expect(formatClock("")).toBe("—");
  });

  it("recognises YYYY-MM-DD strings", () => {
    expect(isIsoDate("2026-10-01")).toBe(true);
    expect(isIsoDate("1/10/2026")).toBe(false);
  });
});

describe("Colombo operating date", () => {
  // Getting this wrong does not throw -- it fetches the wrong day's run.
  it("returns an ISO date", () => {
    expect(isIsoDate(colomboToday())).toBe(true);
  });

  it("agrees with the Intl-free fallback, which is the Hermes safety net", () => {
    const at = new Date("2026-10-01T09:00:00.000Z");
    expect(colomboToday(at)).toBe(colomboDateFallback(at));
  });

  it("rolls the date at 18:30 UTC, because Colombo is UTC+05:30", () => {
    // 18:29 UTC is 23:59 in Colombo, still the 1st.
    expect(colomboDateFallback(new Date("2026-10-01T18:29:00.000Z"))).toBe("2026-10-01");
    // 18:30 UTC is 00:00 the next day.
    expect(colomboDateFallback(new Date("2026-10-01T18:30:00.000Z"))).toBe("2026-10-02");
  });
});

describe("Device clock presentation", () => {
  // The contract: occurredAt is the DEVICE clock and "must be presented as
  // recorded on device". A bare timestamp reads as the server's record.
  it("always says the time came from the device", () => {
    expect(formatDeviceClock("2026-10-01T04:10:00.000Z")).toBe(
      "Recorded on device at 09:40",
    );
  });

  it("still qualifies the time when the timestamp is unparseable", () => {
    expect(formatDeviceClock("not-a-date")).toMatch(/Recorded on device/);
  });
});

describe("Proof-of-delivery events", () => {
  const RECEIPT = {
    id: "page-1",
    kind: "RECEIPT" as const,
    data: "data:image/jpeg;base64,/9j/4AAQ",
    qualityFlags: ["TEXT_NOT_CONFIRMED"],
    capturedAt: "2026-10-01T04:09:00.000Z",
  };
  const SIGNATURE = {
    id: "page-2",
    kind: "SIGNATURE" as const,
    data: "data:image/svg+xml;base64,PHN2Zz4=",
    qualityFlags: [],
    capturedAt: "2026-10-01T04:09:30.000Z",
  };

  it("records every order before the stop-level proof of delivery", () => {
    const events = buildDeliveryEvents({
      lines: [
        { orderId: "ambient", expectedUnits: 12, deliveredUnits: 12, eventId: "line-ambient" },
        { orderId: "chilled", expectedUnits: 8, deliveredUnits: 6, eventId: "line-chilled" },
      ],
      podEventId: "pod",
      occurredAt: "2026-10-01T04:10:00.000Z",
      recipientName: "Nimali Perera",
      pages: [RECEIPT],
    });

    expect(
      events.map(({ type, orderId, deliveredUnits }) => ({ type, orderId, deliveredUnits })),
    ).toEqual([
      { type: "DELIVERED", orderId: "ambient", deliveredUnits: 12 },
      { type: "PART_DELIVERED", orderId: "chilled", deliveredUnits: 6 },
      { type: "POD_CAPTURED", orderId: null, deliveredUnits: null },
    ]);
    expect(events.every((item) => item.recipientName === "Nimali Perera")).toBe(true);
  });

  it("puts every page on the POD event only, in capture order", () => {
    // Repeating a 200 KB photo per order line would multiply the payload for no
    // added fact.
    const events = buildDeliveryEvents({
      lines: [
        { orderId: "a", expectedUnits: 1, deliveredUnits: 1, eventId: "line-a" },
        { orderId: "b", expectedUnits: 1, deliveredUnits: 1, eventId: "line-b" },
      ],
      podEventId: "pod",
      occurredAt: "2026-10-01T04:10:00.000Z",
      recipientName: "Nimali Perera",
      pages: [RECEIPT, SIGNATURE],
    });

    const pod = events.at(-1);
    expect(pod?.type).toBe("POD_CAPTURED");
    expect(pod?.pages.map((page) => page.id)).toEqual(["page-1", "page-2"]);
    expect(pod?.pages[0].qualityFlags).toEqual(["TEXT_NOT_CONFIRMED"]);

    for (const line of events.slice(0, -1)) {
      expect(line.pages).toEqual([]);
    }
  });

  it("never sets the legacy single-image fields, so a picture is not sent twice", () => {
    const events = buildDeliveryEvents({
      lines: [{ orderId: "a", expectedUnits: 1, deliveredUnits: 1, eventId: "line-a" }],
      podEventId: "pod",
      occurredAt: "2026-10-01T04:10:00.000Z",
      recipientName: "Nimali Perera",
      pages: [RECEIPT],
    });
    for (const event of events) {
      expect(event.signatureData).toBe(null);
      expect(event.photoData).toBe(null);
    }
  });

  it("copies the pages, so a later edit by the caller cannot change a queued event", () => {
    const pages = [{ ...RECEIPT, qualityFlags: ["TEXT_NOT_CONFIRMED"] }];
    const events = buildDeliveryEvents({
      lines: [{ orderId: "a", expectedUnits: 1, deliveredUnits: 1, eventId: "line-a" }],
      podEventId: "pod",
      occurredAt: "2026-10-01T04:10:00.000Z",
      recipientName: "N",
      pages,
    });
    pages[0].qualityFlags.push("CORNERS_NOT_CONFIRMED");
    expect(events.at(-1)?.pages[0].qualityFlags).toEqual(["TEXT_NOT_CONFIRMED"]);
  });

  it("calls a short delivery PART_DELIVERED, and an over-delivery DELIVERED", () => {
    const events = buildDeliveryEvents({
      lines: [
        { orderId: "short", expectedUnits: 10, deliveredUnits: 0, eventId: "e1" },
        { orderId: "over", expectedUnits: 10, deliveredUnits: 11, eventId: "e2" },
      ],
      podEventId: "pod",
      occurredAt: "2026-10-01T04:10:00.000Z",
      recipientName: "Nimali Perera",
      pages: [RECEIPT],
    });
    expect(events[0].type).toBe("PART_DELIVERED");
    expect(events[1].type).toBe("DELIVERED");
  });
});

describe("Colombo wall-clock", () => {
  it("renders an instant as Asia/Colombo HH:MM (UTC+05:30, no DST)", () => {
    expect(colomboClockNow(new Date("2026-10-01T01:00:00.000Z"))).toBe("06:30");
    expect(colomboClock(new Date("2026-10-01T18:29:59.000Z"))).toBe("23:59");
  });

  it("rolls past midnight Colombo time", () => {
    expect(colomboClockNow(new Date("2026-10-01T18:30:00.000Z"))).toBe("00:00");
    expect(colomboClockNow(new Date("2026-10-01T00:05:00.000Z"))).toBe("05:35");
  });

  it("agrees with the operating date", () => {
    // 18:30 UTC is already the next day in Colombo.
    const at = new Date("2026-10-01T18:30:00.000Z");
    expect(colomboToday(at)).toBe("2026-10-02");
    expect(colomboClockNow(at)).toBe("00:00");
  });

  it("agrees with formatDeviceClock", () => {
    expect(formatDeviceClock("2026-10-01T04:10:00.000Z")).toBe(
      `Recorded on device at ${colomboClock(new Date("2026-10-01T04:10:00.000Z"))}`,
    );
  });

  it("never throws on a bad date", () => {
    expect(colomboClock(new Date("nope"))).toBe("—");
  });

  it("converts HH:MM to minutes and refuses anything else", () => {
    expect(clockToMinutes("00:00")).toBe(0);
    expect(clockToMinutes("07:21")).toBe(441);
    expect(clockToMinutes("23:59")).toBe(1439);
    for (const bad of [null, undefined, "", "7:21", "24:00", "07:60", "07:21:00", "07-21"]) {
      expect(clockToMinutes(bad)).toBe(null);
    }
  });
});
