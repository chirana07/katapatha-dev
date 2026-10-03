import type { ReactNode } from "react";

/**
 * "Show the daily figures": the chart's numbers, visibly, folded away until
 * wanted. A hover tooltip does not exist on a phone, and a chart is hard to
 * read a single value from, so the table is the way to get an exact figure.
 */
export function DailyTable({
  summary,
  head,
  rows,
}: {
  summary: string;
  head: string[];
  rows: { key: string; cells: ReactNode[] }[];
}) {
  return (
    <details className="mt-3 text-sm">
      <summary className="inline-flex min-h-11 cursor-pointer items-center font-semibold text-link">{summary}</summary>
      <div role="region" aria-label={summary} tabIndex={0} className="mt-2 max-h-72 overflow-auto rounded-card border border-line">
        <table className="w-full border-collapse text-sm">
          <thead className="sticky top-0 bg-raised text-left text-xs font-semibold uppercase tracking-wide text-muted">
            <tr>
              {head.map((cell, index) => (
                <th key={cell} scope="col" className={`px-3 py-2 ${index === 0 ? "" : "text-right"}`}>
                  {cell}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key} className="border-t border-line">
                {row.cells.map((cell, index) => (
                  <td key={index} className={`tabular px-3 py-1.5 ${index === 0 ? "" : "text-right"}`}>
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}
