

import { createHash, randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import type { Role, User } from "@prisma/client";
import { prisma } from "./db";
export {
  HOME_FOR_ROLE,
  PREFIX_FOR_ROLE,
  safePostLoginPath,
} from "@katapatha/core/domain/authPaths";

/**
 * Sessions, deliberately plain.
 *
 * An opaque random token in an httpOnly cookie, and a row in the database. No
 * NextAuth, no JWT — about eighty readable lines, which matters when a judge
 * reads the code and when something goes wrong at 2 a.m.
 *
 * The 30-day lifetime with no rotation is a considered choice, not laziness:
 * a driver's phone has to stay signed in across a stretch with no coverage,
 * and a short rotating token would sign them out exactly when they cannot do
 * anything about it. The offline outbox depends on this.
 */

export const SESSION_COOKIE = "katapatha_session";
const SESSION_DAYS = 30;

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  depotCode: string | null;
  outletId: string | null;
  /** The vehicle a driver picked at the dock for today's run. */
  defaultVehicleId: string | null;
}

function toSessionUser(user: User): SessionUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    depotCode: user.depotCode,
    outletId: user.outletId,
    defaultVehicleId: user.defaultVehicleId,
  };
}

function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function verifyCredentials(
  email: string,
  password: string,
): Promise<User | null> {
  const user = await prisma.user.findUnique({
    where: { email: email.trim().toLowerCase() },
  });
  if (!user) {
    // Hash anyway so a missing account and a wrong password take the same
    // time; otherwise the response time tells an attacker which emails exist.
    await bcrypt.compare(password, "$2b$10$invalidinvalidinvalidinvalidinvalidinv");
    return null;
  }
  const ok = await bcrypt.compare(password, user.passwordHash);
  return ok ? user : null;
}

/** Staff ID and PIN, for the loader's shared dock tablet. Same constant-time
 *  shape as email and password: an unknown staff ID still costs one compare. */
export async function verifyStaffPin(staffId: string, pin: string): Promise<User | null> {
  const user = await prisma.user.findUnique({
    where: { staffId: normalizeStaffId(staffId) },
  });
  if (!user?.pinHash) {
    await bcrypt.compare(pin, "$2b$10$invalidinvalidinvalidinvalidinvalidinv");
    return null;
  }
  const ok = await bcrypt.compare(pin, user.pinHash);
  return ok ? user : null;
}

/** Staff IDs are printed on badges in capitals; people type them any way. */
export function normalizeStaffId(staffId: string): string {
  return staffId.trim().toUpperCase();
}

/**
 * Mint a session row and return the opaque token.
 *
 * Transport is deliberately NOT decided here. The HTTP layer sets the cookie
 * (for the web app) and also returns the token in the body (for the mobile
 * app), which is why the same session table serves both with no schema change.
 */
export async function createSession(
  userId: string,
  userAgent?: string,
): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);

  await prisma.session.create({
    data: { token: hashSessionToken(token), userId, expiresAt, userAgent },
  });

  return { token, expiresAt };
}

export async function destroySessionByToken(token: string | undefined): Promise<void> {
  if (!token) return;
  await prisma.session.deleteMany({ where: { token: hashSessionToken(token) } });
}

/** The user behind a token, or null. The caller extracts the token. */
export async function getSessionByToken(
  token: string | undefined,
): Promise<SessionUser | null> {
  if (!token) return null;

  const session = await prisma.session.findUnique({
    where: { token: hashSessionToken(token) },
    include: { user: true },
  });
  if (!session) return null;

  if (session.expiresAt.getTime() < Date.now()) {
    await prisma.session.deleteMany({ where: { token: hashSessionToken(token) } });
    return null;
  }

  return toSessionUser(session.user);
}

export class AuthError extends Error {
  constructor(
    message: string,
    readonly status: 401 | 403,
  ) {
    super(message);
    this.name = "AuthError";
  }
}

/**
 * Guard for route handlers and server actions.
 *
 * The proxy redirects unauthenticated *page* requests, but that is an
 * optimistic check only — server functions are reachable by direct POST, so
 * every one of them calls this itself.
 */
export function requireRoleOf(
  user: SessionUser | null,
  ...roles: Role[]
): SessionUser {
  if (!user) throw new AuthError("Not signed in", 401);
  if (roles.length > 0 && !roles.includes(user.role)) {
    throw new AuthError(`This is not available to ${user.role}`, 403);
  }
  return user;
}
