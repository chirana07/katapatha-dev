import fp from "fastify-plugin";
import type { Role } from "@prisma/client";
import {
  AuthError,
  SESSION_COOKIE,
  getSessionByToken,
  requireRoleOf,
  type SessionUser,
} from "../lib/auth.js";

declare module "fastify" {
  interface FastifyRequest {
    /** The signed-in user, resolved once per request. */
    user: SessionUser | null;
    /** Asserts a role and returns the user. Throws AuthError otherwise. */
    requireRole(...roles: Role[]): SessionUser;
  }
  interface FastifyReply {
    setSessionCookie(token: string, expiresAt: Date): void;
    clearSessionCookie(): void;
  }
}

/**
 * Accepts the session token from EITHER an httpOnly cookie (web) or an
 * `Authorization: Bearer` header (mobile).
 *
 * One session table serves both clients because the token is the same opaque
 * value in both transports; only its sha256 hash is ever stored. Web and API
 * are deployed same-origin behind the reverse proxy, so CORS and SameSite
 * never enter the picture.
 */
export default fp(async (fastify) => {
  fastify.decorateRequest("user", null);

  fastify.decorateRequest("requireRole", function (this: any, ...roles: Role[]) {
    return requireRoleOf(this.user, ...roles);
  });

  fastify.decorateReply("setSessionCookie", function (this: any, token: string, expiresAt: Date) {
    this.setCookie(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      expires: expiresAt,
    });
  });

  fastify.decorateReply("clearSessionCookie", function (this: any) {
    this.clearCookie(SESSION_COOKIE, { path: "/" });
  });

  fastify.addHook("onRequest", async (request) => {
    const bearer = request.headers.authorization?.startsWith("Bearer ")
      ? request.headers.authorization.slice(7)
      : undefined;
    const token = request.cookies?.[SESSION_COOKIE] ?? bearer;
    request.user = await getSessionByToken(token);
  });

  fastify.decorate("AuthError", AuthError);
}, { name: "session", dependencies: ["prisma"] });
