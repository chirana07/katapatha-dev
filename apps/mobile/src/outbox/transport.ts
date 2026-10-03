import type { Katapatha } from "@katapatha/api-client/client";
import { describeRejection } from "../driver/rejections";
import type { PodPageKind } from "./intents";
import { parseQualityFlags, type OutboxRow, type SettleOutcome } from "./repo";

/**
 * Puts a claimed batch on the wire: one request, POST /sync/stop-events.
 *
 * The server judges every event on its own. Each one comes back in exactly one
 * of `results` (accepted, duplicate or conflict) or `rejected` (refused for a
 * reason retrying cannot change); an event in neither was NOT applied and is safe
 * to send again. A 403/422 for the WHOLE request means the request itself was
 * refused (src/outbox/README.md, point 3), which is a different thing.
 */

export type TransportResult =
  | {
      kind: "ok";
      endpoint: string;
      accepted: number;
      duplicates: number;
      conflicts: number;
      /** Events the server refused terminally (listed in `outcomes` as `rejected`). */
      rejected: number;
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

type PageBody = {
  id: string;
  kind: PodPageKind;
  data: string;
  qualityFlags: string[];
  capturedAt: string;
};

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
  /** POD_CAPTURED only, and only when it has pages. Absent otherwise. */
  pages?: PageBody[];
  // Required on POST /sync/stop-events: a batch spans several stops and the
  // server routes each event by this id (an event without it is rejected,
  // MISSING_TRIP_STOP_ID).
  tripStopId: string;
};

/**
 * Exactly the fields SubmitEventsRequest declares, and no others.
 * The contract sets additionalProperties: false, so a stray key is a 422 -- and
 * a 422 is the one outcome that permanently loses the driver's record.
 *
 * A picture is sent once. When an event has pages they are the picture and the
 * legacy signatureData / photoData go out null (the server would ignore them
 * anyway); a row queued by an older build has no pages, and keeps sending its
 * legacy fields.
 */
export function toBody(row: OutboxRow): EventBody {
  const pages = (row.pages ?? []).filter((page) => page.data !== null);
  const body: EventBody = {
    id: row.id,
    type: row.type,
    occurredAt: row.occurred_at,
    orderId: row.order_id,
    deliveredUnits: row.delivered_units,
    recipientName: row.recipient_name,
    signatureData: pages.length > 0 ? null : row.signature_data,
    photoData: pages.length > 0 ? null : row.photo_data,
    reasonCode: row.reason_code,
    tripStopId: row.stop_id,
  };
  if (pages.length > 0) {
    body.pages = pages.map((page) => ({
      id: page.id,
      kind: page.kind,
      data: page.data as string,
      qualityFlags: parseQualityFlags(page.quality_flags),
      capturedAt: page.captured_at,
    }));
  }
  return body;
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
          rejected: 0,
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

      const failure = classify(result.response.status);
      if (failure) return failure;

      if (!result.data) {
        return { kind: "offline", error: "The server returned no body." };
      }

      return readBatchResult("/sync/stop-events", result.data, rows, isMock);
    },
  };
}

type RawResult = {
  accepted?: number;
  duplicates?: number;
  conflicts?: number;
  results?: Array<{ id?: string; status?: string; conflictState?: string | null }>;
  rejected?: Array<{ id?: string; code?: string; message?: string }>;
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
  const outcomes: AppliedOutcome[] = [];
  for (const item of results) {
    if (!item.id || !isStatus(item.status)) continue;
    outcomes.push({
      id: item.id,
      status: item.status,
      conflictState: item.conflictState ?? null,
    });
  }

  // `rejected` is read AFTER `results` and never overrides it: an id the server
  // reports as applied is applied. Only ids we actually sent are settled.
  const reported = new Set(outcomes.map((outcome) => outcome.id));
  const refusals: SettleOutcome[] = [];
  for (const item of raw.rejected ?? []) {
    if (!item.id || !sentIds.has(item.id) || reported.has(item.id)) continue;
    reported.add(item.id);
    refusals.push({ id: item.id, status: "rejected", reason: describeRejection(item) });
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
      rejected: 0,
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
    rejected: refusals.length,
    outcomes: [...outcomes, ...refusals],
    clockSkewMs: raw.clockSkewMs ?? null,
    serverSeq: raw.serverSeq ?? null,
    note: null,
  };
}

/** An outcome from `results`: the server applied (or already held) the event, or recorded a conflict. */
type AppliedOutcome = Exclude<SettleOutcome, { status: "rejected" }>;

function isStatus(value: unknown): value is AppliedOutcome["status"] {
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
