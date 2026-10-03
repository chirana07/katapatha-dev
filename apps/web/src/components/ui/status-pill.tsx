/**
 * The one status pill.
 *
 * Before this existed there were eight: StatusPill, StatusBadge, LineStateBadge,
 * OrderStatus, PlanStatus, StopStatusBadge and two more, each with its own
 * colour map, in six route files. They disagreed.
 *
 * DESIGN.md: "Pair status colour with text and an icon or shape where space
 * allows" and "Status, focus, and action treatments ... never rely on colour
 * alone." So the label is required, the dot is decorative, and the accessible
 * name always says the word "Status" — a screen reader user should not have to
 * infer that a bare word like "Deferred" is one.
 */

export type Tone = "neutral" | "good" | "warn" | "bad" | "info";

/** Surface + ink per tone. Never a bare hue: the surface alone never carries
 *  the meaning, so each tone ships the ink to write on it. */
const TONE_CLASS: Record<Tone, string> = {
  neutral: "bg-raised text-muted border-line",
  good: "bg-good-surface text-good-ink border-good/25",
  warn: "bg-warn-surface text-warn-ink border-warn/30",
  bad: "bg-bad-surface text-bad-ink border-bad/25",
  info: "bg-info-surface text-info-ink border-info/25",
};

const DOT_CLASS: Record<Tone, string> = {
  neutral: "bg-muted",
  good: "bg-good",
  warn: "bg-warn",
  bad: "bg-bad",
  info: "bg-info",
};

export function StatusPill({
  label,
  tone = "neutral",
  dot = true,
}: {
  label: string;
  tone?: Tone;
  /** Hidden where the row is already dense enough to read without it. */
  dot?: boolean;
}) {
  return (
    <span
      aria-label={`Status: ${label}`}
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-control border px-2 py-0.5 text-xs font-semibold ${TONE_CLASS[tone]}`}
    >
      {dot ? <span aria-hidden className={`size-1.5 shrink-0 rounded-full ${DOT_CLASS[tone]}`} /> : null}
      {label}
    </span>
  );
}

/**
 * Brand accent for Fresh / Style / Tech.
 *
 * Separate from StatusPill on purpose: a brand is an attribute of the order,
 * not a state it is in, and collapsing the two would let a brand colour read
 * as a status.
 */
const BRAND_CLASS = {
  Fresh: "bg-brand-fresh/10 text-brand-fresh border-brand-fresh/25",
  Style: "bg-brand-style/10 text-brand-style border-brand-style/25",
  Tech: "bg-brand-tech/10 text-brand-tech border-brand-tech/25",
} as const;

export function BrandPill({ brand }: { brand: keyof typeof BRAND_CLASS }) {
  return (
    <span className={`inline-flex items-center whitespace-nowrap rounded-control border px-2 py-0.5 text-xs font-semibold ${BRAND_CLASS[brand]}`}>
      {brand}
    </span>
  );
}
