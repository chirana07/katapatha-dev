import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import autoload from "@fastify/autoload";
import cookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import { CONTRACT_AJV } from "./lib/ajv.js";

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * Builds the app.
 *
 * Note what is NOT here: a list of routes. Plugins and routes are discovered
 * from the filesystem by @fastify/autoload, so adding an endpoint means adding
 * a FILE and never editing this one. That is the main reason this project uses
 * Fastify rather than a framework with a central module registry — with three
 * backend developers working in parallel, a shared registry file is where the
 * merge conflicts would live.
 */
export async function buildServer(): Promise<FastifyInstance> {
  const fastify = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? "info",
      transport:
        process.env.NODE_ENV === "production"
          ? undefined
          : { target: "pino-pretty", options: { translateTime: "HH:MM:ss", ignore: "pid,hostname" } },
    },
    // Shared with the route tests, which would otherwise run against default
    // AJV options and silently fail to test the contract. See lib/ajv.ts.
    ajv: CONTRACT_AJV,
  });

  await fastify.register(helmet, { contentSecurityPolicy: false });
  await fastify.register(cookie);
  await fastify.register(rateLimit, { max: 300, timeWindow: "1 minute", keyGenerator: rateLimitKey });

  await fastify.register(autoload, { dir: path.join(here, "plugins") });
  await fastify.register(autoload, {
    dir: path.join(here, "routes"),
    options: { prefix: "/v1" },
  });

  return fastify;
}

/**
 * Who a request counts against for the rate limit.
 *
 * Per signed-in session, not per IP: every web page reaches the API from the
 * one Next.js server, so keyed by IP the whole depot's web users shared a
 * single 300-a-minute allowance and a few busy screens locked everyone out
 * ("could not verify your session"). Sign-in itself stays keyed by IP, so a
 * made-up cookie cannot buy more password guesses; the per-account login
 * throttle in lib/loginThrottle.ts sits behind it as well.
 */
function rateLimitKey(request: FastifyRequest): string {
  if (request.url.startsWith("/v1/auth/session")) return `ip:${request.ip}`;
  const bearer = request.headers.authorization?.startsWith("Bearer ") ? request.headers.authorization.slice(7) : undefined;
  const cookie = /(?:^|;\s*)katapatha_session=([^;]+)/.exec(request.headers.cookie ?? "")?.[1];
  const token = bearer ?? cookie;
  return token ? `session:${createHash("sha256").update(token).digest("hex").slice(0, 32)}` : `ip:${request.ip}`;
}
