import { cookies } from "next/headers";
import { createKatapathaClient } from "@katapatha/api-client/client";

/**
 * The server-side API client.
 *
 * Pages stay server components and only their DATA LINE changes: a Prisma call
 * becomes an api.GET. That is what keeps the migration from the previous app a
 * rewiring rather than a rewrite, and why roughly 90% of the existing JSX
 * survives.
 *
 * Point API_BASE_URL at the Prism mock (http://localhost:4010) to build a
 * screen before its endpoint exists. Note the mock serves paths at the ROOT,
 * while the real API mounts them under /v1.
 */
export async function api() {
  const jar = await cookies();
  const cookieHeader = jar
    .getAll()
    .map((c) => `${c.name}=${c.value}`)
    .join("; ");

  return createKatapathaClient({
    baseUrl: process.env.API_BASE_URL ?? "http://localhost:3001/v1",
    headers: cookieHeader ? { cookie: cookieHeader } : undefined,
  });
}
