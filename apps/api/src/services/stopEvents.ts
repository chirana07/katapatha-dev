import type { ConflictState, PodPageKind, ProblemKind } from "@prisma/client";
import { prisma } from "../lib/db.js";
import type { SessionUser } from "../lib/auth.js";
import {
  detectConflict,
  loadConflictContexts,
  resolveStopAccess,
  type StopAccess,
  type StopConflictContext,
} from "./conflicts.js";
import {
  arriveAtStop,
  completeStop,
  recordConflictedFact,
  reportProblem,
  startUnloading,
  StopStateError,
  type PodPageInput,
} from "./delivery.js";

/**
 * The stop-event applier: the ONE place a driver's events become state.
 *
 * POST /stops/{stopId}/events and POST /sync/stop-events both call this, so the
 * online and the offline path cannot diverge. They differ in exactly two ways,
 * both captured by `strict`:
 *
 * - online (`strict: true`): one stop, authorised by the route before this runs.
 *   An event that fails validation fails the request with 422 and NOTHING is
 *   written, because the caller is a person looking at a form who can fix it.
 * - offline (`strict: false`): a batch from an outbox, spanning stops. Nobody is
 *   there to fix it, and one bad event must not hold hostage the other forty-nine
 *   that were recorded hours earlier, so each event is judged on its own and a
 *   bad one is reported back in `rejected`.
 *
 * Four outcomes per event, because the device settles each row differently:
 * accepted and duplicate (both success), conflict (recorded, not applied, never
 * retried), rejected (refused for a reason retrying cannot change). An event in
 * NONE of those lists failed for an unexpected reason (the database, say): it
 * was not applied and is safe to send again, which is what an outbox that finds
 * an id missing from the response already does.
 */

/** Pages per POD event. A receipt with more sheets than this is a different problem. */
export const MAX_POD_PAGES = 8;

/**
 * Characters in one page's data URL. The mobile app caps a photo at 400 KiB of
 * bytes (~550k base64 characters) and a signature at 64 KiB, so this leaves
 * room for a larger capture without letting one page be an arbitrarily large
 * row.
 */
export const MAX_POD_PAGE_CHARS = 1_048_576;

/**
 * Body limit for the two routes that carry events. Fastify's default is 1 MiB,
 * which is below the mobile outbox's own 1.5 MB batch cap and well below eight
 * pages; a batch over the limit would answer 413 and the outbox would retry it
 * forever as a server error.
 */
export const EVENT_BODY_LIMIT = 12 * 1024 * 1024;

const DATA_URL_PREFIX = /^data:image\/(png|jpeg|webp|svg\+xml);base64,/;
const BASE64_BODY = /^[A-Za-z0-9+/]+={0,2}$/;

export const EVENT_TYPES = [
  "ARRIVED",
  "UNLOAD_START",
  "DELIVERED",
  "PART_DELIVERED",
  "FAILED",
  "SKIPPED",
  "POD_CAPTURED",
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export type IncomingPage = {
  id: string;
  kind: PodPageKind;
  data: string;
  qualityFlags?: string[] | null;
  capturedAt: string;
};

export type IncomingEvent = {
  id: string;
  type: EventType;
  occurredAt: string;
  tripStopId?: string | null;
  orderId?: string | null;
  deliveredUnits?: number | null;
  recipientName?: string | null;
  signatureData?: string | null;
  photoData?: string | null;
  reasonCode?: string | null;
  pages?: IncomingPage[] | null;
};

export type EventResultRow = {
  id: string;
  status: "accepted" | "duplicate" | "conflict";
  conflictState: ConflictState | null;
};

export type EventRejection = { id: string; code: string; message: string };

export type ApplyResult = {
  accepted: number;
  duplicates: number;
  conflicts: number;
  results: EventResultRow[];
  rejected: EventRejection[];
};

/** A validation failure that, in strict mode, fails the whole request. */
export class InvalidEventError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const ULID = "^[0-9A-HJKMNP-TV-Z]{26}$";
const nullable = (schema: object) => ({ oneOf: [schema, { type: "null" }] });

/**
 * The request-side JSON Schema for one page, mirrored by hand from the
 * contract's PodPage. The prefix is checked here; the body's alphabet is
 * checked in code, because an anchored pattern over a megabyte of base64 is a
 * lot of regex for AJV to run on every request.
 */
export const POD_PAGE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["id", "kind", "data", "capturedAt"],
  properties: {
    id: { type: "string", pattern: ULID },
    kind: { type: "string", enum: ["RECEIPT", "SIGNATURE", "PHOTO"] },
    data: {
      type: "string",
      maxLength: MAX_POD_PAGE_CHARS,
      pattern: "^data:image/(png|jpeg|webp|svg\\+xml);base64,",
    },
    qualityFlags: nullable({
      type: "array",
      maxItems: 8,
      items: { type: "string", pattern: "^[A-Z][A-Z0-9_]{1,31}$" },
    }),
    capturedAt: { type: "string", format: "date-time" },
  },
} as const;

/** One event in a request body, for both routes. `tripStopId` is nullable on both. */
export const STOP_EVENT_REQUEST_ITEM = {
  type: "object",
  additionalProperties: false,
  required: ["id", "type", "occurredAt"],
  properties: {
    id: { type: "string", pattern: ULID },
    type: { type: "string", enum: [...EVENT_TYPES] },
    occurredAt: { type: "string", format: "date-time" },
    tripStopId: nullable({ type: "string", minLength: 1 }),
    orderId: nullable({ type: "string" }),
    deliveredUnits: nullable({ type: "integer", minimum: 0 }),
    recipientName: nullable({ type: "string" }),
    signatureData: nullable({ type: "string" }),
    photoData: nullable({ type: "string" }),
    reasonCode: nullable({ type: "string" }),
    pages: { type: "array", maxItems: MAX_POD_PAGES, items: POD_PAGE_SCHEMA },
  },
} as const;

/** The per-event half of both routes' 200 bodies. */
export const EVENT_RESULT_PROPERTIES = {
  accepted: { type: "integer" },
  duplicates: { type: "integer" },
  conflicts: { type: "integer" },
  results: {
    type: "array",
    items: {
      type: "object",
      additionalProperties: false,
      required: ["id", "status"],
      properties: {
        id: { type: "string" },
        status: { type: "string", enum: ["accepted", "duplicate", "conflict"] },
        conflictState: {
          oneOf: [
            { type: "string", enum: ["NONE", "STALE_ASSIGNMENT", "SUPERSEDED"] },
            { type: "null" },
          ],
        },
      },
    },
  },
  rejected: {
    type: "array",
    items: {
      type: "object",
      additionalProperties: false,
      required: ["id", "code", "message"],
      properties: {
        id: { type: "string" },
        code: { type: "string" },
        message: { type: "string" },
      },
    },
  },
} as const;

// Driver-reported problem reasons from the vocabulary map onto Prisma's
// ProblemKind. Anything not recognised falls back to OTHER so the dispatcher
// still sees the event rather than losing it to a strict mapping.
export function toProblemKind(code: string | null | undefined): ProblemKind {
  switch (code) {
    case "OUTLET_CLOSED":
    case "ROAD_BLOCKED":
    case "VEHICLE_BREAKDOWN":
    case "ACCESS_DENIED":
    case "DELIVERY_REFUSED":
      return code;
    default:
      return "OTHER";
  }
}

type Outcome =
  | { kind: "result"; row: EventResultRow; counts: "accepted" | "duplicates" | "conflicts" }
  | { kind: "rejected"; code: string; message: string };

type Planned =
  | { kind: "conflict"; event: IncomingEvent; state: Exclude<ConflictState, "NONE"> }
  | { kind: "simple"; event: IncomingEvent }
  | { kind: "completion"; event: IncomingEvent };

type Logger = { error: (obj: unknown, msg?: string) => void };

function reject(code: string, message: string): Outcome {
  return { kind: "rejected", code, message };
}

/** The state an already-stored event reports: a replayed conflict stays a conflict. */
function replayOutcome(state: ConflictState): Outcome {
  return state === "NONE"
    ? { kind: "result", counts: "duplicates", row: { id: "", status: "duplicate", conflictState: "NONE" } }
    : { kind: "result", counts: "duplicates", row: { id: "", status: "conflict", conflictState: state } };
}

/**
 * Everything about an event that can be judged from the event alone.
 *
 * Pages are held to the same bar whether or not the event goes on to conflict,
 * because a conflicted POD is stored too (the dispatcher needs what the other
 * driver claims) and a malformed page must not be stored on either path.
 */
function validateEvent(event: IncomingEvent): { code: string; message: string } | null {
  if (!Number.isFinite(Date.parse(event.occurredAt))) {
    return { code: "INVALID_OCCURRED_AT", message: "occurredAt is not a valid timestamp." };
  }

  const pages = event.pages ?? [];
  if (pages.length === 0) return null;

  if (event.type !== "POD_CAPTURED") {
    return {
      code: "PAGES_ON_NON_POD",
      message: "Pages belong on POD_CAPTURED events; this event type cannot carry them.",
    };
  }
  if (pages.length > MAX_POD_PAGES) {
    return { code: "TOO_MANY_PAGES", message: `A POD carries at most ${MAX_POD_PAGES} pages.` };
  }
  const seen = new Set<string>();
  for (const page of pages) {
    if (seen.has(page.id)) {
      return { code: "DUPLICATE_PAGE_ID", message: `Page id ${page.id} appears twice in one event.` };
    }
    seen.add(page.id);

    const prefix = DATA_URL_PREFIX.exec(page.data);
    if (!prefix || !BASE64_BODY.test(page.data.slice(prefix[0].length))) {
      return {
        code: "PAGE_DATA_INVALID",
        message: `Page ${page.id} must be a base64 image data URL (png, jpeg, webp or svg).`,
      };
    }
    if (page.data.length > MAX_POD_PAGE_CHARS) {
      return {
        code: "PAGE_TOO_LARGE",
        message: `Page ${page.id} is over the ${MAX_POD_PAGE_CHARS}-character limit.`,
      };
    }
  }
  return null;
}

function podPagesOf(event: IncomingEvent): PodPageInput[] {
  return (event.pages ?? []).map((page) => ({
    id: page.id,
    kind: page.kind,
    data: page.data,
    qualityFlags: page.qualityFlags ?? [],
    capturedAt: new Date(page.capturedAt),
  }));
}

/** Postgres unique violation, matched by code so no instanceof crosses a module boundary. */
function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === "P2002";
}

export async function applyStopEvents(input: {
  user: SessionUser;
  deviceId: string;
  events: IncomingEvent[];
  /** Strict mode: any invalid event fails the call (and writes nothing). */
  strict: boolean;
  /** Stops the caller has already resolved access for, so it is not asked twice. */
  knownAccess?: Map<string, StopAccess>;
  log?: Logger;
}): Promise<ApplyResult> {
  const { user, deviceId, events, strict } = input;
  const actor = { userId: user.id, vehicleId: user.defaultVehicleId, deviceId };

  const outcomes = new Map<string, Outcome>();
  const settle = (id: string, outcome: Outcome) => outcomes.set(id, outcome);

  // A client that sends the same id twice in one request is replaying itself.
  // The first copy is the event; the rest are duplicates, and must not reach the
  // database, where the second insert would collide.
  const seenInRequest = new Set<string>();
  const live: Array<IncomingEvent & { tripStopId: string }> = [];
  const repeats: IncomingEvent[] = [];
  for (const event of events) {
    if (seenInRequest.has(event.id)) {
      repeats.push(event);
      continue;
    }
    seenInRequest.add(event.id);
    if (!event.tripStopId) {
      settle(
        event.id,
        reject(
          "MISSING_TRIP_STOP_ID",
          "Every event in a /sync batch must carry tripStopId. Use POST /stops/{stopId}/events when the stop is in the URL.",
        ),
      );
      continue;
    }
    live.push({ ...event, tripStopId: event.tripStopId });
  }

  // Dedup before anything else, in one query. This is what makes a replay
  // harmless: an id already in StopEvent was applied (or recorded as a conflict)
  // the first time, and none of its side effects -- order status, stop status,
  // notification, decision log -- may run again.
  const existing = await prisma.stopEvent.findMany({
    where: { id: { in: live.map((event) => event.id) } },
    select: { id: true, conflictState: true, tripStopId: true, actorUserId: true },
  });
  const recorded = new Map(existing.map((row) => [row.id, row]));

  // A caller's own record of a stop stays theirs to replay even if the stop has
  // since moved off their run, so it is recognised before access is asked: the
  // alternative is a driver whose "accepted" response was lost being told their
  // already-recorded event is forbidden.
  const accessByStop = new Map<string, StopAccess>(input.knownAccess ?? []);
  const pending: Array<IncomingEvent & { tripStopId: string }> = [];
  for (const event of live) {
    const row = recorded.get(event.id);
    if (row && row.tripStopId === event.tripStopId && row.actorUserId === user.id) {
      settle(event.id, replayOutcome(row.conflictState));
      continue;
    }
    pending.push(event);
  }

  for (const stopId of new Set(pending.map((event) => event.tripStopId))) {
    if (!accessByStop.has(stopId)) accessByStop.set(stopId, await resolveStopAccess(user, stopId));
  }

  const toApply: Array<IncomingEvent & { tripStopId: string }> = [];
  for (const event of pending) {
    // A stop the caller cannot see answers the same whether it exists or not.
    if (accessByStop.get(event.tripStopId) === "DENIED") {
      settle(
        event.id,
        reject("STOP_NOT_ON_RUN", `Stop ${event.tripStopId} is not on this driver's run.`),
      );
      continue;
    }
    const row = recorded.get(event.id);
    if (row) {
      // The id is taken. By the same stop it is a replay; by another it is a
      // client minting one id for two facts, which must not be called a duplicate.
      settle(
        event.id,
        row.tripStopId === event.tripStopId
          ? replayOutcome(row.conflictState)
          : reject("ID_REUSED", "That event id is already recorded against a different stop."),
      );
      continue;
    }
    toApply.push(event);
  }

  // Ownership history and expected units, but only for stops where something
  // would actually be applied. A batch that is entirely replays -- the one the
  // outbox sends most often -- decides nothing and reads neither.
  const workStops = [...new Set(toApply.map((event) => event.tripStopId))];
  const contexts: Map<string, StopConflictContext> = await loadConflictContexts(workStops);
  const expectedByStop = new Map<string, Map<string, number>>();
  if (workStops.length > 0) {
    const stopOrders = await prisma.tripStopOrder.findMany({
      where: { tripStopId: { in: workStops } },
      select: { tripStopId: true, order: { select: { id: true, units: true } } },
    });
    for (const row of stopOrders) {
      const inner = expectedByStop.get(row.tripStopId) ?? new Map<string, number>();
      inner.set(row.order.id, row.order.units);
      expectedByStop.set(row.tripStopId, inner);
    }
  }

  // Plan every stop before writing anything, so strict mode can refuse a bad
  // request while it is still free to.
  const plans = new Map<string, Planned[]>();
  for (const stopId of workStops) {
    const forStop = toApply
      .map((event, index) => ({ event, index }))
      .filter((entry) => entry.event.tripStopId === stopId)
      // By the device clock, which is the order things happened in: an outbox
      // drains in the order it queued, and a delivery's own lines and POD share
      // a timestamp, so the original position breaks ties.
      .sort(
        (a, b) =>
          Date.parse(a.event.occurredAt) - Date.parse(b.event.occurredAt) || a.index - b.index,
      )
      .map((entry) => entry.event);
    plans.set(
      stopId,
      planStop({
        stopId,
        events: forStop,
        access: accessByStop.get(stopId) ?? "DENIED",
        context: contexts.get(stopId),
        expected: expectedByStop.get(stopId) ?? new Map(),
        actor,
        settle,
      }),
    );
  }

  if (strict) {
    // The root cause, not its consequence: a rejected POD takes its delivered
    // lines down with it, and the caller needs to hear about the POD.
    const refused = events
      .map((event) => outcomes.get(event.id))
      .filter((outcome) => outcome?.kind === "rejected");
    const first = refused.find((o) => o?.code !== "POD_REJECTED") ?? refused[0];
    if (first) throw new InvalidEventError(first.code, first.message);
  }

  for (const [stopId, plan] of plans) {
    await executeStop({
      stopId,
      plan,
      expected: expectedByStop.get(stopId) ?? new Map(),
      user,
      deviceId,
      actor,
      strict,
      settle,
      log: input.log,
    });
  }

  // Assemble in the order the events arrived: the response reads like the request.
  const result: ApplyResult = { accepted: 0, duplicates: 0, conflicts: 0, results: [], rejected: [] };
  const emitted = new Set<string>();
  for (const event of events) {
    const outcome = outcomes.get(event.id);
    if (!outcome || emitted.has(event.id)) continue;
    emitted.add(event.id);
    if (outcome.kind === "rejected") {
      result.rejected.push({ id: event.id, code: outcome.code, message: outcome.message });
      continue;
    }
    result[outcome.counts] += 1;
    result.results.push({ ...outcome.row, id: event.id });
  }
  for (const event of repeats) {
    // Reported once per copy, so counts add up to the batch size, but the id is
    // the same row and the device settles it from the first.
    result.duplicates += 1;
    result.results.push({ id: event.id, status: "duplicate", conflictState: "NONE" });
  }
  return result;
}

function planStop(input: {
  stopId: string;
  events: Array<IncomingEvent & { tripStopId: string }>;
  access: StopAccess;
  context: StopConflictContext | undefined;
  expected: Map<string, number>;
  actor: { userId: string; vehicleId: string | null; deviceId: string };
  settle: (id: string, outcome: Outcome) => void;
}): Planned[] {
  const planned: Planned[] = [];
  let failedPod: { id: string; code: string } | null = null;

  for (const event of input.events) {
    const invalid = validateEvent(event);
    if (invalid) {
      input.settle(event.id, reject(invalid.code, invalid.message));
      if (event.type === "POD_CAPTURED") failedPod ??= { id: event.id, code: invalid.code };
      continue;
    }

    // Access granted only on the strength of a reassignment means the stop is
    // someone else's now, so the event cannot apply to it whatever its timing.
    const state: ConflictState =
      input.access === "REASSIGNED_AWAY"
        ? "STALE_ASSIGNMENT"
        : detectConflict(input.context, { occurredAt: new Date(event.occurredAt) }, input.actor);
    if (state !== "NONE") {
      planned.push({ kind: "conflict", event, state });
      continue;
    }

    if (event.type === "DELIVERED" || event.type === "PART_DELIVERED") {
      if (!event.orderId || event.deliveredUnits == null) {
        input.settle(
          event.id,
          reject("DELIVERED_INCOMPLETE", "DELIVERED/PART_DELIVERED events need orderId and deliveredUnits."),
        );
        continue;
      }
      if (!input.expected.has(event.orderId)) {
        input.settle(
          event.id,
          reject("ORDER_NOT_ON_STOP", `Order ${event.orderId} is not on stop ${input.stopId}.`),
        );
        continue;
      }
      planned.push({ kind: "completion", event });
    } else if (event.type === "POD_CAPTURED") {
      planned.push({ kind: "completion", event });
    } else {
      planned.push({ kind: "simple", event });
    }
  }

  // A completion is one act with several events. Judge it as a whole: a POD with
  // no delivered lines has nothing to close, lines with nobody to have received
  // them are not a delivery, and a second POD in one request has no stop left
  // to close.
  const members = planned.filter((entry) => entry.kind === "completion");
  const lines = members.filter((m) => m.event.type !== "POD_CAPTURED");
  const pods = members.filter((m) => m.event.type === "POD_CAPTURED");
  const recipient = members.find((m) => m.event.recipientName)?.event.recipientName;

  const failGroup = (code: string, message: string, ids: Set<string>) => {
    for (const id of ids) input.settle(id, reject(code, message));
    return planned.filter((entry) => !(entry.kind === "completion" && ids.has(entry.event.id)));
  };

  let result = planned;
  if (failedPod && lines.length > 0) {
    // The lines are only a delivery with their proof. Closing the stop without
    // it would leave a completed delivery that cannot be shown to anyone.
    return failGroup(
      "POD_REJECTED",
      `The POD that proves this delivery (${failedPod.id}) was rejected: ${failedPod.code}.`,
      new Set(members.map((m) => m.event.id)),
    );
  }
  if (pods.length > 1) {
    result = failGroup(
      "POD_ALREADY_IN_REQUEST",
      "Only one POD_CAPTURED event can close a stop.",
      new Set(pods.slice(1).map((m) => m.event.id)),
    );
  }
  if (members.length > 0 && lines.length === 0) {
    result = failGroup(
      "POD_WITHOUT_DELIVERY",
      "A POD_CAPTURED event must travel with the DELIVERED lines it proves.",
      new Set(members.map((m) => m.event.id)),
    );
  } else if (lines.length > 0 && !recipient) {
    result = failGroup(
      "RECIPIENT_REQUIRED",
      "A delivery completion needs the recipient's name on a POD event.",
      new Set(members.map((m) => m.event.id)),
    );
  }
  return result;
}

async function executeStop(input: {
  stopId: string;
  plan: Planned[];
  expected: Map<string, number>;
  user: SessionUser;
  deviceId: string;
  actor: { userId: string; vehicleId: string | null; deviceId: string };
  strict: boolean;
  settle: (id: string, outcome: Outcome) => void;
  log?: Logger;
}): Promise<void> {
  const { stopId, plan, user, deviceId, settle } = input;
  const accepted = (id: string): Outcome => ({
    kind: "result",
    counts: "accepted",
    row: { id, status: "accepted", conflictState: "NONE" },
  });

  const completion = plan.filter((entry) => entry.kind === "completion");
  // The completion runs once, at the position of its last member, so anything
  // that happened between its events on the device still lands in order.
  const completionAt = completion.at(-1);

  // Never let one event's failure end the stop's batch. In strict mode the
  // caller wants the failure itself; offline it is judged per event.
  const guarded = async (ids: string[], work: () => Promise<void>, success: () => void) => {
    try {
      await work();
      success();
    } catch (error) {
      if (error instanceof StopStateError) {
        for (const id of ids) settle(id, reject(error.code, error.message));
        return;
      }
      if (isUniqueViolation(error)) {
        // Two requests carrying the same id raced past the dedup query and the
        // loser's transaction rolled back whole, side effects included. If the
        // id is there it is a replay. If it is not, a page id collided.
        const rows = await prisma.stopEvent.findMany({
          where: { id: { in: ids } },
          select: { id: true, conflictState: true, tripStopId: true, actorUserId: true },
        });
        const stored = new Map(rows.map((row) => [row.id, row]));
        for (const id of ids) {
          const row = stored.get(id);
          settle(
            id,
            row
              ? replayOutcome(row.conflictState)
              : reject("ID_COLLISION", "An id in this event, such as a page id, is already used by another record."),
          );
        }
        return;
      }
      if (input.strict) throw error;
      input.log?.error({ err: error, stopId, eventIds: ids }, "stop event not applied");
    }
  };

  for (const entry of plan) {
    const { event } = entry;
    const occurredAt = new Date(event.occurredAt);
    // The client's identity and timing for this fact. The id becomes the
    // StopEvent primary key; occurredAt is the DEVICE clock, and the server's
    // receipt time is recorded separately by StopEvent.recordedAt.
    const meta = { id: event.id, occurredAt, deviceId };

    if (entry.kind === "conflict") {
      await guarded(
        [event.id],
        () =>
          recordConflictedFact({
            stopId,
            conflictState: entry.state,
            fact: {
              id: event.id,
              type: event.type,
              occurredAt,
              orderId: event.orderId,
              deliveredUnits: event.deliveredUnits,
              recipientName: event.recipientName,
              signatureData: event.signatureData,
              photoData: event.photoData,
              reasonCode: event.reasonCode,
              pages: podPagesOf(event),
            },
            // orderId is a foreign key: only link an order the stop really has.
            orderOnStop: event.orderId != null && input.expected.has(event.orderId),
            actor: input.actor,
          }),
        () =>
          settle(event.id, {
            kind: "result",
            counts: "conflicts",
            row: { id: event.id, status: "conflict", conflictState: entry.state },
          }),
      );
      continue;
    }

    if (entry.kind === "simple") {
      await guarded(
        [event.id],
        async () => {
          if (event.type === "ARRIVED") {
            await arriveAtStop(stopId, user, meta);
          } else if (event.type === "UNLOAD_START") {
            await startUnloading(stopId, user, meta);
          } else {
            // FAILED and SKIPPED are separate stop statuses in DOMAIN.md: a stop
            // passed over is not a stop that failed.
            await reportProblem(
              user,
              {
                kind: toProblemKind(event.reasonCode),
                note:
                  event.reasonCode ??
                  (event.type === "SKIPPED" ? "Stop skipped." : "Driver reported a problem."),
                tripStopId: stopId,
                outcome: event.type === "SKIPPED" ? "SKIPPED" : "FAILED",
              },
              meta,
            );
          }
        },
        () => settle(event.id, accepted(event.id)),
      );
      continue;
    }

    if (entry !== completionAt) continue;

    const lines = completion.filter((m) => m.event.type !== "POD_CAPTURED").map((m) => m.event);
    const pod = completion.find((m) => m.event.type === "POD_CAPTURED")?.event;
    const ids = completion.map((m) => m.event.id);
    const pages = pod ? podPagesOf(pod) : [];

    await guarded(
      ids,
      () =>
        completeStop(
          stopId,
          user,
          {
            recipientName: (pod?.recipientName ?? lines.find((l) => l.recipientName)?.recipientName)!,
            delivered: lines.map((line) => ({
              orderId: line.orderId!,
              units: line.deliveredUnits!,
              expected: input.expected.get(line.orderId!)!,
              eventId: line.id,
            })),
            // Pages are the proof of delivery when present; the legacy columns
            // are only for a client that does not send them. Both at once would
            // be the same picture stored twice, so pages win.
            signatureData: pages.length > 0 ? undefined : (pod?.signatureData ?? undefined),
            photoData: pages.length > 0 ? undefined : (pod?.photoData ?? undefined),
            podEventId: pod?.id,
            pages: pages.length > 0 ? pages : undefined,
          },
          {
            // The POD's clock stands for the whole completion, since a delivery
            // is one act even though it produces several events.
            occurredAt: new Date((pod ?? lines.at(-1)!).occurredAt),
            deviceId,
          },
        ),
      () => {
        for (const id of ids) settle(id, accepted(id));
      },
    );
  }
}
