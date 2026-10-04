import { formatClock, formatDeviceClock } from "../../driver/format";
import { lampState, type ConnectionLabel } from "../../driver/connection-state";
import {
  recordedStatusLabel,
  recordedWaitingNotice,
  unsentCopy,
} from "../../outbox/claims";
import { deliveryRecord, type ProjectedStop } from "../../state/store";
import { firstSegment, stopSubline } from "./units";

/**
 * Everything the "Delivery recorded" screen says, as one value built from the
 * snapshot. Pure and reactive-by-recomputation: the screen calls it on every
 * snapshot, so after a drain settles the status turns "Sent" with no navigation.
 *
 * Honesty rules baked in here:
 *  - the time is the DEVICE clock and always says so ("recorded on device at 07:21");
 *  - "Sent" only when nothing is waiting AND the server neither refused nor
 *    declined to apply one of the stop's records (`attention`);
 *  - "waiting" wording comes from outbox/claims.ts, never from here.
 */

export type RecordedTone = "good" | "warn" | "bad" | "info";

export type RecordedView = {
  /** "none": this phone has no delivery for the stop (not done yet, or failed/skipped). */
  kind: "delivered" | "none";
  stopNumber: number;
  outletId: string;
  /** Header subline: "Rear dock · S1-082 · 69 units". */
  subline: string;
  /** Under the check: "Stop 2 · OUT074 · S1-082 · recorded on device at 07:21". */
  confirmation: string;
  units: string;
  receivedBy: string;
  receipt: string;
  status: { label: string; tone: RecordedTone; icon: "check" | "phone" | "warning" };
  /** Server refused / did not apply a record: explained, in place of any green "Sent". */
  attentionBanner: { tone: "bad" | "info"; title: string; body: string } | null;
  /** No signal and records waiting (claims.ts wording), else null. */
  waitingBanner: { title: string; body: string } | null;
  /** Records waiting but the phone can reach the server: an info line, not an alarm. */
  heldNote: string | null;
};

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function recordedView(
  stop: ProjectedStop,
  context: { label: ConnectionLabel; offlineSince: Date | null; now: Date },
): RecordedView {
  const record = deliveryRecord(stop);
  const refs = stop.orders.map((order) => order.orderRef);
  // A delivery the server refused is not "what you recorded" (stopRecords leaves it
  // out), but the screen must still explain it rather than say nothing was done.
  const delivered =
    stop.record.outcome === "DELIVERED" ||
    stop.record.outcome === "PART" ||
    record.attention !== "none";
  const subline = stopSubline({
    accessNote: stop.accessNote,
    orderRefs: refs,
    expectedUnits: record.unitsExpected,
  });

  const clock = record.completedAt ? formatDeviceClock(record.completedAt) : null;
  const confirmation = [
    `Stop ${stop.seq}`,
    stop.outletId,
    refs.length === 1 ? refs[0] : null,
    clock ? clock.charAt(0).toLowerCase() + clock.slice(1) : null,
  ]
    .filter((part): part is string => !!part)
    .join(" · ");

  let units = "—";
  if (record.unitsDelivered !== null) {
    const short = Math.max(0, record.unitsExpected - record.unitsDelivered);
    units = `${record.unitsDelivered} / ${record.unitsExpected} · ${short === 0 ? "no issues" : `${short} short`}`;
  }

  const unsent = stop.projection.unsent;
  const offline = context.label === "Offline";
  const since = lampState({
    label: context.label,
    offlineSince: context.offlineSince,
    now: context.now,
  }).sinceClock;

  let status: RecordedView["status"];
  let attentionBanner: RecordedView["attentionBanner"] = null;
  if (record.attention === "rejected") {
    status = { label: "Not accepted by the server", tone: "bad", icon: "warning" };
    attentionBanner = {
      tone: "bad",
      title: "The server did not accept one of these records",
      body: "It was read and not applied, so this delivery may be missing there. Open Unsent records to see what it said, and tell dispatch.",
    };
  } else if (record.attention === "conflict") {
    status = { label: "Not applied by the server", tone: "info", icon: "warning" };
    attentionBanner = {
      tone: "info",
      title: "The server did not apply one of these records",
      body: "It holds the record but the stop had already moved on. Open Unsent records to see what it said, and tell dispatch.",
    };
  } else if (record.sentState === "sent") {
    status = { label: recordedStatusLabel(true), tone: "good", icon: "check" };
  } else {
    status = { label: recordedStatusLabel(false), tone: "warn", icon: "phone" };
  }

  const waiting = unsent > 0 && offline;
  return {
    kind: delivered ? "delivered" : "none",
    stopNumber: stop.seq,
    outletId: stop.outletId,
    subline,
    confirmation,
    units,
    receivedBy: record.recipientName ?? "—",
    receipt: plural(record.pageCount, "page", "pages"),
    status,
    attentionBanner,
    waitingBanner: waiting ? recordedWaitingNotice({ sinceClock: since, count: unsent }) : null,
    heldNote: unsent > 0 && !offline ? unsentCopy(unsent) : null,
  };
}

/** The "Next" card for the next unfinished stop, or null (Trip complete). */
export type NextStopCard = {
  stopId: string;
  number: number;
  outletId: string;
  /** "planned 08:00 · Rear dock · 1 order": a plan figure, never a countdown or a distance. */
  detail: string;
};

export function nextStopCard(
  stops: readonly ProjectedStop[],
  nextStopId: string | null,
  currentStopId: string,
): NextStopCard | null {
  if (!nextStopId || nextStopId === currentStopId) return null;
  const next = stops.find((stop) => stop.id === nextStopId);
  if (!next) return null;
  const clock = formatClock(next.plannedArrivalAt);
  const detail = [
    clock === "—" ? null : `planned ${clock}`,
    firstSegment(next.accessNote),
    plural(next.orders.length, "order", "orders"),
  ]
    .filter((part): part is string => !!part)
    .join(" · ");
  return { stopId: next.id, number: next.seq, outletId: next.outletId, detail };
}
