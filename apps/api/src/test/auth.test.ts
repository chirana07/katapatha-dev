import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import type { SessionUser } from "../lib/auth.js";
import {
  AuthError,
  createSession,
  destroySessionByToken,
  verifyCredentials,
} from "../lib/auth.js";
import {
  assertSignInAllowed,
  clearSignInFailures,
  LoginRateLimitError,
  recordSignInFailure,
} from "../lib/loginThrottle.js";
import errorsPlugin from "../plugins/errors.js";
import authRoutes from "../routes/auth.js";

vi.mock("../lib/auth.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/auth.js")>();
  return {
    ...actual,
    createSession: vi.fn(),
    destroySessionByToken: vi.fn(),
    verifyCredentials: vi.fn(),
  };
});

vi.mock("../lib/loginThrottle.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/loginThrottle.js")>();
  return {
    ...actual,
    assertSignInAllowed: vi.fn(),
    clearSignInFailures: vi.fn(),
    recordSignInFailure: vi.fn(),
  };
});

const verifyCredentialsMock = vi.mocked(verifyCredentials);
const createSessionMock = vi.mocked(createSession);
const destroySessionMock = vi.mocked(destroySessionByToken);
const assertSignInAllowedMock = vi.mocked(assertSignInAllowed);
const recordSignInFailureMock = vi.mocked(recordSignInFailure);
const clearSignInFailuresMock = vi.mocked(clearSignInFailures);

const user: SessionUser = {
  id: "USR001",
  email: "nimal@waypoint.lk",
  name: "Nimal Perera",
  role: "DISPATCHER",
  depotCode: "Peliyagoda",
  outletId: null,
  defaultVehicleId: null,
};

describe("authentication routes", () => {
  const servers: ReturnType<typeof Fastify>[] = [];
  let setSessionCookie: Mock<(token: string, expiresAt: Date) => void>;
  let clearSessionCookie: Mock<() => void>;

  beforeEach(() => {
    vi.clearAllMocks();
    setSessionCookie = vi.fn();
    clearSessionCookie = vi.fn();
  });

  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => server.close()));
  });

  async function serverFor(currentUser: SessionUser | null = user) {
    const server = Fastify();
    servers.push(server);
    server.decorateRequest("requireRole", function () {
      if (!currentUser) throw new AuthError("Not signed in", 401);
      return currentUser;
    });
    server.decorateReply("setSessionCookie", function (token: string, expiresAt: Date) {
      setSessionCookie(token, expiresAt);
    });
    server.decorateReply("clearSessionCookie", function () {
      clearSessionCookie();
    });
    await server.register(errorsPlugin);
    await server.register(authRoutes, { prefix: "/v1" });
    return server;
  }

  it("creates a session and returns the role home", async () => {
    const server = await serverFor();
    const expiresAt = new Date("2026-11-01T00:00:00.000Z");
    verifyCredentialsMock.mockResolvedValue(user as never);
    createSessionMock.mockResolvedValue({ token: "opaque-token", expiresAt });

    const response = await server.inject({
      method: "POST",
      url: "/v1/auth/session",
      payload: { email: "nimal@waypoint.lk", password: "waypoint" },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual({ token: "opaque-token", home: "/dispatcher", user });
    expect(assertSignInAllowedMock).toHaveBeenCalledWith("nimal@waypoint.lk", "127.0.0.1");
    expect(clearSignInFailuresMock).toHaveBeenCalledWith("nimal@waypoint.lk", "127.0.0.1");
    expect(setSessionCookie).toHaveBeenCalledWith("opaque-token", expiresAt);
  });

  it("records a failed login and returns 401", async () => {
    const server = await serverFor();
    verifyCredentialsMock.mockResolvedValue(null);

    const response = await server.inject({
      method: "POST",
      url: "/v1/auth/session",
      payload: { email: "nimal@waypoint.lk", password: "wrong" },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({
      error: { code: "UNAUTHENTICATED", message: "Those details do not match an account." },
    });
    expect(recordSignInFailureMock).toHaveBeenCalledWith("nimal@waypoint.lk", "127.0.0.1");
    expect(createSessionMock).not.toHaveBeenCalled();
  });

  it("returns 429 and Retry-After when the login bucket is blocked", async () => {
    const server = await serverFor();
    assertSignInAllowedMock.mockRejectedValue(new LoginRateLimitError(73));

    const response = await server.inject({
      method: "POST",
      url: "/v1/auth/session",
      payload: { email: "nimal@waypoint.lk", password: "wrong" },
    });

    expect(response.statusCode).toBe(429);
    expect(response.headers["retry-after"]).toBe("73");
    expect(response.json()).toEqual({
      error: { code: "TOO_MANY_ATTEMPTS", message: "Too many sign-in attempts." },
    });
    expect(verifyCredentialsMock).not.toHaveBeenCalled();
  });

  it("returns the current user and rejects an unauthenticated request", async () => {
    const signedIn = await serverFor();
    const signedOut = await serverFor(null);

    const current = await signedIn.inject({ method: "GET", url: "/v1/auth/me" });
    const missing = await signedOut.inject({ method: "GET", url: "/v1/auth/me" });

    expect(current.statusCode).toBe(200);
    expect(current.json()).toEqual(user);
    expect(missing.statusCode).toBe(401);
  });

  it("destroys a bearer session and clears the cookie", async () => {
    const server = await serverFor();

    const response = await server.inject({
      method: "DELETE",
      url: "/v1/auth/session",
      headers: { authorization: "Bearer opaque-token" },
    });

    expect(response.statusCode).toBe(204);
    expect(destroySessionMock).toHaveBeenCalledWith("opaque-token");
    expect(clearSessionCookie).toHaveBeenCalledOnce();
  });
});
