import Fastify from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFERRAL_REASONS,
  PROBLEM_REASONS,
  SHORTFALL_REASONS,
} from "@katapatha/core/domain/reasons";
import type { SessionUser } from "../lib/auth.js";
import referenceRoutes from "../routes/reference.js";

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

function decoratePrisma(
  server: ReturnType<typeof Fastify>,
  findMany: ReturnType<typeof vi.fn>,
) {
  server.decorate("prisma", {
    outlet: { findMany },
  } as unknown as ReturnType<typeof Fastify>["prisma"]);
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
    decoratePrisma(server, findMany);
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
    decoratePrisma(server, findMany);
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
    decoratePrisma(server, vi.fn().mockResolvedValue([{ ...outlet, displayName: null }]));
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

  it("leaves the other reference endpoints as explicit stubs", async () => {
    const server = Fastify();
    servers.push(server);
    server.decorateRequest("requireRole", function () {
      return signedInUser;
    });
    await server.register(referenceRoutes, { prefix: "/v1" });

    const response = await server.inject({
      method: "GET",
      url: "/v1/reference/vehicles",
    });

    expect(response.statusCode).toBe(501);
    expect(response.json()).toMatchObject({
      error: { code: "NOT_IMPLEMENTED" },
    });
  });
});
