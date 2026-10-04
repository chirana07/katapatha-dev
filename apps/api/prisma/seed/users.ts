/**
 * The four seeded accounts, one per role, as the booklet requires.
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

/** The loader signs in on the shared dock tablet with these instead. */
export const DEMO_LOADER_STAFF_ID = "LDR-0142";
export const DEMO_LOADER_PIN = "4826";

export interface SeedUser {
  email: string;
  name: string;
  role: Role;
  depotCode?: string;
  outletId?: string;
  /** Loaders only: the badge number the dock tablet signs in with. */
  staffId?: string;
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
    staffId: DEMO_LOADER_STAFF_ID,
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
];

export async function seedUsers(prisma: PrismaClient): Promise<number> {
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);
  const pinHash = await bcrypt.hash(DEMO_LOADER_PIN, 10);

  for (const u of SEED_USERS) {
    await prisma.user.upsert({
      where: { email: u.email },
      update: {
        name: u.name,
        role: u.role,
        depotCode: u.depotCode ?? null,
        outletId: u.outletId ?? null,
        passwordHash,
        staffId: u.staffId ?? null,
        pinHash: u.staffId ? pinHash : null,
      },
      create: {
        email: u.email,
        name: u.name,
        role: u.role,
        depotCode: u.depotCode ?? null,
        outletId: u.outletId ?? null,
        passwordHash,
        staffId: u.staffId ?? null,
        pinHash: u.staffId ? pinHash : null,
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
  console.log(`[seed] The loader's dock tablet: staff ID ${DEMO_LOADER_STAFF_ID}, PIN ${DEMO_LOADER_PIN}.`);
}
