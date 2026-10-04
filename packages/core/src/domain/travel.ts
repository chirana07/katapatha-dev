import type { DepotCode, DistrictTravel, OutletRef } from "./types";

/**
 * Where a travel figure came from. `estimate` means at least one leg was
 * derived from straight-line distance rather than read from the road network,
 * and the UI says so.
 */
export type TravelSource = "osrm" | "estimate";

/**
 * Road minutes and kilometres between every pair of points a plan touches.
 *
 * A plain value, deliberately: the allocator is pure and never does I/O, so the
 * API fetches (and caches) the matrix and hands it in. Rows are "from", columns
 * are "to"; the matrix is not assumed symmetric, because one-way streets make
 * real roads asymmetric.
 */
export interface TravelMatrix {
  /** Point keys in index order. */
  keys: readonly string[];
  index: ReadonlyMap<string, number>;
  minutes: readonly (readonly number[])[];
  km: readonly (readonly number[])[];
  source: TravelSource;
}

export const depotKey = (depot: DepotCode | string): string => `depot:${depot}`;
export const outletKey = (outletId: string): string => `outlet:${outletId}`;

export interface Leg {
  min: number;
  km: number;
}

/** One leg of the matrix. Throws on an unknown key: that is a wiring bug, not data. */
export function leg(matrix: TravelMatrix, from: string, to: string): Leg {
  const i = matrix.index.get(from);
  const j = matrix.index.get(to);
  if (i === undefined || j === undefined) {
    throw new Error(`Travel matrix has no leg ${from} -> ${to}.`);
  }
  return { min: matrix.minutes[i]![j]!, km: matrix.km[i]![j]! };
}

/** Builds a matrix from keys and per-cell figures, so callers cannot get the index wrong. */
export function buildTravelMatrix(
  keys: readonly string[],
  cell: (from: string, to: string) => Leg,
  source: TravelSource,
): TravelMatrix {
  const sorted = [...keys].sort();
  const minutes = sorted.map((a) => sorted.map((b) => (a === b ? 0 : cell(a, b).min)));
  const km = sorted.map((a) => sorted.map((b) => (a === b ? 0 : cell(a, b).km)));
  return { keys: sorted, index: new Map(sorted.map((k, i) => [k, i])), minutes, km, source };
}

/**
 * A travel matrix made from the organisers' district table alone.
 *
 * The table gives one figure for the way out to a district and one for each hop
 * between stops in it, with no geography. This turns those into legs so the
 * road-based scheduler can run when no real road times are available: depot to
 * any outlet in a district is the way out, between two outlets in the same
 * district is the hop, and the way home is the way out again. Reproducing the
 * table exactly is the point: it is the fallback that behaves as the planner
 * always did.
 *
 * Two outlets in different districts never share a trip (rule 1), so that leg is
 * only defined, as the two ways out added, because a matrix must answer every
 * pair. An outlet whose district is not in the table gets zero legs; it cannot
 * be planned anyway.
 */
export function travelFromDistricts(
  depot: DepotCode | string,
  outlets: Iterable<OutletRef>,
  districts: ReadonlyMap<string, DistrictTravel>,
): TravelMatrix {
  const byKey = new Map<string, OutletRef>();
  for (const o of outlets) byKey.set(outletKey(o.outletId), o);
  const out = (o: OutletRef): Leg => {
    const d = districts.get(o.district);
    return d ? { min: d.depotToDistrictFreeflowMin, km: d.depotToDistrictKm } : { min: 0, km: 0 };
  };
  const dKey = depotKey(depot);

  return buildTravelMatrix(
    [dKey, ...byKey.keys()],
    (from, to) => {
      const a = byKey.get(from);
      const b = byKey.get(to);
      if (from === dKey && b) return out(b);
      if (to === dKey && a) return out(a);
      if (!a || !b) return { min: 0, km: 0 };
      if (a.district === b.district) {
        const d = districts.get(a.district);
        return d ? { min: d.interStopFreeflowMin, km: d.interStopKm } : { min: 0, km: 0 };
      }
      const x = out(a);
      const y = out(b);
      return { min: x.min + y.min, km: x.km + y.km };
    },
    "estimate",
  );
}
