/**
 * Helpers for the dispatcher's "Defer order" decision.
 *
 * Shared so the API and the web can never disagree about which reason the
 * allocator's own finding points at, or which day a deferred order moves to.
 */

import { DEFERRAL_REASONS, type DeferralReasonCode } from "./reasons";

/**
 * Allocator rejection code -> the fixed deferral reason a dispatcher records.
 *
 * Keyed by string rather than the allocator's `RejectionCode` type because the
 * allocator depends on core, not the other way round. Codes missing from the
 * map get no suggestion: an order that yielded to a higher-priority one in its
 * lane has no capacity reason to suggest, and pretending otherwise would put a
 * misleading line in the store's history.
 */
const SUGGESTION: Readonly<Record<string, DeferralReasonCode>> = {
  NO_REEFER_AVAILABLE: "REEFER_FULL",
  NO_REEFER_IN_FLEET: "REEFER_FULL",
  NO_VAN_AVAILABLE: "NO_VAN",
  NO_VAN_IN_FLEET: "NO_VAN",
  WINDOW_UNREACHABLE: "WINDOW_UNREACHABLE",
  NO_COMMON_WINDOW: "WINDOW_UNREACHABLE",
  FRESH_DEADLINE_UNREACHABLE: "WINDOW_UNREACHABLE",
  OUTLET_UNREACHABLE_IN_WINDOW: "WINDOW_UNREACHABLE",
  TRIP_SEQUENCE_CONFLICT: "TIME_BUDGET",
  PREDAWN_BUDGET_EXCEEDED: "TIME_BUDGET",
  DAYTIME_BUDGET_EXCEEDED: "TIME_BUDGET",
  NO_TRIP_SLOT: "TIME_BUDGET",
  DISTRICT_UNREACHABLE_IN_BUDGET: "TIME_BUDGET",
  FUEL_QUOTA_EXCEEDED: "FUEL_QUOTA",
  VEHICLE_IN_WORKSHOP: "VEHICLE_IN_WORKSHOP",
  ORDER_EXCEEDS_FLEET_CAPACITY: "ORDER_TOO_LARGE",
  VOLUME_CAP_EXCEEDED: "ORDER_TOO_LARGE",
  WEIGHT_CAP_EXCEEDED: "ORDER_TOO_LARGE",
};

/** Capacity-type findings: the vehicle runs, it's just used up. */
const BUSY_CODES = new Set([
  "VOLUME_CAP_EXCEEDED",
  "WEIGHT_CAP_EXCEEDED",
  "NO_TRIP_SLOT",
  "TRIP_SEQUENCE_CONFLICT",
  "PREDAWN_BUDGET_EXCEEDED",
  "DAYTIME_BUDGET_EXCEEDED",
  "FUEL_QUOTA_EXCEEDED",
]);

/**
 * "None of the right vehicles is free" — which can mean full, or off the road.
 * NO_TRIP_SLOT is left out: the allocator also records it against single busy
 * vehicles, so it can't tell the two apart.
 */
const AVAILABILITY_CODES = new Set(["NO_REEFER_AVAILABLE", "NO_VAN_AVAILABLE"]);

/**
 * `contributing` is every code the allocator recorded for the order. When the
 * only reason the right vehicles weren't free is that they're in the
 * workshop — none was merely full — say so: "refrigerated capacity full"
 * would tell the store something untrue.
 */
export function suggestDeferralReason(
  rejectionCode: string | null | undefined,
  contributing: readonly string[] = [],
): DeferralReasonCode | null {
  if (!rejectionCode) return null;
  if (
    AVAILABILITY_CODES.has(rejectionCode) &&
    contributing.includes("VEHICLE_IN_WORKSHOP") &&
    !contributing.some((code) => BUSY_CODES.has(code))
  ) {
    return "VEHICLE_IN_WORKSHOP";
  }
  return SUGGESTION[rejectionCode] ?? null;
}

/**
 * Whether the depot runs on `date` (YYYY-MM-DD). The reference calendar decides
 * where it has a row; where it has none, Waypoint operates Monday to Saturday.
 */
export function isOperatingDay(date: string, calendar: boolean | undefined): boolean {
  if (calendar !== undefined) return calendar;
  return new Date(`${date}T00:00:00.000Z`).getUTCDay() !== 0;
}

/**
 * The first operating day after `date` (YYYY-MM-DD).
 *
 * `isOperating` answers from the reference calendar; `undefined` means the
 * calendar has no row for that day, in which case Sunday is treated as closed
 * — the fuel week and the depot week are both Monday to Saturday. Bounded so a
 * calendar that marks everything closed cannot loop forever.
 */
export function nextOperatingDate(
  date: string,
  isOperating: (date: string) => boolean | undefined,
): string {
  const start = new Date(`${date}T00:00:00.000Z`);
  const dayAfter = (n: number) => {
    const d = new Date(start);
    d.setUTCDate(d.getUTCDate() + n);
    return d;
  };
  for (let n = 1; n <= 14; n += 1) {
    const d = dayAfter(n);
    const iso = d.toISOString().slice(0, 10);
    const known = isOperating(iso);
    if (known === true) return iso;
    if (known === undefined && d.getUTCDay() !== 0) return iso;
  }
  return dayAfter(1).toISOString().slice(0, 10);
}

/**
 * The last operating day before `date` (YYYY-MM-DD). The mirror of
 * `nextOperatingDate`, with the same fallback for days the calendar lacks.
 */
export function previousOperatingDate(
  date: string,
  isOperating: (date: string) => boolean | undefined,
): string {
  const start = new Date(`${date}T00:00:00.000Z`);
  for (let n = 1; n <= 14; n += 1) {
    const d = new Date(start);
    d.setUTCDate(d.getUTCDate() - n);
    const iso = d.toISOString().slice(0, 10);
    if (isOperatingDay(iso, isOperating(iso))) return iso;
  }
  const d = new Date(start);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/**
 * How many operating days lie in (`from`, `to`]: zero when `to` is not after
 * `from`, one for "served yesterday" when yesterday was an operating day. Used
 * for "days since last served", where a Sunday must not count as a day an
 * outlet went without a delivery.
 */
export function operatingDaysBetween(
  from: string,
  to: string,
  isOperating: (date: string) => boolean | undefined,
): number {
  const end = new Date(`${to}T00:00:00.000Z`).getTime();
  const d = new Date(`${from}T00:00:00.000Z`);
  let count = 0;
  // Bounded: a year is far past any cap a caller applies.
  for (let n = 0; n < 366; n += 1) {
    d.setUTCDate(d.getUTCDate() + 1);
    if (d.getTime() > end) break;
    const iso = d.toISOString().slice(0, 10);
    if (isOperatingDay(iso, isOperating(iso))) count += 1;
  }
  return count;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/** "Wed 30 Sep" — formatted by hand so ICU data on the host can't change the copy. */
export function shortDay(iso: string): string {
  const d = new Date(`${iso}T00:00:00.000Z`);
  return `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

const DEFERRAL_LABEL = new Map<string, string>(DEFERRAL_REASONS.map((r) => [r.code, r.label]));

export function deferralReasonLabel(code: string): string {
  return DEFERRAL_LABEL.get(code) ?? code.replaceAll("_", " ").toLowerCase();
}

/**
 * What the store manager reads when a deferral is published. The API writes
 * it into the outlet's notification; the dispatcher's drawer previews the
 * exact same string before they commit.
 */
export function deferralMessage(
  order: { ref: string; windowOpen: string; windowClose: string },
  reasonCode: string,
  movesTo: string,
  permanent = false,
): string {
  const reason = `Reason: ${deferralReasonLabel(reasonCode).toLowerCase()}.`;
  if (permanent) {
    // No vehicle in the fleet can take it as it stands, so promising a slot
    // on the next run would be a lie. Say what actually happens — and only
    // ask for smaller orders when size is the reason the dispatcher gave.
    const next =
      reasonCode === "ORDER_TOO_LARGE"
        ? "Please place it again as smaller orders."
        : "Your dispatcher will contact you about what happens next.";
    return `Your order ${order.ref} could not be delivered today. ${reason} ${next}`;
  }
  return `Your order ${order.ref} moves to ${shortDay(movesTo)}, ${order.windowOpen}–${order.windowClose}. ${reason} It will be planned first on that run.`;
}
