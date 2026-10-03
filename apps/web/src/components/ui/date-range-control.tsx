import Link from "next/link";
import { shiftDate } from "@/lib/dates";

/**
 * The two-date selector for a report ("3 – 9 Apr 2026 ▾" in the designs).
 *
 * A GET form, like `DateControl`, for the same reasons: the page is a server
 * component keyed on `?from=&to=`, so choosing a range is a navigation. It
 * works without JavaScript, the range is in the URL, and `keep` carries the
 * page's other filters across.
 *
 * The presets end on the range's current last day, so "30 days" means the
 * thirty days up to what is on screen. The server rejects a backwards range or
 * one over its limit and says so; this control does not second-guess it.
 */
export function DateRangeControl({
  from,
  to,
  path,
  keep = {},
  presets = [7, 30, 90],
}: {
  from: string | undefined;
  to: string | undefined;
  path: string;
  /** Other search params to preserve. Undefined values are dropped. */
  keep?: Record<string, string | undefined>;
  /** Day counts offered as shortcuts. Needs `to` to be known. */
  presets?: number[];
}) {
  const hrefFor = (days: number) => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(keep)) if (value) params.set(key, value);
    params.set("from", shiftDate(to!, -(days - 1)));
    params.set("to", to!);
    return `${path}?${params.toString()}`;
  };

  return (
    <form method="get" action={path} className="flex flex-wrap items-center gap-2 rounded-control border border-line bg-surface p-1">
      {Object.entries(keep).map(([key, value]) =>
        value ? <input key={key} type="hidden" name={key} value={value} /> : null,
      )}
      <label className="flex items-center gap-1 pl-1 text-sm text-muted">
        <span>From</span>
        <input type="date" name="from" defaultValue={from} required className="h-9 rounded-control bg-transparent px-1 text-sm font-semibold text-ink" />
      </label>
      <label className="flex items-center gap-1 text-sm text-muted">
        <span>to</span>
        <input type="date" name="to" defaultValue={to} required className="h-9 rounded-control bg-transparent px-1 text-sm font-semibold text-ink" />
      </label>
      <button type="submit" className="h-9 rounded-control px-3 text-sm font-semibold text-link hover:bg-canvas">
        Apply
      </button>
      {to
        ? presets.map((days) => (
            <Link key={days} href={hrefFor(days)} className="inline-flex h-9 items-center rounded-control px-2 text-sm text-muted hover:bg-canvas hover:text-ink">
              {days} days
            </Link>
          ))
        : null}
    </form>
  );
}
