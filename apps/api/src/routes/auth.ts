import type { FastifyInstance } from "fastify";
import {
  createSession,
  destroySessionByToken,
  verifyCredentials,
  verifyStaffPin,
  normalizeStaffId,
  SESSION_COOKIE,
  HOME_FOR_ROLE,
  AuthError,
} from "../lib/auth.js";
import { assertSignInAllowed, recordSignInFailure, clearSignInFailures } from "../lib/loginThrottle.js";

const nullableString = { oneOf: [{ type: "string" }, { type: "null" }] } as const;
const sessionUserSchema = {
  type: "object",
  additionalProperties: false,
  required: ["id", "email", "name", "role", "depotCode", "outletId", "defaultVehicleId"],
  properties: {
    id: { type: "string" },
    email: { type: "string", format: "email" },
    name: { type: "string" },
    role: { type: "string", enum: ["DISPATCHER", "LOADER", "DRIVER", "STORE_MANAGER", "ADMIN"] },
    depotCode: nullableString,
    outletId: nullableString,
    defaultVehicleId: nullableString,
  },
} as const;
const errorSchema = {
  type: "object",
  additionalProperties: false,
  required: ["error"],
  properties: {
    error: {
      type: "object",
      additionalProperties: false,
      required: ["code", "message"],
      properties: {
        code: { type: "string" },
        message: { type: "string" },
      },
    },
  },
} as const;

/** Owner: BE1 */
export default async function (fastify: FastifyInstance) {
  fastify.post("/auth/session", {
    config: { rateLimit: { max: 20, timeWindow: "1 minute" } },
    schema: {
      // Email and password for everyone; staff ID and PIN for the loader's
      // shared dock tablet. Exactly one pair.
      body: {
        type: "object",
        additionalProperties: false,
        properties: {
          email: { type: "string", format: "email" },
          password: { type: "string", minLength: 1 },
          staffId: { type: "string", minLength: 2, maxLength: 32 },
          pin: { type: "string", pattern: "^[0-9]{4,8}$" },
        },
        oneOf: [{ required: ["email", "password"] }, { required: ["staffId", "pin"] }],
      },
      response: {
        201: {
          type: "object",
          additionalProperties: false,
          required: ["token", "home", "user"],
          properties: {
            token: { type: "string" },
            home: { type: "string" },
            user: sessionUserSchema,
          },
        },
        401: errorSchema,
        429: errorSchema,
      },
    },
  }, async (request, reply) => {
    const body = request.body as { email?: string; password?: string; staffId?: string; pin?: string };
    // The throttle buckets by identifier, so a staff ID gets its own bucket and
    // can never collide with an email address.
    const identifier = body.staffId != null ? `staff:${normalizeStaffId(body.staffId)}` : body.email!;

    await assertSignInAllowed(identifier, request.ip);

    const user =
      body.staffId != null
        ? await verifyStaffPin(body.staffId, body.pin!)
        : await verifyCredentials(body.email!, body.password!);
    if (!user) {
      await recordSignInFailure(identifier, request.ip);
      throw new AuthError("Those details do not match an account.", 401);
    }
    await clearSignInFailures(identifier, request.ip);

    const { token, expiresAt } = await createSession(user.id, request.headers["user-agent"]);
    reply.setSessionCookie(token, expiresAt);

    // The token is ALSO returned in the body: the web app uses the cookie, the
    // mobile app uses this as a bearer token.
    return reply.status(201).send({
      token,
      home: HOME_FOR_ROLE[user.role],
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        depotCode: user.depotCode,
        outletId: user.outletId,
        defaultVehicleId: user.defaultVehicleId,
      },
    });
  });

  fastify.delete("/auth/session", {
    schema: {
      response: {
        204: { type: "null" },
      },
    },
  }, async (request, reply) => {
    const bearer = request.headers.authorization?.startsWith("Bearer ")
      ? request.headers.authorization.slice(7)
      : undefined;
    await destroySessionByToken(request.cookies?.[SESSION_COOKIE] ?? bearer);
    reply.clearSessionCookie();
    return reply.status(204).send();
  });

  fastify.get("/auth/me", {
    schema: {
      response: {
        200: sessionUserSchema,
        401: errorSchema,
      },
    },
  }, async (request) => request.requireRole());
}
