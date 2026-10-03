import Link from "next/link";
import { longDate, shiftDate, todayInColombo } from "@/lib/dates";

/**
 * The date selector in a page header ("Tue, 29 Sep 2026 ▾").
 *
 * A GET form rather than client state: the page is a server component keyed on
 * `?date=`, so changing the day is just a navigation. It works without
 * JavaScript, is linkable, and the back button does what an operator expects.
 * `keep` carries the page's other filters across, so changing the day does not
 * quietly drop the tab the operator was on.
 */
export function DateControl({
  date,
  path,
  keep = {},
}: {
  date: string;
  path: string;
  /** Other search params to preserve. Undefined values are dropped. */
  keep?: Record<string, string | undefined>;
}) {
  const hrefFor = (value: string) => {
    const params = new URLSearchParams();
    for (const [key, v] of Object.entries(keep)) if (v) params.set(key, v);
    params.set("date", value);
    return `${path}?${params.toString()}`;
  };
  const today = todayInColombo();

  return (
    <form method="get" action={path} className="flex items-center gap-1 rounded-control border border-line bg-surface p-1">
      {Object.entries(keep).map(([key, v]) =>
        v ? <input key={key} type="hidden" name={key} value={v} /> : null,
      )}
      <Link
        href={hrefFor(shiftDate(date, -1))}
        aria-label="Previous day"
        className="inline-flex size-9 items-center justify-center rounded-control text-muted hover:bg-canvas hover:text-ink"
      >
        ‹
      </Link>
      <label className="flex items-center">
        <span className="sr-only">Date, currently {longDate(date)}</span>
        <input
          type="date"
          name="date"
          defaultValue={date}
          className="h-9 rounded-control bg-transparent px-2 text-sm font-semibold text-ink"
        />
      </label>
      <button type="submit" className="h-9 rounded-control px-2 text-sm font-semibold text-link hover:bg-canvas">
        Go
      </button>
      <Link
        href={hrefFor(shiftDate(date, 1))}
        aria-label="Next day"
        className="inline-flex size-9 items-center justify-center rounded-control text-muted hover:bg-canvas hover:text-ink"
      >
        ›
      </Link>
      {date !== today ? (
        <Link href={hrefFor(today)} className="h-9 rounded-control px-2 text-sm leading-9 text-muted hover:text-ink">
          Today
        </Link>
      ) : null}
    </form>
  );
}
