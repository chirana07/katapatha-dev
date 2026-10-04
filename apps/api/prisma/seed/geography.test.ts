/**
 * Positions are filled in, never overwritten. The database is mocked: what
 * matters is which rows the seeder asks to change, and that a pin a dispatcher
 * placed is never among them.
 */

import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { seedGeography } from "./geography";
import type { DataSource } from "./source";

const source = { kind: "fixture", root: "", find: () => null, require: () => "" } as unknown as DataSource;

function fakePrisma(outlets: Array<{ id: string; districtName: string; lat: number | null; geoSource: string | null }>) {
  const update = vi.fn().mockResolvedValue({});
  const findMany = vi.fn(async (args?: { where?: unknown }) => {
    // The seeder asks for unplaced or synthetic rows only; a DISPATCHER row must not be offered.
    expect(JSON.stringify(args?.where)).toContain("SYNTHETIC");
    return outlets.filter((o) => o.geoSource !== "DISPATCHER");
  });
  return {
    update,
    prisma: {
      depot: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      district: { findMany: vi.fn().mockResolvedValue([{ name: "Colombo", roadClass: "urban" }]) },
      outlet: { findMany, update },
    } as unknown as PrismaClient,
  };
}

describe("seedGeography", () => {
  it("places an outlet that has no position, near its district, as SYNTHETIC", async () => {
    const { prisma, update } = fakePrisma([{ id: "OUT1", districtName: "Colombo", lat: null, geoSource: null }]);

    const counts = await seedGeography(prisma, source);

    expect(counts.synthetic).toBe(1);
    const data = update.mock.calls[0]![0].data;
    expect(data).toMatchObject({ geoSource: "SYNTHETIC", geoSnapped: false });
    expect(data.lat).toBeGreaterThan(6.8);
    expect(data.lat).toBeLessThan(7.0);
  });

  it("leaves a position already set alone, so a re-run changes nothing", async () => {
    const { prisma, update } = fakePrisma([{ id: "OUT1", districtName: "Colombo", lat: 6.9, geoSource: "SYNTHETIC" }]);

    const counts = await seedGeography(prisma, source);

    expect(counts).toMatchObject({ synthetic: 0, fromCsv: 0 });
    expect(update).not.toHaveBeenCalled();
  });

  it("never offers a dispatcher's pin for change", async () => {
    const { prisma, update } = fakePrisma([{ id: "OUT1", districtName: "Colombo", lat: 6.9, geoSource: "DISPATCHER" }]);

    await seedGeography(prisma, source);

    expect(update).not.toHaveBeenCalled();
  });

  it("skips an outlet in a district it has no centre for rather than guessing", async () => {
    const { prisma, update } = fakePrisma([{ id: "OUT1", districtName: "Atlantis", lat: null, geoSource: null }]);

    const counts = await seedGeography(prisma, source);

    expect(counts.synthetic).toBe(0);
    expect(update).not.toHaveBeenCalled();
  });
});
