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

  it("leaves the other reference endpoints as explicit stubs", async () => {
    const server = Fastify();
    servers.push(server);
    server.decorateRequest("requireRole", function () {
      return signedInUser;
    });
    await server.register(referenceRoutes, { prefix: "/v1" });

    const response = await server.inject({
      method: "GET",
      url: "/v1/reference/outlets",
    });

    expect(response.statusCode).toBe(501);
    expect(response.json()).toMatchObject({
      error: { code: "NOT_IMPLEMENTED" },
    });
  });
});
