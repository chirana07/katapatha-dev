import type { SqlDriver } from "../db/driver";
import { getApi } from "../api/client";

/**
 * Asks whether the server has stop events this device has not seen.
 *
 * The case this exists for, from src/outbox/README.md: "a stop reassigned to
 * another vehicle while it was off". The device's cached run would still show that
 * stop, and the driver would drive to it.
 *
 * This only reports HOW MANY changes there are. Applying them means refreshing
 * the run, which bootstrap() already does wholesale -- maintaining a second,
 * event-by-event path to mutate the cache would be a second source of truth for
 * the same facts.
 */

export type PullResult =
  | { kind: "ok"; changed: number; serverSeq: number | null }
  | { kind: "unavailable" };

export async function pullSince(
  sql: SqlDriver,
  sinceSeq: number,
): Promise<PullResult> {
  try {
    const client = await getApi(sql);
    const result = await client.GET("/sync/stop-events", {
      params: { query: { sinceSeq } },
    });

    // 501 today. Not an error worth surfacing: the driver loses nothing, because
    // the next bootstrap refreshes the run anyway.
    if (!result.response.ok || !result.data) return { kind: "unavailable" };

    return {
      kind: "ok",
      changed: result.data.events?.length ?? 0,
      serverSeq: result.data.serverSeq ?? null,
    };
  } catch {
    return { kind: "unavailable" };
  }
}

/** The cursor for the next pull. */
export async function readServerSeq(sql: SqlDriver): Promise<number> {
  const row = await sql.first<{ value: string }>(
    "SELECT value FROM meta WHERE key = 'server_seq'",
  );
  const parsed = row ? Number(row.value) : 0;
  return Number.isFinite(parsed) ? parsed : 0;
}
