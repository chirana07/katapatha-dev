/**
 * A horizontal proportion bar with an optional target marker, drawn as an SVG
 * so it needs no layout maths in CSS. `preserveAspectRatio="none"` stretches
 * it to any width; the marker keeps a constant stroke with
 * `vector-effect`. It carries no text of its own: the figure beside it does.
 */
export function MeterBar({
  value,
  target,
  tone = "link",
  label,
}: {
  /** 0-100, or null when the figure is unknown (an empty track is drawn). */
  value: number | null;
  target?: number;
  tone?: "link" | "good" | "warn" | "bad";
  /** For screen readers: "Fleet utilisation 33%, target 80%". */
  label: string;
}) {
  const pct = value === null ? 0 : Math.max(0, Math.min(100, value));
  const fill = { link: "fill-link", good: "fill-good", warn: "fill-warn", bad: "fill-bad" }[tone];
  return (
    <svg viewBox="0 0 100 8" preserveAspectRatio="none" role="img" aria-label={label} className="block h-2 w-full overflow-hidden rounded-full">
      <rect x="0" y="0" width="100" height="8" className="fill-line" />
      {pct > 0 ? <rect x="0" y="0" width={pct} height="8" className={fill} /> : null}
      {target !== undefined ? (
        <line x1={target} x2={target} y1="-1" y2="9" className="stroke-warn" strokeWidth="2" vectorEffect="non-scaling-stroke" />
      ) : null}
    </svg>
  );
}

/** Horizontal bars for a short ranked list (top exceptions): label, bar, count. */
export function RankedBars({ items, label }: { items: { key: string; label: string; count: number }[]; label: string }) {
  const max = Math.max(1, ...items.map((i) => i.count));
  return (
    <ul aria-label={label} className="flex flex-col gap-3">
      {items.map((item) => (
        <li key={item.key} className="grid grid-cols-[minmax(0,9rem)_1fr_2rem] items-center gap-3 text-sm">
          <span className="truncate text-ink">{item.label}</span>
          <svg viewBox="0 0 100 8" preserveAspectRatio="none" aria-hidden className="block h-2 w-full overflow-hidden rounded-full">
            <rect x="0" y="0" width="100" height="8" className="fill-line" />
            <rect x="0" y="0" width={(item.count / max) * 100} height="8" className="fill-warn" />
          </svg>
          <span className="tabular text-right font-semibold text-ink">{item.count}</span>
        </li>
      ))}
    </ul>
  );
}
