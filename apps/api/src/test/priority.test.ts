import { describe, expect, it, vi } from "vitest";
import { MAX_DAYS_SINCE_SERVED, derivePriority, derivePriorityInputs } from "../services/priority.js";

/**
 * The fairness signals. The decision for one order is pure and tested directly;
 * the gathering of history is tested against a mocked transaction, for which
 * queries it makes and which orders it rewrites.
 */

const none = () => undefined;
const stored = { deferredYesterday: false, daysSinceLastServed: 1 };

describe("derivePriority", () => {
  it("counts operating days since the outlet was last served", () => {
    // Served Thursday 1st; planning Tuesday 6th: Fri, Sat, Mon, Tue (Sunday is not a day without).
    const out = derivePriority({ stored, date: "2026-10-06", lastServed: "2026-10-01", deferredLastRun: false, isOperating: none });
    expect(out.daysSinceLastServed).toBe(4);
  });

  it("is one for an outlet served on the previous run", () => {
    expect(derivePriority({ stored, date: "2026-10-06", lastServed: "2026-10-05", deferredLastRun: false, isOperating: none }).daysSinceLastServed).toBe(1);
    // Over a Sunday: served Saturday, planning Monday.
    expect(derivePriority({ stored, date: "2026-10-05", lastServed: "2026-10-03", deferredLastRun: false, isOperating: none }).daysSinceLastServed).toBe(1);
  });

  it("never exceeds the week the priority score recognises", () => {
    const out = derivePriority({ stored, date: "2026-10-30", lastServed: "2026-09-01", deferredLastRun: false, isOperating: none });
    expect(out.daysSinceLastServed).toBe(MAX_DAYS_SINCE_SERVED);
  });

  it("keeps the stored value for an outlet with no history, rather than calling a new store starved", () => {
    const out = derivePriority({
      stored: { deferredYesterday: false, daysSinceLastServed: 3 },
      date: "2026-10-06",
      lastServed: null,
      deferredLastRun: false,
      isOperating: none,
    });
    expect(out.daysSinceLastServed).toBe(3);
  });

  it("flags an outlet that was passed over on the last run", () => {
    expect(derivePriority({ stored, date: "2026-10-06", lastServed: "2026-10-05", deferredLastRun: true, isOperating: none }).deferredYesterday).toBe(true);
  });

  it("never clears a flag that was already set", () => {
    const out = derivePriority({
      stored: { deferredYesterday: true, daysSinceLastServed: 1 },
      date: "2026-10-06",
      lastServed: "2026-10-05",
      deferredLastRun: false,
      isOperating: none,
    });
    expect(out.deferredYesterday).toBe(true);
  });
});

describe("derivePriorityInputs", () => {
  const DATE = new Date("2026-10-06T00:00:00.000Z");
  const planDay = (iso: string) => ({ plan: { planningDay: { date: new Date(`${iso}T00:00:00.000Z`) } } });

  function txFor(parts: {
    orders: Array<{ id: string; outletId: string; deferredYesterday?: boolean; daysSinceLastServed?: number }>;
    served?: Array<{ outletId: string; day: string }>;
    deferrals?: Array<{ outletId: string }>;
    calendar?: Array<{ date: Date; isOperating: boolean }>;
  }) {
    return {
      order: {
        findMany: vi.fn().mockResolvedValue(
          parts.orders.map((o) => ({ deferredYesterday: false, daysSinceLastServed: 1, ...o })),
        ),
        update: vi.fn().mockResolvedValue({}),
      },
      assignment: {
        findMany: vi.fn().mockResolvedValue((parts.served ?? []).map((s) => ({ order: { outletId: s.outletId }, ...planDay(s.day) }))),
      },
      deferral: { findMany: vi.fn().mockResolvedValue((parts.deferrals ?? []).map((d) => ({ order: { outletId: d.outletId } }))) },
      calendarDay: { findMany: vi.fn().mockResolvedValue(parts.calendar ?? []) },
    };
  }
  const run = (tx: ReturnType<typeof txFor>) => derivePriorityInputs(tx as never, DATE, "Peliyagoda");

  it("looks only at live orders for this depot and day", async () => {
    const tx = txFor({ orders: [] });

    expect(await run(tx)).toBe(0);

    expect(tx.order.findMany.mock.calls[0]![0].where).toEqual({
      requestedDate: DATE,
      depotCode: "Peliyagoda",
      status: { not: "CANCELLED" },
      placedByUserId: { not: null },
    });
    // Nothing to derive for, so no history is fetched.
    expect(tx.assignment.findMany).not.toHaveBeenCalled();
  });

  it("asks for served orders in published plans of this depot before the day, and deferrals on the previous run", async () => {
    const tx = txFor({ orders: [{ id: "O1", outletId: "OUT1" }] });

    await run(tx);

    const served = tx.assignment.findMany.mock.calls[0]![0].where;
    expect(served.decision).toBe("SERVED");
    expect(served.plan.status).toBe("PUBLISHED");
    expect(served.plan.planningDay.depotCode).toBe("Peliyagoda");
    expect(served.plan.planningDay.date.lt).toEqual(DATE);
    const deferrals = tx.deferral.findMany.mock.calls[0]![0].where;
    // Tuesday 6th: the previous run was Monday 5th.
    expect(deferrals.plan.planningDay.date).toEqual(new Date("2026-10-05T00:00:00.000Z"));
    // A permanent deferral has no next run, so says nothing about being passed over.
    expect(deferrals.rolledToDate).toEqual({ not: null });
  });

  it("writes days since last served, using the most recent served day per outlet", async () => {
    const tx = txFor({
      orders: [{ id: "O1", outletId: "OUT1" }],
      served: [
        { outletId: "OUT1", day: "2026-10-01" },
        { outletId: "OUT1", day: "2026-10-03" },
      ],
    });

    expect(await run(tx)).toBe(1);

    // Last served Saturday 3rd; Monday 5th and Tuesday 6th lie after it.
    expect(tx.order.update).toHaveBeenCalledWith({ where: { id: "O1" }, data: { deferredYesterday: false, daysSinceLastServed: 2 } });
  });

  it("flags an outlet deferred on the previous run, and only that outlet", async () => {
    const tx = txFor({
      orders: [
        { id: "O1", outletId: "OUT1" },
        { id: "O2", outletId: "OUT2" },
      ],
      served: [
        { outletId: "OUT1", day: "2026-10-05" },
        { outletId: "OUT2", day: "2026-10-05" },
      ],
      deferrals: [{ outletId: "OUT1" }],
    });

    await run(tx);

    const writes = new Map(tx.order.update.mock.calls.map((c) => [c[0].where.id, c[0].data]));
    expect(writes.get("O1")).toEqual({ deferredYesterday: true, daysSinceLastServed: 1 });
    // OUT2 was served yesterday and not deferred: already correct, so not rewritten.
    expect(writes.has("O2")).toBe(false);
  });

  it("leaves an order alone when its stored values are already right", async () => {
    const tx = txFor({
      orders: [{ id: "O1", outletId: "OUT1", deferredYesterday: true, daysSinceLastServed: 2 }],
      served: [{ outletId: "OUT1", day: "2026-10-03" }],
    });

    expect(await run(tx)).toBe(0);
    expect(tx.order.update).not.toHaveBeenCalled();
  });

  it("follows the calendar: a closed day does not count against the outlet", async () => {
    const tx = txFor({
      orders: [{ id: "O1", outletId: "OUT1" }],
      served: [{ outletId: "OUT1", day: "2026-10-02" }],
      // Monday the 5th is a holiday.
      calendar: [{ date: new Date("2026-10-05T00:00:00.000Z"), isOperating: false }],
    });

    await run(tx);

    // After Friday 2nd: Sat 3rd and Tue 6th count; Sunday and the holiday do not.
    expect(tx.order.update.mock.calls[0]![0].data.daysSinceLastServed).toBe(2);
  });
});
