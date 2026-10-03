import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CONTRACT_AJV } from "../lib/ajv.js";
import { AuthError, type SessionUser } from "../lib/auth.js";
import errorsPlugin from "../plugins/errors.js";
import capacityActionRoutes from "../routes/capacityActions.js";
import * as capacity from "../services/capacity.js";
import {
  CapacityActionConflict,
  assemblePlan,
  availableDecisions,
  backtestFor,
  decideAction,
  deriveProposals,
  describeAction,
  ensureProposals,
  summarise,
  type ActionRow,
  type CapacityData,
  type ProposalContext,
  type WeekPlan,
} from "../services/capacity.js";
import { recordDecision } from "../lib/audit.js";
import { addWeeks, weekKeyStr, type CalendarSignalDay } from "../services/forecast.js";

/**
 * Capacity: the weeks, the proposals derived from them, and the decisions.
 *
 * The database is replaced by a small in-memory fake that implements just the
 * queries the service makes, so these tests exercise the real state machine
 * and the real APPLY effects rather than checking that a mock returned what it
 * was told.
 */

// --- An in-memory stand-in for the tables the service touches -----------------------------

interface Tables {
  actions: ActionRow[];
  workshop: { vehicleId: string; date: Date; status: "AVAILABLE" | "IN_WORKSHOP"; note: string | null }[];
  published: Date[];
  ledgers: { vehicleId: string; isoYear: number; isoWeek: number; quotaL: number }[];
  vehicles: { id: string; depotCode: string }[];
}
let t: Tables;
let seq = 0;
const calls: string[] = [];

const matchesWeek = (r: { isoYear: number; isoWeek: number }, or: { isoYear: number; isoWeek: number }[] | undefined) =>
  !or || or.some((w) => w.isoYear === r.isoYear && w.isoWeek === r.isoWeek);

vi.mock("../lib/db.js", () => {
  const prisma = {
    $transaction: vi.fn(async (cb: (tx: unknown) => unknown) => {
      calls.push("tx:start");
      const out = await cb(prisma);
      calls.push("tx:commit");
      return out;
    }),
    $queryRaw: vi.fn(async () => []),
    capacityAction: {
      findMany: vi.fn(async ({ where }: { where: { depotCode: string; OR?: { isoYear: number; isoWeek: number }[] } }) =>
        t.actions.filter((a) => a.depotCode === where.depotCode && matchesWeek(a, where.OR)),
      ),
      // Copies, as a real client returns: a later write must not rewrite what was read.
      findFirst: vi.fn(async ({ where }: { where: { id: string; depotCode: string } }) => {
        const row = t.actions.find((a) => a.id === where.id && a.depotCode === where.depotCode);
        return row ? { ...row } : null;
      }),
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
        const row = t.actions.find((a) => a.id === where.id);
        return row ? { ...row } : null;
      }),
      createMany: vi.fn(async ({ data }: { data: Record<string, unknown>[] }) => {
        for (const d of data) {
          t.actions.push({
            id: `CA${++seq}`,
            status: "PROPOSED",
            decidedByUserId: null,
            decidedAt: null,
            reasonCode: null,
            note: null,
            createdAt: new Date("2026-04-01T00:00:00Z"),
            ...d,
          } as ActionRow);
        }
        return { count: data.length };
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<ActionRow> }) => {
        const row = t.actions.find((a) => a.id === where.id)!;
        Object.assign(row, data);
        return row;
      }),
      updateMany: vi.fn(async ({ where, data }: { where: { id: string; depotCode: string; status: { in: string[] } }; data: Partial<ActionRow> }) => {
        const row = t.actions.find((a) => a.id === where.id && a.depotCode === where.depotCode && where.status.in.includes(a.status));
        if (!row) return { count: 0 };
        Object.assign(row, data);
        return { count: 1 };
      }),
    },
    vehicleDayStatus: {
      findMany: vi.fn(async ({ where }: { where: { vehicleId: { in: string[] }; status: string; date: { in: Date[] } } }) =>
        t.workshop
          .filter((w) => where.vehicleId.in.includes(w.vehicleId) && w.status === where.status && where.date.in.some((d) => d.getTime() === w.date.getTime()))
          .sort((a, b) => a.date.getTime() - b.date.getTime()),
      ),
      updateMany: vi.fn(async ({ where, data }: { where: { vehicleId: { in: string[] }; status: string; date: { in: Date[] } }; data: { status: "AVAILABLE"; note: string } }) => {
        let count = 0;
        for (const w of t.workshop) {
          if (where.vehicleId.in.includes(w.vehicleId) && w.status === where.status && where.date.in.some((d) => d.getTime() === w.date.getTime())) {
            w.status = data.status;
            w.note = data.note;
            count++;
          }
        }
        return { count };
      }),
    },
    planningDay: {
      findMany: vi.fn(async ({ where }: { where: { date: { in: Date[] } } }) =>
        t.published.filter((d) => where.date.in.some((x) => x.getTime() === d.getTime())).map((date) => ({ date })),
      ),
    },
    vehicle: {
      findMany: vi.fn(async ({ where }: { where: { depotCode: string; id: { in: string[] } } }) =>
        t.vehicles.filter((v) => v.depotCode === where.depotCode && where.id.in.includes(v.id)).map((v) => ({ id: v.id })),
      ),
    },
    fuelLedger: {
      findUnique: vi.fn(async ({ where }: { where: { vehicleId_isoYear_isoWeek: { vehicleId: string; isoYear: number; isoWeek: number } } }) => {
        const k = where.vehicleId_isoYear_isoWeek;
        const row = t.ledgers.find((l) => l.vehicleId === k.vehicleId && l.isoYear === k.isoYear && l.isoWeek === k.isoWeek);
        return row ? { ...row } : null;
      }),
      upsert: vi.fn(async ({ where, create, update }: { where: { vehicleId_isoYear_isoWeek: { vehicleId: string; isoYear: number; isoWeek: number } }; create: Tables["ledgers"][number]; update: { quotaL: number } }) => {
        const k = where.vehicleId_isoYear_isoWeek;
        const row = t.ledgers.find((l) => l.vehicleId === k.vehicleId && l.isoYear === k.isoYear && l.isoWeek === k.isoWeek);
        if (row) row.quotaL = update.quotaL;
        else t.ledgers.push(create);
        return row ?? create;
      }),
    },
    user: { findMany: vi.fn(async () => [{ id: "U1", name: "Nimal Perera" }]) },
  };
  return { prisma };
});

vi.mock("../lib/audit.js", () => ({
  recordDecision: vi.fn(async () => {
    calls.push("audit");
  }),
}));

const dispatcher: SessionUser = {
  id: "U1", email: "n@w", name: "Nimal Perera", role: "DISPATCHER", depotCode: "Peliyagoda", outletId: null, defaultVehicleId: null,
};

const d = (s: string) => new Date(`${s}T00:00:00.000Z`);

function action(over: Partial<ActionRow> = {}): ActionRow {
  return {
    id: "CA0",
    isoYear: 2026,
    isoWeek: 16,
    depotCode: "Peliyagoda",
    brand: null,
    kind: "HIRE_RELIEF_VEHICLE",
    params: { count: 1 },
    expectedRelief: { tripsPerDay: 2 },
    status: "PROPOSED",
    decidedByUserId: null,
    decidedAt: null,
    reasonCode: null,
    note: null,
    appliesFromDate: d("2026-04-13"),
    createdAt: new Date("2026-04-01T00:00:00Z"),
    ...over,
  };
}

beforeEach(() => {
  t = { actions: [], workshop: [], published: [], ledgers: [], vehicles: [{ id: "VEH101", depotCode: "Peliyagoda" }, { id: "VEH103", depotCode: "Peliyagoda" }, { id: "VEH201", depotCode: "Kandy" }] };
  seq = 0;
  calls.length = 0;
  vi.mocked(recordDecision).mockClear();
});

// --- The weeks --------------------------------------------------------------------------------

const calendarFor = (start: string, weeks: number, over: (date: string) => Partial<CalendarSignalDay> = () => ({})): CalendarSignalDay[] => {
  const out: CalendarSignalDay[] = [];
  for (let i = 0; i < weeks * 7; i++) {
    const date = new Date(d(start).getTime() + i * 86_400_000).toISOString().slice(0, 10);
    const dow = (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7;
    const wk = (() => {
      const th = new Date(`${date}T00:00:00Z`).getTime() - dow * 86_400_000 + 3 * 86_400_000;
      const y = new Date(th).getUTCFullYear();
      const jan4 = Date.UTC(y, 0, 4);
      const w1 = jan4 - ((new Date(jan4).getUTCDay() + 6) % 7) * 86_400_000;
      return { isoYear: y, isoWeek: 1 + Math.round((th - 3 * 86_400_000 - w1) / (7 * 86_400_000)) };
    })();
    out.push({ date, ...wk, isOperating: dow !== 6, isPayday: false, isHoliday: false, festival: null, festivalRamp: 0, monsoon: false, ...over(date) });
  }
  return out;
};

function data(over: Partial<CapacityData> = {}): CapacityData {
  const reefers = [
    { id: "VEH101", temp: "reefer" as const, volumeCapM3: 30 },
    { id: "VEH103", temp: "reefer" as const, volumeCapM3: 10 },
  ];
  const w14 = { isoYear: 2026, isoWeek: 14 };
  const row = (wk: { isoYear: number; isoWeek: number }, total: number, chilled: number) => ({ ...wk, depotCode: "Peliyagoda", brand: "Fresh" as const, totalM3: total, chilledM3: chilled });
  return {
    depotCode: "Peliyagoda",
    vehicles: [...reefers, { id: "VEH102", temp: "ambient", volumeCapM3: 34 }],
    history: [row(addWeeks(w14, -2), 300, 100), row(addWeeks(w14, -1), 310, 110)],
    forecasts: [
      { ...row(w14, 300, 90), method: "m", generatedAt: new Date("2026-04-01T00:00:00Z") },
      { ...row(addWeeks(w14, 1), 330, 125), method: "m", generatedAt: new Date("2026-04-01T00:00:00Z") },
    ],
    calendar: calendarFor("2026-03-09", 5),
    workshop: [],
    ...over,
  };
}

describe("assemblePlan", () => {
  it("shows weeks with history as actual and the rest as the stored forecast, and omits a week with neither", () => {
    const weeks = [addWeeks({ isoYear: 2026, isoWeek: 14 }, -1), { isoYear: 2026, isoWeek: 14 }, { isoYear: 2026, isoWeek: 15 }, { isoYear: 2026, isoWeek: 30 }];
    const plan = assemblePlan(data(), weeks, null);
    expect(plan.map((w) => [weekKeyStr(w), w.kind])).toEqual([
      ["2026-W13", "actual"],
      ["2026-W14", "forecast"],
      ["2026-W15", "forecast"],
    ]);
    expect(plan[1].method).toBe("m");
    expect(plan[0].method).toBeNull();
  });

  it("works out reefer trips from chilled volume and the depot's own reefer capacities", () => {
    // Two reefers (30 + 10 m3): 5 m3 a trip. W15 chilled 125 m3 over 6 days = 20.8/day -> 5 trips against 4.
    const [, w15] = assemblePlan(data(), [{ isoYear: 2026, isoWeek: 14 }, { isoYear: 2026, isoWeek: 15 }], null);
    expect(w15.assessment).toMatchObject({ tripsNeededPerDay: 5, tripsCapacityPerDay: 4, shortfallTripsPerDay: 1, level: "over" });
    expect(w15.label).toBe("+1 hired reefer");
  });

  it("counts a reefer in the workshop out for the week, and ignores an ambient one", () => {
    const wk = { isoYear: 2026, isoWeek: 15 };
    const withWorkshop = data({
      workshop: [
        { vehicleId: "VEH103", date: "2026-04-08" },
        { vehicleId: "VEH103", date: "2026-04-09" },
        { vehicleId: "VEH102", date: "2026-04-09" }, // ambient: not a reefer, not counted
        { vehicleId: "VEH101", date: "2026-05-20" }, // another week
      ],
    });
    const [w] = assemblePlan(withWorkshop, [wk], null);
    expect(w.workshopReeferIds).toEqual(["VEH103"]);
    expect(w.workshopDates.VEH103).toEqual(["2026-04-08", "2026-04-09"]);
    expect(w.assessment.reefersInWorkshop).toBe(1);
    expect(w.assessment.tripsCapacityPerDay).toBe(2);
  });

  it("filters demand by brand but leaves the depot's reefers alone", () => {
    const base = data();
    base.forecasts.push({ isoYear: 2026, isoWeek: 14, depotCode: "Peliyagoda", brand: "Style", totalM3: 50, chilledM3: 0, method: "m", generatedAt: new Date() });
    const [all] = assemblePlan(base, [{ isoYear: 2026, isoWeek: 14 }], null);
    const [style] = assemblePlan(base, [{ isoYear: 2026, isoWeek: 14 }], "Style");
    expect(all.totalM3).toBe(350);
    expect(style.totalM3).toBe(50);
    expect(style.chilledM3).toBe(0);
    expect(style.assessment.tripsCapacityPerDay).toBe(all.assessment.tripsCapacityPerDay);
  });
});

describe("summarise", () => {
  it("finds the peak, the chilled peak and the shortfall weeks among forecast weeks only", () => {
    const weeks = [{ isoYear: 2026, isoWeek: 13 }, { isoYear: 2026, isoWeek: 14 }, { isoYear: 2026, isoWeek: 15 }];
    const plan = assemblePlan(data(), weeks, null);
    const s = summarise(plan, data(), null);
    expect(s.peakWeek).toMatchObject({ isoWeek: 15, totalM3: 330 });
    expect(s.chilledPeak).toMatchObject({ isoWeek: 15, chilledM3: 125 });
    expect(s.reeferShortfallWeeks).toEqual({ count: 1, of: 2, maxTripsPerDayShort: 1 });
    // Mean of the last four known weeks (two here): (300+310)/2 = 305 -> 330 is +8%.
    expect(s.peakWeek?.vsRecentPct).toBe(8);
  });

  it("has no peak and a zero count when there is no forecast", () => {
    const s = summarise([], data({ forecasts: [] }), null);
    expect(s.peakWeek).toBeNull();
    expect(s.reeferShortfallWeeks).toEqual({ count: 0, of: 0, maxTripsPerDayShort: 0 });
  });
});

describe("backtestFor", () => {
  it("tests at the real gap between the newest known week and the first forecast week", () => {
    const history = Array.from({ length: 20 }, (_, i) => ({
      ...addWeeks({ isoYear: 2025, isoWeek: 40 }, i),
      depotCode: "Peliyagoda",
      brand: "Fresh" as const,
      totalM3: 100,
      chilledM3: 30,
    }));
    const bt = backtestFor(data({ history, forecasts: [{ ...addWeeks({ isoYear: 2025, isoWeek: 40 }, 25), depotCode: "Peliyagoda", brand: "Fresh", totalM3: 1, chilledM3: 1, method: "m", generatedAt: new Date() }] }), null);
    // Newest known is index 19, first forecast index 25: six weeks ahead.
    expect(bt.leadWeeks).toBe(6);
    expect(bt.mapeTotalPct).toBe(0);
  });
});

// --- The proposals ------------------------------------------------------------------------------------

const ctx: ProposalContext = { depotCode: "Peliyagoda", weekdays: { heaviest: "Thursday", lightest: "Tuesday" }, fuelBinds: new Map() };

function plan(over: Partial<CapacityData>, weeks = [{ isoYear: 2026, isoWeek: 14 }, { isoYear: 2026, isoWeek: 15 }]): WeekPlan[] {
  return assemblePlan(data(over), weeks, null);
}

describe("deriveProposals", () => {
  it("proposes nothing for covered weeks and nothing for actual weeks", () => {
    const covered = plan({ forecasts: data().forecasts.map((f) => ({ ...f, chilledM3: 40 })) });
    expect(deriveProposals(covered, ctx)).toEqual([]);
    const actual = assemblePlan(data(), [{ isoYear: 2026, isoWeek: 13 }], null);
    expect(deriveProposals(actual, ctx)).toEqual([]);
  });

  it("proposes hiring and pre-building for a small shortfall, and no day shift", () => {
    const drafts = deriveProposals(plan({}), ctx);
    expect(drafts.map((x) => x.kind)).toEqual(["HIRE_RELIEF_VEHICLE", "PRE_BUILD_ORDERS"]);
    const hire = drafts[0];
    expect(hire).toMatchObject({ isoWeek: 15, brand: null, params: { count: 1, vehicleTemp: "reefer", shortfallTripsPerDay: 1 }, expectedRelief: { tripsPerDay: 2, estimate: false } });
    const prebuild = drafts[1];
    expect(prebuild).toMatchObject({ brand: "Fresh", expectedRelief: { tripsPerDay: 1, estimate: true } });
  });

  it("recalls a workshop reefer first, hires only for what remains, and moves the day for a big gap", () => {
    const wk = { isoYear: 2026, isoWeek: 15 };
    const drafts = deriveProposals(
      assemblePlan(data({ workshop: [{ vehicleId: "VEH103", date: "2026-04-08" }, { vehicleId: "VEH103", date: "2026-04-09" }] }), [wk], null),
      ctx,
    );
    // Chilled 125/6/5 = 5 trips against one available reefer's 2: short 3 -> 2 reefers; recall 1, hire 1.
    const kinds = drafts.map((x) => x.kind);
    expect(kinds).toEqual(["RECALL_FROM_WORKSHOP", "HIRE_RELIEF_VEHICLE", "PRE_BUILD_ORDERS", "SHIFT_BRAND_DAY"]);
    expect(drafts[0].params).toMatchObject({ vehicleIds: ["VEH103"], dates: ["2026-04-08", "2026-04-09"], count: 1 });
    expect(drafts[1].params).toMatchObject({ count: 1 });
    expect(drafts[3].params).toMatchObject({ fromDay: "Thursday", toDay: "Tuesday" });
  });

  it("proposes a fuel quota raise only where the ledger says the quota binds", () => {
    const fuelBinds = new Map([["2026-W14", [{ vehicleId: "VEH101", quotaL: 420, usedL: 400 }]]]);
    const drafts = deriveProposals(plan({ forecasts: data().forecasts.map((f) => ({ ...f, chilledM3: 40 })) }), { ...ctx, fuelBinds });
    expect(drafts).toHaveLength(1);
    expect(drafts[0]).toMatchObject({
      kind: "RAISE_FUEL_QUOTA",
      isoWeek: 14,
      params: { vehicles: [{ vehicleId: "VEH101", quotaL: 420, usedL: 400, proposedQuotaL: 440 }] },
      expectedRelief: { litres: 20 },
    });
  });

  it("is a pure function of the plan: same input, same proposals", () => {
    expect(deriveProposals(plan({}), ctx)).toEqual(deriveProposals(plan({}), ctx));
  });
});

describe("ensureProposals", () => {
  const weeks = [{ isoYear: 2026, isoWeek: 15 }];
  const drafts = () => deriveProposals(plan({}), ctx);

  it("persists each proposal once however often the week is read", async () => {
    const first = await ensureProposals("Peliyagoda", weeks, drafts());
    const second = await ensureProposals("Peliyagoda", weeks, drafts());
    expect(first.rows).toHaveLength(2);
    expect(second.rows).toHaveLength(2);
    expect(t.actions).toHaveLength(2);
    expect(second.rows.map((r) => r.id)).toEqual(first.rows.map((r) => r.id));
    expect(t.actions.every((a) => a.status === "PROPOSED" && a.appliesFromDate?.toISOString().startsWith("2026-04-06"))).toBe(true);
  });

  it("refreshes an open proposal when the week's numbers move, and leaves a decided one alone", async () => {
    await ensureProposals("Peliyagoda", weeks, drafts());
    const hire = t.actions.find((a) => a.kind === "HIRE_RELIEF_VEHICLE")!;
    const pre = t.actions.find((a) => a.kind === "PRE_BUILD_ORDERS")!;
    hire.params = { count: 5 }; // stale
    pre.params = { stale: true };
    pre.status = "APPROVED";
    await ensureProposals("Peliyagoda", weeks, drafts());
    expect(hire.params).toMatchObject({ count: 1 });
    expect(pre.params).toEqual({ stale: true });
  });

  it("flags an open proposal the forecast no longer calls for as stale, never as decided", async () => {
    await ensureProposals("Peliyagoda", weeks, drafts());
    const { rows, currentKeys } = await ensureProposals("Peliyagoda", weeks, []);
    expect(rows).toHaveLength(2); // still on record
    const items = await capacity.toActionItems(rows, currentKeys);
    expect(items.every((i) => i.stale && i.status === "PROPOSED")).toBe(true);
    const decided = await capacity.toActionItems([{ ...rows[0], status: "APPROVED" }], currentKeys);
    expect(decided[0].stale).toBe(false);
  });

  it("takes a per-depot advisory lock before looking for what exists", async () => {
    const { prisma } = await import("../lib/db.js");
    await ensureProposals("Peliyagoda", weeks, drafts());
    expect(prisma.$queryRaw).toHaveBeenCalled();
  });
});

// --- Decisions -------------------------------------------------------------------------------------------------

describe("decideAction: the state machine", () => {
  it("walks PROPOSED -> APPROVED -> APPLIED, recording who and when, and audits each step after commit", async () => {
    t.actions.push(action());
    const approved = await decideAction(dispatcher, "CA0", "APPROVE", { note: "ok" });
    expect(approved.row).toMatchObject({ status: "APPROVED", decidedByUserId: "U1", note: "ok" });
    expect(approved.row.decidedAt).toBeInstanceOf(Date);
    expect(approved.consequences.join(" ")).toMatch(/Nothing has changed yet/);

    const applied = await decideAction(dispatcher, "CA0", "APPLY", {});
    expect(applied.row.status).toBe("APPLIED");
    expect(availableDecisions("APPLIED")).toEqual([]);

    expect(recordDecision).toHaveBeenCalledTimes(2);
    expect(vi.mocked(recordDecision).mock.calls[1][0]).toMatchObject({
      action: "capacityAction.apply",
      entityType: "CapacityAction",
      entityId: "CA0",
      before: { status: "APPROVED" },
      after: { status: "APPLIED" },
    });
    // The audit row is written after its transaction committed, not inside it.
    expect(calls).toEqual(["tx:start", "tx:commit", "audit", "tx:start", "tx:commit", "audit"]);
  });

  it("rejects from PROPOSED or APPROVED, with the reason code kept on the row", async () => {
    t.actions.push(action({ id: "A" }), action({ id: "B", status: "APPROVED" }));
    expect((await decideAction(dispatcher, "A", "REJECT", { reasonCode: "COVERED_ELSEWHERE" })).row).toMatchObject({ status: "REJECTED", reasonCode: "COVERED_ELSEWHERE" });
    expect((await decideAction(dispatcher, "B", "REJECT", {})).row.status).toBe("REJECTED");
  });

  it("refuses APPLY before APPROVE, and every move out of a finished state, with a conflict", async () => {
    t.actions.push(action({ id: "P" }), action({ id: "X", status: "APPLIED" }), action({ id: "R", status: "REJECTED" }));
    await expect(decideAction(dispatcher, "P", "APPLY", {})).rejects.toMatchObject({ code: "ACTION_NOT_APPROVED" });
    for (const id of ["X", "R"]) {
      for (const decision of ["APPROVE", "REJECT", "APPLY"] as const) {
        await expect(decideAction(dispatcher, id, decision, {}), `${id} ${decision}`).rejects.toBeInstanceOf(CapacityActionConflict);
      }
    }
    await expect(decideAction(dispatcher, "P", "APPLY", {})).rejects.toBeInstanceOf(CapacityActionConflict);
    expect(recordDecision).not.toHaveBeenCalled();
    expect(t.actions.find((a) => a.id === "P")?.status).toBe("PROPOSED");
  });

  it("answers 403, as for a record that does not exist, for another depot's action", async () => {
    t.actions.push(action({ id: "K", depotCode: "Kandy" }));
    await expect(decideAction(dispatcher, "K", "APPROVE", {})).rejects.toBeInstanceOf(AuthError);
    await expect(decideAction(dispatcher, "nope", "APPROVE", {})).rejects.toBeInstanceOf(AuthError);
    await expect(decideAction({ ...dispatcher, depotCode: null }, "CA0", "APPROVE", {})).rejects.toBeInstanceOf(AuthError);
    expect(t.actions[0].status).toBe("PROPOSED");
  });

  it("loses cleanly when someone else decided in the meantime: the conditional update claims nothing", async () => {
    t.actions.push(action());
    const { prisma } = await import("../lib/db.js");
    // Someone else approves between our read and our write.
    vi.mocked(prisma.capacityAction.findFirst).mockImplementationOnce((async () => {
      const seen = { ...t.actions[0] };
      t.actions[0].status = "REJECTED";
      return seen;
    }) as never);
    await expect(decideAction(dispatcher, "CA0", "APPROVE", {})).rejects.toMatchObject({ code: "ACTION_STATE_CONFLICT" });
    expect(t.actions[0].status).toBe("REJECTED");
    expect(recordDecision).not.toHaveBeenCalled();
  });
});

describe("decideAction: APPLY effects", () => {
  it("RECALL clears the named reefer's workshop days in the week, on unpublished days only", async () => {
    t.actions.push(action({ kind: "RECALL_FROM_WORKSHOP", status: "APPROVED", params: { vehicleIds: ["VEH103"] } }));
    t.workshop.push(
      { vehicleId: "VEH103", date: d("2026-04-14"), status: "IN_WORKSHOP", note: "brakes" },
      { vehicleId: "VEH103", date: d("2026-04-15"), status: "IN_WORKSHOP", note: "brakes" },
      { vehicleId: "VEH103", date: d("2026-04-22"), status: "IN_WORKSHOP", note: "another week" },
      { vehicleId: "VEH101", date: d("2026-04-14"), status: "IN_WORKSHOP", note: "not named" },
    );
    t.published.push(d("2026-04-15")); // the dock owns this day now
    const { row, consequences } = await decideAction(dispatcher, "CA0", "APPLY", {});
    expect(row.status).toBe("APPLIED");
    const status = (v: string, date: string) => t.workshop.find((w) => w.vehicleId === v && w.date.getTime() === d(date).getTime())!.status;
    expect(status("VEH103", "2026-04-14")).toBe("AVAILABLE");
    expect(status("VEH103", "2026-04-15")).toBe("IN_WORKSHOP"); // published: left alone
    expect(status("VEH103", "2026-04-22")).toBe("IN_WORKSHOP"); // another week
    expect(status("VEH101", "2026-04-14")).toBe("IN_WORKSHOP"); // not named
    expect(consequences.join(" ")).toMatch(/Cleared 1 workshop day for VEH103/);
    expect(consequences.join(" ")).toMatch(/2026-04-15 \(plan already published\)/);
    expect(row.appliesFromDate?.toISOString().slice(0, 10)).toBe("2026-04-14");
  });

  it("RECALL with nothing left to clear still applies and says so", async () => {
    t.actions.push(action({ kind: "RECALL_FROM_WORKSHOP", status: "APPROVED", params: { vehicleIds: ["VEH103"] } }));
    const { row, consequences } = await decideAction(dispatcher, "CA0", "APPLY", {});
    expect(row.status).toBe("APPLIED");
    expect(consequences[0]).toMatch(/No workshop entries were left/);
  });

  it("RAISE_FUEL_QUOTA raises this week's ledger for this depot's vehicles, never lowers, never touches another depot's", async () => {
    t.actions.push(
      action({
        kind: "RAISE_FUEL_QUOTA",
        status: "APPROVED",
        params: {
          vehicles: [
            { vehicleId: "VEH101", proposedQuotaL: 440 },
            { vehicleId: "VEH103", proposedQuotaL: 100 }, // below the current quota: not lowered
            { vehicleId: "VEH201", proposedQuotaL: 999 }, // Kandy's vehicle
          ],
        },
      }),
    );
    t.ledgers.push({ vehicleId: "VEH101", isoYear: 2026, isoWeek: 16, quotaL: 420 }, { vehicleId: "VEH103", isoYear: 2026, isoWeek: 16, quotaL: 220 });
    const { consequences } = await decideAction(dispatcher, "CA0", "APPLY", {});
    const quota = (v: string) => t.ledgers.find((l) => l.vehicleId === v)?.quotaL;
    expect(quota("VEH101")).toBe(440);
    expect(quota("VEH103")).toBe(220);
    expect(quota("VEH201")).toBeUndefined();
    expect(consequences.join(" ")).toMatch(/VEH101 420 → 440 L/);
    expect(consequences.join(" ")).toMatch(/standing quota is unchanged/);
  });

  it("hiring, moving a day and pre-building record the decision and say nothing else changed", async () => {
    for (const kind of ["HIRE_RELIEF_VEHICLE", "SHIFT_BRAND_DAY", "PRE_BUILD_ORDERS"] as const) {
      t.actions = [action({ kind, status: "APPROVED" })];
      t.workshop = [{ vehicleId: "VEH103", date: d("2026-04-14"), status: "IN_WORKSHOP", note: null }];
      t.ledgers = [];
      const { row, consequences } = await decideAction(dispatcher, "CA0", "APPLY", {});
      expect(row.status, kind).toBe("APPLIED");
      expect(consequences, kind).toHaveLength(1);
      expect(consequences[0], kind).toMatch(/Recorded only/);
      expect(consequences[0], kind).toMatch(/nothing else changes/);
      // And truly nothing else: no vehicle freed, no ledger written.
      expect(t.workshop[0].status).toBe("IN_WORKSHOP");
      expect(t.ledgers).toEqual([]);
    }
  });
});

describe("describeAction", () => {
  it("states a hire in the design's words", () => {
    const a = describeAction({
      kind: "HIRE_RELIEF_VEHICLE",
      isoYear: 2026,
      isoWeek: 16,
      depotCode: "Peliyagoda",
      params: { count: 2, shortfallTripsPerDay: 5 },
      expectedRelief: { tripsPerDay: 4 },
    });
    expect(a.title).toBe("Hire 2 reefers for 13–18 Apr");
    expect(a.detail).toBe("Peliyagoda · covers 4 of the 5 short trips a day in W16");
  });
});

// --- The routes -------------------------------------------------------------------------------------------------

describe("capacity-action routes", () => {
  const servers: ReturnType<typeof Fastify>[] = [];
  afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(servers.splice(0).map((s) => s.close()));
  });

  async function serverFor(user: SessionUser) {
    const server = Fastify({ logger: false, ajv: CONTRACT_AJV });
    servers.push(server);
    server.decorateRequest("requireRole", function (...roles: string[]) {
      if (roles.length && !roles.includes(user.role)) throw new AuthError("Forbidden", 403);
      return user;
    });
    await server.register(errorsPlugin);
    await server.register(capacityActionRoutes, { prefix: "/v1" });
    return server;
  }

  it("lists a week's actions for the caller's own depot only", async () => {
    const load = vi.spyOn(capacity, "loadCapacityData").mockResolvedValue({ data: data(), weeks: [{ isoYear: 2026, isoWeek: 16 }] });
    const proposals = vi.spyOn(capacity, "proposalsFor").mockResolvedValue({ rows: [action()], currentKeys: new Set(["2026|16|HIRE_RELIEF_VEHICLE|"]) });
    const server = await serverFor(dispatcher);
    const res = await server.inject({ method: "GET", url: "/v1/capacity-actions?isoYear=2026&isoWeek=16" });
    expect(res.statusCode).toBe(200);
    expect(load.mock.calls[0][0]).toBe("Peliyagoda");
    expect(proposals.mock.calls[0][0]).toBe("Peliyagoda");
    const body = res.json();
    expect(body).toMatchObject({ depotCode: "Peliyagoda", isoYear: 2026, isoWeek: 16 });
    expect(body.items[0]).toMatchObject({ kind: "HIRE_RELIEF_VEHICLE", status: "PROPOSED", stale: false, availableDecisions: ["APPROVE", "REJECT"], title: "Hire 1 reefer for 13–18 Apr" });
  });

  it("wants both week parts or neither, and keeps every other role out", async () => {
    vi.spyOn(capacity, "loadCapacityData").mockResolvedValue({ data: data(), weeks: [] });
    vi.spyOn(capacity, "proposalsFor").mockResolvedValue({ rows: [], currentKeys: new Set() });
    const server = await serverFor(dispatcher);
    expect((await server.inject({ method: "GET", url: "/v1/capacity-actions?isoYear=2026" })).statusCode).toBe(422);
    expect((await server.inject({ method: "GET", url: "/v1/capacity-actions?isoYear=2026&isoWeek=54" })).statusCode).toBe(422);
    expect((await server.inject({ method: "GET", url: "/v1/capacity-actions" })).statusCode).toBe(200);
    const loader = await serverFor({ ...dispatcher, role: "LOADER" });
    expect((await loader.inject({ method: "GET", url: "/v1/capacity-actions" })).statusCode).toBe(403);
    expect((await loader.inject({ method: "POST", url: "/v1/capacity-actions/CA0/decision", payload: { decision: "APPROVE" } })).statusCode).toBe(403);
  });

  it("returns the action and its consequences, and maps a conflict to 409 and a foreign record to 403", async () => {
    const decide = vi.spyOn(capacity, "decideAction");
    const server = await serverFor(dispatcher);

    decide.mockResolvedValueOnce({ row: action({ status: "APPLIED" }), consequences: ["Recorded only. nothing else changes."] });
    const ok = await server.inject({ method: "POST", url: "/v1/capacity-actions/CA0/decision", payload: { decision: "APPLY" } });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().action.status).toBe("APPLIED");
    expect(ok.json().consequences).toEqual(["Recorded only. nothing else changes."]);
    expect(decide.mock.calls[0].slice(1, 3)).toEqual(["CA0", "APPLY"]);

    decide.mockRejectedValueOnce(new CapacityActionConflict("ACTION_NOT_APPROVED", "Approve this action before applying it."));
    const conflict = await server.inject({ method: "POST", url: "/v1/capacity-actions/CA0/decision", payload: { decision: "APPLY" } });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json().error.code).toBe("ACTION_NOT_APPROVED");

    decide.mockRejectedValueOnce(new AuthError("You do not have access to this record", 403));
    expect((await server.inject({ method: "POST", url: "/v1/capacity-actions/KANDY1/decision", payload: { decision: "APPROVE" } })).statusCode).toBe(403);
  });

  it("rejects an unknown decision, an undeclared field and a malformed reason code", async () => {
    const server = await serverFor(dispatcher);
    const post = (payload: unknown) => server.inject({ method: "POST", url: "/v1/capacity-actions/CA0/decision", payload: payload as object });
    expect((await post({ decision: "DELETE" })).statusCode).toBe(422);
    expect((await post({ decision: "APPROVE", extra: 1 })).statusCode).toBe(422);
    expect((await post({ decision: "REJECT", reasonCode: "lower case" })).statusCode).toBe(422);
    expect((await post({})).statusCode).toBe(422);
  });
});
