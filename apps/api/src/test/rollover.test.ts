import { describe, expect, it, vi } from "vitest";
import { createFollowUpOrder } from "../services/followUp.js";
import { rollDeferredOrders } from "../services/rollover.js";

/**
 * Carrying a deferred order to the next run. A mocked transaction: what matters
 * is which orders are created, that the whole order (contents included) comes
 * across, that a repeat creates nothing new, and that the day exists.
 */

const original = (over: Record<string, unknown> = {}) => ({
  id: "O2",
  ref: "ORD-004002",
  outletId: "OUT074",
  brand: "Fresh",
  districtName: "Puttalam",
  depotCode: "Peliyagoda",
  tempRequirement: "chilled",
  units: 20,
  weightKg: 240,
  volumeM3: 4.5,
  windowOpen: "05:30",
  windowClose: "08:00",
  ...over,
});

const line = (over: Record<string, unknown> = {}) => ({
  id: "L1",
  orderId: "O2",
  productId: "P1",
  sku: "FC001",
  productName: "Fresh Milk 1 L",
  unitLabel: "crate",
  kgPerUnit: 12.6,
  m3PerUnit: 0.02,
  quantity: 20,
  ...over,
});

function txFor(parts: { orders?: ReturnType<typeof original>[]; lines?: ReturnType<typeof line>[]; existingKeys?: string[]; latestRef?: string | null }) {
  const created: Array<Record<string, unknown>> = [];
  return {
    created,
    tx: {
      planningDay: { upsert: vi.fn().mockResolvedValue({}) },
      order: {
        findMany: vi.fn().mockResolvedValue(parts.orders ?? [original()]),
        findUnique: vi.fn(async ({ where }: { where: { clientRequestId: string } }) =>
          (parts.existingKeys ?? []).includes(where.clientRequestId) ? { id: "EXISTING" } : null,
        ),
        findFirst: vi.fn().mockResolvedValue(parts.latestRef === null ? null : { ref: parts.latestRef ?? "ORD-004100" }),
        create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
          created.push(data);
          return { id: `NEW${created.length}`, ...data };
        }),
      },
      orderLine: { findMany: vi.fn().mockResolvedValue(parts.lines ?? []) },
    },
  };
}

const roll = (tx: unknown, orderIds = ["O2"]) =>
  rollDeferredOrders(tx as never, { planId: "PLN1", orderIds, forDate: "2026-10-06", userId: "USR001" });

describe("rollDeferredOrders", () => {
  it("queues the whole order for the next run, flagged as deferred yesterday and linked back", async () => {
    const { tx, created } = txFor({});

    const refs = await roll(tx);

    expect(refs).toEqual(["ORD-004101"]);
    expect(created[0]).toMatchObject({
      ref: "ORD-004101",
      outletId: "OUT074",
      brand: "Fresh",
      districtName: "Puttalam",
      depotCode: "Peliyagoda",
      tempRequirement: "chilled",
      units: 20,
      weightKg: 240,
      volumeM3: 4.5,
      windowOpen: "05:30",
      windowClose: "08:00",
      requestedDate: new Date("2026-10-06T00:00:00.000Z"),
      placedByUserId: "USR001",
      status: "QUEUED",
      deferredYesterday: true,
      rolledFromOrderId: "O2",
      clientRequestId: "rollover:PLN1:O2",
    });
  });

  it("opens the depot's planning day for the new date, so the order can be closed and planned", async () => {
    const { tx } = txFor({});

    await roll(tx);

    expect(tx.planningDay.upsert).toHaveBeenCalledWith({
      where: { date_depotCode: { date: new Date("2026-10-06T00:00:00.000Z"), depotCode: "Peliyagoda" } },
      create: { date: new Date("2026-10-06T00:00:00.000Z"), depotCode: "Peliyagoda" },
      update: {},
    });
  });

  it("carries the products the order was placed with, so it never exists without its contents", async () => {
    const { tx, created } = txFor({ lines: [line(), line({ id: "L2", productId: "P2", sku: "FC002", productName: "Set Yoghurt", quantity: 5 })] });

    await roll(tx);

    expect(created[0]!.lines).toEqual({
      create: [
        { productId: "P1", sku: "FC001", productName: "Fresh Milk 1 L", unitLabel: "crate", kgPerUnit: 12.6, m3PerUnit: 0.02, quantity: 20 },
        { productId: "P2", sku: "FC002", productName: "Set Yoghurt", unitLabel: "crate", kgPerUnit: 12.6, m3PerUnit: 0.02, quantity: 5 },
      ],
    });
  });

  it("creates a unit-only order without lines when the original had none", async () => {
    const { tx, created } = txFor({ lines: [] });
    await roll(tx);
    expect(created[0]).not.toHaveProperty("lines");
  });

  it("creates nothing the second time, because the order is keyed on the plan and the original", async () => {
    const { tx, created } = txFor({ existingKeys: ["rollover:PLN1:O2"] });

    expect(await roll(tx)).toEqual([]);

    expect(created).toHaveLength(0);
    expect(tx.planningDay.upsert).not.toHaveBeenCalled();
  });

  it("gives several orders consecutive refs, in the original's ref order", async () => {
    const { tx, created } = txFor({
      orders: [original({ id: "O2", ref: "ORD-004002" }), original({ id: "O3", ref: "ORD-004003", outletId: "OUT075" })],
    });
    // Each create must see the previous one's ref as the highest.
    let latest = "ORD-004100";
    tx.order.findFirst.mockImplementation(async () => ({ ref: latest }));
    tx.order.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
      created.push(data);
      latest = data.ref as string;
      return { id: `NEW${created.length}`, ...data };
    });

    const refs = await roll(tx, ["O3", "O2"]);

    expect(refs).toEqual(["ORD-004101", "ORD-004102"]);
    expect(created.map((c) => c.rolledFromOrderId)).toEqual(["O2", "O3"]);
  });

  it("does nothing for no orders", async () => {
    const { tx } = txFor({});
    expect(await roll(tx, [])).toEqual([]);
    expect(tx.order.findMany).not.toHaveBeenCalled();
  });
});

describe("createFollowUpOrder", () => {
  it("scales a share of an order, and leaves its contents behind", async () => {
    const { tx, created } = txFor({});

    await createFollowUpOrder(tx as never, original() as never, 4, "2026-10-06", "USR001", "followup:SF1");

    expect(created[0]).toMatchObject({ units: 4, weightKg: 48, volumeM3: 0.9, clientRequestId: "followup:SF1" });
    expect(tx.orderLine.findMany).not.toHaveBeenCalled();
    expect(created[0]).not.toHaveProperty("lines");
  });

  it("starts from ORD-004001 when there is no earlier order", async () => {
    const { tx, created } = txFor({ latestRef: null });
    await createFollowUpOrder(tx as never, original() as never, 20, "2026-10-06", "USR001", "k");
    expect(created[0]!.ref).toBe("ORD-004001");
  });
});
