import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { formatVolume, formatWeight } from "./format";
import { canMarkReady, lineState, readinessDisabledReason, resolutionLabel, shortfallState } from "./line-state";
import { FALLBACK_SHORTFALL_REASONS, labelFor } from "./reasons";
import type { Trip } from "./wave";
import { groupByWave, WAVE_ORDER } from "./wave";

describe("Line state classification", () => {
  it("marks an unchecked line as unchecked", () => {
    assert.equal(lineState({}), "unchecked");
    assert.equal(lineState({ condition: null }), "unchecked");
  });

  it("marks an OK line as ok", () => {
    assert.equal(lineState({ loadedUnits: 120, condition: "OK" }), "ok");
  });

  for (const condition of ["SHORT", "DAMAGED"] as const) {
    it(`marks ${condition} as a discrepancy, not blocked`, () => {
      assert.equal(lineState({ loadedUnits: 90, condition }), "discrepancy");
    });
  }

  it("marks MISSING as blocked so it stops ignoring the signal", () => {
    assert.equal(lineState({ loadedUnits: 0, condition: "MISSING" }), "blocked");
  });
});

describe("Readiness gate", () => {
  const base = { total: 7, checked: 7, flagged: 0, blocked: false, status: "PLANNED" as const };

  it("allows release when every line is checked on a planned trip", () => {
    assert.equal(canMarkReady(base), true);
    assert.equal(readinessDisabledReason(base), "");
  });

  it("allows release on a LOADING trip — the first check moves PLANNED to LOADING, so gating on PLANNED alone never opened", () => {
    assert.equal(canMarkReady({ ...base, status: "LOADING" }), true);
  });

  it("blocks release while any line is unchecked", () => {
    const ctx = { ...base, checked: 4 };
    assert.equal(canMarkReady(ctx), false);
    assert.match(readinessDisabledReason(ctx), /3 of 7 lines are still unchecked/);
  });

  it("does not gate on reported lines: the dispatcher's decision is the server's to enforce, and a line sent short stays SHORT", () => {
    const ctx = { ...base, flagged: 2 };
    assert.equal(canMarkReady(ctx), true);
    assert.equal(readinessDisabledReason(ctx), "");
  });

  it("holds the release while an open shortfall blocks the trip, and says whose decision it is", () => {
    const ctx = { ...base, flagged: 1, blocked: true };
    assert.equal(canMarkReady(ctx), false);
    assert.match(readinessDisabledReason(ctx), /Waiting on the dispatcher/);
  });

  it("releases a trip whose reported line the dispatcher has cleared: flagged stays 1, blocked is false", () => {
    const ctx = { ...base, flagged: 1, blocked: false };
    assert.equal(canMarkReady(ctx), true);
    assert.equal(readinessDisabledReason(ctx), "");
  });

  it("names unchecked lines before the dispatcher, since the loader can fix those", () => {
    assert.match(readinessDisabledReason({ ...base, checked: 5, blocked: true }), /2 of 7 lines are still unchecked/);
  });

  it("refuses when the trip has already been released", () => {
    for (const status of ["READY", "DEPARTED", "COMPLETED"] as const) {
      const ctx = { ...base, status };
      assert.equal(canMarkReady(ctx), false);
      assert.match(readinessDisabledReason(ctx), /already/);
    }
  });

  it("refuses an empty trip even if everything is 'checked'", () => {
    const ctx = { ...base, total: 0, checked: 0 };
    assert.equal(canMarkReady(ctx), false);
    assert.match(readinessDisabledReason(ctx), /No lines on this trip/);
  });
});

describe("Shortfall state of a line", () => {
  const sf = (status: "OPEN" | "RESOLVED", resolution: string | null = null) => ({ status, resolution });

  it("is none for a line that is unchecked or loaded correctly", () => {
    assert.equal(shortfallState({}), "none");
    assert.equal(shortfallState({ condition: "OK", loadedUnits: 5, shortfall: null }), "none");
  });

  it("is waiting while the shortfall is open and cleared once decided, whatever the condition still says", () => {
    assert.equal(shortfallState({ condition: "SHORT", shortfall: sf("OPEN") }), "waiting");
    assert.equal(shortfallState({ condition: "SHORT", shortfall: sf("RESOLVED", "SEND_SHORT") }), "cleared");
  });

  it("does not guess when a non-OK line arrives with no shortfall", () => {
    assert.equal(shortfallState({ condition: "DAMAGED", shortfall: null }), "reported");
  });

  it("puts each resolution in the dispatcher's words", () => {
    assert.equal(resolutionLabel("SEND_SHORT"), "Sent short — dispatcher approved");
    assert.match(resolutionLabel("HOLD_ORDER"), /held/);
    assert.match(resolutionLabel("MOVE_TO_TRIP_2"), /trip 2/);
    assert.match(resolutionLabel("CANCEL_LINE"), /cancelled/);
    assert.equal(resolutionLabel(null), "Cleared by the dispatcher");
  });
});

describe("Dock board wave grouping", () => {
  const trip = (overrides: Partial<Trip>): Trip => ({
    id: "t",
    vehicleId: "VEH001",
    tripNo: 1,
    brand: "Fresh",
    districtName: "Colombo",
    wave: "PREDAWN",
    status: "PLANNED",
    ...overrides,
  });

  it("drops empty waves from the output", () => {
    const groups = groupByWave([trip({ id: "a" })]);
    assert.equal(groups.length, 1);
    assert.equal(groups[0]!.wave, "PREDAWN");
    assert.equal(groups[0]!.trips.length, 1);
  });

  it("preserves wave order (predawn before daytime)", () => {
    const groups = groupByWave([
      trip({ id: "day", wave: "DAYTIME", plannedDepartAt: "08:30" }),
      trip({ id: "early", wave: "PREDAWN", plannedDepartAt: "03:30" }),
    ]);
    assert.deepEqual(groups.map((g) => g.wave), WAVE_ORDER);
  });

  it("sorts a wave by departure time, then trip number, then vehicle", () => {
    const groups = groupByWave([
      trip({ id: "late", vehicleId: "VEH002", tripNo: 2, plannedDepartAt: "04:00" }),
      trip({ id: "early", vehicleId: "VEH001", tripNo: 1, plannedDepartAt: "03:30" }),
      trip({ id: "same-time-later", vehicleId: "VEH003", tripNo: 1, plannedDepartAt: "03:30" }),
    ]);
    assert.deepEqual(groups[0]!.trips.map((t) => t.id), ["early", "same-time-later", "late"]);
  });

  it("still sorts when departure time is missing — a planning gap is not an ordering gap", () => {
    const groups = groupByWave([
      trip({ id: "no-time", vehicleId: "VEH002", plannedDepartAt: undefined }),
      trip({ id: "has-time", vehicleId: "VEH001", plannedDepartAt: "03:30" }),
    ]);
    assert.deepEqual(groups[0]!.trips.map((t) => t.id), ["has-time", "no-time"]);
  });
});

describe("Reason vocabulary", () => {
  it("declares a non-empty fallback so the dock is never silent when reference is down", () => {
    assert.ok(FALLBACK_SHORTFALL_REASONS.length >= 1);
  });

  it("labels known reasons and falls back to the raw code for unknown ones", () => {
    assert.equal(labelFor("SHORT_QUANTITY"), "Short quantity");
    assert.equal(labelFor("CUSTOM_REASON"), "CUSTOM_REASON");
  });
});

describe("Dock formatters", () => {
  it("shows weight in tonnes once it crosses 1000kg so the number stays short on a tablet", () => {
    assert.equal(formatWeight(850.4), "850 kg");
    assert.equal(formatWeight(3210.5), "3.21 t");
    assert.equal(formatWeight(null), "—");
  });

  it("shows volume in cubic metres with one decimal", () => {
    assert.equal(formatVolume(16.8), "16.8 m³");
    assert.equal(formatVolume(null), "—");
  });
});
