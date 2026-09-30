/**
 * A streaming CSV reader.
 *
 * The training files are 92,307 and 91,894 rows (13 MB and 12 MB), so reading
 * them with `readFileSync` and `split("\n")` would hold the whole thing plus
 * an array of every line in memory at once. Streaming keeps it flat, and the
 * seeder only ever needs one row at a time to build its aggregates.
 *
 * No dependency: the competition CSVs are plain comma-separated with quoted
 * fields and no embedded newlines, which is a small enough dialect to parse
 * correctly in a few lines. The parser still handles quotes and escaped quotes
 * so a stray comma in a festival name cannot silently shift every column.
 */

import { createReadStream, existsSync } from "node:fs";
import { createInterface } from "node:readline";

export type CsvRow = Record<string, string>;

/** Split one CSV line, honouring double-quoted fields and `""` escapes. */
export function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      out.push(field);
      field = "";
    } else {
      field += c;
    }
  }
  out.push(field);
  return out;
}

/** Yield each data row as a header-keyed object. */
export async function* readCsv(path: string): AsyncGenerator<CsvRow> {
  if (!existsSync(path)) throw new Error(`CSV not found: ${path}`);

  const rl = createInterface({
    input: createReadStream(path, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });

  let header: string[] | null = null;
  for await (const raw of rl) {
    // A trailing \r survives crlfDelay when the file has CRLF endings.
    const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    if (line.length === 0) continue;

    if (!header) {
      header = splitCsvLine(line).map((h) => h.trim());
      continue;
    }

    const cells = splitCsvLine(line);
    const row: CsvRow = {};
    for (let i = 0; i < header.length; i++) row[header[i]] = cells[i] ?? "";
    yield row;
  }
}

/** Read a small reference file fully. Only for files of a few thousand rows. */
export async function readCsvAll(path: string): Promise<CsvRow[]> {
  const rows: CsvRow[] = [];
  for await (const row of readCsv(path)) rows.push(row);
  return rows;
}

// --- Cell coercion ---------------------------------------------------------
// The CSVs use "" for null, and 0/1 for booleans. Coercing explicitly means a
// malformed cell fails loudly at seed time rather than becoming NaN on screen.

export function str(row: CsvRow, key: string): string {
  const v = row[key];
  if (v === undefined) throw new Error(`Missing column "${key}"`);
  return v.trim();
}

export function optStr(row: CsvRow, key: string): string | null {
  const v = row[key];
  if (v === undefined) return null;
  const t = v.trim();
  return t === "" ? null : t;
}

export function num(row: CsvRow, key: string): number {
  const raw = str(row, key);
  const n = Number(raw);
  if (!Number.isFinite(n)) {
    throw new Error(`Column "${key}" is not a number: ${JSON.stringify(raw)}`);
  }
  return n;
}

export function optNum(row: CsvRow, key: string): number | null {
  const raw = optStr(row, key);
  if (raw === null) return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) {
    throw new Error(`Column "${key}" is not a number: ${JSON.stringify(raw)}`);
  }
  return n;
}

export function int(row: CsvRow, key: string): number {
  return Math.round(num(row, key));
}

export function bool(row: CsvRow, key: string): boolean {
  const raw = str(row, key);
  if (raw === "1" || raw === "true" || raw === "True") return true;
  if (raw === "0" || raw === "false" || raw === "False") return false;
  throw new Error(`Column "${key}" is not a 0/1 flag: ${JSON.stringify(raw)}`);
}

/** `"2026-04-09"` -> a UTC Date, so @db.Date stores the day we actually read. */
export function dateOnly(row: CsvRow, key: string): Date {
  const raw = str(row, key);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    throw new Error(`Column "${key}" is not a YYYY-MM-DD date: ${JSON.stringify(raw)}`);
  }
  return new Date(`${raw}T00:00:00.000Z`);
}

export function optDateOnly(row: CsvRow, key: string): Date | null {
  const raw = optStr(row, key);
  if (raw === null) return null;
  return new Date(`${raw}T00:00:00.000Z`);
}
