/**
 * Formatting for the driver screens.
 *
 * Ported from apps/web/src/app/driver/format.ts, with two deliberate removals
 * and two additions.
 *
 * REMOVED generateUlid(): the web copy is a second, non-monotonic ULID
 * implementation. The id is the server's primary key, so the whole idempotency
 * story depends on there being exactly one generator -- this app uses
 * @katapatha/core/offline/ulid, which is monotonic within a millisecond and so
 * cannot replay a rapid sequence of taps out of order.
 *
 * REMOVED deviceId(): it read window.localStorage, which does not exist here.
 * See src/platform/device.ts, which keeps it in SQLite instead.
 *
 * ADDED a fallback for colomboToday() and formatDeviceClock().
 */

/**
 * Today's operating date in Asia/Colombo, as YYYY-MM-DD.
 *
 * GET /drivers/me/run requires this, so getting it wrong does not throw -- it
 * silently fetches the wrong day's run, which is worse. Hermes relies on
 * Android's ICU for named time zones and can lack it, so an Intl failure falls
 * back to fixed +05:30 arithmetic. Sri Lanka has had no DST since 1996, so the
 * offset is a constant rather than a simplification.
 */
export function colomboToday(now: Date = new Date()): string {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Colombo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(now);
    const map: Record<string, string> = {};
    for (const part of parts) if (part.type !== "literal") map[part.type] = part.value;
    const assembled = `${map.year}-${map.month}-${map.day}`;
    if (isIsoDate(assembled)) return assembled;
  } catch {
    // Fall through to the arithmetic path below.
  }
  return colomboDateFallback(now);
}

/** Asia/Colombo is UTC+05:30 year round. */
const COLOMBO_OFFSET_MINUTES = 5 * 60 + 30;

export function colomboDateFallback(now: Date): string {
  const shifted = new Date(now.getTime() + COLOMBO_OFFSET_MINUTES * 60_000);
  const year = shifted.getUTCFullYear();
  const month = String(shifted.getUTCMonth() + 1).padStart(2, "0");
  const day = String(shifted.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export function formatClock(clock: string | undefined | null): string {
  if (!clock || !/^\d{2}:\d{2}$/.test(clock)) return "—";
  return clock;
}

export function formatWindow(open?: string | null, close?: string | null): string {
  if (open && close) return `${open}–${close}`;
  if (open) return `From ${open}`;
  if (close) return `Until ${close}`;
  return "No window set";
}

/**
 * Renders a StopEvent.occurredAt for display.
 *
 * The contract is explicit that occurredAt is the DEVICE clock and "must be
 * presented as recorded on device". A driver's handset can be minutes out, and
 * showing that timestamp bare invites it being read as the server's record of
 * when the delivery happened. Every occurredAt in the UI goes through here, so
 * the qualifier cannot be dropped at a call site.
 */
export function formatDeviceClock(occurredAt: string): string {
  const at = new Date(occurredAt);
  if (Number.isNaN(at.getTime())) return "Recorded on device";

  const shifted = new Date(at.getTime() + COLOMBO_OFFSET_MINUTES * 60_000);
  const hours = String(shifted.getUTCHours()).padStart(2, "0");
  const minutes = String(shifted.getUTCMinutes()).padStart(2, "0");
  return `Recorded on device at ${hours}:${minutes}`;
}
