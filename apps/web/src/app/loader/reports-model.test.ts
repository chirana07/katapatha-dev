import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { tallyLines, type DockTrip, type LoadLine } from "./dock-model";
import { buildReport, resultFor } from "./reports-model";

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

const trip = (over: Partial<DockTrip> & { lines?: LoadLine[] }): DockTrip => {
  const lines = over.lines ?? [];
  return {
    id: "t",
    vehicleId: "VEH101",
    tripNo: 1,
    brand: "Fresh",
    districtName: "Colombo",
    wave: "PREDAWN",
    status: "LOADING",
    plannedDepartAt: "07:00",
    refrigerated: false,
    load: tallyLines(lines),
    ...over,
    lines,
  };
};

describe("buildReport", () => {
  it("counts released vehicles, checked orders and loaded units across the day, leaving cancelled trips out", () => {
    const report = buildReport([
      trip({ id: "a", status: "DEPARTED", lines: [line({ loadedUnits: 40, condition: "OK" })] }),
      trip({ id: "b", status: "LOADING", lines: [line({ loadedUnits: 20, condition: "OK" }), line({ orderId: "x" })] }),
      trip({ id: "c", status: "CANCELLED", lines: [line({})] }),
    ]);
    assert.deepEqual(report.vehicles, { total: 2, released: 1 });
    assert.deepEqual(report.lines, { total: 3, checked: 2 });
    assert.deepEqual(report.units, { expected: 120, loaded: 60, percent: 50 });
  });

  it("lists each reported order once with how far short it was, and totals the units", () => {
    const report = buildReport([
      trip({
        id: "a",
        lines: [
          line({ orderRef: "DEMO-007", loadedUnits: 44, expectedUnits: 55, condition: "SHORT" }),
          line({ orderId: "b", orderRef: "DEMO-011", loadedUnits: 80, expectedUnits: 80, condition: "OK" }),
          line({ orderId: "c", orderRef: "DEMO-012", loadedUnits: 0, expectedUnits: 8, condition: "MISSING" }),
        ],
      }),
    ]);
    assert.deepEqual(report.shortages.map((s) => [s.orderRef, s.shortBy]), [["DEMO-007", 11], ["DEMO-012", 8]]);
    assert.equal(report.shortageUnits, 19);
  });

  it("says for each reported order whether the dispatcher is still deciding or what they decided", () => {
    const report = buildReport([
      trip({
        lines: [
          line({ orderRef: "A", loadedUnits: 44, expectedUnits: 55, condition: "SHORT", shortfall: { id: "1", status: "OPEN", blocksDeparture: true, resolution: null } }),
          line({ orderId: "b", orderRef: "B", loadedUnits: 30, expectedUnits: 40, condition: "SHORT", shortfall: { id: "2", status: "RESOLVED", blocksDeparture: false, resolution: "SEND_SHORT" } }),
        ],
      }),
    ]);
    assert.deepEqual(report.shortages.map((s) => s.outcome), ["Waiting on the dispatcher", "Sent short — dispatcher approved"]);
    assert.equal(report.waiting, 1);
  });

  it("is all zeros, not NaN, for a day with no trips", () => {
    const report = buildReport([]);
    assert.deepEqual(report.vehicles, { total: 0, released: 0 });
    assert.equal(report.units.percent, 0);
  });
});

describe("resultFor", () => {
  it("says a released trip with nothing reported was loaded in full", () => {
    assert.deepEqual(resultFor(trip({ status: "DEPARTED", lines: [line({ loadedUnits: 40, condition: "OK" })] })), {
      label: "Loaded in full",
      tone: "good",
    });
  });

  it("does not say 'loaded in full' for a released trip that has no checks on record", () => {
    assert.equal(resultFor(trip({ status: "DEPARTED", lines: [line({})] })).label, "Released · no checks recorded");
    assert.equal(
      resultFor(trip({ status: "DEPARTED", lines: [line({ loadedUnits: 40, condition: "OK" }), line({ orderId: "b" })] })).label,
      "Released · 1 of 2 checked",
    );
  });

  it("says a released trip with a short line left short, by how many", () => {
    const result = resultFor(trip({ status: "READY", lines: [line({ loadedUnits: 44, expectedUnits: 55, condition: "SHORT" })] }));
    assert.equal(result.label, "Released 11 short");
    assert.equal(result.tone, "warn");
  });

  it("reports progress for a trip still being loaded, and 'not started' before the first check", () => {
    assert.equal(resultFor(trip({ lines: [line({ loadedUnits: 40, condition: "OK" }), line({ orderId: "b" })] })).label, "Loading · 1 of 2 checked");
    assert.equal(resultFor(trip({ status: "PLANNED", lines: [line({})] })).label, "Not started");
  });

  it("does not guess when the load list could not be read", () => {
    assert.equal(resultFor(trip({ load: null })).label, "Load list unavailable");
  });
});
