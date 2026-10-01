

import { createHash } from "node:crypto";
import { prisma } from "./db";

const WINDOW_MS = 15 * 60 * 1_000;
const BLOCK_MS = 15 * 60 * 1_000;
const MAX_FAILURES = 5;

export class LoginRateLimitError extends Error {
  constructor(readonly retryAfterSeconds: number) {
    super("Too many sign-in attempts.");
    this.name = "LoginRateLimitError";
  }
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function keysFor(email: string, ip: string): string[] {
  const normalizedEmail = email.trim().toLowerCase();
  return [`email:${digest(normalizedEmail)}`, `ip:${digest(ip || "unknown")}`];
}

export function clientIp(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || headers.get("x-real-ip")?.trim() || "unknown";
}

export async function assertSignInAllowed(email: string, ip: string): Promise<void> {
  const now = new Date();
  const buckets = await prisma.loginThrottle.findMany({
    where: { key: { in: keysFor(email, ip) }, blockedUntil: { gt: now } },
    orderBy: { blockedUntil: "desc" },
  });
  const blockedUntil = buckets[0]?.blockedUntil;
  if (blockedUntil) {
    throw new LoginRateLimitError(
      Math.max(1, Math.ceil((blockedUntil.getTime() - now.getTime()) / 1_000)),
    );
  }
}

export async function recordSignInFailure(email: string, ip: string): Promise<void> {
  const now = new Date();
  const windowStart = new Date(now.getTime() - WINDOW_MS);

  await prisma.$transaction(async (tx) => {
    for (const key of keysFor(email, ip)) {
      const current = await tx.loginThrottle.findUnique({ where: { key } });
      const failures =
        !current || current.firstFailureAt < windowStart ? 1 : current.failures + 1;
      const blockedUntil =
        failures >= MAX_FAILURES ? new Date(now.getTime() + BLOCK_MS) : null;

      await tx.loginThrottle.upsert({
        where: { key },
        create: { key, failures, firstFailureAt: now, blockedUntil },
        update: {
          failures,
          firstFailureAt:
            !current || current.firstFailureAt < windowStart
              ? now
              : current.firstFailureAt,
          blockedUntil,
        },
      });
    }
  });
}

export async function clearSignInFailures(email: string, ip: string): Promise<void> {
  await prisma.loginThrottle.deleteMany({ where: { key: { in: keysFor(email, ip) } } });
}
