/**
 * The seeded accounts: one per operating role, as the booklet requires, and an
 * admin who keeps the accounts, outlets and vehicles.
 *
 * Their anchors are chosen from the hero day rather than picked at random, so
 * that signing in as each one lands you somewhere with a story:
 *
 *  - the dispatcher runs Peliyagoda, the depot the peak-day scenario covers
 *  - the loader works the Peliyagoda dock
 *  - the store manager is at OUT074, which on the hero day has a dry order AND
 *    a chilled order, was deferred yesterday, has gone five days unserved, and
 *    sits in Puttalam, where four Fresh orders cost 305 minutes against a 270
 *    minute budget. Every constraint in the brief meets at that one counter.
 */

import type { PrismaClient, Role } from "@prisma/client";
import bcrypt from "bcryptjs";

/** Printed by the seeder and shown only in the development access centre. */
export const DEMO_PASSWORD = "waypoint";

export const STORE_ANCHOR_OUTLET = "OUT074";

export interface SeedUser {
  email: string;
  name: string;
  role: Role;
  depotCode?: string;
  outletId?: string;
  blurb: string;
}

export const SEED_USERS: SeedUser[] = [
  {
    email: "nimal@waypoint.lk",
    name: "Nimal Perera",
    role: "DISPATCHER",
    depotCode: "Peliyagoda",
    blurb: "Plans the day, decides the deferrals, watches the road.",
  },
  {
    email: "ranjith@waypoint.lk",
    name: "Ranjith Silva",
    role: "LOADER",
    depotCode: "Peliyagoda",
    blurb: "Loads to the stop sequence and flags what is short.",
  },
  {
    email: "sunil@waypoint.lk",
    name: "Sunil Fernando",
    role: "DRIVER",
    depotCode: "Peliyagoda",
    blurb: "Drives the run, records every stop, works offline.",
  },
  {
    email: "fathima@waypoint.lk",
    name: "Fathima Rizvi",
    role: "STORE_MANAGER",
    outletId: STORE_ANCHOR_OUTLET,
    blurb: "Orders for OUT074, and needs to know when to staff the counter.",
  },
  {
    email: "asha@waypoint.lk",
    name: "Asha Wijesinghe",
    role: "ADMIN",
    blurb: "Keeps the accounts, outlets and vehicles; sees every depot.",
  },
];

export async function seedUsers(prisma: PrismaClient): Promise<number> {
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);

  for (const u of SEED_USERS) {
    await prisma.user.upsert({
      where: { email: u.email },
      update: {
        name: u.name,
        role: u.role,
        depotCode: u.depotCode ?? null,
        outletId: u.outletId ?? null,
        passwordHash,
      },
      create: {
        email: u.email,
        name: u.name,
        role: u.role,
        depotCode: u.depotCode ?? null,
        outletId: u.outletId ?? null,
        passwordHash,
      },
    });
  }

  return SEED_USERS.length;
}

export function printAccounts(): void {
  console.log("[seed] Sign in with any of these (password is the same for all):");
  const width = Math.max(...SEED_USERS.map((u) => u.email.length));
  for (const u of SEED_USERS) {
    console.log(
      `         ${u.email.padEnd(width)}  ${DEMO_PASSWORD.padEnd(10)}  ${u.role}`,
    );
  }
}
