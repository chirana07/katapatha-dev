import type { SqlDriver } from "../db/driver";

/**
 * The driver's opt-in to position sharing, kept on the phone.
 *
 * Stored in the existing `meta` key/value table (no schema change). The default
 * is OFF: nothing here ever answers "on" unless the driver turned it on. Anything
 * other than the exact string 'on' reads as off, so a corrupt or hand-edited row
 * fails closed.
 */
export const POSITION_SHARING_KEY = "position_sharing";

export type PositionSharing = "on" | "off";

export async function readPositionSharing(sql: SqlDriver): Promise<PositionSharing> {
  const row = await sql.first<{ value: string }>("SELECT value FROM meta WHERE key = ?", [
    POSITION_SHARING_KEY,
  ]);
  return row?.value === "on" ? "on" : "off";
}

export async function writePositionSharing(
  sql: SqlDriver,
  value: PositionSharing,
): Promise<void> {
  await sql.run(
    `INSERT INTO meta (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [POSITION_SHARING_KEY, value],
  );
}
