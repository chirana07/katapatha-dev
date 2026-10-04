/**
 * Where the seed data comes from.
 *
 * The competition datasets are confidential: they are gitignored, never
 * committed, and never baked into a Docker image. But `docker compose up` on a
 * clean clone still has to produce a working, populated application. So there
 * are two tiers:
 *
 *   real    - DATA_DIR holds the shipped CSVs. Every number then matches the
 *             booklet, and our allocator output can be cross-checked against
 *             the organisers' own check_allocation.py.
 *   fixture - otherwise, the committed synthetic set in ./fixture. Same
 *             schema, same cardinalities, different values. Safe to publish.
 *
 * Either way the seeder runs to completion, which is what makes a fresh clone
 * work without the operator having to do anything first.
 */

import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

export const DATA_FILES = {
  outlets: "outlets.csv",
  vehicles: "vehicles.csv",
  calendar: "calendar.csv",
  districtTravel: "district_travel.csv",
  serviceAllowance: "service_allowance.csv",
  outletLocations: "outlet_locations.csv",
  trafficSpeed: "traffic_speed.csv",
  roadConditions: "road_conditions.csv",
  deliveriesTrain: "deliveries_train.csv",
  routeLegsTrain: "route_legs_train.csv",
  peakDayScenarios: "task2b_peak_day_scenarios.csv",
  peakDayFleet: "task2b_peak_day_fleet.csv",
  forecastInputs: "task2a_test_inputs.csv",
} as const;

export type DataFileKey = keyof typeof DATA_FILES;

/** The files without which we cannot build a believable network at all. */
const REQUIRED: DataFileKey[] = [
  "outlets",
  "vehicles",
  "calendar",
  "districtTravel",
  "serviceAllowance",
];

export interface DataSource {
  kind: "real" | "fixture";
  root: string;
  /** Absolute path to a data file, or null when this source lacks it. */
  find(key: DataFileKey): string | null;
  /** Absolute path, throwing if absent. */
  require(key: DataFileKey): string;
}

/**
 * Locate a filename anywhere under `root`. The shipped data is arranged in
 * "General Data" / "Training Data" / "Test Data" subfolders, and mirroring
 * that layout here would break the moment someone flattened it. Searching by
 * name is what the organisers' own check_allocation.py does.
 */
function findUnder(root: string, filename: string, depth = 0): string | null {
  if (depth > 4 || !existsSync(root)) return null;
  let entries: string[];
  try {
    entries = readdirSync(root);
  } catch {
    return null;
  }

  const direct = entries.find((e) => e === filename);
  if (direct) return path.join(root, direct);

  for (const entry of entries) {
    if (entry.startsWith(".") || entry === "node_modules") continue;
    const full = path.join(root, entry);
    try {
      if (!statSync(full).isDirectory()) continue;
    } catch {
      continue;
    }
    const hit = findUnder(full, filename, depth + 1);
    if (hit) return hit;
  }
  return null;
}

function makeSource(kind: DataSource["kind"], root: string): DataSource {
  const cache = new Map<DataFileKey, string | null>();
  const find = (key: DataFileKey): string | null => {
    if (!cache.has(key)) cache.set(key, findUnder(root, DATA_FILES[key]));
    return cache.get(key) ?? null;
  };
  return {
    kind,
    root,
    find,
    require(key) {
      const hit = find(key);
      if (!hit) {
        throw new Error(
          `Seed data file ${DATA_FILES[key]} not found under ${root} (source: ${kind})`,
        );
      }
      return hit;
    },
  };
}

export function fixtureRoot(): string {
  return path.join(import.meta.dirname, "fixture");
}

/**
 * Decide which tier to use. Prints a loud banner for the synthetic case so
 * nobody mistakes fixture numbers for the real ones.
 */
export function resolveDataSource(env: NodeJS.ProcessEnv = process.env): DataSource {
  const configured = env.DATA_DIR?.trim();
  const candidates = [
    configured,
    path.join(import.meta.dirname, "..", "..", "..", "data"),
    "/data",
  ].filter((x): x is string => Boolean(x));

  for (const candidate of candidates) {
    const root = path.resolve(candidate);
    if (!existsSync(root)) continue;
    const source = makeSource("real", root);
    const missing = REQUIRED.filter((key) => source.find(key) === null);
    if (missing.length === 0) {
      console.log(`[seed] Using the real competition data at ${root}`);
      return source;
    }
  }

  const root = fixtureRoot();
  console.log(
    [
      "",
      "  ┌────────────────────────────────────────────────────────────────┐",
      "  │  SYNTHETIC DATA                                                │",
      "  │                                                                │",
      "  │  The competition CSVs were not found, so this database is      │",
      "  │  seeded from the committed synthetic fixture. The shape is     │",
      "  │  right; the numbers are not the real ones.                     │",
      "  │                                                                │",
      "  │  To seed the real data, place the supplied `data` folder       │",
      "  │  beside this repository, or set DATA_DIR, and seed again.      │",
      "  └────────────────────────────────────────────────────────────────┘",
      "",
    ].join("\n"),
  );
  return makeSource("fixture", root);
}

/**
 * A cheap fingerprint of the chosen source: its kind plus the size and mtime
 * of each file it offers. Stored on SeedMeta so that swapping fixture for real
 * data — or refreshing the CSVs — re-seeds automatically instead of silently
 * leaving stale rows in place.
 */
export function sourceChecksum(source: DataSource): string {
  const parts: string[] = [source.kind];
  for (const key of Object.keys(DATA_FILES) as DataFileKey[]) {
    const file = source.find(key);
    if (!file) {
      parts.push(`${key}:absent`);
      continue;
    }
    try {
      const s = statSync(file);
      parts.push(`${key}:${s.size}:${Math.floor(s.mtimeMs)}`);
    } catch {
      parts.push(`${key}:unreadable`);
    }
  }
  return parts.join("|");
}
