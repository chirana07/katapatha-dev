/**
 * Calendar dates as the product speaks them: `YYYY-MM-DD` strings in
 * Asia/Colombo. Never a `Date` for something that is only a day — the planning
 * day is a day, and a timezone conversion on it is how an order ends up on the
 * wrong one.
 *
 * Several pages carried their own copy of `todayInColombo`; this is the one.
 */

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export function todayInColombo(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Colombo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** True only for a real calendar day — `2026-02-30` is not one. */
export function isDateOnly(value: unknown): value is string {
  if (typeof value !== "string" || !DATE_ONLY.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const probe = new Date(Date.UTC(y!, m! - 1, d!));
  return probe.getUTCFullYear() === y && probe.getUTCMonth() === m! - 1 && probe.getUTCDate() === d;
}

/** A `?date=` search param, or today when it is absent or not a real day. */
export function dateParam(value: string | string[] | undefined, fallback: string = todayInColombo()): string {
  const first = Array.isArray(value) ? value[0] : value;
  return isDateOnly(first) ? first : fallback;
}

export function shiftDate(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const shifted = new Date(Date.UTC(y!, m! - 1, d! + days));
  return shifted.toISOString().slice(0, 10);
}

function utc(date: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!));
}

/** "Thu, 9 Apr 2026" */
export function longDate(date: string): string {
  return utc(date).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** "9 Apr" */
export function shortDate(date: string): string {
  return utc(date).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
}

/** "Thu" */
export function weekdayShort(date: string): string {
  return utc(date).toLocaleDateString("en-GB", { weekday: "short", timeZone: "UTC" });
}
