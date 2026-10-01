import { ulid } from "@katapatha/core/offline/ulid";
import type { SqlDriver } from "../db/driver";

/**
 * A stable id for this handset.
 *
 * Not a security credential -- it travels with every event so the server can
 * tell two devices on the same account apart, which is what SyncLog and the
 * conflict story need. The web console keeps the equivalent in localStorage;
 * here it lives in the meta table, so it survives app restarts and is gone when
 * the app's data is cleared.
 *
 * Minted once and then read. A device whose id changed on every launch would
 * make the server's per-device bookkeeping meaningless.
 */
const KEY = "device_id";

export async function deviceId(sql: SqlDriver): Promise<string> {
  const existing = await sql.first<{ value: string }>(
    "SELECT value FROM meta WHERE key = ?",
    [KEY],
  );
  if (existing?.value) return existing.value;

  const minted = `device-${ulid().slice(-10).toLowerCase()}`;
  // ON CONFLICT DO NOTHING, then re-read: two callers racing on first launch must
  // agree, and the loser should adopt the winner's id rather than overwrite it.
  await sql.run(
    "INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO NOTHING",
    [KEY, minted],
  );

  const settled = await sql.first<{ value: string }>(
    "SELECT value FROM meta WHERE key = ?",
    [KEY],
  );
  return settled?.value ?? minted;
}
