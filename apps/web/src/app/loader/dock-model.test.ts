import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  attentionFor,
  attentionLabel,
  byDeparture,
  dockCounts,
  groupByStop,
  loadOrderLabel,
  nextToLoad,
  queueStatus,
  tallyLines,
  unitsPercent,
  type DockClock,
  type DockTrip,
  type LoadLine,
} from "./dock-model";

const line = (over: Partial<LoadLine>): LoadLine => ({
  orderId: "o",
  orderRef: "DEMO-001",
  outletId: "OUT010",
  seq: 0,
  expectedUnits: 40,
  loadedUnits: null,
  condition: null,
  ...over,
});

const trip = (over: Partial<DockTrip>): DockTrip => ({
  id: "t",
  vehicleId: "VEH101",
  tripNo: 1,
  brand: "Fresh",
  districtName: "Colombo",
  wave: "PREDAWN",
  status: "LOADING",
  plannedDepartAt: "07:00",
  lines: [],
  load: null,
  refrigerated: false,
  ...over,
});

describe("tallyLines", () => {
  it("counts a line as checked only when both units and condition are recorded", () => {
    const tally = tallyLines([
      line({ loadedUnits: 40, condition: "OK" }),
      line({ orderId: "b", loadedUnits: null, condition: null }),
      line({ orderId: "c", loadedUnits: 10, condition: null }),
    ]);
    assert.equal(tally.lines, 3);
    assert.equal(tally.checked, 1);
    assert.equal(tally.loadedUnits, 40);
    assert.equal(tally.expectedUnits, 120);
  });

  it("counts shortage units on flagged lines and never goes negative", () => {
    const tally = tallyLines([
      line({ loadedUnits: 44, expectedUnits: 55, condition: "SHORT" }),
      line({ orderId: "b", loadedUnits: 12, expectedUnits: 12, condition: "DAMAGED" }),
      line({ orderId: "c", loadedUnits: 0, expectedUnits: 8, condition: "MISSING" }),
    ]);
    assert.equal(tally.flagged, 3);
    assert.equal(tally.shortUnits, 11 + 0 + 8);
  });

  it("counts a stop once however many orders it carries", () => {
    const tally = tallyLines([line({ seq: 0 }), line({ orderId: "b", seq: 0 }), line({ orderId: "c", seq: 1 })]);
    assert.equal(tally.stops, 2);
  });

  it("reports 0% for an empty list rather than dividing by zero", () => {
    assert.equal(unitsPercent(tallyLines([])), 0);
    assert.equal(unitsPercent(null), 0);
    assert.equal(unitsPercent(tallyLines([line({ loadedUnits: 20, condition: "OK" })])), 50);
  });
});

describe("dockCounts", () => {
  it("treats ready, departed and completed as loaded, and leaves cancelled out entirely", () => {
    const counts = dockCounts([
      { status: "PLANNED" },
      { status: "LOADING" },
      { status: "READY" },
      { status: "DEPARTED" },
      { status: "COMPLETED" },
      { status: "CANCELLED" },
    ]);
    assert.deepEqual(counts, { total: 5, loaded: 3, loading: 1, planned: 1, loadedPercent: 60 });
  });

  it("is zero, not NaN, on an empty day", () => {
    assert.equal(dockCounts([]).loadedPercent, 0);
  });
});

describe("departure order", () => {
  it("orders across waves by departure time, then trip, then vehicle; no time goes last", () => {
    const sorted = [
      trip({ id: "none", plannedDepartAt: undefined }),
      trip({ id: "b", vehicleId: "VEH102", plannedDepartAt: "07:07" }),
      trip({ id: "a", vehicleId: "VEH101", plannedDepartAt: "07:07" }),
      trip({ id: "day", wave: "DAYTIME", plannedDepartAt: "10:25" }),
      trip({ id: "t2", tripNo: 2, vehicleId: "VEH100", plannedDepartAt: "07:07" }),
    ].sort(byDeparture);
    assert.deepEqual(sorted.map((t) => t.id), ["a", "b", "t2", "day", "none"]);
  });

  it("picks a vehicle already loading before an earlier planned one", () => {
    const next = nextToLoad([
      trip({ id: "planned", status: "PLANNED", plannedDepartAt: "06:00" }),
      trip({ id: "loading", status: "LOADING", plannedDepartAt: "08:00" }),
      trip({ id: "gone", status: "DEPARTED", plannedDepartAt: "05:00" }),
    ]);
    assert.equal(next?.id, "loading");
    assert.equal(nextToLoad([trip({ status: "READY" })]), null);
  });
});

describe("attentionFor", () => {
  const past: DockClock = { date: "2026-04-09", today: "2026-10-03", minutesNow: 6 * 60 };
  const todayAt = (hhmm: string): DockClock => {
    const [h, m] = hhmm.split(":").map(Number);
    return { date: "2026-10-03", today: "2026-10-03", minutesNow: h! * 60 + m! };
  };
  const open = { id: "sf", status: "OPEN" as const, blocksDeparture: true, resolution: null };
  const cleared = { id: "sf", status: "RESOLVED" as const, blocksDeparture: false, resolution: "SEND_SHORT" as const };
  const flagged = tallyLines([line({ loadedUnits: 44, expectedUnits: 55, condition: "SHORT", shortfall: open })]);

  it("flags a held shortage on any day, in words that say how many units and who is waited on", () => {
    const found = attentionFor(trip({ load: flagged, blocked: true }), past);
    assert.deepEqual(found, [{ kind: "shortage", flagged: 1, shortUnits: 11 }]);
    assert.equal(attentionLabel(found[0]!), "Short 11 · waiting");
  });

  it("does not flag a line the dispatcher has already cleared, even though it is still SHORT", () => {
    const done = tallyLines([line({ loadedUnits: 44, expectedUnits: 55, condition: "SHORT", shortfall: cleared })]);
    assert.equal(done.flagged, 1);
    assert.equal(done.awaiting, 0);
    assert.deepEqual(attentionFor(trip({ load: done, blocked: false }), past), []);
  });

  it("trusts the API's blocked flag over the line tally, and falls back to the tally without it", () => {
    assert.equal(attentionFor(trip({ load: flagged, blocked: false }), past).length, 0);
    assert.equal(attentionFor(trip({ load: flagged }), past).length, 1);
  });

  it("raises an out-of-range chiller reading on a refrigerated vehicle that is not yet released", () => {
    const reading = { tempC: 6, targetMinC: 2, targetMaxC: 5, inRange: false, source: "LOADER_AT_BAY" as const, recordedByName: "R", recordedAt: "2026-04-09T22:30:00.000Z", ageSeconds: 60 };
    const found = attentionFor(trip({ refrigerated: true, chiller: reading, load: tallyLines([]) }), past);
    assert.deepEqual(found, [{ kind: "chiller", tempC: 6 }]);
    assert.equal(attentionLabel(found[0]!), "Chiller 6 °C");
    assert.deepEqual(attentionFor(trip({ refrigerated: true, chiller: { ...reading, inRange: true }, load: tallyLines([]) }), past), []);
    assert.deepEqual(attentionFor(trip({ refrigerated: true, status: "DEPARTED", chiller: reading }), past), []);
    assert.deepEqual(attentionFor(trip({ refrigerated: false, chiller: reading }), past), []);
  });

  it("does not raise timing alarms for a day that is not today", () => {
    const unchecked = tallyLines([line({})]);
    assert.deepEqual(attentionFor(trip({ load: unchecked, plannedDepartAt: "05:00" }), past), []);
  });

  it("says a vehicle is past its departure time only today, and only while unreleased", () => {
    const unchecked = tallyLines([line({})]);
    assert.deepEqual(attentionFor(trip({ load: unchecked, plannedDepartAt: "07:00" }), todayAt("07:10")), [{ kind: "overdue" }]);
    assert.deepEqual(attentionFor(trip({ status: "READY", plannedDepartAt: "07:00" }), todayAt("07:10")), []);
  });

  it("warns that departure is near only when lines are still unchecked", () => {
    const unchecked = tallyLines([line({}), line({ orderId: "b", loadedUnits: 40, condition: "OK" })]);
    const done = tallyLines([line({ loadedUnits: 40, condition: "OK" })]);
    assert.deepEqual(attentionFor(trip({ load: unchecked, plannedDepartAt: "07:20" }), todayAt("07:00")), [
      { kind: "departing-soon", minutes: 20, unchecked: 1 },
    ]);
    assert.deepEqual(attentionFor(trip({ load: done, plannedDepartAt: "07:20" }), todayAt("07:00")), []);
    assert.deepEqual(attentionFor(trip({ load: unchecked, plannedDepartAt: "09:00" }), todayAt("07:00")), []);
  });

  it("leads the queue pill with a held shortage, otherwise with the trip's own status", () => {
    const withShortage = trip({ load: flagged, blocked: true });
    assert.deepEqual(queueStatus(withShortage, attentionFor(withShortage, past)), { label: "Short 11 · waiting", tone: "bad" });
    const quiet = trip({ status: "READY", load: tallyLines([]) });
    assert.deepEqual(queueStatus(quiet, []), { label: "Ready", tone: "good" });
  });
});

describe("groupByStop", () => {
  it("keeps the API's reverse delivery order: the first group is the last stop and loads first", () => {
    const groups = groupByStop([
      line({ orderId: "a", seq: 2, outletId: "OUT075" }),
      line({ orderId: "b", seq: 1, outletId: "OUT074" }),
      line({ orderId: "c", seq: 1, outletId: "OUT074" }),
      line({ orderId: "d", seq: 0, outletId: "OUT073" }),
    ]);
    assert.deepEqual(groups.map((g) => [g.outletId, g.loadOrder, g.lines.length]), [
      ["OUT075", 1, 1],
      ["OUT074", 2, 2],
      ["OUT073", 3, 1],
    ]);
  });

  it("marks a stop done, partial or untouched from its checks", () => {
    const [done, partial, untouched] = groupByStop([
      line({ orderId: "a", seq: 2, loadedUnits: 40, condition: "OK" }),
      line({ orderId: "b", seq: 1, loadedUnits: 40, condition: "OK" }),
      line({ orderId: "c", seq: 1 }),
      line({ orderId: "d", seq: 0 }),
    ]);
    assert.equal(done!.state, "done");
    assert.equal(partial!.state, "partial");
    assert.equal(untouched!.state, "untouched");
  });

  it("words the loading order in plain language", () => {
    assert.equal(loadOrderLabel(1, 3), "Load first");
    assert.equal(loadOrderLabel(2, 3), "Load second");
    assert.equal(loadOrderLabel(3, 3), "Load last");
    assert.equal(loadOrderLabel(1, 1), "Only stop");
  });
});
