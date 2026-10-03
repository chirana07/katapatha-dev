import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createKatapathaClient } from "@katapatha/api-client/client";
import { createTransport } from "./transport";
import type { OutboxPageRow, OutboxRow } from "./repo";

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

describe("there is no per-stop fallback any more", () => {
  it("treats a 501 from the sync endpoint like any 5xx: retry later, one request, nothing regrouped", async () => {
    // routes/sync.ts is real. A 501 now would be a misconfigured proxy, and the
    // rows must simply stay queued -- not be re-sent to a second endpoint.
    const urls: string[] = [];
    const fetchImpl = (async (input: RequestInfo | URL) => {
      urls.push(input instanceof Request ? input.url : String(input));
      return jsonResponse({ error: { code: "NOT_IMPLEMENTED" } }, 501);
    }) as unknown as typeof fetch;

    const result = await transportFor(fetchImpl).send([row()]);

    expect(urls).toEqual([`${BASE}/sync/stop-events`]);
    expect(result).toMatchObject({ kind: "server", status: 501 });
  });
});

function page(over: Partial<OutboxPageRow> = {}): OutboxPageRow {
  return {
    id: "01JP0000000000000000000000",
    event_id: "01JA0000000000000000000000",
    seq: 0,
    kind: "RECEIPT",
    data: "data:image/jpeg;base64,/9j/4AAQ",
    quality_flags: '["TEXT_NOT_CONFIRMED"]',
    captured_at: "2026-10-01T04:09:00.000Z",
    payload_bytes: 31,
    ...over,
  };
}

describe("multi-page proof of delivery on the wire", () => {
  it("sends the pages (id, kind, data, qualityFlags, capturedAt) on the POD and not the legacy fields", async () => {
    const transport = transportFor(capturingFetch(OK_BODY));

    await transport.send([
      row({
        type: "POD_CAPTURED",
        recipient_name: "Nimali Perera",
        pages: [
          page(),
          page({ id: "01JP0000000000000000000001", seq: 1, kind: "SIGNATURE", quality_flags: "[]" }),
        ],
      }),
    ]);

    const [event] = JSON.parse(String(captured?.init.body)).events;
    expect(event.pages).toEqual([
      {
        id: "01JP0000000000000000000000",
        kind: "RECEIPT",
        data: "data:image/jpeg;base64,/9j/4AAQ",
        qualityFlags: ["TEXT_NOT_CONFIRMED"],
        capturedAt: "2026-10-01T04:09:00.000Z",
      },
      {
        id: "01JP0000000000000000000001",
        kind: "SIGNATURE",
        data: "data:image/jpeg;base64,/9j/4AAQ",
        qualityFlags: [],
        capturedAt: "2026-10-01T04:09:00.000Z",
      },
    ]);
    expect(Object.keys(event.pages[0]).sort()).toEqual([
      "capturedAt",
      "data",
      "id",
      "kind",
      "qualityFlags",
    ]);
    expect(event.signatureData).toBe(null);
    expect(event.photoData).toBe(null);
    expect(event.tripStopId).toBe("stop-1");
  });

  it("never sends the same picture twice: pages win over legacy columns on one row", async () => {
    const transport = transportFor(capturingFetch(OK_BODY));

    await transport.send([
      row({
        type: "POD_CAPTURED",
        signature_data: "data:image/svg+xml;base64,PHN2Zz4=",
        photo_data: "data:image/jpeg;base64,/9j/4AAQ",
        pages: [page()],
      }),
    ]);

    const [event] = JSON.parse(String(captured?.init.body)).events;
    expect(event.signatureData).toBe(null);
    expect(event.photoData).toBe(null);
    expect(event.pages).toHaveLength(1);
  });

  it("still sends a legacy row's single images, and no pages key", async () => {
    const transport = transportFor(capturingFetch(OK_BODY));

    await transport.send([
      row({ type: "POD_CAPTURED", signature_data: "data:image/svg+xml;base64,PHN2Zz4=" }),
    ]);

    const [event] = JSON.parse(String(captured?.init.body)).events;
    expect(event.signatureData).toBe("data:image/svg+xml;base64,PHN2Zz4=");
    expect("pages" in event).toBe(false);
  });

  it("omits pages on every event that is not a POD", async () => {
    const transport = transportFor(capturingFetch(OK_BODY));
    await transport.send([row(), row({ id: "01JB", type: "UNLOAD_START" })]);
    for (const event of JSON.parse(String(captured?.init.body)).events) {
      expect("pages" in event).toBe(false);
    }
  });
});

describe("events the server refused", () => {
  const A = "01JA0000000000000000000000";
  const B = "01JB0000000000000000000000";

  it("settles a rejected id terminally, with a sentence the driver can read, and counts it", async () => {
    const transport = transportFor(
      capturingFetch({
        accepted: 1,
        duplicates: 0,
        conflicts: 0,
        results: [{ id: A, status: "accepted", conflictState: "NONE" }],
        rejected: [
          { id: B, code: "STOP_NOT_ON_RUN", message: "Stop clx0stp9z8y7 is not on this driver's run." },
        ],
        clockSkewMs: 10,
        serverSeq: 7,
      }),
    );

    const result = await transport.send([row({ id: A }), row({ id: B })]);

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.rejected).toBe(1);
    expect(result.accepted).toBe(1);
    const refusal = result.outcomes.find((o) => o.id === B);
    expect(refusal).toMatchObject({ status: "rejected" });
    if (refusal?.status !== "rejected") throw new Error("expected a rejection");
    expect(refusal.reason).toMatch(/not on your run/i);
    // Not the server's developer wording, and not "failed": a rejection is a known outcome.
    expect(refusal.reason).not.toMatch(/clx0stp|failed/i);
  });

  it("leaves an id that is in neither list out of the outcomes, so it is requeued", async () => {
    const transport = transportFor(
      capturingFetch({
        accepted: 1,
        duplicates: 0,
        conflicts: 0,
        results: [{ id: A, status: "accepted" }],
        rejected: [],
      }),
    );

    const result = await transport.send([row({ id: A }), row({ id: B })]);

    if (result.kind !== "ok") throw new Error("expected ok");
    expect(result.outcomes.map((o) => o.id)).toEqual([A]);
  });

  it("never lets a rejection override an id the server reports as applied", async () => {
    const transport = transportFor(
      capturingFetch({
        accepted: 1,
        duplicates: 0,
        conflicts: 0,
        results: [{ id: A, status: "accepted" }],
        rejected: [{ id: A, code: "STATE_MISMATCH", message: "x" }],
      }),
    );

    const result = await transport.send([row({ id: A })]);

    if (result.kind !== "ok") throw new Error("expected ok");
    expect(result.rejected).toBe(0);
    expect(result.outcomes).toEqual([{ id: A, status: "accepted", conflictState: null }]);
  });

  it("ignores a rejected id it never sent", async () => {
    const transport = transportFor(
      capturingFetch({
        accepted: 1,
        duplicates: 0,
        conflicts: 0,
        results: [{ id: A, status: "accepted" }],
        rejected: [{ id: B, code: "STATE_MISMATCH", message: "x" }],
      }),
    );

    const result = await transport.send([row({ id: A })]);

    if (result.kind !== "ok") throw new Error("expected ok");
    expect(result.rejected).toBe(0);
  });

  it("treats an unknown code as terminal, with generic wording", async () => {
    const transport = transportFor(
      capturingFetch({
        accepted: 0,
        duplicates: 0,
        conflicts: 0,
        results: [],
        rejected: [{ id: A, code: "SOMETHING_NEW", message: "" }],
      }),
    );

    const result = await transport.send([row({ id: A })]);

    if (result.kind !== "ok") throw new Error("expected ok");
    expect(result.outcomes[0]).toMatchObject({ id: A, status: "rejected" });
  });

  it("reads a response with no `rejected` key (an older server) as no rejections", async () => {
    const result = await transportFor(capturingFetch(OK_BODY)).send([row()]);
    if (result.kind !== "ok") throw new Error("expected ok");
    expect(result.rejected).toBe(0);
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
