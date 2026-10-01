/**
 * The SQL seam.
 *
 * expo-sqlite is a native module: it cannot run under Node, so a test that
 * imported it could never execute in CI. But the outbox is the one subsystem
 * that MUST be proven by a test (src/outbox/README.md makes the acceptance test
 * a release gate), and what needs proving is the SQL and the state machine, not
 * the binding.
 *
 * So everything above this file talks to SqlDriver. src/db/sqlite.ts implements
 * it with expo-sqlite on the device; src/db/node-sqlite.ts implements it with
 * node:sqlite for the tests. Both run the SAME DDL from src/db/migrations.ts and
 * the same statements, so the tests exercise real SQLite, not a mock of it.
 *
 * Deliberately zero imports: this is a type contract, nothing else.
 */

/** A value SQLite can bind. */
export type SqlValue = string | number | null;

export interface SqlDriver {
  /** Runs one or more statements with no parameters and no result. For DDL. */
  exec(sql: string): Promise<void>;

  /** Runs one parameterised statement. Returns rows affected. */
  run(sql: string, params?: SqlValue[]): Promise<number>;

  /** Runs one parameterised query and returns every row. */
  all<T>(sql: string, params?: SqlValue[]): Promise<T[]>;

  /** Runs one parameterised query and returns the first row, or null. */
  first<T>(sql: string, params?: SqlValue[]): Promise<T | null>;

  /**
   * Runs `body` inside a transaction, committing on resolve and rolling back on
   * throw.
   *
   * The outbox depends on this being real. Settling a drain writes several rows
   * and the run cache together: a partial settle would leave an event both
   * confirmed on the server and still folding into the local projection, which
   * is precisely the double-count the projection is designed to avoid.
   */
  tx<T>(body: (driver: SqlDriver) => Promise<T>): Promise<T>;

  /** Releases the handle. Tests call this; the app does not. */
  close(): Promise<void>;
}
