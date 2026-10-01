import Fastify from "fastify";
import fp from "fastify-plugin";
import cookie from "@fastify/cookie";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getSessionByToken, type SessionUser } from "../lib/auth.js";
import errorsPlugin from "../plugins/errors.js";
import sessionPlugin from "../plugins/session.js";

vi.mock("../lib/auth.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/auth.js")>();
  return { ...actual, getSessionByToken: vi.fn() };
});

const getSessionByTokenMock = vi.mocked(getSessionByToken);
const user: SessionUser = {
  id: "USR001",
  email: "nimal@waypoint.lk",
  name: "Nimal",
  role: "DISPATCHER",
  depotCode: "Peliyagoda",
  outletId: null,
  defaultVehicleId: null,
};

describe("session plugin", () => {
  const servers: ReturnType<typeof Fastify>[] = [];

  beforeEach(() => vi.clearAllMocks());

  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => server.close()));
  });

  async function build() {
    const server = Fastify();
    servers.push(server);
    await server.register(cookie);
    await server.register(fp(async () => {}, { name: "prisma" }));
    await server.register(errorsPlugin);
    await server.register(sessionPlugin);
    server.get("/who", async (request) => request.requireRole());
    return server;
  }

  it("authenticates a web request from its session cookie", async () => {
    const server = await build();
    getSessionByTokenMock.mockResolvedValue(user);

    const response = await server.inject({
      method: "GET",
      url: "/who",
      headers: { cookie: "katapatha_session=cookie-token" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(user);
    expect(getSessionByTokenMock).toHaveBeenCalledWith("cookie-token");
  });

  it("authenticates a mobile request from its bearer token", async () => {
    const server = await build();
    getSessionByTokenMock.mockResolvedValue(user);

    const response = await server.inject({
      method: "GET",
      url: "/who",
      headers: { authorization: "Bearer mobile-token" },
    });

    expect(response.statusCode).toBe(200);
    expect(getSessionByTokenMock).toHaveBeenCalledWith("mobile-token");
  });

  it("returns 401 when neither transport resolves a session", async () => {
    const server = await build();
    getSessionByTokenMock.mockResolvedValue(null);

    const response = await server.inject({ method: "GET", url: "/who" });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({
      error: { code: "UNAUTHENTICATED", message: "Not signed in" },
    });
  });
});
