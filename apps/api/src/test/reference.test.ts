import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFERRAL_REASONS,
  PROBLEM_REASONS,
  SHORTFALL_REASONS,
  STORE_ISSUE_REASONS,
  STORE_PROBLEM_KINDS,
} from "@katapatha/core/domain/reasons";
import type { SessionUser } from "../lib/auth.js";
import errorsPlugin from "../plugins/errors.js";
import { nextOperatingDate } from "../services/store.js";
import referenceRoutes from "../routes/reference.js";

vi.mock("../services/store.js", () => ({
  nextOperatingDate: vi.fn(),
}));

const nextOperatingDateMock = vi.mocked(nextOperatingDate);

const signedInUser: SessionUser = {
  id: "USR001",
  email: "nimal@waypoint.lk",
  name: "Nimal",
  role: "DISPATCHER",
  depotCode: "Peliyagoda",
  outletId: null,
  defaultVehicleId: null,
};

const outlet = {
  id: "OUT074",
  displayName: "Fresh Nugegoda",
  brand: "Fresh" as const,
  districtName: "Colombo",
  depotCode: "Peliyagoda",
  dockType: "rear_dock" as const,
  parkingConstraint: "van_only" as const,
  windowOpen: "06:00",
  windowClose: "11:00",
  mallWindowOpen: null,
  mallWindowClose: null,
};

const vehicle = {
  id: "VEH043",
  type: "truck" as const,
  temp: "reefer" as const,
  weightCapKg: 3500,
  volumeCapM3: 18.5,
  kmPerL: 7.2,
  weeklyFuelQuotaL: 420,
  depotCode: "Peliyagoda",
};

function decoratePrisma(
  server: ReturnType<typeof Fastify>,
  models: Record<string, unknown>,
) {
  server.decorate("prisma", models as unknown as ReturnType<typeof Fastify>["prisma"]);
}

describe("GET /v1/reference/vocabularies", () => {
  const servers: ReturnType<typeof Fastify>[] = [];

  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => server.close()));
  });

  it("returns the server-owned reason-code lists to a signed-in user", async () => {
    const server = Fastify();
    servers.push(server);

    const requireRole = vi.fn();
    server.decorateRequest("requireRole", function () {
      requireRole();
      return signedInUser;
    });
    await server.register(referenceRoutes, { prefix: "/v1" });

    const response = await server.inject({
      method: "GET",
      url: "/v1/reference/vocabularies",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      deferralReasons: DEFERRAL_REASONS.map(({ code }) => code),
      shortfallReasons: SHORTFALL_REASONS.map(({ code }) => code),
      problemReasons: PROBLEM_REASONS.map(({ code }) => code),
      storeProblemKinds: STORE_PROBLEM_KINDS.map(({ code }) => code),
      storeIssueReasons: STORE_ISSUE_REASONS.map(({ code }) => code),
    });
    expect(requireRole).toHaveBeenCalledOnce();
  });
});

describe("GET /v1/reference/outlets", () => {
  const servers: ReturnType<typeof Fastify>[] = [];

  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => server.close()));
  });

  it("returns only outlets at the signed-in user's depot", async () => {
    const server = Fastify();
    servers.push(server);
    const findMany = vi.fn().mockResolvedValue([outlet]);
    decoratePrisma(server, { outlet: { findMany } });
    server.decorateRequest("requireRole", function () {
      return signedInUser;
    });
    await server.register(referenceRoutes, { prefix: "/v1" });

    const response = await server.inject({
      method: "GET",
      url: "/v1/reference/outlets",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual([outlet]);
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { depotCode: "Peliyagoda" },
      orderBy: { id: "asc" },
    }));
  });

  it("restricts a store manager to their assigned outlet", async () => {
    const server = Fastify();
    servers.push(server);
    const findMany = vi.fn().mockResolvedValue([outlet]);
    decoratePrisma(server, { outlet: { findMany } });
    server.decorateRequest("requireRole", function () {
      return {
        ...signedInUser,
        role: "STORE_MANAGER",
        depotCode: null,
        outletId: "OUT074",
      };
    });
    await server.register(referenceRoutes, { prefix: "/v1" });

    const response = await server.inject({
      method: "GET",
      url: "/v1/reference/outlets",
    });

    expect(response.statusCode).toBe(200);
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "OUT074" },
    }));
  });

  it("omits the optional display name when the database value is null", async () => {
    const server = Fastify();
    servers.push(server);
    decoratePrisma(server, {
      outlet: { findMany: vi.fn().mockResolvedValue([{ ...outlet, displayName: null }]) },
    });
    server.decorateRequest("requireRole", function () {
      return signedInUser;
    });
    await server.register(referenceRoutes, { prefix: "/v1" });

    const response = await server.inject({
      method: "GET",
      url: "/v1/reference/outlets",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()[0]).not.toHaveProperty("displayName");
  });
});

describe("GET /v1/reference/vehicles", () => {
  const servers: ReturnType<typeof Fastify>[] = [];

  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => server.close()));
  });

  it("returns only vehicles at the signed-in user's depot", async () => {
    const server = Fastify();
    servers.push(server);
    const findMany = vi.fn().mockResolvedValue([vehicle]);
    decoratePrisma(server, { vehicle: { findMany } });
    server.decorateRequest("requireRole", function () {
      return signedInUser;
    });
    await server.register(referenceRoutes, { prefix: "/v1" });

    const response = await server.inject({
      method: "GET",
      url: "/v1/reference/vehicles",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual([vehicle]);
    expect(findMany).toHaveBeenCalledWith({
      where: { depotCode: "Peliyagoda" },
      orderBy: { id: "asc" },
      select: {
        id: true,
        type: true,
        temp: true,
        weightCapKg: true,
        volumeCapM3: true,
        kmPerL: true,
        weeklyFuelQuotaL: true,
        depotCode: true,
      },
    });
  });

  it("does not expose depot vehicles to a store manager", async () => {
    const server = Fastify();
    servers.push(server);
    const findMany = vi.fn();
    decoratePrisma(server, { vehicle: { findMany } });
    server.decorateRequest("requireRole", function () {
      return {
        ...signedInUser,
        role: "STORE_MANAGER",
        depotCode: null,
        outletId: "OUT074",
      };
    });
    await server.register(referenceRoutes, { prefix: "/v1" });

    const response = await server.inject({
      method: "GET",
      url: "/v1/reference/vehicles",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual([]);
    expect(findMany).not.toHaveBeenCalled();
  });
});

describe("GET /v1/reference/calendar/next-operating-day", () => {
  const servers: ReturnType<typeof Fastify>[] = [];

  beforeEach(() => {
    nextOperatingDateMock.mockReset();
  });

  afterEach(async () => {
    vi.useRealTimers();
    await Promise.all(servers.splice(0).map((server) => server.close()));
  });

  it("returns the next operating date after the requested date", async () => {
    const server = Fastify();
    servers.push(server);
    nextOperatingDateMock.mockResolvedValue(new Date("2026-10-05T00:00:00.000Z"));
    server.decorateRequest("requireRole", function () {
      return signedInUser;
    });
    await server.register(referenceRoutes, { prefix: "/v1" });

    const response = await server.inject({
      method: "GET",
      url: "/v1/reference/calendar/next-operating-day?after=2026-10-01",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ date: "2026-10-05" });
    expect(nextOperatingDateMock).toHaveBeenCalledWith(
      new Date("2026-10-01T00:00:00.000Z"),
    );
  });

  it("defaults to today's date in Asia/Colombo", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-01T20:00:00.000Z"));
    const server = Fastify();
    servers.push(server);
    nextOperatingDateMock.mockResolvedValue(new Date("2026-10-03T00:00:00.000Z"));
    server.decorateRequest("requireRole", function () {
      return signedInUser;
    });
    await server.register(referenceRoutes, { prefix: "/v1" });

    const response = await server.inject({
      method: "GET",
      url: "/v1/reference/calendar/next-operating-day",
    });

    expect(response.statusCode).toBe(200);
    expect(nextOperatingDateMock).toHaveBeenCalledWith(
      new Date("2026-10-02T00:00:00.000Z"),
    );
  });

  it("rejects a malformed date before calling the calendar service", async () => {
    const server = Fastify();
    servers.push(server);
    server.decorateRequest("requireRole", function () {
      return signedInUser;
    });
    await server.register(errorsPlugin);
    await server.register(referenceRoutes, { prefix: "/v1" });

    const response = await server.inject({
      method: "GET",
      url: "/v1/reference/calendar/next-operating-day?after=not-a-date",
    });

    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({
      error: { code: "REQUEST_DOES_NOT_MATCH_CONTRACT" },
    });
    expect(nextOperatingDateMock).not.toHaveBeenCalled();
  });

  it("does not expose internals when the calendar has no future operating day", async () => {
    const server = Fastify({ logger: false });
    servers.push(server);
    nextOperatingDateMock.mockResolvedValue(null);
    server.decorateRequest("requireRole", function () {
      return signedInUser;
    });
    await server.register(errorsPlugin);
    await server.register(referenceRoutes, { prefix: "/v1" });

    const response = await server.inject({
      method: "GET",
      url: "/v1/reference/calendar/next-operating-day?after=2099-12-31",
    });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({
      error: { code: "INTERNAL", message: "Something went wrong." },
    });
  });
});
