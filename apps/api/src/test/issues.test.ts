import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CONTRACT_AJV } from "../lib/ajv.js";
import { AuthError, type SessionUser } from "../lib/auth.js";
import { prisma } from "../lib/db.js";
import { recordDecisions } from "../lib/audit.js";
import errorsPlugin from "../plugins/errors.js";
import issueRoutes from "../routes/issues.js";
import { uuidToUlid } from "../services/issues.js";

/**
 * What a store manager reports about a delivery.
 *
 * The things worth proving: only your own outlet's orders, a retried submit
 * never raises two issues (and never hands back somebody else's), the
 * dispatchers of the right depot hear about it, and the outlet's list is
 * the outlet's own.
 */

vi.mock("../lib/db.js", () => ({
  prisma: {
    $transaction: vi.fn(),
    order: { findFirst: vi.fn() },
    problem: { findUnique: vi.fn(), create: vi.fn(), findMany: vi.fn() },
    tripStopOrder: { findFirst: vi.fn() },
    user: { findMany: vi.fn() },
    notification: { createMany: vi.fn() },
    auditEvent: { findMany: vi.fn() },
  },
}));
vi.mock("../lib/audit.js", () => ({ recordDecisions: vi.fn(), recordDecision: vi.fn(), historyFor: vi.fn() }));

const manager: SessionUser = {
  id: "USR-S",
  email: "fathima@waypoint.lk",
  name: "Fathima Rizvi",
  role: "STORE_MANAGER",
  depotCode: null,
  outletId: "OUT074",
  defaultVehicleId: null,
};

const REQUEST_ID = "3f2b8e9a-7c41-4d0e-9a52-6b1f0c8d2e11";
const PROBLEM_ID = uuidToUlid(REQUEST_ID);

const order = { id: "ORD1", ref: "S1-074", units: 5, depotCode: "Peliyagoda", outlet: { displayName: "Fresh Puttalam" } };

describe("issues routes", () => {
  const servers: ReturnType<typeof Fastify>[] = [];

  async function serverFor(user: SessionUser) {
    const server = Fastify({ logger: false, ajv: CONTRACT_AJV });
    servers.push(server);
    server.decorateRequest("requireRole", function (...roles: string[]) {
      if (roles.length && !roles.includes(user.role)) throw new AuthError("Forbidden", 403);
      return user;
    });
    await server.register(errorsPlugin);
    await server.register(issueRoutes, { prefix: "/v1" });
    return server;
  }

  const post = async (body: unknown, user = manager) =>
    (await serverFor(user)).inject({ method: "POST", url: "/v1/issues", payload: body as never });

  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(prisma.$transaction).mockImplementation((async (fn: (tx: unknown) => unknown) => fn(prisma)) as never);
    vi.mocked(prisma.order.findFirst).mockResolvedValue(order as never);
    vi.mocked(prisma.problem.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.tripStopOrder.findFirst).mockResolvedValue({ tripStopId: "ST1", tripStop: { tripId: "T1" } } as never);
    vi.mocked(prisma.user.findMany).mockResolvedValue([{ id: "USR-D1" }, { id: "USR-D2" }] as never);
    vi.mocked(prisma.problem.create).mockResolvedValue({} as never);
    vi.mocked(prisma.auditEvent.findMany).mockResolvedValue([]);
    vi.mocked(recordDecisions).mockResolvedValue(undefined);
  });

  afterEach(async () => {
    await Promise.all(servers.splice(0).map((s) => s.close()));
  });

  describe("POST /issues", () => {
    const body = { orderId: "ORD1", kind: "GOODS_DAMAGED", reasonCode: "ITEMS_MISSING", units: 4, note: "Only 1 bag arrived", clientRequestId: REQUEST_ID };

    it("refuses every role but a store manager", async () => {
      for (const role of ["DISPATCHER", "LOADER", "DRIVER"] as const) {
        expect((await post(body, { ...manager, role })).statusCode, role).toBe(403);
      }
    });

    it("looks the order up inside the manager's own outlet, and answers 403 for anyone else's", async () => {
      vi.mocked(prisma.order.findFirst).mockResolvedValue(null);
      const response = await post(body);
      expect(response.statusCode).toBe(403);
      expect(prisma.order.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "ORD1", outletId: "OUT074" } }));
      expect(prisma.problem.create).not.toHaveBeenCalled();
    });

    it("creates a NEW problem raised by the manager, tied to the order's trip stop", async () => {
      const response = await post(body);
      expect(response.statusCode).toBe(201);
      expect(prisma.problem.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          id: PROBLEM_ID,
          kind: "GOODS_DAMAGED",
          reasonCode: "ITEMS_MISSING",
          orderId: "ORD1",
          tripId: "T1",
          tripStopId: "ST1",
          note: "Only 1 bag arrived",
          raisedByUserId: "USR-S",
        }),
      });
      expect(response.json()).toMatchObject({
        id: PROBLEM_ID,
        orderRef: "S1-074",
        kind: "GOODS_DAMAGED",
        reasonCode: "ITEMS_MISSING",
        units: 4,
        status: "NEW",
        resolution: null,
        resolvedAt: null,
      });
    });

    it("works for an order that was never planned: no trip, no stop", async () => {
      vi.mocked(prisma.tripStopOrder.findFirst).mockResolvedValue(null);
      const response = await post({ orderId: "ORD1", kind: "OTHER" });
      expect(response.statusCode).toBe(201);
      expect(vi.mocked(prisma.problem.create).mock.calls[0]![0].data).toMatchObject({ tripId: null, tripStopId: null, reasonCode: null });
      // No client id: a fresh ULID rather than a derived one.
      expect(vi.mocked(prisma.problem.create).mock.calls[0]![0].data.id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    });

    it("notifies the dispatchers of the order's depot, by user", async () => {
      await post(body);
      expect(prisma.user.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { role: "DISPATCHER", depotCode: "Peliyagoda" } }));
      const rows = vi.mocked(prisma.notification.createMany).mock.calls[0]![0]!.data as Array<Record<string, unknown>>;
      expect(rows.map((r) => r.userId)).toEqual(["USR-D1", "USR-D2"]);
      expect(rows[0]).toMatchObject({ kind: "issue.raised", payload: { problemId: PROBLEM_ID, exceptionId: `problem:${PROBLEM_ID}`, outletId: "OUT074" } });
    });

    it("writes the decision log after the commit: the units live there, since the table has no column", async () => {
      await post(body);
      const records = vi.mocked(recordDecisions).mock.calls[0]![0];
      expect(records[0]).toMatchObject({
        entityType: "Problem",
        entityId: PROBLEM_ID,
        action: "problem.raise",
        after: expect.objectContaining({ units: 4, orderId: "ORD1", outletId: "OUT074" }),
      });
      expect(records[1]).toMatchObject({ entityType: "Order", entityId: "ORD1", action: "issue.raise" });
    });

    it("rejects more affected units than the order held", async () => {
      const response = await post({ ...body, units: 6 });
      expect(response.statusCode).toBe(422);
      expect(response.json().error.code).toBe("UNITS_EXCEED_ORDER");
      expect(prisma.problem.create).not.toHaveBeenCalled();
    });

    it("rejects a kind or reason outside the store vocabularies, an oversized note, and extras", async () => {
      expect((await post({ ...body, kind: "VEHICLE_BREAKDOWN" })).statusCode).toBe(422);
      expect((await post({ ...body, reasonCode: "NOT_COLD_ENOUGH" })).statusCode).toBe(422);
      expect((await post({ ...body, note: "x".repeat(501) })).statusCode).toBe(422);
      expect((await post({ ...body, units: 0 })).statusCode).toBe(422);
      expect((await post({ ...body, clientRequestId: "not-a-uuid" })).statusCode).toBe(422);
      expect((await post({ ...body, raisedBy: "someone" })).statusCode).toBe(422);
    });

    describe("idempotency", () => {
      const existing = {
        id: PROBLEM_ID,
        kind: "GOODS_DAMAGED",
        note: "Only 1 bag arrived",
        reasonCode: "ITEMS_MISSING",
        status: "NEW",
        resolution: null,
        occurredAt: new Date("2026-09-28T04:10:00Z"),
        orderId: "ORD1",
        raisedByUserId: "USR-S",
      };

      it("returns the first issue with 200 and creates nothing the second time", async () => {
        vi.mocked(prisma.problem.findUnique).mockResolvedValue(existing as never);
        vi.mocked(prisma.auditEvent.findMany).mockResolvedValue([
          { entityId: PROBLEM_ID, action: "problem.raise", at: new Date(), after: { units: 4 } },
        ] as never);
        const response = await post(body);
        expect(response.statusCode).toBe(200);
        expect(response.json()).toMatchObject({ id: PROBLEM_ID, units: 4, createdAt: "2026-09-28T04:10:00.000Z" });
        expect(prisma.problem.findUnique).toHaveBeenCalledWith({ where: { id: PROBLEM_ID } });
        expect(prisma.problem.create).not.toHaveBeenCalled();
        expect(prisma.notification.createMany).not.toHaveBeenCalled();
        expect(recordDecisions).not.toHaveBeenCalled();
      });

      it("treats losing a race on the primary key as the replay it is", async () => {
        vi.mocked(prisma.problem.findUnique).mockResolvedValueOnce(null).mockResolvedValueOnce(existing as never);
        vi.mocked(prisma.$transaction).mockRejectedValueOnce(Object.assign(new Error("unique"), { code: "P2002" }));
        const response = await post(body);
        expect(response.statusCode).toBe(200);
        expect(response.json().id).toBe(PROBLEM_ID);
        expect(recordDecisions).not.toHaveBeenCalled();
      });

      it("will not return another manager's issue for a reused request id", async () => {
        vi.mocked(prisma.problem.findUnique).mockResolvedValue({ ...existing, raisedByUserId: "USR-OTHER" } as never);
        const response = await post(body);
        expect(response.statusCode).toBe(409);
        expect(response.json().error.code).toBe("IDEMPOTENCY_KEY_REUSED");
        expect(JSON.stringify(response.json())).not.toContain("Only 1 bag");
      });

      it("rejects the same request id reused for a different order or kind", async () => {
        vi.mocked(prisma.problem.findUnique).mockResolvedValue(existing as never);
        expect((await post({ ...body, kind: "OTHER" })).statusCode).toBe(409);
      });

      it("does not mask a real database failure", async () => {
        vi.mocked(prisma.$transaction).mockRejectedValueOnce(new Error("connection lost"));
        expect((await post(body)).statusCode).toBe(500);
      });
    });
  });

  describe("GET /issues", () => {
    it("refuses other roles", async () => {
      const server = await serverFor({ ...manager, role: "DISPATCHER" });
      expect((await server.inject({ method: "GET", url: "/v1/issues" })).statusCode).toBe(403);
    });

    it("lists issues raised by this outlet's managers, newest first, with units and resolution", async () => {
      vi.mocked(prisma.user.findMany).mockResolvedValue([{ id: "USR-S" }, { id: "USR-S2" }] as never);
      vi.mocked(prisma.problem.findMany).mockResolvedValue([
        { id: "P2", kind: "GOODS_DAMAGED", note: null, reasonCode: "ITEMS_DAMAGED", status: "RESOLVED", resolution: "Credit issued", occurredAt: new Date("2026-09-27T05:00:00Z"), orderId: "ORD2", order: { ref: "S1-068" } },
        { id: "P1", kind: "OTHER", note: "Hello", reasonCode: null, status: "NEW", resolution: null, occurredAt: new Date("2026-09-26T05:00:00Z"), orderId: "ORD1", order: { ref: "S1-074" } },
      ] as never);
      vi.mocked(prisma.auditEvent.findMany).mockResolvedValue([
        { entityId: "P2", action: "problem.raise", at: new Date("2026-09-27T05:00:00Z"), after: { units: 2 } },
        { entityId: "P2", action: "problem.resolve", at: new Date("2026-09-27T09:00:00Z"), after: {} },
      ] as never);
      const server = await serverFor(manager);

      const response = await server.inject({ method: "GET", url: "/v1/issues" });

      expect(response.statusCode).toBe(200);
      // The outlet's own managers only: not a driver's problem about an order at this outlet.
      expect(prisma.user.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { role: "STORE_MANAGER", outletId: "OUT074" } }));
      expect(vi.mocked(prisma.problem.findMany).mock.calls[0]![0]).toMatchObject({
        where: { raisedByUserId: { in: ["USR-S", "USR-S2"] } },
        orderBy: { occurredAt: "desc" },
      });
      const body = response.json();
      expect(body.map((i: { id: string }) => i.id)).toEqual(["P2", "P1"]);
      expect(body[0]).toMatchObject({ orderRef: "S1-068", units: 2, status: "RESOLVED", resolution: "Credit issued", resolvedAt: "2026-09-27T09:00:00.000Z" });
      expect(body[1]).toMatchObject({ units: null, resolvedAt: null });
    });
  });
});

describe("uuidToUlid", () => {
  it("makes a valid, stable ULID from a uuid, whatever its case", () => {
    expect(PROBLEM_ID).toMatch(/^[0-7][0-9A-HJKMNP-TV-Z]{25}$/);
    expect(uuidToUlid(REQUEST_ID.toUpperCase())).toBe(PROBLEM_ID);
  });

  it("keeps different uuids apart, including ones differing in a single bit", () => {
    expect(uuidToUlid("3f2b8e9a-7c41-4d0e-9a52-6b1f0c8d2e10")).not.toBe(PROBLEM_ID);
    expect(uuidToUlid("00000000-0000-0000-0000-000000000000")).toBe("00000000000000000000000000");
    expect(uuidToUlid("ffffffff-ffff-ffff-ffff-ffffffffffff")).toBe("7ZZZZZZZZZZZZZZZZZZZZZZZZZ");
  });
});
