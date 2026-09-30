import { describe, expect, it } from "vitest";
import { Role as PrismaRole } from "@prisma/client";
import { ROLES, type Role } from "@katapatha/core/domain/roles";

/**
 * packages/core declares the Role union locally so it stays free of Prisma and
 * can be used by the web and mobile clients. That decoupling is only safe if
 * something fails loudly when the two drift apart. This is that something.
 */
describe("the core Role union matches the Prisma enum", () => {
  it("has exactly the same members", () => {
    expect([...ROLES].sort()).toEqual(Object.values(PrismaRole).sort());
  });

  it("is assignable in both directions", () => {
    const fromPrisma: Role = PrismaRole.DISPATCHER;
    const toPrisma: PrismaRole = "STORE_MANAGER";
    expect(fromPrisma).toBe("DISPATCHER");
    expect(toPrisma).toBe(PrismaRole.STORE_MANAGER);
  });
});
