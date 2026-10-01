import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mutationError, readError } from "./api-errors";
import { buildDeliveryEvents } from "./delivery-events";
import { formatClock, formatWindow, generateUlid, isIsoDate } from "./format";
import { FALLBACK_PROBLEM_REASONS, labelFor } from "./reasons";
import {
  STOP_STATUS_HINT,
  STOP_STATUS_LABEL,
  isTerminal,
  primaryAction,
  stopsProgress,
} from "./stop-state";

describe("Stop primary action", () => {
  const mappings = [
    ["PENDING", "arrive"],
    ["ARRIVED", "unload"],
    ["UNLOADING", "complete"],
    ["DONE", "none"],
    ["SKIPPED", "none"],
    ["FAILED", "none"],
  ] as const;

  for (const [status, kind] of mappings) {
    it(`advances ${status} toward ${kind}`, () => {
      assert.equal(primaryAction(status).kind, kind);
    });
  }

  it("labels the arrival action as something a driver would recognise", () => {
    assert.equal(primaryAction("PENDING").label, "Record arrival");
    assert.equal(primaryAction("ARRIVED").label, "Start unload");
    assert.equal(primaryAction("UNLOADING").label, "Complete delivery");
  });

  it("gives every status a hint that doesn't repeat the status label", () => {
    for (const status of Object.keys(STOP_STATUS_HINT) as Array<keyof typeof STOP_STATUS_HINT>) {
      const hint = STOP_STATUS_HINT[status];
      assert.ok(hint.length > 0, `${status} hint missing`);
      assert.notEqual(hint, STOP_STATUS_LABEL[status]);
    }
  });
});

describe("Terminal state detection", () => {
  for (const status of ["DONE", "SKIPPED", "FAILED"] as const) {
    it(`treats ${status} as terminal — a driver can't change it from the phone`, () => {
      assert.equal(isTerminal(status), true);
    });
  }
  for (const status of ["PENDING", "ARRIVED", "UNLOADING"] as const) {
    it(`treats ${status} as still open`, () => {
      assert.equal(isTerminal(status), false);
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
    assert.equal(result.done, 2);
    assert.equal(result.total, 4);
    assert.equal(result.remaining, 2);
  });

  it("names the next still-open stop so the driver knows where to go", () => {
    const result = stopsProgress([
      { status: "DONE" },
      { status: "PENDING" },
      { status: "PENDING" },
    ]);
    assert.equal(result.nextIndex, 1);
  });

  it("returns a null next index when every stop is closed", () => {
    const result = stopsProgress([
      { status: "DONE" },
      { status: "DONE" },
    ]);
    assert.equal(result.nextIndex, null);
    assert.equal(result.remaining, 0);
  });

  it("still works on an empty run", () => {
    const result = stopsProgress([]);
    assert.equal(result.done, 0);
    assert.equal(result.total, 0);
    assert.equal(result.nextIndex, null);
  });
});

describe("Driver API error mapping", () => {
  it("marks 401 reads as expired so the UI picks the gentler role", () => {
    assert.equal(readError(401, "run").expired, true);
    assert.equal(readError(500, "run").expired, false);
  });

  it("names the resource for 404 on a stop", () => {
    assert.match(readError(404, "stop").title, /Stop not on this run/);
    assert.match(readError(404, "run").title, /Run unavailable/);
  });

  it("maps mutation statuses to driver copy, not generic http", () => {
    assert.match(mutationError(401, "record arrival"), /driver session expired/i);
    assert.match(mutationError(409, "complete the delivery"), /newer record/i);
    assert.match(mutationError(422, "report the problem"), /recipient/i);
    assert.match(mutationError(500, "release the vehicle"), /temporarily unavailable/i);
  });
});

describe("Problem reasons", () => {
  it("declares a non-empty fallback so the phone is never silent", () => {
    assert.ok(FALLBACK_PROBLEM_REASONS.length >= 1);
  });

  it("labels known reasons and falls back to the raw code for unknown ones", () => {
    assert.equal(labelFor("OUTLET_CLOSED"), "Outlet closed");
    assert.equal(labelFor("UNKNOWN_REASON"), "UNKNOWN_REASON");
  });
});

describe("Driver formatters", () => {
  it("shows a window as open–close when both exist", () => {
    assert.equal(formatWindow("06:00", "11:00"), "06:00–11:00");
    assert.equal(formatWindow("06:00", undefined), "From 06:00");
    assert.equal(formatWindow(undefined, "11:00"), "Until 11:00");
    assert.equal(formatWindow(undefined, undefined), "No window set");
  });

  it("renders a well-formed clock time and nothing else", () => {
    assert.equal(formatClock("04:12"), "04:12");
    assert.equal(formatClock(undefined), "—");
    assert.equal(formatClock("4:12"), "—");
    assert.equal(formatClock(""), "—");
  });

  it("recognises YYYY-MM-DD strings", () => {
    assert.equal(isIsoDate("2026-10-01"), true);
    assert.equal(isIsoDate("1/10/2026"), false);
  });
});

describe("Client-side ULIDs", () => {
  it("mints 26-character Crockford-base32 strings", () => {
    for (let round = 0; round < 10; round++) {
      const id = generateUlid();
      assert.equal(id.length, 26);
      assert.match(id, /^[0-9A-HJKMNP-TV-Z]{26}$/);
    }
  });

  it("mints distinct ids on back-to-back calls so a double-submit isn't deduped as the same event", () => {
    const first = generateUlid();
    const second = generateUlid();
    assert.notEqual(first, second);
  });
});

describe("Proof-of-delivery events", () => {
  it("records every order before the stop-level proof of delivery", () => {
    const events = buildDeliveryEvents({
      lines: [
        { orderId: "ambient", expectedUnits: 12, deliveredUnits: 12, eventId: "line-ambient" },
        { orderId: "chilled", expectedUnits: 8, deliveredUnits: 6, eventId: "line-chilled" },
      ],
      podEventId: "pod",
      occurredAt: "2026-10-01T04:10:00.000Z",
      recipientName: "Nimali Perera",
    });

    assert.deepEqual(
      events.map(({ type, orderId, deliveredUnits }) => ({ type, orderId, deliveredUnits })),
      [
        { type: "DELIVERED", orderId: "ambient", deliveredUnits: 12 },
        { type: "PART_DELIVERED", orderId: "chilled", deliveredUnits: 6 },
        { type: "POD_CAPTURED", orderId: null, deliveredUnits: null },
      ],
    );
    assert.ok(events.every((item) => item.recipientName === "Nimali Perera"));
  });
});
