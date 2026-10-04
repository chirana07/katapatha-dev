import "server-only";

import { api } from "@/lib/api";
import { isDateOnly, shiftDate, todayInColombo } from "@/lib/dates";

/**
 * The day a desk screen opens on when the URL names none.
 *
 * A store orders for the next operating day, and the dispatcher closes the queue
 * and plans that same day. Defaulting to the calendar day therefore hides every
 * order a store has just placed whenever today is not itself an operating day
 * (a Sunday, a holiday): the desk opens on an empty day while the work sits on
 * the next one. So the default is today if the depot operates today, else the
 * next operating day. An explicit `?date=` always wins.
 *
 * The calendar read is best-effort — if it fails the desk falls back to today,
 * as it did before, rather than refusing to open.
 */
export async function deskDate(value: string | string[] | undefined): Promise<string> {
  const given = Array.isArray(value) ? value[0] : value;
  if (isDateOnly(given)) return given;
  return operatingDayFrom(todayInColombo());
}

/** `day` itself when it is an operating day, else the next one. */
export async function operatingDayFrom(day: string): Promise<string> {
  try {
    const client = await api();
    // The endpoint is "strictly after", so ask from the day before.
    const next = await client.GET("/reference/calendar/next-operating-day", {
      params: { query: { after: shiftDate(day, -1) } },
    });
    return next.data?.date ?? day;
  } catch {
    return day;
  }
}
