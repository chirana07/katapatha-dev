import type { PositionStatus, StatusDetail } from "./status";

/**
 * The words the Connection screen shows for position sharing.
 *
 * The claim (docs/DOMAIN.md): a position is what the phone last reported, with
 * its age. Never "live", never "real-time", never "tracking". Foreground only,
 * opt-in, and the driver can turn it off. Kept in step with the web driver's
 * "Share my position" card (apps/web/src/app/driver/position-control.tsx):
 * "Sends your position to dispatch while this page is open... 'last reported'".
 */

export const POSITION_TITLE = "Share my position";

/** The consent explanation shown beside the switch. */
export const CONSENT_COPY =
  "Dispatch and the outlet see the last position this phone sent, with how long ago it was. Nothing is sent while the app is closed, and you can turn it off here at any time.";

/** Shown while sharing is on and something is waiting to be sent. */
export const UNSENT_NOTE =
  "Positions that could not be sent wait on this phone only while the app is open.";

/** Shown when the driver declines the permission prompt. No nagging: it is not asked again by itself. */
export const DENIED_COPY =
  "Location is not allowed for Katapatha, so no position is sent. Allow it in the phone's settings, then turn this on again.";

export const UNAVAILABLE_COPY =
  "This phone's location is switched off. Turn it on in the phone's settings, then try again.";

/**
 * How long ago, measured from when the FIX was taken (`takenAt`), never from
 * when it was received. A clock that disagrees reads as "just now", not negative.
 */
export function ageLabel(takenAt: Date, now: Date): string {
  const seconds = Math.max(0, Math.floor((now.getTime() - takenAt.getTime()) / 1000));
  const minutes = Math.floor(seconds / 60);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} h ago` : `${hours} h ${rest} min ago`;
}

export interface StatusLineInput {
  status: PositionStatus;
  detail?: StatusDetail;
  lastReportedAt: Date | null;
  pendingCount?: number;
  now: Date;
}

/** "Last sent 3 min ago", or the plain reason nothing is being sent. */
export function statusLine(input: StatusLineInput): string {
  const { status, detail = null, lastReportedAt, now } = input;
  const last = lastReportedAt ? `Last sent ${ageLabel(lastReportedAt, now)}` : null;

  switch (status) {
    case "off":
      return "Not sharing. Dispatch only sees a position this phone has sent before.";
    case "denied":
      return DENIED_COPY;
    case "clock-wrong":
      return "Check the phone's date and time. Its clock is ahead, so positions are not being accepted.";
    case "offline":
      if (detail === "session-ended") {
        return `Sign in again to keep sharing.${last ? ` ${last}.` : ""}`;
      }
      return last ? `No signal. ${last}.` : "No signal. Nothing has been sent yet.";
    case "waiting":
      if (detail === "no-vehicle") return "Pick a vehicle to share its position.";
      if (detail === "rejected") return "Dispatch did not accept the last position. Trying again shortly.";
      if (detail === "no-fix") {
        return last
          ? `The phone could not find its position just now. ${last}.`
          : "The phone could not find its position just now. Trying again shortly.";
      }
      return last ?? "Looking for this phone's position…";
    case "reporting":
      return last ?? "Looking for this phone's position…";
  }
}

/** Every string above, for the test that bans the words the product must not use. */
export function allPositionCopy(now: Date = new Date(0)): string[] {
  const statuses: PositionStatus[] = ["off", "waiting", "reporting", "denied", "clock-wrong", "offline"];
  const details: StatusDetail[] = [null, "no-vehicle", "no-fix", "session-ended", "rejected"];
  const reported = new Date(now.getTime() - 3 * 60_000);
  const lines = [POSITION_TITLE, CONSENT_COPY, UNSENT_NOTE, DENIED_COPY, UNAVAILABLE_COPY];
  for (const status of statuses) {
    for (const detail of details) {
      for (const lastReportedAt of [null, reported]) {
        lines.push(statusLine({ status, detail, lastReportedAt, now }));
      }
    }
  }
  for (const seconds of [0, 59, 60, 3599, 3600, 7500]) {
    lines.push(ageLabel(new Date(now.getTime() - seconds * 1000), now));
  }
  return lines;
}
