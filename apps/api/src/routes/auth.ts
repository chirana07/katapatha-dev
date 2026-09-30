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

  fastify.delete("/auth/session", async (request, reply) => {
    const bearer = request.headers.authorization?.startsWith("Bearer ")
      ? request.headers.authorization.slice(7)
      : undefined;
    await destroySessionByToken(request.cookies?.[SESSION_COOKIE] ?? bearer);
    reply.clearSessionCookie();
    return reply.status(204).send();
  });

  fastify.get("/auth/me", async (request) => request.requireRole());
}
