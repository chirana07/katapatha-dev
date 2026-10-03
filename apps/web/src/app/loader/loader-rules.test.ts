import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { mutationError, readError } from "./api-errors";
import { formatMinutes, formatVolume, formatWeight, isIsoDate } from "./format";
import { canMarkReady, lineState, readinessDisabledReason } from "./line-state";
import {
  FALLBACK_SHORTFALL_REASONS,
  conditionNeedsReason,
  labelFor,
} from "./reasons";
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
  const base = { total: 7, checked: 7, openDiscrepancies: 0, status: "PLANNED" as const };

  it("allows release when every line is OK on a planned trip", () => {
    assert.equal(canMarkReady(base), true);
    assert.equal(readinessDisabledReason(base), "");
  });

  it("blocks release while any line is unchecked", () => {
    const ctx = { ...base, checked: 4 };
    assert.equal(canMarkReady(ctx), false);
    assert.match(readinessDisabledReason(ctx), /3 of 7 lines are still unchecked/);
  });

  it("blocks release while any discrepancy is open", () => {
    const ctx = { ...base, openDiscrepancies: 1 };
    assert.equal(canMarkReady(ctx), false);
    assert.match(readinessDisabledReason(ctx), /1 discrepancy is open/);
  });

  it("names both when both are open and uses the right plural", () => {
    const ctx = { ...base, checked: 5, openDiscrepancies: 2 };
    assert.match(readinessDisabledReason(ctx), /2 of 7 lines are still unchecked and 2 discrepancy are open/);
  });

  it("refuses when the trip has already moved past planned", () => {
    const ctx = { ...base, status: "READY" as const };
    assert.equal(canMarkReady(ctx), false);
    assert.match(readinessDisabledReason(ctx), /already ready/);
  });

  it("refuses an empty trip even if everything is 'checked'", () => {
    const ctx = { ...base, total: 0, checked: 0 };
    assert.equal(canMarkReady(ctx), false);
    assert.match(readinessDisabledReason(ctx), /No lines on this trip/);
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

describe("API error mapping", () => {
  it("marks 401 reads as expired so the UI picks the gentler role", () => {
    assert.equal(readError(401, "trips").expired, true);
    assert.equal(readError(500, "trips").expired, false);
  });

  it("names the resource for 404 on a trip", () => {
    assert.match(readError(404, "trip").title, /Trip not found/);
    assert.match(readError(404, "trips").title, /Dock board unavailable/);
  });

  it("maps mutation statuses to loader-shaped copy, not generic http", () => {
    assert.match(mutationError(401, "record load check"), /dock session expired/i);
    assert.match(mutationError(403, "record load check"), /cannot record load check/i);
    assert.match(mutationError(422, "record load check"), /quantity and reason/i);
    assert.match(mutationError(500, "mark the trip ready"), /temporarily unavailable/i);
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

  it("requires a reason for every non-OK condition", () => {
    assert.equal(conditionNeedsReason("OK"), false);
    for (const condition of ["SHORT", "DAMAGED", "MISSING"] as const) {
      assert.equal(conditionNeedsReason(condition), true);
    }
  });
});

describe("Dock formatters", () => {
  it("formats clock-free minute totals that match 212 as 3h 32m, not a date", () => {
    assert.equal(formatMinutes(212), "3h 32m");
    assert.equal(formatMinutes(45), "45m");
    assert.equal(formatMinutes(120), "2h");
  });

  it("treats missing minutes as missing — never a confident zero", () => {
    assert.equal(formatMinutes(null), "—");
    assert.equal(formatMinutes(undefined), "—");
    assert.equal(formatMinutes(-1), "—");
  });

  it("shows weight in tonnes once it crosses 1000kg so the number stays short on a tablet", () => {
    assert.equal(formatWeight(850.4), "850 kg");
    assert.equal(formatWeight(3210.5), "3.21 t");
  });

  it("shows volume in cubic metres with one decimal", () => {
    assert.equal(formatVolume(16.8), "16.8 m³");
    assert.equal(formatVolume(null), "—");
  });

  it("recognises YYYY-MM-DD strings and nothing else", () => {
    assert.equal(isIsoDate("2026-10-01"), true);
    assert.equal(isIsoDate("01-10-2026"), false);
    assert.equal(isIsoDate("2026/10/01"), false);
    assert.equal(isIsoDate(""), false);
  });
});
