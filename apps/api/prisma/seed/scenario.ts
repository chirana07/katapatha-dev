/**
 * Rehearsal scenarios for the hero day (2026-04-09).
 *
 * Run AFTER `pnpm demo:reset` and BEFORE the dispatcher runs the allocator.
 * Each scenario only changes which vehicles are in the workshop that day — a
 * real operational input the allocator already reads — so every deferral it
 * produces is genuine, never a hand-written row.
 *
 *   tsx prisma/seed/scenario.ts <name>
 */

import { PrismaClient, type VehicleStatus } from "@prisma/client";

const HERO_DATE = new Date("2026-04-09T00:00:00.000Z");

/** Vehicle -> status on the hero day. Anything not listed keeps its seed value. */
const SCENARIOS: Record<string, { about: string; status: Record<string, VehicleStatus> }> = {
  default: {
    about: "Seed as shipped: VEH104 in the workshop; DEMO-012 (45 m³) can never fit.",
    status: { VEH101: "AVAILABLE", VEH103: "AVAILABLE", VEH104: "IN_WORKSHOP" },
  },
  "reefer-tight": {
    about: "VEH101 (reefer truck) in the workshop: chilled orders compete for the one reefer van.",
    status: { VEH101: "IN_WORKSHOP", VEH103: "AVAILABLE", VEH104: "IN_WORKSHOP" },
  },
  "reefer-out": {
    about: "Both reefers in the workshop: every chilled order is deferred, including OUT074 (Fathima).",
    status: { VEH101: "IN_WORKSHOP", VEH103: "IN_WORKSHOP", VEH104: "IN_WORKSHOP" },
  },
};

async function main() {
  const name = process.argv[2] ?? "";
  const scenario = SCENARIOS[name];
  if (!scenario) {
    console.log("Usage: tsx prisma/seed/scenario.ts <scenario>\n");
    for (const [key, s] of Object.entries(SCENARIOS)) console.log(`  ${key.padEnd(14)} ${s.about}`);
    process.exit(name ? 1 : 0);
  }

  const prisma = new PrismaClient();
  try {
    for (const [vehicleId, status] of Object.entries(scenario.status)) {
      await prisma.vehicleDayStatus.upsert({
        where: { date_vehicleId: { date: HERO_DATE, vehicleId } },
        create: { date: HERO_DATE, vehicleId, status, note: `Scenario: ${name}` },
        update: { status, note: `Scenario: ${name}`, setAt: new Date() },
      });
    }
    console.log(`Scenario '${name}' applied for 2026-04-09: ${scenario.about}`);
  } finally {
    await prisma.$disconnect();
  }
}

await main();
