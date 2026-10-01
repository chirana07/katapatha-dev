import type { FastifyInstance } from "fastify";
import {
  createSession,
  destroySessionByToken,
  verifyCredentials,
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
    role: { type: "string", enum: ["DISPATCHER", "LOADER", "DRIVER", "STORE_MANAGER"] },
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
      body: {
        type: "object",
        required: ["email", "password"],
        additionalProperties: false,
        properties: {
          email: { type: "string", format: "email" },
          password: { type: "string", minLength: 1 },
        },
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
    const { email, password } = request.body as { email: string; password: string };

    await assertSignInAllowed(email, request.ip);

    const user = await verifyCredentials(email, password);
    if (!user) {
      await recordSignInFailure(email, request.ip);
      throw new AuthError("Those details do not match an account.", 401);
    }
    await clearSignInFailures(email, request.ip);

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
