import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "../lib/db.js";
import { coordKey, nearest, osrmStatus, routeGeometry, travelMatrix, type RoutePoint } from "../services/routing.js";
import { decodePolyline } from "@katapatha/core/domain/polyline";
import { leg } from "@katapatha/core/domain/travel";

/**
 * The road network is reached through one service that must never fail a
 * caller. Prisma and fetch are mocked: what is asserted is what is asked of
 * OSRM (only the legs the cache lacks), what is stored, and that every failure
 * mode ends in a usable estimate that says it is one.
 */

vi.mock("../lib/db.js", () => ({
  prisma: { roadLeg: { findMany: vi.fn() }, $executeRaw: vi.fn() },
}));

const depot: RoutePoint = { key: "depot:Peliyagoda", lat: 6.9689, lng: 79.8936, roadClass: "highway", freeFlowKmh: 45 };
const a: RoutePoint = { key: "outlet:A", lat: 6.94131, lng: 79.87615, roadClass: "urban", freeFlowKmh: 30 };
const b: RoutePoint = { key: "outlet:B", lat: 7.05909, lng: 79.98551, roadClass: "suburban", freeFlowKmh: 35 };
const points = [depot, a, b];

const leg_ = (from: RoutePoint, to: RoutePoint, source: string, durationS: number, distanceM: number) => ({
  fromKey: coordKey(from),
  toKey: coordKey(to),
  durationS,
  distanceM,
  source,
  dataVersion: "2026-09-30",
});

function allCached(source = "OSRM") {
  const rows = [];
  for (const x of points) for (const y of points) if (x !== y) rows.push(leg_(x, y, source, 600, 8000));
  return rows;
}

describe("routing service", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.resetAllMocks();
    delete process.env.OSRM_URL;
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    vi.mocked(prisma.$executeRaw).mockResolvedValue(0 as never);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.OSRM_URL;
  });

  const ok = (body: unknown) => ({ ok: true, json: async () => body });

  describe("coordKey", () => {
    it("is stable to about a metre, so an unmoved pin hits the cache and a moved one misses", () => {
      expect(coordKey({ lat: 6.941312, lng: 79.876151 })).toBe(coordKey({ lat: 6.941314, lng: 79.876149 }));
      expect(coordKey({ lat: 6.94131, lng: 79.87615 })).not.toBe(coordKey({ lat: 6.9414, lng: 79.87615 }));
    });
  });

  describe("travelMatrix", () => {
    it("reads a fully cached matrix without touching the network or writing", async () => {
      process.env.OSRM_URL = "http://osrm:5000";
      vi.mocked(prisma.roadLeg.findMany).mockResolvedValue(allCached() as never);

      const { matrix, live, dataVersion } = await travelMatrix(points);

      expect(fetchMock).not.toHaveBeenCalled();
      expect(prisma.$executeRaw).not.toHaveBeenCalled();
      expect(matrix.source).toBe("osrm");
      expect(live).toBe(true);
      expect(dataVersion).toBe("2026-09-30");
      expect(leg(matrix, a.key, b.key)).toEqual({ min: 10, km: 8 });
      expect(leg(matrix, a.key, a.key)).toEqual({ min: 0, km: 0 });
    });

    it("asks OSRM for only the legs the cache lacks, then stores them as OSRM", async () => {
      process.env.OSRM_URL = "http://osrm:5000/";
      // Everything cached except depot -> A.
      vi.mocked(prisma.roadLeg.findMany).mockResolvedValue(
        allCached().filter((r) => !(r.fromKey === coordKey(depot) && r.toKey === coordKey(a))) as never,
      );
      fetchMock.mockResolvedValue(ok({ code: "Ok", data_version: "2026-10-04", durations: [[1200]], distances: [[15000]] }));

      const { matrix } = await travelMatrix(points);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const url = String(fetchMock.mock.calls[0]![0]);
      expect(url.startsWith("http://osrm:5000/table/v1/driving/")).toBe(true);
      expect(url).toContain("sources=0");
      expect(url).toContain("destinations=1");
      expect(leg(matrix, depot.key, a.key)).toEqual({ min: 20, km: 15 });
      expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
      expect(matrix.source).toBe("osrm");
    });

    it("falls back to straight-line estimates when OSRM is not configured, and says so", async () => {
      vi.mocked(prisma.roadLeg.findMany).mockResolvedValue([] as never);

      const { matrix, live, dataVersion } = await travelMatrix(points);

      expect(fetchMock).not.toHaveBeenCalled();
      expect(matrix.source).toBe("estimate");
      expect(live).toBe(false);
      expect(dataVersion).toBe("estimate-v1");
      const l = leg(matrix, depot.key, a.key);
      expect(l.km).toBeGreaterThan(0);
      expect(l.min).toBeGreaterThan(0);
      // Remembered, so the same plan can be reproduced offline.
      expect(prisma.$executeRaw).toHaveBeenCalled();
    });

    it("falls back to estimates when OSRM times out, without throwing", async () => {
      process.env.OSRM_URL = "http://osrm:5000";
      vi.mocked(prisma.roadLeg.findMany).mockResolvedValue([] as never);
      fetchMock.mockRejectedValue(new Error("timeout"));

      const { matrix, live } = await travelMatrix(points);

      expect(matrix.source).toBe("estimate");
      expect(live).toBe(false);
    });

    it("upgrades a cached estimate once OSRM answers", async () => {
      process.env.OSRM_URL = "http://osrm:5000";
      vi.mocked(prisma.roadLeg.findMany).mockResolvedValue(allCached("ESTIMATE") as never);
      // Every pair is re-asked; answer 3 sources x 3 destinations.
      const grid = (n: number) => [0, 1, 2].map(() => [0, 1, 2].map(() => n));
      fetchMock.mockResolvedValue(ok({ code: "Ok", durations: grid(300), distances: grid(4000) }));

      const { matrix } = await travelMatrix(points);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(matrix.source).toBe("osrm");
      expect(leg(matrix, a.key, b.key)).toEqual({ min: 5, km: 4 });
    });

    it("keeps a cached estimate for a pair OSRM says is unreachable", async () => {
      process.env.OSRM_URL = "http://osrm:5000";
      vi.mocked(prisma.roadLeg.findMany).mockResolvedValue(allCached() as never);
      vi.mocked(prisma.roadLeg.findMany).mockResolvedValue(
        allCached().map((r) => (r.fromKey === coordKey(a) && r.toKey === coordKey(b) ? { ...r, source: "ESTIMATE" } : r)) as never,
      );
      fetchMock.mockResolvedValue(ok({ code: "Ok", durations: [[null]], distances: [[null]] }));

      const { matrix } = await travelMatrix(points);

      expect(matrix.source).toBe("estimate");
      expect(leg(matrix, a.key, b.key)).toEqual({ min: 10, km: 8 });
    });

    it("treats two points at the same place as zero apart, without a request", async () => {
      process.env.OSRM_URL = "http://osrm:5000";
      const twin = { ...a, key: "outlet:A2" };
      vi.mocked(prisma.roadLeg.findMany).mockResolvedValue([
        leg_(depot, a, "OSRM", 600, 8000),
        leg_(a, depot, "OSRM", 600, 8000),
      ] as never);

      const { matrix } = await travelMatrix([depot, a, twin]);

      expect(fetchMock).not.toHaveBeenCalled();
      expect(leg(matrix, a.key, twin.key)).toEqual({ min: 0, km: 0 });
      expect(leg(matrix, depot.key, twin.key)).toEqual({ min: 10, km: 8 });
    });

    it("is deterministic about order: the same points in any order give the same matrix", async () => {
      vi.mocked(prisma.roadLeg.findMany).mockResolvedValue(allCached() as never);
      process.env.OSRM_URL = "http://osrm:5000";

      const one = await travelMatrix(points);
      const two = await travelMatrix([b, depot, a]);

      expect(two.matrix.keys).toEqual(one.matrix.keys);
      expect(two.matrix.minutes).toEqual(one.matrix.minutes);
    });
  });

  describe("osrmStatus and nearest", () => {
    it("reports not configured without a request", async () => {
      expect(await osrmStatus()).toEqual({ live: false, configured: false, dataVersion: null });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("reports live with the road data version", async () => {
      process.env.OSRM_URL = "http://osrm:5000";
      fetchMock.mockResolvedValue(ok({ code: "Ok", data_version: "2026-10-04" }));
      expect(await osrmStatus()).toEqual({ live: true, configured: true, dataVersion: "2026-10-04" });
    });

    it("reports configured but down on a failed request", async () => {
      process.env.OSRM_URL = "http://osrm:5000";
      fetchMock.mockRejectedValue(new Error("refused"));
      expect(await osrmStatus()).toEqual({ live: false, configured: true, dataVersion: null });
    });

    it("snaps to the road, or returns the point unchanged when it cannot", async () => {
      process.env.OSRM_URL = "http://osrm:5000";
      fetchMock.mockResolvedValueOnce(ok({ code: "Ok", waypoints: [{ location: [79.87701, 6.94205] }] }));
      expect(await nearest({ lat: 6.94131, lng: 79.87615 })).toEqual({ lat: 6.94205, lng: 79.87701, live: true });

      fetchMock.mockRejectedValueOnce(new Error("down"));
      expect(await nearest({ lat: 6.94131, lng: 79.87615 })).toEqual({ lat: 6.94131, lng: 79.87615, live: false });
    });
  });

  describe("routeGeometry", () => {
    it("returns the road geometry from OSRM", async () => {
      process.env.OSRM_URL = "http://osrm:5000";
      fetchMock.mockResolvedValue(ok({ code: "Ok", routes: [{ geometry: "abc", distance: 12345, duration: 1800 }] }));

      const r = await routeGeometry([depot, a]);

      expect(r).toEqual({ polyline: "abc", km: 12.345, minutes: 30, live: true });
      expect(String(fetchMock.mock.calls[0]![0])).toContain("geometries=polyline6");
    });

    it("falls back to a straight line through the waypoints, marked not live", async () => {
      const r = await routeGeometry([depot, a, b]);

      expect(r.live).toBe(false);
      expect(r.km).toBeGreaterThan(0);
      const back = decodePolyline(r.polyline);
      expect(back).toHaveLength(3);
      expect(back[1]!.lat).toBeCloseTo(a.lat, 5);
    });
  });
});
