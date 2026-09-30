/**
 * The Katapatha palette, as data.
 *
 * Values come from DESIGN.md, which is the binding design system. The previous
 * repository carried TWO divergent token sets that disagreed on the brand
 * colours (Style was ruby #AE0109 in the working application and purple
 * #9333EA in the design prototype). DESIGN.md settles it; this file is now the
 * single source and is LEAD-owned.
 *
 * React Native cannot read CSS custom properties, so the mobile app imports
 * these values and the web imports tokens.css. Both are generated from the same
 * table here — keep them in step.
 */
export const color = {
  navy: "#20364E",
  flame: "#F6B723",
  ruby: "#AE0109",
  ochre: "#FBCD5A",
  crimson: "#D80511",
  ink: "#0F172A",
  muted: "#526277",
  canvas: "#F1F5F9",
  raised: "#F8FAFC",
  surface: "#FFFFFF",
  link: "#2563EB",
} as const;

/** Brand accents. Status colour never appears without a label or icon. */
export const brand = {
  Fresh: "#157347",
  Style: color.ruby,
  Tech: color.link,
} as const;

export const radius = { control: 8, card: 10, cardLoose: 14 } as const;

/** An 8px rhythm, with 4px available for dense table content. */
export const space = { dense: 4, xs: 8, sm: 16, md: 24, lg: 32, xl: 48 } as const;

export const font = {
  sans: "Inter, ui-sans-serif, system-ui, -apple-system, sans-serif",
  /** Capacity, fuel, counts, times and quantities use tabular numerals. */
  tabular: '"Inter", ui-sans-serif, system-ui',
} as const;

/** Minimum touch target on tablet and phone, per DESIGN.md. */
export const TOUCH_TARGET_MIN = 44;
