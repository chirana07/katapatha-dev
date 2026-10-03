import type { components } from "@katapatha/contracts/types";
import { deferralReasonLabel } from "@katapatha/core/domain/deferral";

type HistoryEvent = components["schemas"]["HistoryEvent"];

/**
 * How a decision-log verb reads to a dispatcher.
 *
 * The API says an action is free-form on purpose and a client "shows it, it
 * does not switch on it". So this only chooses words and a tone: a verb it does
 * not know is shown humanised, never dropped, because a missing entry in an
 * audit trail is worse than an ugly one.
 */
const TITLES: Record<string, { title: string; tone?: "good" | "bad" }> = {
  "order.place": { title: "Order placed" },
  "order.plan": { title: "Planned on a trip", tone: "good" },
  "order.defer": { title: "Deferred", tone: "bad" },
  "order.receive": { title: "Receipt recorded", tone: "good" },
  "deferral.confirm": { title: "Deferral reason confirmed" },
  "plan.generate": { title: "Plan built" },
  "plan.publish": { title: "Plan published", tone: "good" },
  "queue.close": { title: "Order queue closed" },
  "trip.ready": { title: "Trip marked ready", tone: "good" },
  "load.check": { title: "Loading checked" },
  "stop.deliver": { title: "Delivered", tone: "good" },
  "shortfall.raise": { title: "Loading shortfall raised", tone: "bad" },
  "shortfall.resolve": { title: "Shortfall decided" },
  "problem.raise": { title: "Delivery problem raised", tone: "bad" },
  "problem.resolve": { title: "Delivery problem resolved" },
  "issue.raise": { title: "Issue raised by the store", tone: "bad" },
};

export function historyTitle(action: string): { title: string; tone?: "good" | "bad" } {
  const known = TITLES[action];
  if (known) return known;
  const words = action.replaceAll(".", " ").replaceAll("_", " ");
  return { title: words.charAt(0).toUpperCase() + words.slice(1) };
}

/** A reason code is shown by its label; a note is shown as written. */
export function historyReason(event: Pick<HistoryEvent, "reasonCode" | "note">): string | undefined {
  const parts = [event.reasonCode ? deferralReasonLabel(event.reasonCode) : null, event.note].filter(Boolean);
  return parts.length ? parts.join(" · ") : undefined;
}

/** "9 Apr, 16:38" on the Colombo clock — the day matters because history spans days. */
export function historyStamp(iso: string): string {
  const date = new Date(iso);
  const day = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Colombo", day: "numeric", month: "short" }).format(date);
  const time = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Colombo",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(date);
  return `${day}, ${time}`;
}
