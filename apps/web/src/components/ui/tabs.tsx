import Link from "next/link";

/**
 * The tab strip under a page's KPI row.
 *
 * Links, not client state, because every tab in the designs is a different
 * filter over server data — "Open (7)", "Unallocated Orders (2)", "Workshop
 * (2)". Making them links keeps the page a server component, makes each view
 * linkable and back-button-able, and matches how filters already work here.
 *
 * `count` is rendered as a quiet chip; `alert` turns it red for the counts that
 * are themselves the problem (open exceptions, orders needing attention).
 */

export interface TabItem {
  label: string;
  href: string;
  current?: boolean;
  count?: number;
  /** Draws the count as a warning. Use for "this number should be zero". */
  alert?: boolean;
}

export function Tabs({ items, label }: { items: TabItem[]; label: string }) {
  return (
    <nav aria-label={label} className="-mb-px flex gap-1 overflow-x-auto border-b border-line">
      {items.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          aria-current={item.current ? "page" : undefined}
          className={`flex min-h-11 shrink-0 items-center gap-2 border-b-2 px-3 text-sm font-semibold transition-colors ${
            item.current
              ? "border-action text-ink"
              : "border-transparent text-muted hover:border-line hover:text-ink"
          }`}
        >
          {item.label}
          {item.count !== undefined ? (
            <span
              className={`tabular rounded-full px-1.5 py-0.5 text-xs font-semibold ${
                item.alert && item.count > 0 ? "bg-bad text-white" : "bg-raised text-muted"
              }`}
            >
              {item.count}
            </span>
          ) : null}
        </Link>
      ))}
    </nav>
  );
}
