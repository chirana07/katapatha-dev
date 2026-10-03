import { afterEach, describe, expect, it } from "vitest";
import { migrate } from "../db/migrations";
import { openNodeSqlite } from "../db/node-sqlite";
import type { SqlDriver } from "../db/driver";
import { POSITION_SHARING_KEY, readPositionSharing, writePositionSharing } from "./consent";

let sql: SqlDriver;

async function fresh(): Promise<SqlDriver> {
  sql = openNodeSqlite();
  await migrate(sql);
  return sql;
}

afterEach(async () => {
  await sql?.close();
});

describe("position sharing consent", () => {
  it("is off until the driver turns it on", async () => {
    await fresh();
    expect(await readPositionSharing(sql)).toBe("off");
  });

  it("remembers on and off, and overwrites in place", async () => {
    await fresh();
    await writePositionSharing(sql, "on");
    expect(await readPositionSharing(sql)).toBe("on");
    await writePositionSharing(sql, "off");
    expect(await readPositionSharing(sql)).toBe("off");
    const rows = await sql.all("SELECT * FROM meta WHERE key = ?", [POSITION_SHARING_KEY]);
    expect(rows).toHaveLength(1);
  });

  it("fails closed on anything but the exact string 'on'", async () => {
    await fresh();
    for (const junk of ["ON", "true", "1", "", " on"]) {
      await sql.run(
        `INSERT INTO meta (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
        [POSITION_SHARING_KEY, junk],
      );
      expect(await readPositionSharing(sql)).toBe("off");
    }
  });

  it("does not disturb other meta keys", async () => {
    await fresh();
    await sql.run("INSERT INTO meta (key, value) VALUES ('device_id', 'device-abc')");
    await writePositionSharing(sql, "on");
    expect(await sql.first("SELECT value FROM meta WHERE key = 'device_id'")).toEqual({
      value: "device-abc",
    });
  });
});
