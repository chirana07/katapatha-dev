import * as SQLite from "expo-sqlite";
import type { SqlDriver, SqlValue } from "./driver";

/**
 * SqlDriver over expo-sqlite, for the device.
 *
 * WAL because a drain writes while the UI reads, and the default journal mode
 * would make the run list block behind a settling batch.
 *
 * foreign_keys is ON so the ON DELETE CASCADE from run -> trip -> stop actually
 * fires: replacing the cached run on a re-bootstrap depends on it, and SQLite
 * leaves the pragma off per connection by default.
 */
const DATABASE_NAME = "katapatha.db";

export async function openDeviceSqlite(
  name = DATABASE_NAME,
): Promise<SqlDriver> {
  const db = await SQLite.openDatabaseAsync(name);

  await db.execAsync("PRAGMA journal_mode = WAL");
  await db.execAsync("PRAGMA foreign_keys = ON");

  const wrap = (handle: SQLite.SQLiteDatabase): SqlDriver => ({
    async exec(sql) {
      await handle.execAsync(sql);
    },

    async run(sql, params = []) {
      const result = await handle.runAsync(sql, params);
      return result.changes;
    },

    async all<T>(sql: string, params: SqlValue[] = []) {
      return handle.getAllAsync<T>(sql, params);
    },

    async first<T>(sql: string, params: SqlValue[] = []) {
      return handle.getFirstAsync<T>(sql, params);
    },

    async tx<T>(body: (tx: SqlDriver) => Promise<T>) {
      // Exclusive, not deferred: a drain settling a batch must not interleave
      // with a driver queueing the next arrival, or a row could be claimed
      // twice.
      let result: T;
      await handle.withExclusiveTransactionAsync(async (txHandle) => {
        result = await body(wrap(txHandle as unknown as SQLite.SQLiteDatabase));
      });
      return result!;
    },

    async close() {
      await handle.closeAsync();
    },
  });

  return wrap(db);
}
