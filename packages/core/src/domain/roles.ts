/**
 * The four roles, declared locally.
 *
 * This union is deliberately NOT imported from "@prisma/client". packages/core
 * must stay framework- and database-free so the web and mobile clients can use
 * it without pulling in Prisma. apps/api owns a test that asserts this union
 * still matches the Prisma `Role` enum, so drift is caught at build time
 * rather than at runtime.
 */
export type Role = "DISPATCHER" | "LOADER" | "DRIVER" | "STORE_MANAGER";

export const ROLES: readonly Role[] = [
  "DISPATCHER",
  "LOADER",
  "DRIVER",
  "STORE_MANAGER",
] as const;
