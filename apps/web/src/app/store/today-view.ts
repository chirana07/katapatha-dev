import type { components } from "@katapatha/contracts/types";
// Relative, not "@/lib": the unit-test runner does not resolve the alias.
import { ageLabel, clockTime, plural } from "../../lib/format";
import type { Tone } from "@/components/ui/status-pill";

type StoreToday = components["schemas"]["StoreToday"];
type StoreOrder = components["schemas"]["StoreOrder"];
type Incoming = components["schemas"]["IncomingDelivery"];
type Weather = components["schemas"]["Weather"];

/**
 * Delivered, and the outlet has not yet said what arrived. These are the orders
 * the receipt card is for. `receiptConfirmed` comes from the server, so a
 * refresh after confirming shows the order as settled instead of asking again.
 */
export function awaitingReceipt(orders: readonly StoreOrder[]): StoreOrder[] {
  return orders.filter((order) => order.state === "delivered" && !order.receiptConfirmed);
}

export interface TodayCard {
  value: number;
  foot: string;
  tone: Tone;
}

/**
 * The four cards across the top of Today. The numbers are the API's; this adds
 * the line underneath each, which says what the number asks of the manager.
 */
export function todayCards(today: Pick<StoreToday, "counts" | "orders"> & { incoming?: ArrivalSource | null }): {
  expected: TodayCard;
  confirmed: TodayCard;
  pending: TodayCard;
  issues: TodayCard;
} {
  const { counts, incoming, orders } = today;
  const waiting = awaitingReceipt(orders);

  const expectedFoot = incoming
    ? arrivalView(incoming).foot
    : counts.expected === 0
      ? "Nothing due"
      : "Not yet planned";

  const confirmedFoot =
    counts.pending > 0
      ? "Waiting for you"
      : counts.expected > 0 && counts.confirmed >= counts.expected
        ? "All confirmed"
        : counts.confirmed > 0
          ? "Confirmed so far"
          : "None confirmed yet";

  const pendingFoot =
    waiting.length === 0
      ? "No action needed"
      : waiting.length === 1
        ? `Confirm receipt of ${waiting[0]!.ref}`
        : `Confirm receipt of ${plural(waiting.length, "order")}`;

  return {
    expected: { value: counts.expected, foot: expectedFoot, tone: "info" },
    confirmed: { value: counts.confirmed, foot: confirmedFoot, tone: counts.pending > 0 ? "warn" : counts.confirmed > 0 ? "good" : "neutral" },
    pending: { value: counts.pending, foot: pendingFoot, tone: counts.pending > 0 ? "warn" : "neutral" },
    issues: {
      value: counts.issues,
      foot: counts.issues === 0 ? "No issues" : plural(counts.issues, "issue") + " reported",
      tone: counts.issues === 0 ? "good" : "bad",
    },
  };
}

type ArrivalSource = Pick<Incoming, "stopsBefore" | "departed" | "arrival"> & {
  minutesAway?: number | null;
  report?: Incoming["report"];
};

/**
 * Lamp Mode, as the API says it: the last report is old enough that the
 * arrival is an estimate. Either signal is enough — `arrival.basis` is the one
 * the arrival wording follows, `report.lamp` the one the report line does.
 */
export function isLamp(incoming: Pick<ArrivalSource, "report" | "arrival">): boolean {
  return incoming.report?.lamp === true || incoming.arrival.basis === "estimate";
}

/** "Last reported 06:28 · 22 min ago", measured from when the fix was taken. */
export function lastReportedLine(report: Incoming["report"]): string | null {
  if (!report) return null;
  return `Last reported ${clockTime(report.reportedAt)} · ${ageLabel(report.ageSeconds)}`;
}

export interface ArrivalView {
  basis: "plan" | "report" | "estimate";
  /** Over the figure: what kind of arrival this is. */
  label: string;
  /** A time, or a range once the report is too old for one time. */
  headline: string;
  /** One line under it: where the figure comes from. */
  source: string;
  /** The short form for the "Expected today" card. */
  foot: string;
}

/**
 * The arrival, worded to match how much evidence is behind it. A plan is a
 * plan; a single time from a report says it is from the driver's last report;
 * an estimate is always a range and always says it is one. Nothing here says
 * the vehicle is being followed.
 */
export function arrivalView(incoming: Pick<ArrivalSource, "arrival">): ArrivalView {
  const { basis, at, from, to } = incoming.arrival;
  if (basis === "estimate") {
    const headline = from && to ? `${from}–${to}` : (at ?? "Not available");
    return {
      basis,
      label: "Estimated arrival",
      headline,
      source: "An estimate from the driver's last report, which is out of date. It is shown as a range.",
      foot: from && to ? `Estimated ${from}–${to}` : "Arrival can't be estimated yet",
    };
  }
  if (basis === "report") {
    return {
      basis,
      label: "Expected arrival",
      headline: at ?? "Not available",
      source: "About this time, from the driver's last report.",
      foot: at ? `Expected about ${at}` : "Arrival can't be estimated yet",
    };
  }
  return {
    basis,
    label: "Planned arrival",
    headline: at ?? "—",
    source: "The planned time, not a sighting of the vehicle.",
    foot: at ? `Planned arrival ${at}` : "Not yet planned",
  };
}

/**
 * "1 stop before yours", and a countdown only when it is honest: the vehicle
 * has left, the API judged the minutes sane, and the arrival is not an estimate
 * — a countdown out of Lamp Mode would put a precise number on a range.
 */
export function stopsAndCountdown(incoming: ArrivalSource): string {
  const stops =
    incoming.stopsBefore === 0 ? "Yours is the next stop" : `${plural(incoming.stopsBefore, "stop")} before yours`;
  const away =
    incoming.minutesAway != null && incoming.departed && !isLamp(incoming)
      ? `about ${incoming.minutesAway} min by the plan`
      : null;
  return [stops, away].filter(Boolean).join(" · ");
}

/**
 * What the weather chip says. A fallback (`live: false`) is the calendar's
 * seasonal flag, not a reading, and must not wear a temperature.
 */
export function weatherCaption(weather: Weather): { headline: string; note: string } {
  if (!weather.live) {
    return { headline: weather.label, note: "Seasonal note from the calendar, not an observation" };
  }
  return {
    headline: weather.temperatureC == null ? weather.label : `${weather.temperatureC}°C · ${weather.label}`,
    note: weather.observedAt ? `Now, as of ${weather.observedAt}` : "Now",
  };
}
