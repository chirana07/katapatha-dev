/**
 * Where things are.
 *
 * Depots get their known position. An outlet gets, in order of preference: a
 * position from the optional `outlet_locations.csv` (`outlet_id,lat,lng`), else
 * a stable stand-in near its district centre. Nothing here calls the road
 * network, so a clean clone seeds offline; `geo:snap` moves positions onto a
 * road afterwards.
 *
 * It only fills gaps. A row whose `geoSource` is DISPATCHER was placed by a
 * person and is never touched, and re-running changes nothing that is already
 * set, so it is safe from the seeder, from `db:seed`, and on its own.
 */

import type { PrismaClient } from "@prisma/client";
import { optNum, readCsvAll, str } from "@katapatha/allocator/csv";
import {
  DEPOT_POSITIONS,
  DISTRICT_POSITIONS,
  syntheticOutletPosition,
  withinSriLanka,
} from "@katapatha/core/domain/geography";
import type { DataSource } from "./source";

export interface GeographyCounts {
  depots: number;
  fromCsv: number;
  synthetic: number;
}

export async function seedGeography(prisma: PrismaClient, source: DataSource): Promise<GeographyCounts> {
  let depots = 0;
  for (const [code, position] of Object.entries(DEPOT_POSITIONS)) {
    const result = await prisma.depot.updateMany({
      where: { code, lat: null },
      data: { lat: position.lat, lng: position.lng },
    });
    depots += result.count;
  }

  const csv = new Map<string, { lat: number; lng: number }>();
  const csvPath = source.find("outletLocations");
  if (csvPath) {
    for (const row of await readCsvAll(csvPath)) {
      const lat = optNum(row, "lat");
      const lng = optNum(row, "lng");
      if (lat === null || lng === null || !withinSriLanka({ lat, lng })) {
        throw new Error(`outlet_locations.csv: ${str(row, "outlet_id")} has no usable lat/lng.`);
      }
      csv.set(str(row, "outlet_id"), { lat, lng });
    }
  }

  const districts = new Map(
    (await prisma.district.findMany({ select: { name: true, roadClass: true } })).map((d) => [d.name, d]),
  );
  const outlets = await prisma.outlet.findMany({
    where: { OR: [{ lat: null }, { geoSource: "SYNTHETIC" }] },
    select: { id: true, districtName: true, lat: true, geoSource: true },
  });

  let fromCsv = 0;
  let synthetic = 0;
  for (const outlet of outlets) {
    const given = csv.get(outlet.id);
    if (given) {
      await prisma.outlet.update({
        where: { id: outlet.id },
        data: { ...given, geoSource: "CSV", geoSnapped: false },
      });
      fromCsv++;
      continue;
    }
    // Already placed (a synthetic position that matched only the OR above).
    if (outlet.lat !== null) continue;

    const centre = DISTRICT_POSITIONS[outlet.districtName];
    const district = districts.get(outlet.districtName);
    if (!centre || !district) continue;
    const position = syntheticOutletPosition(outlet.id, centre, district.roadClass);
    await prisma.outlet.update({
      where: { id: outlet.id },
      data: { ...position, geoSource: "SYNTHETIC", geoSnapped: false },
    });
    synthetic++;
  }

  return { depots, fromCsv, synthetic };
}
