import Link from "next/link";
import { StatusPill } from "@/components/ui/status-pill";
import { ageLabel } from "@/lib/format";
import { KindIcon } from "./kind-icon";
import { CATEGORY_LABEL, reportedByLine, severityLabel, severityTone, type ExceptionRow } from "./model";

const EDGE = {
  critical: "border-l-bad",
  warning: "border-l-warn",
  info: "border-l-info",
} as const;

/**
 * One exception as a row. The whole row is the link, so the target is as large
 * as the row; `aria-current` marks the one the panel is showing.
 *
 * The third line is the API's own `detail` (for a chiller item: "a person's
 * reading, not a live feed"), falling back to who reported it. It is not
 * rewritten here: those sentences are the claims the product may make.
 */
export function ExceptionList({
  rows,
  selectedId,
  hrefOf,
}: {
  rows: ExceptionRow[];
  selectedId: string | null;
  hrefOf: (id: string) => string;
}) {
  return (
    <ul aria-label="Exceptions" className="flex flex-col gap-2">
      {rows.map((row) => {
        const selected = row.id === selectedId;
        const third = row.detail ?? reportedByLine(row.reportedBy);
        return (
          <li key={row.id}>
            <Link
              href={hrefOf(row.id)}
              aria-current={selected ? "true" : undefined}
              className={`flex items-start gap-3 rounded-card border border-l-4 p-3 transition-colors ${EDGE[row.severity]} ${
                selected ? "border-action bg-warn-surface" : "border-line bg-surface hover:bg-raised"
              }`}
            >
              <KindIcon kind={row.kind} severity={row.severity} />
              <span className="min-w-0 flex-1">
                <span className="block font-semibold text-ink">{row.title}</span>
                <span className="mt-0.5 block text-sm text-ink/80">{row.subtitle}</span>
                {third ? <span className="mt-1 block text-xs text-muted">{third}</span> : null}
                <span className="mt-2 flex flex-wrap items-center gap-1.5 xl:hidden">
                  <StatusPill label={severityLabel(row.severity)} tone={severityTone(row.severity)} />
                  <StatusPill label={CATEGORY_LABEL[row.category]} tone="neutral" dot={false} />
                  <span className="tabular text-xs text-muted">{ageLabel(row.ageMinutes * 60)}</span>
                </span>
              </span>
              <span className="hidden shrink-0 flex-col items-end gap-1.5 xl:flex">
                <StatusPill label={severityLabel(row.severity)} tone={severityTone(row.severity)} />
                <StatusPill label={CATEGORY_LABEL[row.category]} tone="neutral" dot={false} />
                <span className="tabular text-xs text-muted">{ageLabel(row.ageMinutes * 60)}</span>
              </span>
              <span aria-hidden className="mt-3 text-muted">
                ›
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
