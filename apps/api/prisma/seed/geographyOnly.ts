/**
 * Give depots and outlets positions in a database seeded before they had any,
 * without wiping anything. Fills gaps only; a position a dispatcher set is never
 * touched.
 *
 *   pnpm db:seed:geography
 */

import { PrismaClient } from "@prisma/client";
import { seedGeography } from "./geography";
import { resolveDataSource } from "./source";

const prisma = new PrismaClient();

seedGeography(prisma, resolveDataSource())
  .then((c) =>
    console.log(
      `[seed:geography] ${c.depots} depots, ${c.fromCsv} outlets from outlet_locations.csv, ` +
        `${c.synthetic} placed near their district centre (approximate).`,
    ),
  )
  .catch((err) => {
    console.error("[seed:geography] Failed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
