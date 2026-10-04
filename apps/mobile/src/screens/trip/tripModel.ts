import { BACK_ONLINE_WINDOW_MINUTES, type LastSyncFacts } from "../../driver/connection-state";
import { clockToMinutes, colomboClock, formatClock } from "../../driver/format";
import { isTerminal, type StopStatus } from "../../driver/stop-state";
import { stopSavedPillLabel } from "../../outbox/claims";
import { STOP_BADGE_SPEC } from "../../ui/logic";

/**
 * The Trip screen's decisions, as functions over plain values.
 *
 * Nothing here renders. The screen asks "which badge does this stop get?" or
 * "what does the footer say?" and draws the answer, so every branch -- including
 * the ones that stop a refused record being shown as green -- is tested without
 * React.
 *
 * Wording about what is stored on the phone or sent later is NOT written here:
 * it comes from src/outbox/claims.ts.
 */

/** The slice of a projected stop these functions read. */
export type RowStop = {
  id: string;
  outletId: string;
  outletName: string | null;
  plannedArrivalAt: string | null;
  windowOpen: string | null;
  windowClose: string | null;
  accessNote: string | null;
  orders: ReadonlyArray<{ orderRef: string; expectedUnits: number }>;
  projection: {
    status: StopStatus;
    unsent: number;
    state: "clean" | "unsent" | "conflict" | "rejected";
  };
  record: { completedAt: string | null };
};

// --- trips --------------------------------------------------------------------

/** "2 trips today", "1 trip today". */
export function tripsTodayLabel(count: number): string {
  return count === 1 ? "1 trip today" : `${count} trips today`;
}

/** "Trip 1 of 2": the position in the day, not the planner's number. */
export function tripChipLabel(index: number, count: number): string {
  return `Trip ${index + 1} of ${count}`;
}

type TripLike = {
  tripId: string;
  stops: ReadonlyArray<{ projection: { status: StopStatus } }>;
};

export type TripChoice = {
  tripId: string;
  label: string;
  /** "1 of 4 stops completed" */
  detail: string;
  selected: boolean;
};

/** The rows of the trip-switch menu. */
export function tripChoices(
  trips: ReadonlyArray<TripLike>,
  selectedIndex: number,
): TripChoice[] {
  return trips.map((trip, index) => {
    const done = trip.stops.filter((stop) => isTerminal(stop.projection.status)).length;
    return {
      tripId: trip.tripId,
      label: `Trip ${index + 1}`,
      detail: `${done} of ${trip.stops.length} stops completed`,
      selected: index === selectedIndex,
    };
  });
}

/**
 * The trip on screen: the driver's own choice while it still exists, else the
 * active one. `chosenTripId` is null until the driver picks from the menu.
 */
export function displayedTripIndex(
  trips: ReadonlyArray<{ tripId: string }>,
  chosenTripId: string | null,
  activeIndex: number,
): number {
  if (chosenTripId) {
    const index = trips.findIndex((trip) => trip.tripId === chosenTripId);
    if (index !== -1) return index;
  }
  return Math.min(Math.max(0, activeIndex), Math.max(0, trips.length - 1));
}

/** The first stop of a trip that is not closed. */
export function nextStopOf<T extends { projection: { status: StopStatus } }>(
  stops: readonly T[],
): T | null {
  return stops.find((stop) => !isTerminal(stop.projection.status)) ?? null;
}

/**
 * What the Next stop card says when the displayed trip has nothing left: the
 * trip is finished, and -- if the driver is looking at a finished trip while
 * another still has stops to go -- which one to switch to.
 */
export function finishedTripNote(
  trips: ReadonlyArray<TripLike>,
  displayedIndex: number,
): { title: string; body: string | null } {
  const label = `Trip ${displayedIndex + 1}`;
  const other = trips.findIndex(
    (trip, index) =>
      index !== displayedIndex && trip.stops.some((stop) => !isTerminal(stop.projection.status)),
  );
  return {
    title: `${label} is finished`,
    body: other === -1 ? null : `Trip ${other + 1} still has stops to go. Choose it above.`,
  };
}

// --- the stop rows ------------------------------------------------------------

export type RowBadge =
  | { kind: "delivered" | "next" | "upcoming" | "onsite" | "skipped" }
  | { kind: "saved"; label: string }
  | { kind: "failed"; label?: string }
  /** The server kept its own record: neutral information, not an error and not green. */
  | { kind: "conflict"; label: string };

export type RowMarker = "done" | "current" | "upcoming" | "failed";

export type StopRowModel = {
  id: string;
  number: number;
  marker: RowMarker;
  /** The outlet id: the thing a driver reads on the dock card. */
  title: string;
  /** The outlet name, shown muted after the id when there is one. */
  subtitle: string | null;
  time: { text: string; a11y: string };
  place: string | null;
  detail: string;
  badge: RowBadge;
  isNext: boolean;
  /** "Start delivery" or "Continue delivery"; null when the stop is closed. */
  startLabel: string | null;
};

/** The first sentence of an access note ("Rear dock. Ring twice." -> "Rear dock"). */
export function accessPlace(note: string | null | undefined): string | null {
  if (!note) return null;
  const first = note.split(/[.;·\n]/)[0]?.trim();
  return first ? first : null;
}

/** "Window 05:30–08:00", or the half we know, or null. */
export function windowText(open: string | null, close: string | null): string | null {
  const from = open && clockToMinutes(open) !== null ? open : null;
  const to = close && clockToMinutes(close) !== null ? close : null;
  if (from && to) return `Window ${from}–${to}`;
  if (from) return `Window from ${from}`;
  if (to) return `Window until ${to}`;
  return null;
}

export function ordersText(count: number): string {
  return count === 1 ? "1 order" : `${count} orders`;
}

export function unitsText(units: number): string {
  return units === 1 ? "1 unit" : `${units} units`;
}

/**
 * The order row on the expanded Next-stop card. One order reads "S1-082" over
 * "69 units"; several read "3 orders" over their references and the total.
 */
export function orderSummary(
  orders: ReadonlyArray<{ orderRef: string; expectedUnits: number }>,
): { title: string; detail: string } | null {
  if (orders.length === 0) return null;
  const units = orders.reduce((sum, order) => sum + order.expectedUnits, 0);
  if (orders.length === 1) {
    return { title: orders[0]!.orderRef, detail: unitsText(units) };
  }
  const refs = orders.slice(0, 3).map((order) => order.orderRef);
  const more = orders.length > 3 ? ` +${orders.length - 3}` : "";
  return {
    title: ordersText(orders.length),
    detail: `${refs.join(", ")}${more} · ${unitsText(units)}`,
  };
}

export function startLabel(status: StopStatus): string | null {
  if (isTerminal(status)) return null;
  return status === "ARRIVED" || status === "UNLOADING" ? "Continue delivery" : "Start delivery";
}

/**
 * Which chip a stop gets. Precedence, highest first:
 *
 *   rejected   the server read the record and did not apply it: never green
 *   conflict   the server kept its own record: information, never green
 *   saved      events for this stop are on the phone and unsent
 *   closed     Delivered / Failed / Skipped, from the (projected) status
 *   open       Next stop / On site / Upcoming
 */
export function stopBadge(stop: RowStop, isNext: boolean): RowBadge {
  const { status, state, unsent } = stop.projection;
  if (state === "rejected") return { kind: "failed", label: "Not accepted" };
  if (state === "conflict") return { kind: "conflict", label: "Changed on server" };
  if (unsent > 0) return { kind: "saved", label: stopSavedPillLabel() };
  switch (status) {
    case "DONE":
      return { kind: "delivered" };
    case "FAILED":
      return { kind: "failed" };
    case "SKIPPED":
      return { kind: "skipped" };
    case "ARRIVED":
    case "UNLOADING":
      return { kind: "onsite" };
    case "PENDING":
      return { kind: isNext ? "next" : "upcoming" };
  }
}

/** The words on a badge, for the row's accessibility label. */
export function badgeLabel(badge: RowBadge): string {
  if ("label" in badge && badge.label) return badge.label;
  if (badge.kind === "conflict") return "Changed on server";
  return STOP_BADGE_SPEC[badge.kind].label ?? "";
}

function markerFor(status: StopStatus, isNext: boolean): RowMarker {
  if (status === "DONE") return "done";
  if (status === "FAILED") return "failed";
  if (isNext) return "current";
  return "upcoming";
}

/**
 * The line with the clock icon. A stop closed on THIS phone shows the time the
 * phone recorded (a device clock, so it says so); anything else shows the plan,
 * and says "planned" because a planned arrival is not an observation.
 */
export function stopTime(stop: RowStop): { text: string; a11y: string } {
  const closed = isTerminal(stop.projection.status);
  const completedAt = stop.record.completedAt ? new Date(stop.record.completedAt) : null;
  if (closed && completedAt && !Number.isNaN(completedAt.getTime())) {
    const clock = colomboClock(completedAt);
    return { text: `${clock} on device`, a11y: `Recorded on device at ${clock}` };
  }
  const planned = formatClock(stop.plannedArrivalAt);
  if (planned === "—") return { text: "No planned time", a11y: "No planned time" };
  return { text: `planned ${planned}`, a11y: `Planned arrival ${planned}` };
}

export function stopRowModel(stop: RowStop, position: number, isNext: boolean): StopRowModel {
  const units = stop.orders.reduce((sum, order) => sum + order.expectedUnits, 0);
  const closed = isTerminal(stop.projection.status);
  const detailParts = [
    windowText(stop.windowOpen, stop.windowClose),
    stop.orders.length > 0 ? ordersText(stop.orders.length) : null,
  ].filter((part): part is string => part !== null);

  return {
    id: stop.id,
    number: position,
    marker: markerFor(stop.projection.status, isNext && !closed),
    title: stop.outletId,
    subtitle: stop.outletName && stop.outletName !== stop.outletId ? stop.outletName : null,
    time: stopTime(stop),
    place: accessPlace(stop.accessNote),
    detail: units > 0 && detailParts.length === 0 ? unitsText(units) : detailParts.join(" · "),
    badge: stopBadge(stop, isNext),
    isNext: isNext && !closed,
    startLabel: startLabel(stop.projection.status),
  };
}

/** One model per stop of a trip, numbered within the trip, with the next stop flagged. */
export function stopRowModels(stops: readonly RowStop[]): StopRowModel[] {
  const next = nextStopOf(stops);
  return stops.map((stop, index) => stopRowModel(stop, index + 1, stop === next));
}

// --- the foot of the screen ---------------------------------------------------

/** "All updates sent" is shown this long after the send (the Back online window). */
export const ALL_SENT_WINDOW_MINUTES = BACK_ONLINE_WINDOW_MINUTES;

export type FooterModel = {
  /** Records on this phone not yet accepted. */
  waiting: number | null;
  /** Records the server refused or replaced, which need a person to look. */
  attention: number | null;
  /** Colombo "HH:MM" of the last send, when nothing is waiting and it was recent. */
  allSentAt: string | null;
};

/**
 * What sits above the Trip bottom bar. At most one of `waiting` and `allSentAt`
 * is set: a count of waiting records and "All updates sent" never appear
 * together. `attention` is independent -- a refused record still needs a look
 * after everything else has been sent.
 */
export function footerModel(input: {
  unsent: number;
  rejected: number;
  conflicts: number;
  lastSettledAt: string | null;
  now: Date;
}): FooterModel {
  const attention = input.rejected + input.conflicts;
  const base = { attention: attention > 0 ? attention : null };
  if (input.unsent > 0) return { ...base, waiting: input.unsent, allSentAt: null };

  const at = input.lastSettledAt ? new Date(input.lastSettledAt) : null;
  if (at && !Number.isNaN(at.getTime())) {
    const ageMinutes = (input.now.getTime() - at.getTime()) / 60_000;
    if (ageMinutes <= ALL_SENT_WINDOW_MINUTES) {
      return { ...base, waiting: null, allSentAt: colomboClock(at) };
    }
  }
  return { ...base, waiting: null, allSentAt: null };
}

/** The sentence beside the review action for records the server did not apply. */
export function attentionText(count: number): string {
  return count === 1
    ? "1 record was not applied by the server."
    : `${count} records were not applied by the server.`;
}

/**
 * The line under a "Try now" that did not clear the queue. It reports what the
 * phone knows -- when it tried and how many are still waiting -- and does not
 * guess why (no signal, a busy server and a slow request look the same here).
 */
export function tryNowResult(input: {
  after: number;
  attemptedAt: Date;
}): string | null {
  if (input.after <= 0) return null;
  const clock = colomboClock(input.attemptedAt);
  return `Tried at ${clock} · ${input.after} still waiting.`;
}

/** For the "Back online" notice's facts: the store keeps the last settle, not the last attempt. */
export function settledFacts(
  lastSettledAt: string | null,
  lastSettledCount: number,
): LastSyncFacts {
  if (!lastSettledAt || lastSettledCount <= 0) return null;
  return {
    at: lastSettledAt,
    outcome: "sent",
    sent: lastSettledCount,
    accepted: lastSettledCount,
    duplicates: 0,
  };
}

/**
 * The outlet to name in "Dispatch and OUT074 can now see your work": the stop
 * closed on this phone most recently (by the device clock it was recorded with)
 * whose records the server has taken without refusing or replacing any. Null when
 * no stop qualifies, so the banner says "Dispatch" alone rather than guess.
 */
export function lastSentOutlet(stops: readonly RowStop[]): string | null {
  let best: { at: number; name: string } | null = null;
  for (const stop of stops) {
    if (!isTerminal(stop.projection.status)) continue;
    if (stop.projection.unsent > 0 || stop.projection.state !== "clean") continue;
    const at = stop.record.completedAt ? Date.parse(stop.record.completedAt) : NaN;
    if (Number.isNaN(at)) continue;
    if (!best || at > best.at) best = { at, name: stop.outletName ?? stop.outletId };
  }
  return best?.name ?? null;
}

// --- advisories ---------------------------------------------------------------

/** More than this many ms of difference and the driver is told the phone's clock is off. */
export const CLOCK_SKEW_ADVISORY_MS = 120_000;

export function clockSkewAdvisory(skewMs: number | null): string | null {
  if (skewMs === null || Math.abs(skewMs) <= CLOCK_SKEW_ADVISORY_MS) return null;
  const minutes = Math.round(Math.abs(skewMs) / 60_000);
  return `This phone's clock is ${minutes} minutes ${skewMs > 0 ? "ahead of" : "behind"} the server. Times recorded on device may look wrong.`;
}
