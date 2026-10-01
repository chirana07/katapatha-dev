import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { openNodeSqlite } from "../db/node-sqlite";
import { migrate } from "../db/migrations";
import type { SqlDriver } from "../db/driver";
import { deviceId } from "./device";

let sql: SqlDriver;

beforeEach(async () => {
  sql = openNodeSqlite();
  await migrate(sql);
});

afterEach(async () => {
  await sql.close();
});

describe("deviceId", () => {
  it("mints an id shaped like the web console's", () => {
    // The server sees ids from both clients; they should look alike.
    return expect(deviceId(sql)).resolves.toMatch(/^device-[0-9a-z]{10}$/);
  });

  it("returns the same id on every later call", async () => {
    const first = await deviceId(sql);
    const second = await deviceId(sql);
    const third = await deviceId(sql);
    expect(second).toBe(first);
    expect(third).toBe(first);
  });

  it("has one winner when two callers race on first launch", async () => {
    // Both must end up with the same id: a device whose id changes per launch
    // makes the server's per-device bookkeeping meaningless.
    const [a, b] = await Promise.all([deviceId(sql), deviceId(sql)]);
    expect(a).toBe(b);

    const rows = await sql.all<{ value: string }>(
      "SELECT value FROM meta WHERE key = 'device_id'",
    );
    expect(rows).toHaveLength(1);
  });
});
