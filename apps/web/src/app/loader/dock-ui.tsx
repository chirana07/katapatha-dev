import type { ReactNode } from "react";
import type { Tone } from "@/components/ui/status-pill";

/**
 * The loader workspace's building blocks, drawn to the Figma file (L-02…L-08).
 *
 * They sit on the shared tokens — flame, link blue, the good/warn/bad surfaces
 * — so the dock looks like the Figma frames without a second palette. The
 * shared StatCard and StatusPill stay as they are for the other workspaces;
 * these are the dock's own shapes: a round tinted icon, a 23px figure, a
 * rounded tag, a dot-led status.
 */

export type IconTone = "info" | "good" | "warn" | "bad" | "neutral" | "violet";

const ICON_TONE: Record<IconTone, string> = {
  info: "bg-info-surface text-link",
  good: "bg-good-surface text-good",
  warn: "bg-warn-surface text-warn",
  bad: "bg-bad-surface text-bad",
  neutral: "bg-raised text-muted",
  violet: "bg-[#f3e8ff] text-[#9333ea]",
};

const FOOT_TONE: Record<Tone, string> = {
  neutral: "text-muted",
  good: "text-good-ink",
  warn: "text-warn-ink",
  bad: "text-bad-ink",
  info: "text-link",
};

/** The KPI card: a round tinted icon, the figure, its label, and one line of
 *  context underneath. `tone="bad"` tints the card itself (L-05 "At risk"). */
export function KpiCard({
  icon,
  iconTone = "info",
  value,
  label,
  foot,
  footTone = "neutral",
  tone = "neutral",
  children,
}: {
  icon: ReactNode;
  iconTone?: IconTone;
  value: ReactNode;
  label: string;
  foot?: ReactNode;
  footTone?: Tone;
  tone?: "neutral" | "bad";
  children?: ReactNode;
}) {
  return (
    <div
      className={`flex min-h-[123px] flex-col justify-between rounded-[10px] border p-4 ${
        tone === "bad" ? "border-bad/25 bg-bad-surface" : "border-[#ededed] bg-surface"
      }`}
    >
      <div className="flex items-start gap-4">
        <span aria-hidden className={`grid size-12.5 shrink-0 place-items-center rounded-full ${ICON_TONE[iconTone]}`}>
          {icon}
        </span>
        <div className="min-w-0">
          <p className="tabular text-[23px] font-bold leading-tight text-ink">{value}</p>
          <p className="mt-0.5 text-[15px] text-[#374151]">{label}</p>
        </div>
      </div>
      {children ? <div className="mt-3">{children}</div> : null}
      {foot ? <p className={`mt-2 text-[13px] font-medium ${FOOT_TONE[footTone]}`}>{foot}</p> : null}
    </div>
  );
}

export function KpiRow({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  return <div className={`grid gap-3 sm:grid-cols-2 ${wide ? "xl:grid-cols-[1.1fr_1fr_1fr_1fr]" : "xl:grid-cols-4"}`}>{children}</div>;
}

export type BarColor = "blue" | "flame" | "green" | "amber" | "red" | "grey";

const BAR_COLOR: Record<BarColor, string> = {
  blue: "bg-link",
  flame: "bg-action",
  green: "bg-good",
  amber: "bg-warn",
  red: "bg-bad",
  grey: "bg-[#cbd5e1]",
};

/** A rounded progress bar. Several segments stack left to right (L-05's
 *  sealed-then-loading overall bar). */
export function Bar({
  segments,
  max,
  label,
  height = "h-[7px]",
  track = "bg-[#e5e7eb]",
}: {
  segments: { value: number; color: BarColor }[];
  max: number;
  label: string;
  height?: string;
  track?: string;
}) {
  const total = segments.reduce((sum, s) => sum + s.value, 0);
  return (
    <div
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={total}
      className={`flex w-full overflow-hidden rounded-full ${height} ${track}`}
    >
      {segments.map((segment, i) =>
        segment.value > 0 && max > 0 ? (
          <div key={i} className={`h-full ${BAR_COLOR[segment.color]}`} style={{ width: `${Math.min(100, (segment.value / max) * 100)}%` }} />
        ) : null,
      )}
    </div>
  );
}

/** "Trip 1", "Refrigerated", "Fresh": the small rounded tags in a vehicle cell. */
export function Tag({ children, tone = "info" }: { children: ReactNode; tone?: "info" | "good" | "neutral" | "bad" | "warn" }) {
  const cls =
    tone === "good"
      ? "bg-good-surface text-good-ink"
      : tone === "neutral"
        ? "bg-raised text-muted"
        : tone === "bad"
          ? "bg-bad-surface text-bad-ink"
          : tone === "warn"
            ? "bg-warn-surface text-warn-ink"
            : "bg-info-surface text-link";
  return <span className={`inline-flex h-5.5 items-center whitespace-nowrap rounded-[5px] px-1.5 text-xs font-medium ${cls}`}>{children}</span>;
}

const PILL_TONE: Record<Tone, { box: string; dot: string }> = {
  info: { box: "bg-info-surface text-link", dot: "bg-link" },
  neutral: { box: "bg-raised text-[#374151]", dot: "bg-muted" },
  good: { box: "bg-good-surface text-good-ink", dot: "bg-good" },
  warn: { box: "bg-warn-surface text-warn-ink", dot: "bg-warn" },
  bad: { box: "bg-bad-surface text-bad-ink", dot: "bg-bad" },
};

/** The dot-led status in a queue row ("● Loading", "● Pending"). The word is
 *  always there; the dot only repeats it. */
export function DockStatus({ label, tone, round = false }: { label: string; tone: Tone; round?: boolean }) {
  const t = PILL_TONE[tone];
  return (
    <span
      aria-label={`Status: ${label}`}
      className={`inline-flex h-6 items-center gap-1.5 whitespace-nowrap px-2 text-xs font-medium ${round ? "rounded-full" : "rounded-[5px]"} ${t.box}`}
    >
      <span aria-hidden className={`size-1.5 shrink-0 rounded-full ${t.dot}`} />
      {label}
    </span>
  );
}

/** The numbered disc on a queue row or a stop group. */
export function NumberDisc({ n, tone = "neutral", size = "sm" }: { n: number; tone?: "flame" | "neutral" | "blue" | "green" | "night" | "amber"; size?: "sm" | "md" }) {
  const cls =
    tone === "flame"
      ? "bg-action text-[#111]"
      : tone === "blue"
        ? "bg-link text-white"
        : tone === "green"
          ? "bg-good text-white"
          : tone === "night"
            ? "bg-night text-white"
            : tone === "amber"
              ? "bg-warn text-white"
              : "bg-[#f3f4f6] text-[#374151]";
  return (
    <span aria-hidden className={`tabular grid shrink-0 place-items-center rounded-full font-bold ${size === "md" ? "size-8 text-sm" : "size-6 text-[13px]"} ${cls}`}>
      {n}
    </span>
  );
}

/** A white panel with the Figma card edge. */
export function Panel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-[10px] border border-[#e5e7eb] bg-surface ${className}`}>{children}</section>;
}

/** A blue information strip ("Load the last stop first…"). */
export function InfoStrip({ children, icon }: { children: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex items-start gap-2.5 rounded-[10px] bg-info-surface px-3 py-2.5 text-[13px] font-medium text-[#1e3a8a]">
      {icon ? <span className="mt-0.5 shrink-0">{icon}</span> : null}
      <div className="min-w-0">{children}</div>
    </div>
  );
}
