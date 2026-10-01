import Fastify from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import systemRoutes from "../routes/system.js";

describe("GET /v1/health", () => {
  const servers: ReturnType<typeof Fastify>[] = [];

  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => server.close()));
  });

  it("returns a valid liveness timestamp without authentication", async () => {
    const server = Fastify();
    servers.push(server);
    await server.register(systemRoutes, { prefix: "/v1" });

    const response = await server.inject({ method: "GET", url: "/v1/health" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ ok: true });
    expect(Number.isNaN(Date.parse(response.json().at))).toBe(false);
  });
});
