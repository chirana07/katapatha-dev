import type { ReactNode } from "react";
import { SWATCH, type ChartTone } from "./tones";

/**
 * Three drawings of one chart, chosen by the width of the card it sits in (a
 * container query, not the viewport: the same chart is a half-width card at
 * 1440 and a full-width one at 1024). One SVG scaled to every width would
 * blow its axis text up on a wide card and shrink it unreadably on a phone, so
 * each size has its own geometry and label density.
 */
export function Responsive({ wide, medium, narrow }: { wide: ReactNode; medium: ReactNode; narrow: ReactNode }) {
  return (
    <div className="@container">
      <div className="hidden @4xl:block">{wide}</div>
      <div className="hidden @lg:block @4xl:hidden">{medium}</div>
      <div className="@lg:hidden">{narrow}</div>
    </div>
  );
}

export function Legend({ items }: { items: { label: string; tone: ChartTone; dashed?: boolean; line?: boolean }[] }) {
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
      {items.map((item) => (
        <li key={item.label} className="flex items-center gap-1.5">
          <span
            aria-hidden
            className={`inline-block ${item.line || item.dashed ? "h-0.5 w-4" : "size-2.5 rounded-sm"} ${SWATCH[item.tone]} ${
              item.dashed ? "opacity-80" : ""
            }`}
          />
          {item.label}
        </li>
      ))}
    </ul>
  );
}

/**
 * The text alternative: the same numbers as a table, for screen readers. It is
 * the chart's accessible content; the SVGs themselves are marked as images with
 * a one-line summary.
 */
export function DataTableAlt({
  caption,
  columns,
  rows,
}: {
  caption: string;
  columns: string[];
  rows: { label: string; cells: string[] }[];
}) {
  // The wrapper is what is hidden: a bare `table.sr-only` ignores its 1px width
  // (tables size to content) and stretches the whole page sideways.
  return (
    <div className="sr-only">
      <table>
        <caption>{caption}</caption>
        <thead>
          <tr>
            <th scope="col">Period</th>
            {columns.map((column) => (
              <th key={column} scope="col">
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label}>
              <th scope="row">{row.label}</th>
              {row.cells.map((cell, index) => (
                <td key={index}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
