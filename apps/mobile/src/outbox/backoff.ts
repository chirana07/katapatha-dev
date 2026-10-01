/**
 * Retry schedule for a batch that could not be sent.
 *
 * A driver's phone is on the road for a whole shift with no charger, so a
 * failing endpoint must not be retried in a tight loop. Equally, a driver who
 * regains signal should not wait minutes for their work to go.
 *
 * Exponential from 2s, capped at 5 minutes, with jitter so that several queued
 * batches on several handsets do not all retry on the same tick after a depot
 * outage.
 *
 * Note the automatic schedule is only half the story: reconnecting triggers a
 * drain immediately on the connectivity edge, so in the common case -- signal
 * came back -- nothing waits for this at all.
 */

const BASE_MS = 2_000;
const MAX_MS = 300_000;
const JITTER = 0.2;

/** After this many failures a row is only sent when the driver asks. */
export const MAX_AUTOMATIC_ATTEMPTS = 8;

/**
 * Milliseconds to wait before attempt number `attempts + 1`.
 * `random` is injectable so the test can assert the schedule rather than a range.
 */
export function backoffMs(attempts: number, random: () => number = Math.random): number {
  const exponent = Math.max(0, attempts);
  const flat = Math.min(BASE_MS * 2 ** exponent, MAX_MS);
  // random() in [0,1) maps to a +/- JITTER multiplier.
  const factor = 1 + (random() * 2 - 1) * JITTER;
  return Math.round(flat * factor);
}

/**
 * When the row becomes eligible again, as an ISO string.
 *
 * Always a date, never null. Exhaustion is a separate question, answered by
 * isExhausted(attempts) and enforced in the claim query -- because NULL in
 * next_attempt_at already means "never attempted, send immediately", and
 * overloading it with "never send automatically again" made an exhausted row the
 * FIRST thing a drain would pick up.
 */
export function nextAttemptAt(
  attempts: number,
  now: Date,
  random: () => number = Math.random,
): string {
  return new Date(now.getTime() + backoffMs(attempts, random)).toISOString();
}

/**
 * True once the app will no longer retry this row without being asked.
 *
 * The work is NOT lost: the row stays queued and the outbox screen's "Send now"
 * still picks it up. The app just stops asking by itself, so a dead endpoint
 * cannot drain the battery of a phone that is on the road all day.
 */
export function isExhausted(attempts: number): boolean {
  return attempts >= MAX_AUTOMATIC_ATTEMPTS;
}
