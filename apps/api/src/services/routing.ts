import { prisma } from "../lib/db";
import {
  estimateLeg,
  haversineKm,
  type LatLng,
  type RoadClass,
} from "@katapatha/core/domain/geography";
import { encodePolyline } from "@katapatha/core/domain/polyline";
import { buildTravelMatrix, type Leg, type TravelMatrix } from "@katapatha/core/domain/travel";

/**
 * The road network, as far as planning is concerned.
 *
 * OSRM serves OpenStreetMap routing from our own container (`OSRM_URL`). Three
 * things matter about how it is used:
 *
 *  - The planner never calls it. `travelMatrix` fetches and caches road legs
 *    here, on the API side, and the allocator receives plain numbers. That is
 *    what keeps the allocator pure and a plan repeatable: the same coordinates
 *    read the same cached legs until the road data is deliberately refreshed.
 *  - It never throws to a caller. Unset, down, slow or returning nonsense, the
 *    answer is a straight-line estimate marked `estimate` / `live: false`, so a
 *    dispatcher can still plan and the screen says what the figures are.
 *  - Estimates are cached too (as ESTIMATE) so a plan made offline can be
 *    reproduced, and are replaced by measured legs the next time OSRM answers.
 */

export interface RoutePoint extends LatLng {
  key: string;
  roadClass: RoadClass;
  freeFlowKmh: number;
}

const ESTIMATE_VERSION = "estimate-v1";
/** OSRM's default table limit is 100; the container is started with 1000. */
const MAX_TABLE_COORDS = 900;
const INSERT_CHUNK = 4000;

function base(): string | null {
  const url = process.env.OSRM_URL?.trim();
  return url ? url.replace(/\/+$/, "") : null;
}

/** A coordinate pair, to about a metre, so a moved pin misses the cache and an unmoved one hits. */
export function coordKey(p: LatLng): string {
  return `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`;
}

const lngLat = (p: LatLng) => `${p.lng.toFixed(6)},${p.lat.toFixed(6)}`;

async function getJson<T>(path: string, timeoutMs: number): Promise<T | null> {
  const root = base();
  if (!root) return null;
  try {
    const res = await fetch(`${root}${path}`, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export interface RoutingStatus {
  /** OSRM is configured and answering. */
  live: boolean;
  configured: boolean;
  dataVersion: string | null;
}

export async function osrmStatus(): Promise<RoutingStatus> {
  if (!base()) return { live: false, configured: false, dataVersion: null };
  const body = await getJson<{ code?: string; data_version?: string }>("/nearest/v1/driving/79.8612,6.9271", 2000);
  const live = body?.code === "Ok";
  return { live, configured: true, dataVersion: live ? (body?.data_version ?? "osrm") : null };
}

/** The point on the road nearest to `p`, or `p` itself when the network cannot say. */
export async function nearest(p: LatLng): Promise<LatLng & { live: boolean }> {
  const body = await getJson<{ code?: string; waypoints?: { location?: [number, number] }[] }>(
    `/nearest/v1/driving/${lngLat(p)}?number=1`,
    3000,
  );
  const loc = body?.code === "Ok" ? body.waypoints?.[0]?.location : undefined;
  if (!loc || !Number.isFinite(loc[0]) || !Number.isFinite(loc[1])) return { ...p, live: false };
  return { lat: Number(loc[1].toFixed(5)), lng: Number(loc[0].toFixed(5)), live: true };
}

export interface RoadTravel {
  matrix: TravelMatrix;
  /** Road dataset the measured legs came from; "estimate-v1" if none were. */
  dataVersion: string;
  live: boolean;
}

/**
 * Road minutes and kilometres between every pair of points, from the cache
 * where it has them and from OSRM (one table request) where it does not.
 */
export async function travelMatrix(input: readonly RoutePoint[]): Promise<RoadTravel> {
  const points = [...new Map(input.map((p) => [p.key, p])).values()].sort((a, b) => (a.key < b.key ? -1 : 1));
  const cks = points.map(coordKey);
  const distinct = [...new Set(cks)];

  const cached = new Map<string, { durationS: number; distanceM: number; source: string; dataVersion: string }>();
  if (distinct.length > 1) {
    const rows = await prisma.roadLeg.findMany({
      where: { fromKey: { in: distinct }, toKey: { in: distinct } },
    });
    for (const r of rows) cached.set(`${r.fromKey}>${r.toKey}`, r);
  }

  const pairKey = (a: number, b: number) => `${cks[a]}>${cks[b]}`;
  const needsFetch = (a: number, b: number) => {
    if (cks[a] === cks[b]) return false;
    const hit = cached.get(pairKey(a, b));
    // An estimate is only good enough while nothing better is on offer.
    return !hit || (hit.source === "ESTIMATE" && base() !== null);
  };

  const missing: [number, number][] = [];
  for (let a = 0; a < points.length; a++) {
    for (let b = 0; b < points.length; b++) if (needsFetch(a, b)) missing.push([a, b]);
  }

  let dataVersion: string | null = null;
  const fresh: { from: string; to: string; durationS: number; distanceM: number; source: "OSRM" | "ESTIMATE" }[] = [];

  if (missing.length > 0) {
    const measured = await fetchTable(points, missing);
    if (measured) dataVersion = measured.dataVersion;
    for (const [a, b] of missing) {
      const m = measured?.cells.get(`${a}>${b}`);
      const from = cks[a]!;
      const to = cks[b]!;
      if (m) {
        fresh.push({ from, to, durationS: m.durationS, distanceM: m.distanceM, source: "OSRM" });
      } else if (!cached.has(pairKey(a, b))) {
        // Nothing cached and nothing measured: estimate, and remember it.
        const e = estimateBetween(points[a]!, points[b]!);
        fresh.push({ from, to, durationS: e.min * 60, distanceM: e.km * 1000, source: "ESTIMATE" });
      }
    }
    await store(fresh, dataVersion ?? ESTIMATE_VERSION);
  }

  const freshByPair = new Map(fresh.map((f) => [`${f.from}>${f.to}`, f]));
  const indexOf = new Map(points.map((p, i) => [p.key, i]));
  let anyEstimate = false;
  const cell = (fromKey: string, toKey: string): Leg => {
    const a = indexOf.get(fromKey)!;
    const b = indexOf.get(toKey)!;
    if (cks[a] === cks[b]) return { min: 0, km: 0 };
    const k = pairKey(a, b);
    const row = freshByPair.get(k) ?? cached.get(k);
    if (!row) {
      // Defensive: every pair was either cached or just built above.
      anyEstimate = true;
      return estimateBetween(points[a]!, points[b]!);
    }
    if (row.source === "ESTIMATE") anyEstimate = true;
    return { min: row.durationS / 60, km: row.distanceM / 1000 };
  };
  const matrix = buildTravelMatrix(
    points.map((p) => p.key),
    cell,
    "osrm",
  );
  const finalMatrix: TravelMatrix = anyEstimate ? { ...matrix, source: "estimate" } : matrix;

  const versions = new Set([...cached.values()].filter((r) => r.source === "OSRM").map((r) => r.dataVersion));
  if (dataVersion) versions.add(dataVersion);
  return {
    matrix: finalMatrix,
    dataVersion: anyEstimate ? ESTIMATE_VERSION : ([...versions].sort().join("+") || ESTIMATE_VERSION),
    live: !anyEstimate,
  };
}

/** The road class that applies to a leg: the non-depot end, destination first. */
function estimateBetween(from: RoutePoint, to: RoutePoint): Leg {
  const governing = to.key.startsWith("depot:") ? from : to;
  return estimateLeg(from, to, governing.roadClass, governing.freeFlowKmh);
}

async function fetchTable(
  points: readonly RoutePoint[],
  missing: readonly [number, number][],
): Promise<{ cells: Map<string, { durationS: number; distanceM: number }>; dataVersion: string } | null> {
  if (!base()) return null;
  const sources = [...new Set(missing.map(([a]) => a))].sort((x, y) => x - y);
  const destinations = [...new Set(missing.map(([, b]) => b))].sort((x, y) => x - y);
  const involved = [...new Set([...sources, ...destinations])].sort((x, y) => x - y);
  if (involved.length > MAX_TABLE_COORDS) return null;

  const at = new Map(involved.map((p, i) => [p, i]));
  const coords = involved.map((i) => lngLat(points[i]!)).join(";");
  const body = await getJson<{
    code?: string;
    data_version?: string;
    durations?: (number | null)[][];
    distances?: (number | null)[][];
  }>(
    `/table/v1/driving/${coords}?annotations=duration,distance` +
      `&sources=${sources.map((s) => at.get(s)).join(";")}` +
      `&destinations=${destinations.map((d) => at.get(d)).join(";")}`,
    15000,
  );
  if (body?.code !== "Ok" || !body.durations || !body.distances) return null;

  const cells = new Map<string, { durationS: number; distanceM: number }>();
  sources.forEach((a, i) => {
    destinations.forEach((b, j) => {
      const d = body.durations![i]?.[j];
      const m = body.distances![i]?.[j];
      // null: the network says the two are not connected. Leave it to the estimate.
      if (typeof d === "number" && typeof m === "number" && a !== b) cells.set(`${a}>${b}`, { durationS: d, distanceM: m });
    });
  });
  return { cells, dataVersion: body.data_version ?? "osrm" };
}

async function store(
  rows: readonly { from: string; to: string; durationS: number; distanceM: number; source: "OSRM" | "ESTIMATE" }[],
  dataVersion: string,
): Promise<void> {
  // Grouped by source because a statement carries one cast value for the lot.
  for (const source of ["OSRM", "ESTIMATE"] as const) {
    const group = rows.filter((r) => r.source === source);
    for (let i = 0; i < group.length; i += INSERT_CHUNK) {
      const chunk = group.slice(i, i + INSERT_CHUNK);
      await prisma.$executeRaw`
        INSERT INTO "RoadLeg" ("fromKey", "toKey", "durationS", "distanceM", "source", "dataVersion", "fetchedAt")
        SELECT u.f, u.t, u.d, u.m, ${source}::"RoadSource", ${source === "OSRM" ? dataVersion : ESTIMATE_VERSION}, now()
        FROM unnest(
          ${chunk.map((r) => r.from)}::text[],
          ${chunk.map((r) => r.to)}::text[],
          ${chunk.map((r) => r.durationS)}::float8[],
          ${chunk.map((r) => r.distanceM)}::float8[]
        ) AS u(f, t, d, m)
        ON CONFLICT ("fromKey", "toKey") DO UPDATE SET
          "durationS" = EXCLUDED."durationS",
          "distanceM" = EXCLUDED."distanceM",
          "source" = EXCLUDED."source",
          "dataVersion" = EXCLUDED."dataVersion",
          "fetchedAt" = EXCLUDED."fetchedAt"`;
    }
  }
}

export interface RouteLine {
  /** Encoded polyline, precision 6. */
  polyline: string;
  km: number;
  minutes: number;
  /** False when this is a straight line through the waypoints, not the road. */
  live: boolean;
}

/** The road geometry through the waypoints, for drawing. Planning never reads it. */
export async function routeGeometry(waypoints: readonly LatLng[]): Promise<RouteLine> {
  const straight = (): RouteLine => {
    let km = 0;
    for (let i = 1; i < waypoints.length; i++) km += haversineKm(waypoints[i - 1]!, waypoints[i]!);
    return { polyline: encodePolyline(waypoints), km, minutes: 0, live: false };
  };
  if (waypoints.length < 2) return straight();

  const body = await getJson<{
    code?: string;
    routes?: { geometry?: string; distance?: number; duration?: number }[];
  }>(`/route/v1/driving/${waypoints.map(lngLat).join(";")}?overview=full&geometries=polyline6&steps=false`, 10000);
  const route = body?.code === "Ok" ? body.routes?.[0] : undefined;
  if (!route?.geometry || typeof route.distance !== "number" || typeof route.duration !== "number") return straight();
  return { polyline: route.geometry, km: route.distance / 1000, minutes: route.duration / 60, live: true };
}
