import { describe, it, expect, afterEach } from "vitest";
import { openNodeSqlite } from "./node-sqlite";
import { MIGRATIONS, SCHEMA_VERSION, currentVersion, migrate } from "./migrations";
import type { SqlDriver } from "./driver";

let sql: SqlDriver | null = null;

async function fresh(): Promise<SqlDriver> {
  sql = openNodeSqlite();
  return sql;
}

afterEach(async () => {
  await sql?.close();
  sql = null;
});

type NameRow = { name: string };

async function tableNames(driver: SqlDriver): Promise<string[]> {
  const rows = await driver.all<NameRow>(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
  );
  return rows.map((row) => row.name);
}

describe("migrate", () => {
  it("takes a fresh database to the current version", async () => {
    const driver = await fresh();
    expect(await currentVersion(driver)).toBe(0);

    await migrate(driver);

    expect(await currentVersion(driver)).toBe(SCHEMA_VERSION);
    expect(SCHEMA_VERSION).toBe(MIGRATIONS.length);
  });

  it("creates every table the app reads", async () => {
    const driver = await fresh();
    await migrate(driver);

    expect(await tableNames(driver)).toEqual([
      "meta",
      "outbox_event",
      "outbox_page",
      "run",
      "stop",
      "stop_order",
      "stop_order_item",
      "sync_log",
      "trip",
      "vocabulary",
    ]);
  });

  it("is idempotent: migrating twice changes nothing", async () => {
    const driver = await fresh();
    await migrate(driver);
    const before = await tableNames(driver);

    // Would throw "table already exists" if a migration re-ran.
    await expect(migrate(driver)).resolves.toBe(SCHEMA_VERSION);

    expect(await tableNames(driver)).toEqual(before);
    expect(await currentVersion(driver)).toBe(SCHEMA_VERSION);
  });

  it("indexes the three queries that run on every screen", async () => {
    const driver = await fresh();
    await migrate(driver);

    const rows = await driver.all<NameRow>(
      "SELECT name FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    );
    expect(rows.map((row) => row.name)).toEqual([
      // claim-ready rows for a drain
      "idx_outbox_batch",
      // a POD's pages, in capture order (read at drain time only)
      "idx_outbox_page_event",
      "idx_outbox_ready",
      // pending events for one stop, in ULID order
      "idx_outbox_stop",
      // the run list, in delivery order
      "idx_stop_order",
    ]);
  });
});

describe("the outbox table's guarantees", () => {
  it("makes a re-queued ULID a no-op, which is what a double-tap is", async () => {
    // The device's half of the idempotency story: the same key that makes a
    // replay safe on the server makes a double-submit safe here.
    const driver = await fresh();
    await migrate(driver);

    const insert = `
      INSERT OR IGNORE INTO outbox_event
        (id, batch_key, stop_id, type, occurred_at, state, created_at)
      VALUES (?, ?, ?, ?, ?, 'queued', ?)`;
    const args = [
      "01JA0000000000000000000000",
      "batch-1",
      "stop-1",
      "ARRIVED",
      "2026-10-01T04:10:00.000Z",
      "2026-10-01T04:10:00.000Z",
    ];

    await driver.run(insert, args);
    await driver.run(insert, args);

    const row = await driver.first<{ c: number }>("SELECT COUNT(*) AS c FROM outbox_event");
    expect(row?.c).toBe(1);
  });

  it("refuses a state outside the lifecycle", async () => {
    const driver = await fresh();
    await migrate(driver);

    await expect(
      driver.run(
        `INSERT INTO outbox_event (id, batch_key, stop_id, type, occurred_at, state, created_at)
         VALUES ('01JB', 'b', 's', 'ARRIVED', 'now', 'definitely-not-a-state', 'now')`,
      ),
    ).rejects.toThrow();
  });

  it("defaults a new row to zero attempts and no blobs", async () => {
    const driver = await fresh();
    await migrate(driver);
    await driver.run(
      `INSERT INTO outbox_event (id, batch_key, stop_id, type, occurred_at, state, created_at)
       VALUES ('01JC', 'b', 's', 'ARRIVED', 'now', 'queued', 'now')`,
    );

    const row = await driver.first<{
      attempts: number;
      payload_bytes: number;
      signature_data: string | null;
      settled_at: string | null;
    }>("SELECT attempts, payload_bytes, signature_data, settled_at FROM outbox_event");

    expect(row).toMatchObject({
      attempts: 0,
      payload_bytes: 0,
      signature_data: null,
      settled_at: null,
    });
  });
});

describe("the cached run", () => {
  it("cascades a replaced run down to its stops and orders", async () => {
    // Re-bootstrapping replaces the run wholesale; without the cascade the old
    // day's stops would linger and the run list would show yesterday's work.
    const driver = await fresh();
    await migrate(driver);

    await driver.run("INSERT INTO run VALUES (?, ?, ?)", [
      "2026-10-01",
      "VEH043",
      "2026-10-01T00:00:00.000Z",
    ]);
    await driver.run("INSERT INTO trip VALUES (?, ?, ?, ?)", [
      "trip-1",
      "2026-10-01",
      1,
      "PREDAWN",
    ]);
    await driver.run(
      `INSERT INTO stop VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        "stop-1",
        "trip-1",
        "2026-10-01",
        1,
        "OUT074",
        "Fresh Nugegoda",
        "PENDING",
        "04:12",
        "06:00",
        "11:00",
        null,
      ],
    );
    await driver.run("INSERT INTO stop_order (stop_id, order_id, order_ref, expected_units) VALUES (?, ?, ?, ?)", [
      "stop-1",
      "order-1",
      "ORD-004312",
      120,
    ]);

    await driver.run(
      "INSERT INTO stop_order_item (stop_id, order_id, seq, sku, name, quantity, unit_label) VALUES (?, ?, ?, ?, ?, ?, ?)",
      ["stop-1", "order-1", 0, "FA001", "White Rice 5 kg", 12, "bag"],
    );

    await driver.run("DELETE FROM run WHERE date = ?", ["2026-10-01"]);

    expect(
      (await driver.first<{ c: number }>("SELECT COUNT(*) AS c FROM stop_order_item"))?.c,
    ).toBe(0);
    expect((await driver.first<{ c: number }>("SELECT COUNT(*) AS c FROM trip"))?.c).toBe(0);
    expect((await driver.first<{ c: number }>("SELECT COUNT(*) AS c FROM stop"))?.c).toBe(0);
    expect(
      (await driver.first<{ c: number }>("SELECT COUNT(*) AS c FROM stop_order"))?.c,
    ).toBe(0);
  });

  it("keeps a window as an HH:MM string, never a timestamp", async () => {
    // docs/CONVENTIONS.md: wall-clock time is a string. An outlet opens at 06:00
    // local regardless of what instant that is.
    const driver = await fresh();
    await migrate(driver);
    const row = await driver.first<{ type: string }>(
      "SELECT type FROM pragma_table_info('stop') WHERE name = 'window_open'",
    );
    expect(row?.type).toBe("TEXT");
  });
});

describe("transactions", () => {
  it("rolls back every write when the body throws", async () => {
    // The drain settles several rows plus the run cache together; a partial
    // settle would double-count an event.
    const driver = await fresh();
    await migrate(driver);

    await expect(
      driver.tx(async (tx) => {
        await tx.run("INSERT INTO meta VALUES ('a', '1')");
        await tx.run("INSERT INTO meta VALUES ('b', '2')");
        throw new Error("drain failed mid-settle");
      }),
    ).rejects.toThrow(/drain failed/);

    expect((await driver.first<{ c: number }>("SELECT COUNT(*) AS c FROM meta"))?.c).toBe(0);
  });

  it("commits on success", async () => {
    const driver = await fresh();
    await migrate(driver);

    await driver.tx(async (tx) => {
      await tx.run("INSERT INTO meta VALUES ('device_id', 'device-abc')");
    });

    const row = await driver.first<{ value: string }>(
      "SELECT value FROM meta WHERE key = 'device_id'",
    );
    expect(row?.value).toBe("device-abc");
  });
});

describe("migration 2: proof-of-delivery pages", () => {
  async function eventRow(driver: SqlDriver, id: string): Promise<void> {
    await driver.run(
      `INSERT INTO outbox_event (id, batch_key, stop_id, type, occurred_at, state, created_at)
       VALUES (?, ?, 's', 'POD_CAPTURED', 'now', 'queued', 'now')`,
      [id, id],
    );
  }

  it("upgrades a version-1 database in place and keeps its queued rows and blobs", async () => {
    const driver = await fresh();
    // Exactly what a phone running the previous build holds.
    await driver.exec(MIGRATIONS[0]);
    await driver.exec("PRAGMA user_version = 1");
    await driver.run(
      `INSERT INTO outbox_event
         (id, batch_key, stop_id, type, occurred_at, signature_data, state, created_at)
       VALUES ('01OLD', '01OLD', 's', 'POD_CAPTURED', 'now', 'data:image/svg+xml;base64,PHN2Zz4=', 'queued', 'now')`,
    );
    await driver.run(
      "INSERT INTO sync_log (at, endpoint, sent, outcome) VALUES ('now', 'e', 1, 'sent')",
    );

    await migrate(driver);

    expect(await currentVersion(driver)).toBe(SCHEMA_VERSION);
    const old = await driver.first<{ signature_data: string }>(
      "SELECT signature_data FROM outbox_event WHERE id = '01OLD'",
    );
    expect(old?.signature_data).toBe("data:image/svg+xml;base64,PHN2Zz4=");
    const log = await driver.first<{ rejected: number | null }>("SELECT rejected FROM sync_log");
    expect(log?.rejected).toBe(null);
  });

  it("deletes a page with its event, so prune() leaves no orphan blobs", async () => {
    const driver = await fresh();
    await migrate(driver);
    await eventRow(driver, "01POD");
    await driver.run(
      `INSERT INTO outbox_page (id, event_id, seq, kind, data, captured_at)
       VALUES ('01PG1', '01POD', 0, 'RECEIPT', 'data:image/jpeg;base64,AAAA', 'now')`,
    );

    await driver.run("DELETE FROM outbox_event WHERE id = '01POD'");

    const left = await driver.first<{ c: number }>("SELECT COUNT(*) AS c FROM outbox_page");
    expect(left?.c).toBe(0);
  });

  it("refuses a page for an event that does not exist, and a kind outside the contract", async () => {
    const driver = await fresh();
    await migrate(driver);
    await expect(
      driver.run(
        `INSERT INTO outbox_page (id, event_id, seq, kind, captured_at)
         VALUES ('01PG1', 'nope', 0, 'RECEIPT', 'now')`,
      ),
    ).rejects.toThrow();

    await eventRow(driver, "01POD");
    await expect(
      driver.run(
        `INSERT INTO outbox_page (id, event_id, seq, kind, captured_at)
         VALUES ('01PG2', '01POD', 0, 'SELFIE', 'now')`,
      ),
    ).rejects.toThrow();
  });

  it("makes a re-queued page id a no-op, like the event's own", async () => {
    const driver = await fresh();
    await migrate(driver);
    await eventRow(driver, "01POD");
    const insert = `INSERT OR IGNORE INTO outbox_page (id, event_id, seq, kind, captured_at)
                    VALUES ('01PG1', '01POD', 0, 'RECEIPT', 'now')`;
    expect(await driver.run(insert)).toBe(1);
    expect(await driver.run(insert)).toBe(0);
  });
});

describe("migration 4: order products", () => {
  it("upgrades a version-3 database in place and keeps the cached run", async () => {
    // A phone that cached today's run before this build: its stop_order rows must
    // survive, and stop_order_item starts empty ("no breakdown", not an error).
    const driver = await fresh();
    for (let version = 0; version < 3; version++) {
      await driver.exec(MIGRATIONS[version]);
    }
    await driver.exec("PRAGMA user_version = 3");

    await driver.run("INSERT INTO run VALUES ('2026-10-01', 'VEH043', 'now')");
    await driver.run("INSERT INTO trip VALUES ('trip-1', '2026-10-01', 1, 'PREDAWN')");
    await driver.run(
      "INSERT INTO stop VALUES ('stop-1', 'trip-1', '2026-10-01', 1, 'OUT074', NULL, 'PENDING', NULL, NULL, NULL, NULL)",
    );
    await driver.run(
      "INSERT INTO stop_order (stop_id, order_id, order_ref, expected_units) VALUES ('stop-1', 'o1', 'S1-082', 69)",
    );

    expect(await migrate(driver)).toBe(SCHEMA_VERSION);

    expect((await driver.first<{ c: number }>("SELECT COUNT(*) AS c FROM stop_order"))?.c).toBe(1);
    expect(
      (await driver.first<{ c: number }>("SELECT COUNT(*) AS c FROM stop_order_item"))?.c,
    ).toBe(0);
  });

  it("refuses the same line position twice for one order", async () => {
    const driver = await fresh();
    await migrate(driver);
    await driver.run("INSERT INTO run VALUES ('d', 'V', 'now')");
    await driver.run("INSERT INTO trip VALUES ('t', 'd', 1, 'PREDAWN')");
    await driver.run(
      "INSERT INTO stop VALUES ('s', 't', 'd', 1, 'OUT074', NULL, 'PENDING', NULL, NULL, NULL, NULL)",
    );
    const insert =
      "INSERT INTO stop_order_item (stop_id, order_id, seq, sku, name, quantity, unit_label) VALUES ('s', 'o', 0, 'FA001', 'Rice', 1, 'bag')";
    await driver.run(insert);
    await expect(driver.run(insert)).rejects.toThrow();
  });
});
