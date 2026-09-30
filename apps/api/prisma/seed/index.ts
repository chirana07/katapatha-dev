/**
 * Seed orchestrator.
 *
 * Idempotent: a `SeedMeta` row records the source kind and a fingerprint of
 * the input files, so re-running is a no-op unless the data changed or
 * SEED_FORCE=1. That matters because `docker compose up` runs this on every
 * boot, and because swapping the synthetic fixture for the real CSVs must
 * re-seed rather than silently leave stale rows behind.
 */

import { PrismaClient } from "@prisma/client";
import { seedForecastShells, seedHeroDay } from "./heroDay";
import { seedReference } from "./reference";
import { resolveDataSource, sourceChecksum } from "./source";
import { printAccounts, seedUsers } from "./users";

const SEED_KEY = "waypoint";
const SEED_VERSION = "1";

const prisma = new PrismaClient();

/** Wipe every table the seeder owns, in FK-safe order. */
async function reset(): Promise<void> {
  // Operational and derived data first, then reference, then identity.
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      "StopEvent", "Problem", "ReceiptConfirmation", "StopReassignment",
      "LoadCheck", "Shortfall", "TripStopOrder", "TripStop", "Trip",
      "Assignment", "Deferral", "Plan", "PlanningDay", "Order",
      "FuelLedgerEntry", "FuelLedger", "CapacityAction", "SyncLog",
      "Notification", "AuditEvent", "Session", "LoginThrottle", "User",
      "VehicleDayStatus", "HistoricalLeg", "ServiceObservation",
      "DemandForecast", "DailyDemandHistory", "WeeklyDemandHistory",
      "RoadCondition", "TrafficSpeed", "CalendarDay", "ServiceAllowance",
      "Vehicle", "Outlet", "District", "Depot", "SeedMeta"
    RESTART IDENTITY CASCADE
  `);
}

async function main(): Promise<void> {
  const started = Date.now();
  const source = resolveDataSource();
  const checksum = sourceChecksum(source);
  const force = process.env.SEED_FORCE === "1";

  const existing = await prisma.seedMeta.findUnique({ where: { key: SEED_KEY } });
  if (existing && existing.checksum === checksum && existing.version === SEED_VERSION && !force) {
    console.log(
      `[seed] Already seeded from ${existing.dataSource} data at ${existing.seededAt.toISOString()}. ` +
        `Set SEED_FORCE=1 to seed again.`,
    );
    return;
  }

  if (existing) {
    console.log("[seed] Source or version changed — clearing and re-seeding.");
  }
  await reset();

  const reference = await seedReference(prisma, source);
  console.log("[seed] Reference data:");
  for (const [name, count] of Object.entries(reference)) {
    console.log(`         ${String(count).padStart(6)}  ${name}`);
  }

  const users = await seedUsers(prisma);
  console.log(`[seed] ${users} accounts, one per role.`);

  const hero = await seedHeroDay(prisma, source);
  if (hero) {
    const brands = Object.entries(hero.byBrand)
      .sort()
      .map(([b, n]) => `${b} ${n}`)
      .join(", ");
    console.log(
      `[seed] Hero day: ${hero.orders} orders (${brands}); ` +
        `${hero.chilledOrders} chilled totalling ${hero.chilledVolumeM3} m3; ` +
        `${hero.vehiclesAvailable} vehicles available, ${hero.vehiclesInWorkshop} in the workshop.`,
    );
  }

  const forecastWeeks = await seedForecastShells(prisma, source);
  if (forecastWeeks > 0) {
    console.log(`[seed] ${forecastWeeks} forecast rows opened (depot x brand x week).`);
  }

  await prisma.seedMeta.create({
    data: {
      key: SEED_KEY,
      version: SEED_VERSION,
      dataSource: source.kind,
      checksum,
    },
  });

  printAccounts();
  console.log(`[seed] Done in ${((Date.now() - started) / 1000).toFixed(1)}s.`);
}

main()
  .catch((err) => {
    console.error("[seed] Failed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
