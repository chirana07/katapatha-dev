import { isDateOnly, shiftDate } from "../../../lib/dates";

/**
 * The reports' `?from=&to=`. Only real calendar days are passed on; anything
 * else is dropped, so the API's default (the seven days ending at the newest
 * day with data) applies instead of a 422 for a typo in the URL.
 */
export interface Range {
  from?: string;
  to?: string;
}

type Params = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export function parseRange(params: Params): Range {
  const from = first(params.from);
  const to = first(params.to);
  return {
    ...(isDateOnly(from) ? { from } : {}),
    ...(isDateOnly(to) ? { to } : {}),
  };
}

/** A path with the range (and any other params) as a query string. */
export function reportHref(path: string, range: Range, extra: Record<string, string | undefined> = {}): string {
  const search = new URLSearchParams();
  if (range.from) search.set("from", range.from);
  if (range.to) search.set("to", range.to);
  for (const [key, value] of Object.entries(extra)) if (value) search.set(key, value);
  const text = search.toString();
  return text ? `${path}?${text}` : path;
}

/** Last N days ending at `to`, inclusive. */
export function lastDays(to: string, days: number): Required<Range> {
  return { from: shiftDate(to, -(days - 1)), to };
}

function dayNumber(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return Date.UTC(y!, m! - 1, d!) / 86_400_000;
}

/** Whole days in a range, inclusive; 0 when it is backwards. */
export function daysInRange(from: string, to: string): number {
  const days = dayNumber(to) - dayNumber(from) + 1;
  return days > 0 ? days : 0;
}
