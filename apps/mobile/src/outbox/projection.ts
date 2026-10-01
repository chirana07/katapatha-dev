import { isTerminal, type StopStatus } from "../driver/stop-state";

/**
 * What the driver sees, given what the server last said and what this phone has
 * recorded but not yet sent.
 *
 * The cache holds server truth and nothing else (src/db/migrations.ts). So when a
 * driver taps "Record arrival" with no signal, the stop does not become ARRIVED
 * in the database -- the event is queued, and this function folds it over the
 * server's status at read time. Keeping one status column means there is nothing
 * to reconcile later and no way for the two to drift.
 *
 * It returns `state` as well as `status`, because a projected status must never
 * be presented as a confirmed one. docs/PRODUCT.md forbids claiming durability
 * that has not been verified, so the UI says "recorded on this phone, not sent
 * yet" rather than showing a delivered stop as simply delivered.
 */

export type PendingEvent = {
  id: string;
  type:
    | "ARRIVED"
    | "UNLOAD_START"
    | "DELIVERED"
    | "PART_DELIVERED"
    | "FAILED"
    | "SKIPPED"
    | "POD_CAPTURED";
  state: "queued" | "sending" | "confirmed" | "conflict" | "rejected";
};

export type ProjectionState = "clean" | "unsent" | "conflict" | "rejected";

export type Projection = {
  /** What to show the driver. */
  status: StopStatus;
  /** How many of this stop's events are still waiting to reach the server. */
  unsent: number;
  state: ProjectionState;
  /**
   * True when a queued event did not match its own precondition -- for example
   * an arrival queued for a stop the server already moved past. The phone is
   * ahead of, or out of step with, the server; the UI should say so rather than
   * quietly showing a status the server will reject.
   */
  ahead: boolean;
};

/** Only these two states represent work the server has not accepted yet. */
function isPending(state: PendingEvent["state"]): boolean {
  return state === "queued" || state === "sending";
}

function advance(status: StopStatus, type: PendingEvent["type"]): StopStatus | null {
  switch (type) {
    case "ARRIVED":
      return status === "PENDING" ? "ARRIVED" : null;
    case "UNLOAD_START":
      return status === "ARRIVED" ? "UNLOADING" : null;
    case "DELIVERED":
    case "PART_DELIVERED":
    case "POD_CAPTURED":
      // A delivery closes the stop from any open state: a driver who completes
      // without tapping through arrive and unload has still delivered.
      return "DONE";
    case "FAILED":
      return "FAILED";
    case "SKIPPED":
      return "SKIPPED";
  }
}

/**
 * Folds this stop's pending events over the server's status.
 *
 * Events must arrive ordered by id. ULIDs sort lexicographically by mint time,
 * so that is the order the driver actually did the work -- and because
 * @katapatha/core/offline/ulid is monotonic within a millisecond, two taps in
 * the same tick still sort in call order.
 */
export function projectStopStatus(
  serverStatus: StopStatus,
  events: readonly PendingEvent[],
): Projection {
  const pending = events.filter((event) => isPending(event.state));
  const hasConflict = events.some((event) => event.state === "conflict");
  const hasRejected = events.some((event) => event.state === "rejected");

  // The server never moves a stop backwards out of a terminal state, so once it
  // says DONE, FAILED or SKIPPED, that is the answer. A local event folded on
  // top could only contradict a decision already recorded.
  if (isTerminal(serverStatus)) {
    return {
      status: serverStatus,
      unsent: pending.length,
      state: resolveState(pending.length, hasConflict, hasRejected),
      ahead: pending.length > 0,
    };
  }

  let status = serverStatus;
  let ahead = false;

  for (const event of pending) {
    const next = advance(status, event.type);
    if (next === null) {
      // The event does not fit the status it was queued against. Keep the
      // status and flag it: this is the signal that the phone and the server
      // disagree, and it is the server that will decide.
      ahead = true;
      continue;
    }
    status = next;
  }

  return {
    status,
    unsent: pending.length,
    state: resolveState(pending.length, hasConflict, hasRejected),
    ahead,
  };
}

/**
 * A rejected event outranks a conflict, which outranks merely-unsent work.
 * Rejection is the only outcome that loses the driver's record, so it must be
 * the one the stop card reports.
 */
function resolveState(
  unsent: number,
  hasConflict: boolean,
  hasRejected: boolean,
): ProjectionState {
  if (hasRejected) return "rejected";
  if (hasConflict) return "conflict";
  return unsent > 0 ? "unsent" : "clean";
}

/** Projects a whole run in one pass, grouping pending events by stop. */
export function projectRun<T extends { id: string; serverStatus: StopStatus }>(
  stops: readonly T[],
  pendingByStop: ReadonlyMap<string, readonly PendingEvent[]>,
): Array<T & { projection: Projection }> {
  return stops.map((stop) => ({
    ...stop,
    projection: projectStopStatus(stop.serverStatus, pendingByStop.get(stop.id) ?? []),
  }));
}
