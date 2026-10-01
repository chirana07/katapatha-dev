import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { openNodeSqlite } from "../db/node-sqlite";
import { migrate } from "../db/migrations";
import type { SqlDriver } from "../db/driver";
import { fetchMe, signIn, signOut } from "./session";
import { resetApi } from "./client";

// expo-secure-store is a native module. The token store is not what is under
// test here; the status mapping is.
const stored = new Map<string, string>();
vi.mock("expo-secure-store", () => ({
  setItemAsync: async (key: string, value: string) => {
    stored.set(key, value);
  },
  getItemAsync: async (key: string) => stored.get(key) ?? null,
  deleteItemAsync: async (key: string) => {
    stored.delete(key);
  },
}));

vi.mock("expo-constants", () => ({
  default: { expoConfig: { extra: { apiBaseUrl: "http://localhost:4010" } } },
}));

let sql: SqlDriver;

function respondWith(body: unknown, status: number, headers: Record<string, string> = {}) {
  vi.stubGlobal("fetch", async () =>
    new Response(status === 204 ? null : JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json", ...headers },
    }),
  );
}

const DRIVER = {
  id: "user-1",
  email: "sunil@waypoint.lk",
  name: "Sunil Fernando",
  role: "DRIVER" as const,
  depotCode: "Peliyagoda",
  outletId: null,
  defaultVehicleId: null,
};

beforeEach(async () => {
  sql = openNodeSqlite();
  await migrate(sql);
  stored.clear();
  resetApi();
});

afterEach(async () => {
  vi.unstubAllGlobals();
  resetApi();
  await sql.close();
});

describe("signIn", () => {
  it("stores the bearer token on success", async () => {
    respondWith({ token: "opaque-token", home: "/driver", user: DRIVER }, 201);

    const result = await signIn(sql, {
      email: "sunil@waypoint.lk",
      password: "waypoint",
    });

    expect(result).toMatchObject({ kind: "ok", home: "/driver" });
    expect(stored.get("katapatha.session")).toBe("opaque-token");
  });

  it("normalises the email, so a capitalised keyboard does not block sign-in", async () => {
    let sentBody = "";
    vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
      sentBody = input instanceof Request ? await input.text() : "";
      return new Response(JSON.stringify({ token: "t", home: "/driver", user: DRIVER }), {
        status: 201,
        headers: { "content-type": "application/json" },
      });
    });

    await signIn(sql, { email: "  Sunil@Waypoint.LK  ", password: "waypoint" });

    expect(JSON.parse(sentBody).email).toBe("sunil@waypoint.lk");
  });

  it("maps 401 to invalid credentials", async () => {
    respondWith({ error: { code: "UNAUTHORIZED" } }, 401);
    expect(await signIn(sql, { email: "a@b.lk", password: "x" })).toEqual({
      kind: "invalid",
    });
    expect(stored.size).toBe(0);
  });

  it("reads Retry-After on a 429 so the screen can say how long", async () => {
    respondWith({ error: { code: "TOO_MANY_REQUESTS" } }, 429, { "retry-after": "60" });

    expect(await signIn(sql, { email: "a@b.lk", password: "x" })).toEqual({
      kind: "throttled",
      retryAfterSeconds: 60,
    });
  });

  it("survives a 429 with no Retry-After header", async () => {
    respondWith({}, 429);
    expect(await signIn(sql, { email: "a@b.lk", password: "x" })).toEqual({
      kind: "throttled",
      retryAfterSeconds: null,
    });
  });

  it("refuses a non-driver account plainly instead of letting the guard bounce them", async () => {
    // A dispatcher signed into the driver app would land on a run list that 403s
    // forever.
    respondWith(
      { token: "t", home: "/dispatcher", user: { ...DRIVER, role: "DISPATCHER" } },
      201,
    );

    expect(await signIn(sql, { email: "nimal@waypoint.lk", password: "waypoint" })).toEqual({
      kind: "not-a-driver",
      role: "DISPATCHER",
    });
    // And no token is kept.
    expect(stored.size).toBe(0);
  });

  it("reports a thrown fetch as offline, not as bad credentials", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new TypeError("Network request failed");
    });

    expect((await signIn(sql, { email: "a@b.lk", password: "x" })).kind).toBe("offline");
  });
});

describe("signOut", () => {
  it("clears the token even when the server cannot be reached", async () => {
    stored.set("katapatha.session", "opaque-token");
    vi.stubGlobal("fetch", async () => {
      throw new TypeError("Network request failed");
    });

    await signOut(sql);

    // A driver who taps Sign out must end up signed out on this handset
    // regardless of signal.
    expect(stored.size).toBe(0);
  });

  it("leaves queued outbox rows alone", async () => {
    // They are the driver's record of work done, not session state. The next
    // sign-in drains them.
    await sql.run(
      `INSERT INTO outbox_event (id, batch_key, stop_id, type, occurred_at, state, created_at)
       VALUES ('01JA', 'b', 'stop-1', 'ARRIVED', 'now', 'queued', 'now')`,
    );
    respondWith(null, 204);

    await signOut(sql);

    const row = await sql.first<{ c: number }>("SELECT COUNT(*) AS c FROM outbox_event");
    expect(row?.c).toBe(1);
  });
});

describe("fetchMe", () => {
  // These are separate cases, not three asserts in one, because openapi-fetch
  // captures globalThis.fetch when the client is constructed and getApi()
  // memoises the client -- so each stub needs a fresh client via resetApi().
  //
  // The expired/unreachable distinction is the whole point: a driver opening the
  // app with no signal must stay signed in and keep working from the cache.
  // Treating unreachable as expired would empty the screen at exactly the moment
  // the app is supposed to prove its worth.

  it("treats a 401 as an expired session", async () => {
    respondWith({ error: { code: "UNAUTHORIZED" } }, 401);
    expect((await fetchMe(sql)).kind).toBe("expired");
  });

  it("treats a thrown fetch as unreachable, NOT expired", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new TypeError("Network request failed");
    });
    resetApi();
    expect((await fetchMe(sql)).kind).toBe("unreachable");
  });

  it("treats a 5xx as unreachable, NOT expired", async () => {
    respondWith({}, 503);
    resetApi();
    expect((await fetchMe(sql)).kind).toBe("unreachable");
  });

  it("returns the user when the token still works", async () => {
    respondWith(DRIVER, 200);
    expect(await fetchMe(sql)).toEqual({ kind: "ok", user: DRIVER });
  });
});
