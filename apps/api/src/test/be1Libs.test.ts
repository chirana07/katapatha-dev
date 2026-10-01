import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  auditEvent: { create: vi.fn(), findMany: vi.fn() },
  loginThrottle: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
    upsert: vi.fn(),
    deleteMany: vi.fn(),
  },
  session: { create: vi.fn(), findUnique: vi.fn(), deleteMany: vi.fn() },
  vehicle: { findFirst: vi.fn() },
  $transaction: vi.fn(),
}));

vi.mock("../lib/db.js", () => ({ prisma: prismaMock }));

import {
  AuthError,
  createSession,
  getSessionByToken,
  requireRoleOf,
  type SessionUser,
} from "../lib/auth.js";
import { historyFor, recordDecision } from "../lib/audit.js";
import { requireDispatcherVehicle } from "../lib/authorization.js";
import {
  assertSignInAllowed,
  clearSignInFailures,
  LoginRateLimitError,
  recordSignInFailure,
} from "../lib/loginThrottle.js";

const user: SessionUser = {
  id: "USR001",
  email: "nimal@waypoint.lk",
  name: "Nimal",
  role: "DISPATCHER",
  depotCode: "Peliyagoda",
  outletId: null,
  defaultVehicleId: null,
};

describe("BE1 authentication, authorization and audit libraries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("enforces authentication and role membership", () => {
    expect(() => requireRoleOf(null)).toThrowError(AuthError);
    expect(() => requireRoleOf(user, "DRIVER")).toThrowError(AuthError);
    expect(requireRoleOf(user, "DISPATCHER")).toBe(user);
  });

  it("stores only the SHA-256 hash of a newly created session token", async () => {
    const before = Date.now();
    const created = await createSession(user.id, "test-agent");

    expect(created.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(created.expiresAt.getTime()).toBeGreaterThan(before);
    expect(prismaMock.session.create).toHaveBeenCalledWith({
      data: {
        token: createHash("sha256").update(created.token).digest("hex"),
        userId: user.id,
        expiresAt: created.expiresAt,
        userAgent: "test-agent",
      },
    });
  });

  it("deletes an expired session and treats it as signed out", async () => {
    prismaMock.session.findUnique.mockResolvedValue({
      token: "stored-hash",
      expiresAt: new Date("2000-01-01T00:00:00.000Z"),
      user,
    });

    await expect(getSessionByToken("raw-token")).resolves.toBeNull();
    expect(prismaMock.session.deleteMany).toHaveBeenCalledWith({
      where: { token: createHash("sha256").update("raw-token").digest("hex") },
    });
  });

  it("rejects a dispatcher vehicle outside the caller's depot", async () => {
    prismaMock.vehicle.findFirst.mockResolvedValue(null);

    await expect(requireDispatcherVehicle(user, "VEH999")).rejects.toMatchObject({
      status: 403,
    });
    expect(prismaMock.vehicle.findFirst).toHaveBeenCalledWith({
      where: { id: "VEH999", depotCode: "Peliyagoda" },
    });
  });

  it("writes and reads audit records", async () => {
    await recordDecision({
      actor: user,
      action: "PLAN_PUBLISHED",
      entityType: "Plan",
      entityId: "PLAN001",
      reasonCode: "READY",
    });

    expect(prismaMock.auditEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorUserId: user.id,
        actorRole: "DISPATCHER",
        action: "PLAN_PUBLISHED",
        entityType: "Plan",
        entityId: "PLAN001",
      }),
    });

    await historyFor("Plan", "PLAN001");
    expect(prismaMock.auditEvent.findMany).toHaveBeenCalledWith({
      where: { entityType: "Plan", entityId: "PLAN001" },
      orderBy: { at: "desc" },
      include: { actor: { select: { name: true, role: true } } },
    });
  });

  it("reports the remaining wait for a blocked login bucket", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-01T00:00:00.000Z"));
    prismaMock.loginThrottle.findMany.mockResolvedValue([
      { blockedUntil: new Date("2026-10-01T00:01:31.000Z") },
    ]);

    try {
      await assertSignInAllowed("NIMAL@WAYPOINT.LK", "127.0.0.1");
      throw new Error("Expected the login to be blocked");
    } catch (error) {
      expect(error).toBeInstanceOf(LoginRateLimitError);
      expect((error as LoginRateLimitError).retryAfterSeconds).toBe(91);
    } finally {
      vi.useRealTimers();
    }
  });

  it("blocks both login buckets on the fifth failure", async () => {
    vi.useFakeTimers();
    const now = new Date("2026-10-01T00:00:00.000Z");
    vi.setSystemTime(now);
    const firstFailureAt = new Date("2026-09-30T23:59:00.000Z");
    prismaMock.loginThrottle.findUnique.mockResolvedValue({
      failures: 4,
      firstFailureAt,
    });
    prismaMock.$transaction.mockImplementation(async (work) => work(prismaMock));

    try {
      await recordSignInFailure("nimal@waypoint.lk", "127.0.0.1");

      expect(prismaMock.loginThrottle.upsert).toHaveBeenCalledTimes(2);
      for (const [call] of prismaMock.loginThrottle.upsert.mock.calls) {
        expect(call.update).toMatchObject({
          failures: 5,
          firstFailureAt,
          blockedUntil: new Date("2026-10-01T00:15:00.000Z"),
        });
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it("clears hashed email and IP buckets without storing raw identifiers", async () => {
    await clearSignInFailures("NIMAL@WAYPOINT.LK", "127.0.0.1");

    const call = prismaMock.loginThrottle.deleteMany.mock.calls[0]?.[0];
    const keys = call.where.key.in as string[];
    expect(keys).toHaveLength(2);
    expect(keys.every((key) => /^(email|ip):[a-f0-9]{64}$/.test(key))).toBe(true);
    expect(JSON.stringify(call)).not.toContain("nimal@waypoint.lk");
    expect(JSON.stringify(call)).not.toContain("127.0.0.1");
  });
});
