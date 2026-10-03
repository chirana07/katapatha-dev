import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CONTRACT_AJV } from "../lib/ajv.js";
import { AuthError, type SessionUser } from "../lib/auth.js";
import { prisma } from "../lib/db.js";
import errorsPlugin from "../plugins/errors.js";
import notificationRoutes from "../routes/notifications.js";

/**
 * The bell: whose notifications are whose.
 *
 * A store manager reads their outlet's, a dispatcher their own, nobody else
 * reads anything, and marking one read is something only its owner can do —
 * with a stranger's id answering the same 403 as a missing one.
 */

vi.mock("../lib/db.js", () => ({
  prisma: { notification: { findMany: vi.fn(), count: vi.fn(), findFirst: vi.fn(), findUnique: vi.fn(), updateMany: vi.fn() } },
}));

const manager: SessionUser = { id: "USR-S", email: "f@w.lk", name: "Fathima Rizvi", role: "STORE_MANAGER", depotCode: null, outletId: "OUT074", defaultVehicleId: null };
const dispatcher: SessionUser = { id: "USR-D", email: "n@w.lk", name: "Nimal Perera", role: "DISPATCHER", depotCode: "Peliyagoda", outletId: null, defaultVehicleId: null };

const row = (over: Record<string, unknown> = {}) => ({
  id: "N1",
  userId: null,
  outletId: "OUT074",
  kind: "shortfall.send_short",
  title: "Order S1-082 is leaving 4 short",
  body: "VEH017 leaves with 16 of 20 units.",
  payload: { orderId: "ORD1" },
  createdAt: new Date("2026-09-28T22:41:00Z"),
  readAt: null,
  ...over,
});

describe("notifications routes", () => {
  const servers: ReturnType<typeof Fastify>[] = [];
  async function serverFor(user: SessionUser) {
    const server = Fastify({ logger: false, ajv: CONTRACT_AJV });
    servers.push(server);
    server.decorateRequest("requireRole", function (...roles: string[]) {
      if (roles.length && !roles.includes(user.role)) throw new AuthError("Forbidden", 403);
      return user;
    });
    await server.register(errorsPlugin);
    await server.register(notificationRoutes, { prefix: "/v1" });
    return server;
  }

  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(prisma.notification.findMany).mockResolvedValue([row()] as never);
    vi.mocked(prisma.notification.count).mockResolvedValue(3);
  });
  afterEach(async () => {
    await Promise.all(servers.splice(0).map((s) => s.close()));
  });

  describe("GET /notifications", () => {
    it("refuses loaders and drivers, which have no notifications", async () => {
      for (const role of ["LOADER", "DRIVER"] as const) {
        const server = await serverFor({ ...dispatcher, role });
        expect((await server.inject({ method: "GET", url: "/v1/notifications" })).statusCode, role).toBe(403);
      }
      expect(prisma.notification.findMany).not.toHaveBeenCalled();
    });

    it("gives a store manager their outlet's, newest first, capped at 50", async () => {
      const server = await serverFor(manager);
      const response = await server.inject({ method: "GET", url: "/v1/notifications" });
      expect(response.statusCode).toBe(200);
      expect(prisma.notification.findMany).toHaveBeenCalledWith({
        where: { outletId: "OUT074" },
        orderBy: { createdAt: "desc" },
        take: 50,
      });
      expect(response.json()).toEqual({
        unreadCount: 3,
        items: [
          {
            id: "N1",
            kind: "shortfall.send_short",
            title: "Order S1-082 is leaving 4 short",
            body: "VEH017 leaves with 16 of 20 units.",
            payload: { orderId: "ORD1" },
            createdAt: "2026-09-28T22:41:00.000Z",
            readAt: null,
          },
        ],
      });
    });

    it("gives a dispatcher the ones addressed to them, and never another user's", async () => {
      const server = await serverFor(dispatcher);
      await server.inject({ method: "GET", url: "/v1/notifications" });
      expect(vi.mocked(prisma.notification.findMany).mock.calls[0]![0]).toMatchObject({ where: { userId: "USR-D" } });
    });

    it("filters to unread, while the badge still counts every unread one", async () => {
      const server = await serverFor(manager);
      await server.inject({ method: "GET", url: "/v1/notifications?unread=true" });
      expect(vi.mocked(prisma.notification.findMany).mock.calls[0]![0]).toMatchObject({ where: { outletId: "OUT074", readAt: null } });
      expect(prisma.notification.count).toHaveBeenCalledWith({ where: { outletId: "OUT074", readAt: null } });

      vi.mocked(prisma.notification.findMany).mockClear();
      await server.inject({ method: "GET", url: "/v1/notifications?unread=false" });
      expect(vi.mocked(prisma.notification.findMany).mock.calls[0]![0]).toMatchObject({ where: { outletId: "OUT074" } });
      expect(vi.mocked(prisma.notification.findMany).mock.calls[0]![0]!.where).not.toHaveProperty("readAt");
    });

    it("rejects a query value that is not true or false, and unknown parameters", async () => {
      const server = await serverFor(manager);
      expect((await server.inject({ method: "GET", url: "/v1/notifications?unread=yes" })).statusCode).toBe(422);
      expect((await server.inject({ method: "GET", url: "/v1/notifications?outlet=OUT001" })).statusCode).toBe(422);
    });

    it("says null, not an object, for a payload that is not one", async () => {
      vi.mocked(prisma.notification.findMany).mockResolvedValue([row({ payload: null })] as never);
      const server = await serverFor(manager);
      expect((await server.inject({ method: "GET", url: "/v1/notifications" })).json().items[0].payload).toBeNull();
    });
  });

  describe("POST /notifications/:id/read", () => {
    it("marks an unread notification read, only if it is still unread", async () => {
      vi.mocked(prisma.notification.findFirst).mockResolvedValue(row() as never);
      vi.mocked(prisma.notification.findUnique).mockResolvedValue(row({ readAt: new Date("2026-09-28T23:00:00Z") }) as never);
      vi.mocked(prisma.notification.count).mockResolvedValue(2);
      const server = await serverFor(manager);

      const response = await server.inject({ method: "POST", url: "/v1/notifications/N1/read" });

      expect(response.statusCode).toBe(200);
      expect(prisma.notification.findFirst).toHaveBeenCalledWith({ where: { id: "N1", outletId: "OUT074" } });
      expect(prisma.notification.updateMany).toHaveBeenCalledWith({ where: { id: "N1", readAt: null }, data: { readAt: expect.any(Date) } });
      expect(response.json()).toMatchObject({ unreadCount: 2, notification: { id: "N1", readAt: "2026-09-28T23:00:00.000Z" } });
    });

    it("is idempotent: an already-read notification is returned as it is, not touched", async () => {
      const readAt = new Date("2026-09-28T23:00:00Z");
      vi.mocked(prisma.notification.findFirst).mockResolvedValue(row({ readAt }) as never);
      vi.mocked(prisma.notification.findUnique).mockResolvedValue(row({ readAt }) as never);
      const server = await serverFor(manager);
      const response = await server.inject({ method: "POST", url: "/v1/notifications/N1/read" });
      expect(response.statusCode).toBe(200);
      expect(prisma.notification.updateMany).not.toHaveBeenCalled();
      expect(response.json().notification.readAt).toBe("2026-09-28T23:00:00.000Z");
    });

    it("answers 403, as for a missing one, for a notification that belongs to another outlet or user", async () => {
      vi.mocked(prisma.notification.findFirst).mockResolvedValue(null);
      const asManager = await serverFor(manager);
      expect((await asManager.inject({ method: "POST", url: "/v1/notifications/OTHER/read" })).statusCode).toBe(403);
      const asDispatcher = await serverFor(dispatcher);
      expect((await asDispatcher.inject({ method: "POST", url: "/v1/notifications/OTHER/read" })).statusCode).toBe(403);
      expect(vi.mocked(prisma.notification.findFirst).mock.calls[1]![0]).toEqual({ where: { id: "OTHER", userId: "USR-D" } });
      expect(prisma.notification.updateMany).not.toHaveBeenCalled();
    });

    it("refuses other roles", async () => {
      const server = await serverFor({ ...dispatcher, role: "DRIVER" });
      expect((await server.inject({ method: "POST", url: "/v1/notifications/N1/read" })).statusCode).toBe(403);
    });
  });
});
