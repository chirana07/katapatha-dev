import Link from "next/link";
import { Button } from "@/components/ui/button";

const FIELD = "min-h-11 rounded-control border border-line bg-surface px-3 text-sm text-ink";

/**
 * The orders filters, as a GET form.
 *
 * A form rather than client state because the filters are part of the URL:
 * submitting navigates, so the result is linkable and the back button undoes it,
 * and it works before any JavaScript has loaded. The tab (`status`) rides along
 * as a hidden field so applying a filter does not throw away the tab the
 * dispatcher is on.
 */
export function FilterBar({
  date,
  group,
  brand,
  temp,
  q,
  filtering,
  clearHref,
}: {
  date: string;
  group: string | undefined;
  brand: string | undefined;
  temp: string | undefined;
  q: string;
  filtering: boolean;
  clearHref: string;
}) {
  return (
    <form method="get" action="/dispatcher/orders" role="search" aria-label="Filter orders" className="flex flex-wrap items-end gap-3">
      <input type="hidden" name="date" value={date} />
      {group ? <input type="hidden" name="status" value={group} /> : null}
      <label className="flex min-w-[14rem] flex-1 flex-col gap-1 text-xs font-semibold text-muted">
        Search
        <input
          type="search"
          name="q"
          defaultValue={q}
          maxLength={60}
          placeholder="Order, outlet or district"
          className={`${FIELD} font-normal`}
        />
      </label>
      <label className="flex flex-col gap-1 text-xs font-semibold text-muted">
        Brand
        <select name="brand" defaultValue={brand ?? ""} className={`${FIELD} font-normal`}>
          <option value="">All brands</option>
          <option value="Fresh">Fresh</option>
          <option value="Style">Style</option>
          <option value="Tech">Tech</option>
        </select>
      </label>
      <label className="flex flex-col gap-1 text-xs font-semibold text-muted">
        Load
        <select name="temp" defaultValue={temp ?? ""} className={`${FIELD} font-normal`}>
          <option value="">All loads</option>
          <option value="chilled">Chilled</option>
          <option value="frozen">Frozen</option>
          <option value="ambient">Ambient</option>
        </select>
      </label>
      <Button type="submit" variant="secondary">
        Apply
      </Button>
      {filtering ? (
        <Link href={clearHref} className="inline-flex min-h-11 items-center px-2 text-sm font-semibold text-link underline-offset-2 hover:underline">
          Clear filters
        </Link>
      ) : null}
    </form>
  );
}
