import type { Katapatha } from "@katapatha/api-client/client";
import type { OutboxRow, SettleOutcome } from "./repo";

/**
 * Puts a claimed batch on the wire.
 *
 * One shape, two endpoints. POST /sync/stop-events is the real path and the one
 * the outbox is designed around. POST /stops/{stopId}/events is the fallback for
 * today's server, where routes/sync.ts returns 501 -- and because a batch_key
 * never spans stops, falling back is a regrouping of the same events, not a
 * different write. src/outbox/README.md: "There is exactly one write to replay."
 */

export type TransportResult =
  | {
      kind: "ok";
      endpoint: string;
      accepted: number;
      duplicates: number;
      conflicts: number;
      outcomes: SettleOutcome[];
      clockSkewMs: number | null;
      serverSeq: number | null;
      note: string | null;
    }
  | { kind: "offline"; error: string }
  | { kind: "auth" }
  | { kind: "forbidden" }
  | { kind: "rejected"; reason: string }
  | { kind: "server"; status: number };

export interface Transport {
  send(rows: readonly OutboxRow[]): Promise<TransportResult>;
}

type EventBody = {
  id: string;
  type: OutboxRow["type"];
  occurredAt: string;
  orderId: string | null;
  deliveredUnits: number | null;
  recipientName: string | null;
  signatureData: string | null;
  photoData: string | null;
  reasonCode: string | null;
  // Additive field. Required on POST /sync/stop-events (a batch spans
  // several stops and the server routes each event by this id). Ignored on
  // POST /stops/{stopId}/events where the URL carries the stop.
  tripStopId: string | null;
};

/**
 * Exactly the fields SubmitEventsRequest declares, and no others.
 * The contract sets additionalProperties: false, so a stray key is a 422 -- and
 * a 422 is the one outcome that permanently loses the driver's record.
 */
function toBody(row: OutboxRow): EventBody {
  return {
    id: row.id,
    type: row.type,
    occurredAt: row.occurred_at,
    orderId: row.order_id,
    deliveredUnits: row.delivered_units,
    recipientName: row.recipient_name,
    signatureData: row.signature_data,
    photoData: row.photo_data,
    reasonCode: row.reason_code,
    tripStopId: row.stop_id,
  };
}

export function createTransport(options: {
  client: () => Promise<Katapatha>;
  deviceId: () => Promise<string>;
  now?: () => Date;
  /**
   * True when pointed at the Prism mock, which enables the settle-by-position
   * path. Resolved per send rather than captured once, because the base URL can
   * be changed at runtime from the Connection screen and a cached flag would go
   * stale the moment it was.
   */
  isMock?: () => boolean | Promise<boolean>;
}): Transport {
  const now = options.now ?? (() => new Date());

  return {
    async send(rows) {
      if (rows.length === 0) {
        return {
          kind: "ok",
          endpoint: "none",
          accepted: 0,
          duplicates: 0,
          conflicts: 0,
          outcomes: [],
          clockSkewMs: null,
          serverSeq: null,
          note: null,
        };
      }

      const client = await options.client();
      const deviceId = await options.deviceId();
      const isMock = (await options.isMock?.()) ?? false;
      const events = rows.map(toBody);

      let result;
      try {
        result = await client.POST("/sync/stop-events", {
          body: {
            deviceId,
            clientClockAt: now().toISOString(),
            events,
          },
        });
      } catch (error) {
        // A thrown fetch is no connectivity, a DNS failure or a timeout. It is
        // never a decision by the server, so the rows must survive untouched.
        return { kind: "offline", error: describe(error) };
      }

      // Today's API: routes/sync.ts is a 501 stub. Regroup by stop and use the
      // online endpoint, which shares the server's applier.
      if (result.response.status === 501) {
        return sendPerStop(client, deviceId, rows, isMock);
      }

      const failure = classify(result.response.status);
      if (failure) return failure;

      if (!result.data) {
        return { kind: "offline", error: "The server returned no body." };
      }

      return readBatchResult("/sync/stop-events", result.data, rows, isMock);
    },
  };
}

/**
 * The 501 fallback: one request per stop, results merged.
 *
 * A batch_key never spans stops, so no intent is split by this grouping.
 */
async function sendPerStop(
  client: Katapatha,
  deviceId: string,
  rows: readonly OutboxRow[],
  isMock: boolean,
): Promise<TransportResult> {
  const byStop = new Map<string, OutboxRow[]>();
  for (const row of rows) {
    const list = byStop.get(row.stop_id) ?? [];
    list.push(row);
    byStop.set(row.stop_id, list);
  }

  const merged: SettleOutcome[] = [];
  let accepted = 0;
  let duplicates = 0;
  let conflicts = 0;

  for (const [stopId, stopRows] of byStop) {
    let result;
    try {
      result = await client.POST("/stops/{stopId}/events", {
        params: { path: { stopId } },
        body: { deviceId, events: stopRows.map(toBody) },
      });
    } catch (error) {
      // Partial progress is safe to keep: anything already accepted will come
      // back as a duplicate on the retry.
      if (merged.length === 0) return { kind: "offline", error: describe(error) };
      break;
    }

    const failure = classify(result.response.status);
    if (failure) {
      if (merged.length === 0) return failure;
      break;
    }
    if (!result.data) break;

    const read = readBatchResult("/stops/{stopId}/events", result.data, stopRows, isMock);
    if (read.kind !== "ok") return read;

    accepted += read.accepted;
    duplicates += read.duplicates;
    conflicts += read.conflicts;
    merged.push(...read.outcomes);
  }

  return {
    kind: "ok",
    endpoint: "/stops/{stopId}/events",
    accepted,
    duplicates,
    conflicts,
    outcomes: merged,
    clockSkewMs: null,
    serverSeq: null,
    note: "sync endpoint returned 501; sent per stop",
  };
}

type RawResult = {
  accepted?: number;
  duplicates?: number;
  conflicts?: number;
  results?: Array<{ id?: string; status?: string; conflictState?: string | null }>;
  clockSkewMs?: number;
  serverSeq?: number;
};

function readBatchResult(
  endpoint: string,
  data: unknown,
  rows: readonly OutboxRow[],
  isMock: boolean,
): TransportResult {
  const raw = data as RawResult;
  const results = raw.results ?? [];

  const sentIds = new Set(rows.map((row) => row.id));
  const outcomes: SettleOutcome[] = [];
  for (const item of results) {
    if (!item.id || !isStatus(item.status)) continue;
    outcomes.push({
      id: item.id,
      status: item.status,
      conflictState: item.conflictState ?? null,
    });
  }

  // The Prism mock returns a STATIC example: three hard-coded ULIDs and fixed
  // counts, whatever it was sent. So its ids can never match ours and nothing
  // would ever settle. Against the mock only, and only when the counts add up to
  // what we sent, settle by position so the app is demoable -- and say so, in
  // sync_log and on the outbox screen, so a mock run is never mistaken for a
  // real one. The acceptance test does not use this path.
  const intersects = outcomes.some((outcome) => sentIds.has(outcome.id));
  const total = (raw.accepted ?? 0) + (raw.duplicates ?? 0) + (raw.conflicts ?? 0);
  if (isMock && !intersects && outcomes.length > 0 && total === rows.length) {
    return {
      kind: "ok",
      endpoint,
      accepted: raw.accepted ?? 0,
      duplicates: raw.duplicates ?? 0,
      conflicts: raw.conflicts ?? 0,
      outcomes: rows.map((row, index) => ({
        id: row.id,
        status: outcomes[Math.min(index, outcomes.length - 1)].status,
        conflictState: null,
      })),
      clockSkewMs: raw.clockSkewMs ?? null,
      serverSeq: raw.serverSeq ?? null,
      note: "mock-response: settled by position",
    };
  }

  return {
    kind: "ok",
    endpoint,
    accepted: raw.accepted ?? 0,
    duplicates: raw.duplicates ?? 0,
    conflicts: raw.conflicts ?? 0,
    outcomes,
    clockSkewMs: raw.clockSkewMs ?? null,
    serverSeq: raw.serverSeq ?? null,
    note: null,
  };
}

function isStatus(value: unknown): value is SettleOutcome["status"] {
  return value === "accepted" || value === "duplicate" || value === "conflict";
}

function classify(status: number): TransportResult | null {
  if (status === 401) return { kind: "auth" };
  if (status === 403) return { kind: "forbidden" };
  if (status === 422) {
    return {
      kind: "rejected",
      reason:
        "The server rejected these details. Review the quantities, reason, or recipient and try again.",
    };
  }
  if (status >= 500) return { kind: "server", status };
  if (status >= 400) return { kind: "server", status };
  return null;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : "The request could not be sent.";
}
