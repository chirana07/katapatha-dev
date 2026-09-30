import { PrismaClient } from "@prisma/client";

/**
 * One Prisma client for the process.
 *
 * Stashed on globalThis so `tsx watch` reloading a module does not open a new
 * pool on every save and exhaust Postgres' connection limit.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "production" ? ["error"] : ["warn", "error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
