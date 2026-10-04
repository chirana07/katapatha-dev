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

/** The loader's dock tablet badge, kept as named constants because the demo
 *  scripts and docs refer to it. */
export const DEMO_LOADER_STAFF_ID = "LDR-0142";
export const DEMO_LOADER_PIN = "4826";

export interface SeedUser {
  email: string;
  name: string;
  role: Role;
  depotCode?: string;
  outletId?: string;
  /** The Waypoint staff ID and PIN every sign-in screen asks for (D-01,
   *  L-01, R-01, S-01). Email and password still work for the native driver
   *  app and the demo scripts. */
  staffId: string;
  pin: string;
  blurb: string;
}

export const SEED_USERS: SeedUser[] = [
  {
    email: "nimal@waypoint.lk",
    name: "Nimal Perera",
    role: "DISPATCHER",
    depotCode: "Peliyagoda",
    staffId: "DSP-0101",
    pin: "2580",
    blurb: "Plans the day, decides the deferrals, watches the road.",
  },
  {
    email: "ranjith@waypoint.lk",
    name: "Ranjith Silva",
    role: "LOADER",
    depotCode: "Peliyagoda",
    staffId: DEMO_LOADER_STAFF_ID,
    pin: DEMO_LOADER_PIN,
    blurb: "Loads to the stop sequence and flags what is short.",
  },
  {
    email: "sunil@waypoint.lk",
    name: "Sunil Fernando",
    role: "DRIVER",
    depotCode: "Peliyagoda",
    staffId: "DRV-0207",
    pin: "1357",
    blurb: "Drives the run, records every stop, works offline.",
  },
  {
    email: "fathima@waypoint.lk",
    name: "Fathima Rizvi",
    role: "STORE_MANAGER",
    outletId: STORE_ANCHOR_OUTLET,
    staffId: "STR-0074",
    pin: "9024",
    blurb: "Orders for OUT074, and needs to know when to staff the counter.",
  },
  {
    email: "asha@waypoint.lk",
    name: "Asha Wijesinghe",
    role: "ADMIN",
    staffId: "ADM-0001",
    pin: "7531",
    blurb: "Keeps the accounts, outlets and vehicles; sees every depot.",
  },
];

export async function seedUsers(prisma: PrismaClient): Promise<number> {
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);

  for (const u of SEED_USERS) {
    const pinHash = await bcrypt.hash(u.pin, 10);
    await prisma.user.upsert({
      where: { email: u.email },
      update: {
        name: u.name,
        role: u.role,
        depotCode: u.depotCode ?? null,
        outletId: u.outletId ?? null,
        passwordHash,
        staffId: u.staffId,
        pinHash,
      },
      create: {
        email: u.email,
        name: u.name,
        role: u.role,
        depotCode: u.depotCode ?? null,
        outletId: u.outletId ?? null,
        passwordHash,
        staffId: u.staffId,
        pinHash,
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
  console.log("[seed] Or by Waypoint staff ID and PIN (what the sign-in screens ask for):");
  for (const u of SEED_USERS) console.log(`         ${u.staffId.padEnd(10)}  PIN ${u.pin}  ${u.role}`);
}
