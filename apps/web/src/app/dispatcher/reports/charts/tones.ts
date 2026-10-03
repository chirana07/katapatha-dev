/**
 * Chart colours as full Tailwind class names, because Tailwind only emits a
 * class it can read verbatim in the source. Tokens only: each maps to a theme
 * colour, so a palette correction in tokens.css reaches the charts too.
 */
export type ChartTone = "link" | "soft" | "warn" | "bad" | "good" | "muted";

export const FILL: Record<ChartTone, string> = {
  link: "fill-link",
  soft: "fill-info/30",
  warn: "fill-warn",
  bad: "fill-bad",
  good: "fill-good",
  muted: "fill-muted",
};

export const STROKE: Record<ChartTone, string> = {
  link: "stroke-link",
  soft: "stroke-info/30",
  warn: "stroke-warn",
  bad: "stroke-bad",
  good: "stroke-good",
  muted: "stroke-muted",
};

export const SWATCH: Record<ChartTone, string> = {
  link: "bg-link",
  soft: "bg-info/30",
  warn: "bg-warn",
  bad: "bg-bad",
  good: "bg-good",
  muted: "bg-muted",
};
