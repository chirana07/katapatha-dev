import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CONTRACT_AJV } from "../lib/ajv.js";
import type { SessionUser } from "../lib/auth.js";
import { AuthError } from "../lib/auth.js";
import { prisma } from "../lib/db.js";
import { requireDispatcherPlan } from "../lib/authorization.js";
import errorsPlugin from "../plugins/errors.js";
import historyRoutes from "../routes/history.js";

/**
 * The decision log, read back.
 *
 * What matters here is who may read which log: a log is exactly as visible as
 * the record it describes, and a record the caller cannot see answers the same
 * as one that does not exist.
 */

vi.mock("../lib/db.js", () => ({
  prisma: {
    order: { findFirst: vi.fn() },
    trip: { findFirst: vi.fn() },
    outlet: { findFirst: vi.fn() },
    capacityAction: { findFirst: vi.fn() },
    product: { findUnique: vi.fn() },
    auditEvent: { findMany: vi.fn() },
  },
}));

vi.mock("../lib/authorization.js", () => ({
  requireDispatcherPlan: vi.fn(),
  requireDispatcherPlanningDay: vi.fn(),
  requireDispatcherVehicle: vi.fn(),
  requireDispatcherShortfall: vi.fn(),
  requireDispatcherProblem: vi.fn(),
}));

const dispatcher: SessionUser = {
  id: "USR001",
  email: "nimal@waypoint.lk",
  name: "Nimal Perera",
  role: "DISPATCHER",
  depotCode: "Peliyagoda",
  outletId: null,
  defaultVehicleId: null,
};

const store: SessionUser = {
  id: "USR020",
  email: "fathima@waypoint.lk",
  name: "Fathima Rizvi",
  role: "STORE_MANAGER",
  depotCode: null,
  outletId: "OUT074",
  defaultVehicleId: null,
};

const row = {
  id: "AUD1",
  at: new Date("2026-04-08T16:58:03.000Z"),
  actorUserId: "USR001",
  actorRole: "DISPATCHER" as const,
  action: "deferral.confirm",
  entityType: "Order",
  entityId: "ORD1",
  reasonCode: "REEFER_FULL",
  note: null,
  before: null,
  after: { planId: "PLN1" },
  requestId: null,
  actor: { name: "Nimal Perera", role: "DISPATCHER" as const },
};

describe("GET /v1/history/:entityType/:entityId", () => {
  const servers: ReturnType<typeof Fastify>[] = [];

  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(prisma.auditEvent.findMany).mockResolvedValue([row] as never);
  });

  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => server.close()));
  });

  async function serverFor(user: SessionUser) {
    const server = Fastify({ logger: false, ajv: CONTRACT_AJV });
    servers.push(server);
    server.decorateRequest("requireRole", function (...roles: string[]) {
      if (roles.length && !roles.includes(user.role)) throw new AuthError("Forbidden", 403);
      return user;
    });
    await server.register(errorsPlugin);
    await server.register(historyRoutes, { prefix: "/v1" });
    return server;
  }

  it("returns an order's log to the dispatcher whose depot owns the order", async () => {
    const server = await serverFor(dispatcher);
    vi.mocked(prisma.order.findFirst).mockResolvedValue({ id: "ORD1" } as never);

    const response = await server.inject({ method: "GET", url: "/v1/history/Order/ORD1" });

    expect(response.statusCode).toBe(200);
    expect(vi.mocked(prisma.order.findFirst).mock.calls[0]![0]).toMatchObject({
      where: { id: "ORD1", depotCode: "Peliyagoda" },
    });
    expect(response.json()).toEqual({
      entityType: "Order",
      entityId: "ORD1",
      events: [
        {
          id: "AUD1",
          at: "2026-04-08T16:58:03.000Z",
          action: "deferral.confirm",
          actorName: "Nimal Perera",
          actorRole: "DISPATCHER",
          reasonCode: "REEFER_FULL",
          note: null,
          before: null,
          after: { planId: "PLN1" },
        },
      ],
    });
  });

  it("answers 403, not an empty log, for an order at another depot", async () => {
    const server = await serverFor(dispatcher);
    vi.mocked(prisma.order.findFirst).mockResolvedValue(null);

    const response = await server.inject({ method: "GET", url: "/v1/history/Order/ORD9" });

    expect(response.statusCode).toBe(403);
    // Not even asked: a refused caller must not be able to time the log.
    expect(prisma.auditEvent.findMany).not.toHaveBeenCalled();
  });

  it("lets a store manager read the log of their own order and no other", async () => {
    const server = await serverFor(store);
    vi.mocked(prisma.order.findFirst).mockResolvedValueOnce({ id: "ORD1" } as never);

    const mine = await server.inject({ method: "GET", url: "/v1/history/Order/ORD1" });
    expect(mine.statusCode).toBe(200);
    expect(vi.mocked(prisma.order.findFirst).mock.calls[0]![0]).toMatchObject({
      where: { id: "ORD1", outletId: "OUT074" },
    });

    vi.mocked(prisma.order.findFirst).mockResolvedValueOnce(null);
    const theirs = await server.inject({ method: "GET", url: "/v1/history/Order/ORD2" });
    expect(theirs.statusCode).toBe(403);
  });

  it("keeps a store manager out of plans, trips and other outlets", async () => {
    const server = await serverFor(store);

    for (const url of ["/v1/history/Plan/PLN1", "/v1/history/Trip/TRP1", "/v1/history/Outlet/OUT001"]) {
      const response = await server.inject({ method: "GET", url });
      expect(response.statusCode, url).toBe(403);
    }
    const own = await server.inject({ method: "GET", url: "/v1/history/Outlet/OUT074" });
    expect(own.statusCode).toBe(200);
  });

  it("delegates plans to the depot-scoped predicate", async () => {
    const server = await serverFor(dispatcher);
    vi.mocked(requireDispatcherPlan).mockRejectedValue(new AuthError("no", 403));

    const response = await server.inject({ method: "GET", url: "/v1/history/Plan/PLN9" });

    expect(response.statusCode).toBe(403);
    expect(requireDispatcherPlan).toHaveBeenCalledWith(dispatcher, "PLN9");
  });

  it("scopes a capacity action's log to the dispatcher's depot", async () => {
    const server = await serverFor(dispatcher);
    vi.mocked(prisma.capacityAction.findFirst).mockResolvedValueOnce({ id: "CAP1" } as never);

    const mine = await server.inject({ method: "GET", url: "/v1/history/CapacityAction/CAP1" });
    expect(mine.statusCode).toBe(200);
    expect(vi.mocked(prisma.capacityAction.findFirst).mock.calls[0]![0]).toMatchObject({
      where: { id: "CAP1", depotCode: "Peliyagoda" },
    });

    vi.mocked(prisma.capacityAction.findFirst).mockResolvedValueOnce(null);
    const theirs = await server.inject({ method: "GET", url: "/v1/history/CapacityAction/CAP2" });
    expect(theirs.statusCode).toBe(403);
  });

  it("lets a dispatcher read a product's log, but never a store manager", async () => {
    // The catalogue is Waypoint-wide: there is no depot to scope it by.
    vi.mocked(prisma.product.findUnique).mockResolvedValue({ id: "PRD1" } as never);

    const dispatcherServer = await serverFor(dispatcher);
    const mine = await dispatcherServer.inject({ method: "GET", url: "/v1/history/Product/PRD1" });
    expect(mine.statusCode).toBe(200);
    expect(mine.json().entityType).toBe("Product");

    vi.mocked(prisma.product.findUnique).mockResolvedValueOnce(null);
    const missing = await dispatcherServer.inject({ method: "GET", url: "/v1/history/Product/PRD9" });
    expect(missing.statusCode).toBe(403);

    vi.mocked(prisma.auditEvent.findMany).mockClear();
    const storeServer = await serverFor(store);
    const refused = await storeServer.inject({ method: "GET", url: "/v1/history/Product/PRD1" });
    expect(refused.statusCode).toBe(403);
    expect(prisma.auditEvent.findMany).not.toHaveBeenCalled();
  });

  it("refuses roles that have no log to read", async () => {
    const loader: SessionUser = { ...dispatcher, role: "LOADER" };
    const server = await serverFor(loader);

    const response = await server.inject({ method: "GET", url: "/v1/history/Order/ORD1" });

    expect(response.statusCode).toBe(403);
  });

  it("rejects an entity type the log is not kept against", async () => {
    const server = await serverFor(dispatcher);

    const response = await server.inject({ method: "GET", url: "/v1/history/User/USR1" });

    expect(response.statusCode).toBe(422);
  });
});
