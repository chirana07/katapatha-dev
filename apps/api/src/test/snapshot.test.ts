import { describe, expect, it, vi } from "vitest";
import { prisma } from "../lib/db.js";
import { snapshotFromPlan } from "../services/snapshot.js";

/**
 * OPEN_SHORTFALL_AT_PUBLISH could never fire: the snapshot declared the list
 * and never filled it. What is pinned here is which shortfalls count.
 */

vi.mock("../lib/db.js", () => ({
  prisma: { shortfall: { findMany: vi.fn() } },
}));

const ctx = {
  planningDay: { id: "DAY1", date: new Date("2026-04-09"), depotCode: "Peliyagoda", status: "PLANNING", cutoffAt: "16:00" },
  input: {
    date: "2026-04-09",
    depot: "Peliyagoda",
    orders: [],
    vehicles: [],
    outlets: new Map(),
    districts: new Map(),
    allowance: new Map(),
    fuel: new Map(),
  },
  orderIdByRef: new Map(),
};

const plan = { id: "PLN2", planningDayId: "DAY1", trips: [], assignments: [] };

describe("snapshotFromPlan", () => {
  it("lists the orders with an open shortfall on the day's other plans, once each", async () => {
    vi.mocked(prisma.shortfall.findMany).mockResolvedValue([
      { order: { ref: "ORD-1" } },
      { order: { ref: "ORD-1" } },
      { order: { ref: "ORD-2" } },
    ] as never);

    const snapshot = await snapshotFromPlan(plan as never, ctx as never);

    expect(snapshot.openShortfallOrderRefs).toEqual(["ORD-1", "ORD-2"]);
    expect(vi.mocked(prisma.shortfall.findMany).mock.calls[0]![0]).toMatchObject({
      where: { status: "OPEN", trip: { plan: { planningDayId: "DAY1", id: { not: "PLN2" } } } },
    });
  });

  it("is empty when nothing is open", async () => {
    vi.mocked(prisma.shortfall.findMany).mockResolvedValue([]);

    const snapshot = await snapshotFromPlan(plan as never, ctx as never);

    expect(snapshot.openShortfallOrderRefs).toEqual([]);
  });
});
