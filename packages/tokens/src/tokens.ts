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
  // Borders and dividers. tokens.css has carried --c-line since the start; this
  // mirror had simply drifted, and React Native cannot read the CSS.
  line: "#E2E8F0",
  link: "#2563EB",
} as const;

/**
 * The night rendering of the same palette, for the driver only.
 *
 * Not a second palette: the brand hues (navy, flame, ruby, ochre, crimson) are
 * unchanged, and only the surface and text ramp is re-mapped. A predawn run
 * starts at 03:30 in a dark cab. See DESIGN.md "Night theme", and keep this in
 * step with the [data-theme="dark"] block in tokens.css.
 */
export const nightColor = {
  navy: color.navy,
  flame: color.flame,
  ruby: color.ruby,
  ochre: color.ochre,
  crimson: color.crimson,
  ink: "#F1F5F9",
  muted: "#94A3B8",
  canvas: "#0B1220",
  raised: "#131C2E",
  surface: "#18233A",
  line: "#2A3650",
  link: "#7AA5FF",
} as const;

export type Scheme = "light" | "dark";

/** The shape both renderings share. Values are strings, not literals, so the
 *  night set is assignable to the same type as the light one. */
export type Palette = { readonly [K in keyof typeof color]: string };

export function paletteFor(scheme: Scheme): Palette {
  return scheme === "dark" ? nightColor : color;
}

/**
 * Status tones, as a foreground/surface pair.
 *
 * A status is never a surface alone — DESIGN.md requires colour to appear with
 * a label or icon — so each tone carries the ink to write on it.
 */
export const tone = {
  good: { fg: "#157347", ink: "#115C3A", surface: "#ECFDF3" },
  warn: { fg: "#B45309", ink: "#8A4208", surface: "#FEF6E0" },
  bad: { fg: color.ruby, ink: color.ruby, surface: "#FEF1F1" },
  info: { fg: color.link, ink: "#1D4ED8", surface: "#EFF6FF" },
} as const;

export const nightTone = {
  good: { fg: "#2FA36B", ink: "#7FE0AE", surface: "#11291E" },
  warn: { fg: color.ochre, ink: color.ochre, surface: "#2B2110" },
  bad: { fg: "#EF4B55", ink: "#FF9BA1", surface: "#2D1417" },
  info: { fg: "#7AA5FF", ink: "#A8C4FF", surface: "#141F38" },
} as const;

export type ToneSet = {
  readonly [K in keyof typeof tone]: { readonly fg: string; readonly ink: string; readonly surface: string };
};

export function toneFor(scheme: Scheme): ToneSet {
  return scheme === "dark" ? nightTone : tone;
}

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
