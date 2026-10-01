import { DatabaseSync } from "node:sqlite";
import type { SqlDriver, SqlValue } from "./driver";

/**
 * SqlDriver over node:sqlite, for the tests.
 *
 * This is not a mock. It is real SQLite running the real DDL and the real
 * statements, so src/outbox/drain.acceptance.test.ts proves the queue's
 * behaviour rather than proving that a fake agrees with itself. Only the binding
 * differs from the device.
 *
 * node:sqlite rather than better-sqlite3 on purpose: better-sqlite3 is a native
 * addon that would have to compile in CI, and this needs no build step.
 */
export function openNodeSqlite(path = ":memory:"): SqlDriver {
  const db = new DatabaseSync(path);

  db.exec("PRAGMA foreign_keys = ON");

  const driver: SqlDriver = {
    async exec(sql) {
      db.exec(sql);
    },

    async run(sql, params = []) {
      const result = db.prepare(sql).run(...params);
      return Number(result.changes);
    },

    async all<T>(sql: string, params: SqlValue[] = []) {
      return db.prepare(sql).all(...params) as T[];
    },

    async first<T>(sql: string, params: SqlValue[] = []) {
      return (db.prepare(sql).get(...params) as T | undefined) ?? null;
    },

    async tx<T>(body: (tx: SqlDriver) => Promise<T>) {
      db.exec("BEGIN");
      try {
        const result = await body(driver);
        db.exec("COMMIT");
        return result;
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },

    async close() {
      db.close();
    },
  };

  return driver;
}
