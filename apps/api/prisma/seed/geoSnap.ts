/**
 * Move outlet positions onto the nearest road, using the OSRM service.
 *
 *   pnpm geo:snap
 *
 * Seeded positions are a point near the district centre, which may be in a field
 * or the sea; a delivery has to start from a road. This asks OSRM for the nearest
 * one and records `geoSnapped`. Idempotent: only unsnapped outlets are touched,
 * and a position a dispatcher placed is never moved here (their pin is snapped,
 * if they ask, when they save it). Needs OSRM_URL; without it nothing changes.
 */

import { PrismaClient } from "@prisma/client";
import { nearest, osrmStatus } from "../../src/services/routing";

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const status = await osrmStatus();
  if (!status.live) {
    console.log(
      status.configured
        ? "[geo:snap] OSRM_URL is set but the service is not answering. Start it with `pnpm osrm:up`."
        : "[geo:snap] OSRM_URL is not set, so there is no road network to snap to. Nothing changed.",
    );
    return;
  }

  const outlets = await prisma.outlet.findMany({
    where: { geoSnapped: false, lat: { not: null }, lng: { not: null }, NOT: { geoSource: "DISPATCHER" } },
    select: { id: true, lat: true, lng: true },
    orderBy: { id: "asc" },
  });

  let moved = 0;
  let failed = 0;
  for (const o of outlets) {
    const snapped = await nearest({ lat: o.lat!, lng: o.lng! });
    if (!snapped.live) {
      failed++;
      continue;
    }
    await prisma.outlet.update({
      where: { id: o.id },
      data: { lat: snapped.lat, lng: snapped.lng, geoSnapped: true },
    });
    moved++;
  }
  console.log(`[geo:snap] ${moved} outlets snapped to the road (road data ${status.dataVersion}); ${failed} could not be.`);
}

main()
  .catch((err) => {
    console.error("[geo:snap] Failed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
