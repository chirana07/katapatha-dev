/**
 * Add the demo catalogue to a database that was seeded before products
 * existed, without wiping anything.
 *
 * `pnpm db:seed` is a no-op on a seeded database (and SEED_FORCE=1 wipes it),
 * which would cost a running environment its orders, plans and history just to
 * gain a catalogue. This only adds: missing products (existing ones are left as
 * a dispatcher edited them) and, for a database seeded from the synthetic
 * fixture, the breakdown of the fixture's DEMO- orders that have none yet.
 * Orders from the competition data are never given invented contents.
 *
 *   pnpm db:seed:products
 */

import { PrismaClient } from "@prisma/client";
import { seedFixtureOrderLines, seedProducts } from "./products";
import { resolveDataSource } from "./source";

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const meta = await prisma.seedMeta.findUnique({ where: { key: "waypoint" } });
  // The recorded source wins over what is on disk now: the database was seeded
  // from one or the other, and a fixture breakdown must never land on real
  // orders just because the CSVs happen to be present today.
  const fixture = meta ? meta.dataSource.startsWith("fixture") : resolveDataSource().kind === "fixture";

  const products = await seedProducts(prisma);
  console.log(
    `[seed:products] ${products.total} products in the catalogue (${products.added} added). ` +
      `DEMO DATA: invented for the demo, not Waypoint's range.`,
  );

  if (!fixture) {
    console.log("[seed:products] Competition data: no order lines invented for its orders.");
    return;
  }
  const lines = await seedFixtureOrderLines(prisma);
  console.log(
    `[seed:products] ${lines.lines} order lines added across ${lines.orders} fixture orders ` +
      `(orders that already had lines are untouched).`,
  );
}

main()
  .catch((err) => {
    console.error("[seed:products] Failed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
