import type { ReactNode } from "react";
import type { Tone } from "./status-pill";

/**
 * The KPI card at the top of almost every workspace screen.
 *
 * Replaces five near-identical local definitions (Metric, SummaryCard,
 * ProgressCard and two unnamed) that had drifted apart on padding and number
 * size.
 *
 * The shape comes from the designs: an icon tile, a large tabular figure, a
 * label, and a context line underneath that carries the delta or the caveat.
 * That last line is the point of the component — a number without its context
 * is the thing the dispatcher cannot act on.
 */

const FOOT_CLASS: Record<Tone, string> = {
  neutral: "text-muted",
  good: "text-good-ink",
  warn: "text-warn-ink",
  bad: "text-bad-ink",
  info: "text-info-ink",
};

export function StatCard({
  value,
  label,
  foot,
  footTone = "neutral",
  icon,
  tone = "neutral",
  children,
}: {
  value: ReactNode;
  label: string;
  /** The delta, the target, or the reason the number is what it is. */
  foot?: ReactNode;
  footTone?: Tone;
  icon?: ReactNode;
  /** Tints the whole card. Reserve it for cards that are themselves an alert. */
  tone?: Tone;
  /** Block content between the figure and `foot`, e.g. a Meter. `foot` is a
   *  paragraph, so a meter (a div) cannot live inside it. */
  children?: ReactNode;
}) {
  const shell =
    tone === "neutral"
      ? "border-line bg-surface"
      : tone === "bad"
        ? "border-bad/25 bg-bad-surface"
        : tone === "warn"
          ? "border-warn/30 bg-warn-surface"
          : tone === "good"
            ? "border-good/25 bg-good-surface"
            : "border-info/25 bg-info-surface";

  return (
    <div className={`rounded-card border p-4 ${shell}`}>
      <div className="flex items-start gap-3">
        {icon ? (
          <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-control bg-raised text-muted">
            {icon}
          </span>
        ) : null}
        <div className="min-w-0">
          <p className="tabular text-2xl font-bold leading-tight text-ink">{value}</p>
          <p className="mt-0.5 truncate text-sm text-muted">{label}</p>
        </div>
      </div>
      {children ? <div className="mt-3">{children}</div> : null}
      {foot ? <p className={`mt-3 text-xs font-semibold ${FOOT_CLASS[footTone]}`}>{foot}</p> : null}
    </div>
  );
}

/**
 * The row the cards sit in. Wraps rather than scrolls, because a KPI that has
 * scrolled off the side of a dashboard is a KPI nobody reads.
 */
export function StatRow({ children }: { children: ReactNode }) {
  return <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{children}</div>;
}

/**
 * A labelled proportion. Used for vehicle utilisation, loading progress and
 * fuel quota, which the designs draw identically in three different places.
 *
 * `level` comes from @katapatha/core/domain/capacity so the ok/near/over
 * thresholds are the same ones the allocator uses.
 */
export function Meter({
  value,
  max,
  level = "ok",
  label,
}: {
  value: number;
  max: number;
  level?: "ok" | "near" | "over";
  /** Describes the bar for screen readers; the visible text is the caller's. */
  label: string;
}) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  const fill = level === "over" ? "bg-bad" : level === "near" ? "bg-action" : "bg-good";

  return (
    <div
      role="meter"
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-label={label}
      className="h-1.5 w-full overflow-hidden rounded-full bg-line"
    >
      <div className={`h-full rounded-full ${fill}`} style={{ width: `${pct}%` }} />
    </div>
  );
}
