import type { ReactNode } from "react";

/**
 * The dense table, with its phone fallback.
 *
 * DESIGN.md: "Tables may scroll inside an explicitly labelled container on
 * narrow screens, but decision-critical fields should use mobile cards." Both
 * halves of that rule are the caller's to honour, so this component makes the
 * card list a required prop rather than an optional one — a table shipped
 * without `cards` would silently fail the 390px acceptance criterion, and the
 * type system now stops that.
 *
 * The existing pages each hand-rolled this pair; the markup below is theirs,
 * with the sr-only caption and the labelled scroll container kept.
 */
export function DataTable({
  caption,
  head,
  children,
  cards,
  empty,
}: {
  /** Describes the table for screen readers. Never rendered visually. */
  caption: string;
  head: ReactNode;
  /** The <tr> rows. */
  children: ReactNode;
  /** The same rows as cards, shown below the md breakpoint. */
  cards: ReactNode;
  /** Shown instead of either when there is nothing. */
  empty?: ReactNode;
  }) {
  if (empty) return <>{empty}</>;

  return (
    <>
      <div
        role="region"
        aria-label={caption}
        tabIndex={0}
        className="hidden overflow-x-auto rounded-card border border-line bg-surface md:block"
      >
        <table className="w-full border-collapse text-sm">
          <caption className="sr-only">{caption}</caption>
          <thead className="border-b border-line bg-raised text-left text-xs font-semibold uppercase tracking-wide text-muted">
            {head}
          </thead>
          <tbody>{children}</tbody>
        </table>
      </div>

      <ul className="flex flex-col gap-3 md:hidden">{cards}</ul>
    </>
  );
}

/** A header cell. Right-aligns numbers so columns of figures line up. */
export function Th({ children, numeric }: { children: ReactNode; numeric?: boolean }) {
  return <th scope="col" className={`px-3 py-2.5 font-semibold ${numeric ? "text-right" : ""}`}>{children}</th>;
}

/** A body cell. `numeric` also applies tabular figures, per DESIGN.md. */
export function Td({ children, numeric }: { children: ReactNode; numeric?: boolean }) {
  return <td className={`px-3 py-2.5 align-middle ${numeric ? "tabular text-right" : ""}`}>{children}</td>;
}

/** A body row. `selected` matches the detail panel's current record. */
export function Tr({ children, selected }: { children: ReactNode; selected?: boolean }) {
  return (
    <tr className={`border-b border-line last:border-0 ${selected ? "bg-warn-surface" : "hover:bg-raised"}`}>
      {children}
    </tr>
  );
}

/** One record as a card, for the phone list. */
export function RowCard({ children }: { children: ReactNode }) {
  return <li className="rounded-card border border-line bg-surface p-3">{children}</li>;
}
