import { clockToMinutes, colomboClock, colomboClockNow } from "./format";

/**
 * Pure helpers for what the driver is told about the connection and the clock.
 *
 * Everything here is a function over plain values -- the connectivity provider,
 * the store snapshot and `now` are passed in -- so the claims they make are
 * tested without React. Wording that claims anything about durability does NOT
 * live here; it is in src/outbox/claims.ts.
 */

/**
 * Minutes without verified contact with the server before the phone is in Lamp
 * Mode ("Lamp Mode is on · no signal since HH:MM").
 *
 * Duplicated, on purpose, from `LAMP_AFTER_MINUTES` in
 * apps/api/src/services/positions.ts: the server applies the same threshold to
 * a vehicle's last reported position, and a driver's phone and dispatch's board
 * must agree on when "no signal" becomes "Lamp". The API package is not a
 * dependency of the app, so the number is copied rather than imported; if the
 * server value changes, change this one in the same PR.
 */
export const LAMP_AFTER_MINUTES = 10;

/** The only three connectivity labels (docs/DESIGN.md), from a verified /v1/health. */
export type ConnectionLabel = "Checking" | "Connected" | "Offline";

export type LampState = {
  kind: "connected" | "checking" | "offline" | "lamp";
  /** Colombo "HH:MM" of the last verified contact; null when unknown or not offline. */
  sinceClock: string | null;
};

/**
 * `offlineSince` is the moment the phone last had VERIFIED contact with the
 * server (a successful /v1/health), not when the app noticed. Null when unknown
 * -- the label then reads "Offline" with no time rather than a made-up one.
 */
export function lampState(input: {
  label: ConnectionLabel;
  offlineSince: Date | null;
  now: Date;
}): LampState {
  if (input.label === "Connected") return { kind: "connected", sinceClock: null };
  if (input.label === "Checking") return { kind: "checking", sinceClock: null };

  const since = input.offlineSince;
  if (!since || Number.isNaN(since.getTime())) return { kind: "offline", sinceClock: null };

  const minutes = (input.now.getTime() - since.getTime()) / 60_000;
  return {
    kind: minutes >= LAMP_AFTER_MINUTES ? "lamp" : "offline",
    sinceClock: colomboClock(since),
  };
}

/** Countdown only under this many minutes: further out, a countdown is noise. */
export const COUNTDOWN_UNDER_MINUTES = 4 * 60;

export type NextStopLine = {
  kind: "countdown" | "planned" | "late" | "unknown";
  text: string;
};

function formatMinutes(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}

/**
 * The line under the next stop: what the plan says, and -- only when the phone is
 * Connected and the figure is positive and under four hours -- how far off it is.
 *
 * A planned arrival is a plan figure, not an observation of the vehicle, so the
 * text always says "planned". Offline or in Lamp Mode there is no countdown at
 * all: a number counting down on a phone that cannot hear the server would be a
 * claim nobody can back. An overdue stop says "was planned for HH:MM" and nothing
 * more -- not how late the driver is, which this phone does not know.
 *
 * `plannedClock` is Asia/Colombo wall-clock "HH:MM" for the run's date; `now` is
 * compared on the same day (a run does not span midnight).
 */
export function nextStopLine(input: {
  plannedClock: string | null;
  now: Date;
  connected: boolean;
}): NextStopLine {
  const planned = clockToMinutes(input.plannedClock);
  if (planned === null || !input.plannedClock) {
    return { kind: "unknown", text: "No planned time" };
  }

  const plannedText = `planned ${input.plannedClock}`;
  if (!input.connected) return { kind: "planned", text: plannedText };

  const nowMinutes = clockToMinutes(colomboClockNow(input.now));
  if (nowMinutes === null) return { kind: "planned", text: plannedText };

  const diff = planned - nowMinutes;
  if (diff > 0 && diff < COUNTDOWN_UNDER_MINUTES) {
    return { kind: "countdown", text: `in ${formatMinutes(diff)} · ${plannedText}` };
  }
  if (diff < 0) {
    return { kind: "late", text: `was planned for ${input.plannedClock}` };
  }
  return { kind: "planned", text: plannedText };
}

/** How long after a send the "Back online" notice may still be shown. */
export const BACK_ONLINE_WINDOW_MINUTES = 30;

/** The slice of a sync_log row the notice needs. */
export type LastSyncFacts = {
  at: string;
  outcome: string;
  sent: number | null;
  accepted?: number | null;
  duplicates?: number | null;
} | null;

/**
 * "Back online · sent at 07:34": shown only when the phone is Connected, nothing
 * is waiting, and the LAST drain attempt was a `sent` one that carried records
 * and is at most 30 minutes old. The count is the records the server took
 * (accepted, or already held) -- a drain in which the server refused every record
 * has nothing to announce, so it returns null.
 */
export function backOnlineNotice(input: {
  unsent: number;
  lastSync: LastSyncFacts;
  now: Date;
  label: ConnectionLabel;
}): { atClock: string; count: number } | null {
  const { lastSync } = input;
  if (input.label !== "Connected" || input.unsent !== 0 || !lastSync) return null;
  if (lastSync.outcome !== "sent" || (lastSync.sent ?? 0) <= 0) return null;

  const at = new Date(lastSync.at);
  if (Number.isNaN(at.getTime())) return null;
  const ageMinutes = (input.now.getTime() - at.getTime()) / 60_000;
  if (ageMinutes > BACK_ONLINE_WINDOW_MINUTES) return null;

  const count =
    lastSync.accepted == null && lastSync.duplicates == null
      ? (lastSync.sent ?? 0)
      : (lastSync.accepted ?? 0) + (lastSync.duplicates ?? 0);
  if (count <= 0) return null;

  return { atClock: colomboClock(at), count };
}
