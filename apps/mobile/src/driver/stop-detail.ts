import { colomboClock, formatWindow } from "./format";
import { reasonLabel } from "./reason-presentation";
import type { StopStatus } from "./stop-state";
import { recordedStatusLabel } from "../outbox/claims";

/**
 * The stop screen and the failed-delivery header, as plain values.
 *
 * Everything here is a function over a stop's cached facts and the phone's own
 * record of it, so the wording is tested without React. Times in `record` are the
 * DEVICE clock: they only ever leave this module as "HH:MM · recorded on device".
 */

export type StopFacts = {
  seq: number;
  tripNo: number;
  wave: string;
  outletId: string;
  outletName: string | null;
  plannedArrivalAt: string | null;
  windowOpen: string | null;
  windowClose: string | null;
  accessNote: string | null;
  orders: ReadonlyArray<{ orderRef: string; expectedUnits: number }>;
};

// --- header -------------------------------------------------------------------

const SEGMENT_BREAK = /\s*[·\n;,|]\s*|\.(?:\s+|$)/;
const MAX_SEGMENT = 28;

/**
 * The first segment of an access note ("Rear dock · ask for the manager" ->
 * "Rear dock"), shortened so it fits the one-line header subline. Null when the
 * note is empty.
 */
export function accessSegment(note: string | null | undefined): string | null {
  const first = (note ?? "").split(SEGMENT_BREAK).find((part) => part.trim().length > 0);
  if (!first) return null;
  const text = first.trim();
  return text.length > MAX_SEGMENT ? `${text.slice(0, MAX_SEGMENT - 1).trimEnd()}…` : text;
}

export function unitsLabel(units: number): string {
  return units === 1 ? "1 unit" : `${units} units`;
}

/** "S1-084", "S1-082, S1-083", or "S1-082 +2" when there are more than two orders. */
export function orderRefsLabel(refs: readonly string[]): string | null {
  if (refs.length === 0) return null;
  if (refs.length <= 2) return refs.join(", ");
  return `${refs[0]} +${refs.length - 1}`;
}

/**
 * "Rear dock · 24 units · S1-084": the line under "Stop 3 · OUT075" (R-07, R-09,
 * R-11). The design puts the order ref before the units; here the units come first
 * because the header draws this on ONE line beside a badge ("Can't deliver" is
 * wide), and a line that is cut off should lose the order ref, not the count.
 * Parts that are not known are left out, never replaced with a made-up one.
 */
export function stopSubline(stop: Pick<StopFacts, "accessNote" | "orders">): string {
  const units = stop.orders.reduce((sum, order) => sum + order.expectedUnits, 0);
  return [
    accessSegment(stop.accessNote),
    stop.orders.length > 0 ? unitsLabel(units) : null,
    orderRefsLabel(stop.orders.map((order) => order.orderRef)),
  ]
    .filter((part): part is string => part !== null)
    .join(" · ");
}

/** "07:58" for a device-clock ISO moment, or null when it is missing or invalid. */
export function deviceClock(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? null : colomboClock(at);
}

/** "07:58 · recorded on device": a time the phone recorded, never bare. */
export function deviceTimeText(iso: string | null | undefined): string | null {
  const clock = deviceClock(iso);
  return clock ? `${clock} · recorded on device` : null;
}

/**
 * The info line in the failed-delivery header: "Arrived 07:58 (recorded on
 * device) · window 03:00–08:00". Without a recorded arrival it is the window
 * alone; with neither it is null and the header shows no line.
 */
export function arrivalInfoLine(input: {
  arrivedAt: string | null;
  windowOpen: string | null;
  windowClose: string | null;
}): string | null {
  const arrived = deviceClock(input.arrivedAt);
  const hasWindow = Boolean(input.windowOpen || input.windowClose);
  const window = hasWindow ? formatWindow(input.windowOpen, input.windowClose) : null;

  if (arrived && window) return `Arrived ${arrived} (recorded on device) · window ${window}`;
  if (arrived) return `Arrived ${arrived} (recorded on device)`;
  if (window) return `Window ${window}`;
  return null;
}

// --- status -------------------------------------------------------------------

export type HeaderBadge = { label: string; tone: "good" | "warn" | "bad" | "neutral" };

/** The badge at the right of the stop header; the text is always there. */
export function statusBadge(status: StopStatus, isNext: boolean): HeaderBadge {
  switch (status) {
    case "PENDING":
      return isNext ? { label: "Next stop", tone: "warn" } : { label: "Upcoming", tone: "neutral" };
    case "ARRIVED":
      return { label: "On site", tone: "warn" };
    case "UNLOADING":
      return { label: "Unloading", tone: "warn" };
    case "DONE":
      return { label: "Delivered", tone: "good" };
    case "FAILED":
      return { label: "Failed", tone: "bad" };
    case "SKIPPED":
      return { label: "Skipped", tone: "neutral" };
  }
}

/**
 * What the status means, in the words of the current flow. (`STOP_STATUS_HINT` in
 * stop-state.ts still describes the old Record arrival / Start unload buttons.)
 */
export const STOP_HINT: Record<StopStatus, string> = {
  PENDING: "Not arrived yet. Start delivery when you reach the outlet.",
  ARRIVED: "On site. Continue delivery to check the items.",
  UNLOADING: "Unloading. Continue delivery to check items and record the receipt.",
  DONE: "Delivery recorded.",
  FAILED: "Recorded as failed. The reason is below.",
  SKIPPED: "Recorded as skipped. The reason is below.",
};

export type StopPrimary = { kind: "start" | "continue"; label: string };

/** The one dominant action, or null for a closed stop. */
export function stopPrimary(status: StopStatus): StopPrimary | null {
  switch (status) {
    case "PENDING":
      return { kind: "start", label: "Start delivery" };
    case "ARRIVED":
    case "UNLOADING":
      return { kind: "continue", label: "Continue delivery" };
    default:
      return null;
  }
}

// --- notices ------------------------------------------------------------------

export type StopNotice = { id: "rejected" | "conflict" | "ahead"; tone: "bad" | "warn" | "info"; text: string };

type ProjectionFacts = {
  unsent: number;
  state: "clean" | "unsent" | "conflict" | "rejected";
  ahead: boolean;
};

/** The server-disagrees notices, worst first. Wording kept from the first stop screen. */
export function stopNotices(projection: ProjectionFacts): StopNotice[] {
  const notices: StopNotice[] = [];
  if (projection.state === "rejected") {
    notices.push({
      id: "rejected",
      tone: "bad",
      text: "The server would not accept one of these records. Open Unsent records to see what it said, and tell dispatch.",
    });
  }
  if (projection.state === "conflict") {
    notices.push({
      id: "conflict",
      tone: "warn",
      text: "The server flagged a conflict on this stop. Pull down on the trip to reload before recording anything else.",
    });
  }
  if (projection.ahead) {
    notices.push({
      id: "ahead",
      tone: "info",
      text: "This phone has recorded more than the server has accepted for this stop. The server's version is what counts once it catches up.",
    });
  }
  return notices;
}

// --- recorded facts and closed-stop summary ------------------------------------

export type Row = { label: string; value: string };
export type SyncStatus = { label: string; tone: "good" | "warn" | "bad"; phone: boolean };

type RecordFacts = {
  arrivedAt: string | null;
  unloadStartedAt: string | null;
  completedAt: string | null;
  recipientName: string | null;
  pageCount: number;
  outcome: "DELIVERED" | "PART" | "FAILED" | "SKIPPED" | null;
  reasonCode: string | null;
  lines: ReadonlyArray<{ deliveredUnits: number }>;
};

/** "Arrived" and "Unloading", only the ones this phone recorded. */
export function recordedFactRows(record: Pick<RecordFacts, "arrivedAt" | "unloadStartedAt">): Row[] {
  const rows: Row[] = [];
  const arrived = deviceTimeText(record.arrivedAt);
  if (arrived) rows.push({ label: "Arrived", value: arrived });
  const unloading = deviceTimeText(record.unloadStartedAt);
  if (unloading) rows.push({ label: "Unloading", value: unloading });
  return rows;
}

/**
 * Where this stop's records stand, as a pill. A server refusal or conflict is
 * never shown as "Sent": the server read the record and did not apply it.
 */
export function syncStatus(projection: ProjectionFacts): SyncStatus {
  if (projection.state === "rejected") {
    return { label: "Not accepted by the server", tone: "bad", phone: false };
  }
  if (projection.state === "conflict") {
    return { label: "Server flagged a conflict", tone: "warn", phone: false };
  }
  if (projection.unsent > 0) return { label: recordedStatusLabel(false), tone: "warn", phone: true };
  return { label: recordedStatusLabel(true), tone: "good", phone: false };
}

function unitsRow(delivered: number | null, expected: number): string {
  if (delivered === null) return `${unitsLabel(expected)} expected`;
  const short = expected - delivered;
  const base = `${delivered} / ${expected} units`;
  return short > 0 ? `${base} · ${short} short` : base;
}

/**
 * The read-only record of a closed stop: what the phone holds for it (R-09's rows,
 * minus the ones the API cannot back). `null` when there is nothing to summarise,
 * i.e. the stop is open.
 */
export function closedSummary(input: {
  status: StopStatus;
  record: RecordFacts;
  expectedUnits: number;
  projection: ProjectionFacts;
}): { rows: Row[]; status: SyncStatus } | null {
  const { status, record } = input;
  const rows: Row[] = [];

  if (status === "DONE") {
    const delivered =
      record.lines.length > 0
        ? record.lines.reduce((sum, line) => sum + line.deliveredUnits, 0)
        : null;
    rows.push({ label: "Units", value: unitsRow(delivered, input.expectedUnits) });
    if (record.recipientName) rows.push({ label: "Received by", value: record.recipientName });
    if (record.pageCount > 0) {
      rows.push({
        label: "Receipt",
        value: record.pageCount === 1 ? "1 page" : `${record.pageCount} pages`,
      });
    }
    const completed = deviceTimeText(record.completedAt);
    if (completed) rows.push({ label: "Recorded", value: completed });
  } else if (status === "FAILED" || status === "SKIPPED") {
    rows.push({ label: "Outcome", value: status === "FAILED" ? "Failed delivery" : "Skipped" });
    if (record.reasonCode) rows.push({ label: "Reason", value: reasonLabel(record.reasonCode) });
    const completed = deviceTimeText(record.completedAt);
    if (completed) rows.push({ label: "Recorded", value: completed });
  } else {
    return null;
  }

  return { rows, status: syncStatus(input.projection) };
}
