import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createKatapathaClient } from "@katapatha/api-client/client";
import { createTransport } from "./transport";
import type { OutboxRow } from "./repo";

/**
 * What goes on the wire.
 *
 * The acceptance test (drain.acceptance.test.ts) fakes the Transport port, so it
 * proves the device's state machine but says nothing about the request itself.
 * This file closes that gap by stubbing fetch and reading the actual request:
 * the URL, the bearer header, and -- most importantly -- that the body carries
 * EXACTLY the keys SubmitEventsRequest declares. The contract sets
 * additionalProperties: false, so one stray key is a 422, and a 422 is the only
 * outcome that permanently loses the driver's record.
 */

const BASE = "http://localhost:4010";

function row(over: Partial<OutboxRow> = {}): OutboxRow {
  return {
    id: "01JA0000000000000000000000",
    batch_key: "01JA0000000000000000000000",
    stop_id: "stop-1",
    type: "ARRIVED",
    occurred_at: "2026-10-01T04:12:00.000Z",
    order_id: null,
    delivered_units: null,
    recipient_name: null,
    reason_code: null,
    signature_data: null,
    photo_data: null,
    payload_bytes: 256,
    state: "sending",
    attempts: 1,
    next_attempt_at: null,
    last_error: null,
    server_status: null,
    conflict_state: null,
    created_at: "2026-10-01T04:12:00.000Z",
    settled_at: null,
    ...over,
  };
}

function transportFor(fetchImpl: typeof fetch) {
  vi.stubGlobal("fetch", fetchImpl);
  return createTransport({
    client: async () =>
      createKatapathaClient({ baseUrl: BASE, getToken: () => "test-token" }),
    deviceId: async () => "device-7f3a91",
    now: () => new Date("2026-10-01T05:00:00.000Z"),
  });
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const OK_BODY = {
  accepted: 1,
  duplicates: 0,
  conflicts: 0,
  results: [{ id: "01JA0000000000000000000000", status: "accepted", conflictState: null }],
  clockSkewMs: 120,
  serverSeq: 42,
};

let captured: { url: string; init: RequestInit } | null = null;

beforeEach(() => {
  captured = null;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function capturingFetch(body: unknown, status = 200): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : null;
    captured = {
      url: request ? request.url : String(input),
      init: request
        ? { method: request.method, headers: request.headers, body: await request.text() }
        : (init ?? {}),
    };
    return jsonResponse(body, status);
  }) as unknown as typeof fetch;
}

describe("the sync request", () => {
  it("posts to /sync/stop-events with a bearer token", async () => {
    const transport = transportFor(capturingFetch(OK_BODY));

    await transport.send([row()]);

    expect(captured?.url).toBe(`${BASE}/sync/stop-events`);
    expect(captured?.init.method).toBe("POST");
    const headers = captured?.init.headers as Headers;
    expect(headers.get("authorization")).toBe("Bearer test-token");
  });

  it("sends exactly deviceId, clientClockAt and events — nothing more", async () => {
    const transport = transportFor(capturingFetch(OK_BODY));

    await transport.send([row()]);

    const body = JSON.parse(String(captured?.init.body));
    expect(Object.keys(body).sort()).toEqual(["clientClockAt", "deviceId", "events"]);
    expect(body.deviceId).toBe("device-7f3a91");
    expect(body.clientClockAt).toBe("2026-10-01T05:00:00.000Z");
  });

  it("sends exactly the StopEvent keys the contract declares", async () => {
    const transport = transportFor(capturingFetch(OK_BODY));

    await transport.send([
      row({
        type: "POD_CAPTURED",
        recipient_name: "Nimali Perera",
        signature_data: "data:image/svg+xml;base64,PHN2Zz4=",
      }),
    ]);

    const body = JSON.parse(String(captured?.init.body));
    expect(Object.keys(body.events[0]).sort()).toEqual([
      "deliveredUnits",
      "id",
      "occurredAt",
      "orderId",
      "photoData",
      "reasonCode",
      "recipientName",
      "signatureData",
      "tripStopId",
      "type",
    ]);
    // Absent values must be null, not undefined: undefined serialises to an
    // absent key, and the device clock must survive verbatim.
    expect(body.events[0].photoData).toBe(null);
    expect(body.events[0].occurredAt).toBe("2026-10-01T04:12:00.000Z");
  });

  it("reads the counts, skew and sequence back", async () => {
    const transport = transportFor(capturingFetch(OK_BODY));

    const result = await transport.send([row()]);

    expect(result).toMatchObject({
      kind: "ok",
      endpoint: "/sync/stop-events",
      accepted: 1,
      duplicates: 0,
      clockSkewMs: 120,
      serverSeq: 42,
    });
  });

  it("does nothing and reports nothing for an empty batch", async () => {
    const transport = transportFor(capturingFetch(OK_BODY));
    const result = await transport.send([]);
    expect(result).toMatchObject({ kind: "ok", endpoint: "none", accepted: 0 });
    expect(captured).toBe(null);
  });
});

describe("how failures are classified", () => {
  it("reports a thrown fetch as offline, never as a server decision", async () => {
    const transport = transportFor(
      (async () => {
        throw new TypeError("Network request failed");
      }) as unknown as typeof fetch,
    );

    const result = await transport.send([row()]);

    expect(result).toMatchObject({ kind: "offline" });
  });

  it("separates 401, 403 and 422, because each row ends up somewhere different", async () => {
    for (const [status, kind] of [
      [401, "auth"],
      [403, "forbidden"],
      [422, "rejected"],
    ] as const) {
      const transport = transportFor(capturingFetch({ error: { code: "X" } }, status));
      expect((await transport.send([row()])).kind).toBe(kind);
    }
  });

  it("treats a 5xx as retryable", async () => {
    const transport = transportFor(capturingFetch({}, 503));
    expect(await transport.send([row()])).toMatchObject({ kind: "server", status: 503 });
  });
});

describe("the 501 fallback", () => {
  it("falls back to the per-stop endpoint, which shares the server's applier", async () => {
    // Today's reality: apps/api/src/routes/sync.ts is a 501 stub. Because a
    // batch_key never spans stops, this regroups the same events rather than
    // writing something different.
    const urls: string[] = [];
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = input instanceof Request ? input.url : String(input);
      urls.push(url);
      if (url.endsWith("/sync/stop-events")) {
        return jsonResponse({ error: { code: "NOT_IMPLEMENTED" } }, 501);
      }
      return jsonResponse({
        accepted: 1,
        duplicates: 0,
        conflicts: 0,
        results: [
          { id: "01JA0000000000000000000000", status: "accepted", conflictState: null },
        ],
      });
    }) as unknown as typeof fetch;

    const transport = transportFor(fetchImpl);
    const result = await transport.send([row()]);

    expect(urls).toEqual([
      `${BASE}/sync/stop-events`,
      `${BASE}/stops/stop-1/events`,
    ]);
    expect(result).toMatchObject({
      kind: "ok",
      endpoint: "/stops/{stopId}/events",
      accepted: 1,
    });
    if (result.kind === "ok") {
      expect(result.note).toMatch(/501/);
    }
  });

  it("groups the fallback by stop, one request each", async () => {
    const urls: string[] = [];
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = input instanceof Request ? input.url : String(input);
      urls.push(url);
      if (url.endsWith("/sync/stop-events")) return jsonResponse({}, 501);
      return jsonResponse({ accepted: 1, duplicates: 0, conflicts: 0, results: [] });
    }) as unknown as typeof fetch;

    const transport = transportFor(fetchImpl);
    await transport.send([
      row({ id: "01JA", stop_id: "stop-1" }),
      row({ id: "01JB", stop_id: "stop-2" }),
    ]);

    expect(urls.slice(1).sort()).toEqual([
      `${BASE}/stops/stop-1/events`,
      `${BASE}/stops/stop-2/events`,
    ]);
  });
});

describe("the Prism mock's static response", () => {
  // Prism returns the example from the spec whatever it is sent: fixed counts and
  // three hard-coded ULIDs. Without special handling nothing would ever settle
  // and the app would be undemoable.
  const MOCK_BODY = {
    accepted: 1,
    duplicates: 0,
    conflicts: 0,
    results: [{ id: "01JB2X8Q9K7YC4V3M0ZQ5T6RWE", status: "accepted", conflictState: null }],
  };

  it("settles by position against the mock, and says so", async () => {
    vi.stubGlobal("fetch", capturingFetch(MOCK_BODY));
    const transport = createTransport({
      client: async () =>
        createKatapathaClient({ baseUrl: BASE, getToken: () => "t" }),
      deviceId: async () => "device-7f3a91",
      isMock: () => true,
    });

    const result = await transport.send([row({ id: "01JOURS" })]);

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    // Our id, not the example's.
    expect(result.outcomes).toEqual([
      { id: "01JOURS", status: "accepted", conflictState: null },
    ]);
    expect(result.note).toBe("mock-response: settled by position");
  });

  it("does NOT settle by position against a real server", async () => {
    // The same mismatched response from a real base URL means the server really
    // did report ids we did not send; those rows must be re-queued, not assumed.
    vi.stubGlobal("fetch", capturingFetch(MOCK_BODY));
    const transport = createTransport({
      client: async () =>
        createKatapathaClient({ baseUrl: BASE, getToken: () => "t" }),
      deviceId: async () => "device-7f3a91",
      isMock: () => false,
    });

    const result = await transport.send([row({ id: "01JOURS" })]);

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.outcomes.map((o) => o.id)).toEqual(["01JB2X8Q9K7YC4V3M0ZQ5T6RWE"]);
    expect(result.note).toBe(null);
  });
});
