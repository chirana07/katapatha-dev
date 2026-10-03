import { describe, expect, it } from "vitest";
import {
  FIX_TIMEOUT_MS,
  MAX_PINGS_PER_REQUEST,
  PING_INTERVAL_MS,
  PingBuffer,
  buildPing,
  classifyResponse,
  fixTakenAt,
  mintPingId,
  shouldTakeFix,
  withTimeout,
  type Ping,
} from "./pings";

const ID = "01JBX3Q7W2R8M5T9K4N6P0ZYAB";

function ping(n: number): Ping {
  return {
    clientPingId: `PING${String(n).padStart(8, "0")}`,
    lat: 7,
    lng: 79,
    recordedAt: new Date(Date.UTC(2026, 3, 9, 1, 0, n)).toISOString(),
  };
}

describe("buildPing", () => {
  it("builds exactly the contract's fields, rounded to a metre, with the phone's fix time", () => {
    expect(
      buildPing(
        { latitude: 7.123456789, longitude: 79.987654321, accuracy: 17.6, takenAtMs: Date.UTC(2026, 3, 9, 1, 11) },
        ID,
      ),
    ).toEqual({
      clientPingId: ID,
      lat: 7.12346,
      lng: 79.98765,
      accuracyM: 18,
      recordedAt: "2026-04-09T01:11:00.000Z",
    });
  });

  it("leaves accuracy out rather than inventing it", () => {
    for (const accuracy of [null, undefined, -1, NaN]) {
      const built = buildPing({ latitude: 7, longitude: 79, accuracy, takenAtMs: 0 }, ID);
      expect(built && "accuracyM" in built).toBe(false);
    }
  });

  it("refuses a fix that cannot be real", () => {
    expect(buildPing({ latitude: NaN, longitude: 79, takenAtMs: 0 }, ID)).toBeNull();
    expect(buildPing({ latitude: 91, longitude: 79, takenAtMs: 0 }, ID)).toBeNull();
    expect(buildPing({ latitude: 7, longitude: -181, takenAtMs: 0 }, ID)).toBeNull();
    expect(buildPing({ latitude: 7, longitude: 79, takenAtMs: NaN }, ID)).toBeNull();
  });

  it("refuses an id the contract would reject (8 to 64 characters)", () => {
    expect(buildPing({ latitude: 7, longitude: 79, takenAtMs: 0 }, "short")).toBeNull();
    expect(buildPing({ latitude: 7, longitude: 79, takenAtMs: 0 }, "x".repeat(65))).toBeNull();
  });
});

describe("mintPingId", () => {
  it("is a ULID and is unique per ping", () => {
    const a = mintPingId();
    const b = mintPingId();
    expect(a).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(a).not.toBe(b);
  });
});

describe("fixTakenAt", () => {
  it("uses the fix's own time so the age is measured from when it was taken", () => {
    expect(fixTakenAt(1_000, 5_000)).toBe(1_000);
  });
  it("never stamps a fix ahead of the phone's clock", () => {
    expect(fixTakenAt(9_000, 5_000)).toBe(5_000);
    expect(fixTakenAt(NaN, 5_000)).toBe(5_000);
    expect(fixTakenAt(null, 5_000)).toBe(5_000);
  });
});

describe("cadence", () => {
  it("takes the first fix at once, then one a minute (same as the web driver)", () => {
    expect(PING_INTERVAL_MS).toBe(60_000);
    expect(shouldTakeFix(null, 1_000)).toBe(true);
    expect(shouldTakeFix(1_000, 1_000 + PING_INTERVAL_MS - 1)).toBe(false);
    expect(shouldTakeFix(1_000, 1_000 + PING_INTERVAL_MS)).toBe(true);
  });
});

describe("PingBuffer", () => {
  it("is bounded at the contract's per-request maximum, dropping the oldest", () => {
    expect(MAX_PINGS_PER_REQUEST).toBe(50);
    const buffer = new PingBuffer();
    for (let n = 0; n < 60; n++) buffer.add(ping(n));
    expect(buffer.size).toBe(50);
    expect(buffer.peek()[0]?.clientPingId).toBe(ping(10).clientPingId);
    expect(buffer.peek().at(-1)?.clientPingId).toBe(ping(59).clientPingId);
  });

  it("removes only what was sent, so a fix taken mid-send survives", () => {
    const buffer = new PingBuffer();
    buffer.add(ping(1));
    buffer.add(ping(2));
    const sent = buffer.peek();
    buffer.add(ping(3));
    buffer.remove(sent);
    expect(buffer.peek().map((p) => p.clientPingId)).toEqual([ping(3).clientPingId]);
  });

  it("peek is a copy", () => {
    const buffer = new PingBuffer(2);
    buffer.add(ping(1));
    buffer.peek().length = 0;
    expect(buffer.size).toBe(1);
  });
});

describe("classifyResponse", () => {
  it("maps the server's answers to what happens to the batch", () => {
    expect(classifyResponse(200)).toBe("sent");
    expect(classifyResponse(422, "PING_IN_FUTURE")).toBe("clock");
    expect(classifyResponse(422, "VALIDATION")).toBe("rejected");
    expect(classifyResponse(400)).toBe("rejected");
    expect(classifyResponse(401)).toBe("auth");
    expect(classifyResponse(403)).toBe("no-vehicle");
    expect(classifyResponse(0)).toBe("offline");
    expect(classifyResponse(429)).toBe("offline");
    expect(classifyResponse(503)).toBe("offline");
  });
});

describe("withTimeout", () => {
  it("returns the value when it arrives in time", async () => {
    expect(await withTimeout(Promise.resolve(7), 50)).toBe(7);
  });
  it("returns null rather than blocking when no fix arrives", async () => {
    expect(FIX_TIMEOUT_MS).toBeGreaterThan(0);
    expect(await withTimeout(new Promise<number>(() => {}), 10)).toBeNull();
  });
  it("returns null when the fix throws", async () => {
    expect(await withTimeout(Promise.reject(new Error("no gps")), 50)).toBeNull();
  });
});
