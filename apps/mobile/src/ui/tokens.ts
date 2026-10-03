import {
  color,
  nightTone,
  paletteFor,
  toneFor,
  type Palette,
  type Scheme,
  type ToneSet,
} from "@katapatha/tokens/tokens";
import type { StatusTone } from "../driver/stop-state";

/**
 * Semantic tone -> palette value, for both schemes. The only place in the app
 * where a meaning (good, warn, bad...) becomes a colour, and the only module in
 * src/ui that reads the raw `color` table: every component asks `useTheme()`
 * (src/ui/theme.ts) instead, so night mode cannot silently stay light.
 *
 * packages/tokens/src/tokens.css says "Components use these, never the raw
 * --c-* values", and the same applies here. Values this app needs that the
 * shared token package lacks (tone borders, the dominant-action ink, the solid
 * danger fill, the on-navy translucents) live in THIS file, once, with the
 * reason beside each. packages/tokens is not edited from the mobile app.
 */

/** What a tone means. Every tone is rendered with a label or icon, never alone. */
export type Tone = "neutral" | "accent" | "good" | "warn" | "info" | "bad";

export const TONES: readonly Tone[] = ["neutral", "accent", "good", "warn", "info", "bad"];

export type ToneStyle = {
  /** Icon, dot and radio colour. Drawn on `surface`, so it needs >= 3:1 there. */
  fg: string;
  /** Text written on `surface`. Needs >= 4.5:1 there. */
  ink: string;
  surface: string;
  border: string;
};

/**
 * Borders for the status tones. tokens.ts gives a foreground/ink/surface triple
 * but no border, and a tinted surface without an edge disappears on a card of
 * the same lightness. Light values are the ones the old Notes used; night values
 * are the matching dark edges.
 */
const TONE_BORDER: Record<Scheme, Record<"good" | "warn" | "bad" | "info", string>> = {
  light: { good: "#A9E2C1", warn: "#F3DCA0", bad: "#F0B4B4", info: "#BFD6FB" },
  dark: { good: "#1F5A3F", warn: "#5C4716", bad: "#6B2A30", info: "#2B3F6B" },
};

/** The full table. Pure, so the contrast test can walk every pair. */
export function toneStyles(scheme: Scheme): Record<Tone, ToneStyle> {
  const palette = paletteFor(scheme);
  const status = toneFor(scheme);
  const border = TONE_BORDER[scheme];

  return {
    // The grey pill ("Upcoming"): the hairline colour as a fill, muted ink on it.
    neutral: {
      fg: palette.muted,
      ink: palette.muted,
      surface: palette.line,
      border: palette.line,
    },
    // Flame is the dominant action and "Next stop". Its ink is the LIGHT palette's
    // ink in both schemes: night re-maps `ink` to near-white, which on yellow is
    // 1.3:1. Dark text on flame is what the design shows in R-03 too.
    accent: { fg: palette.flame, ink: color.ink, surface: palette.flame, border: palette.flame },
    good: { ...status.good, border: border.good },
    warn: { ...status.warn, border: border.warn },
    info: { ...status.info, border: border.info },
    bad: { ...status.bad, border: border.bad },
  };
}

/** A solid red fill with its ink, for the one destructive dominant action (R-11). */
export const DANGER: Record<Scheme, { bg: string; ink: string }> = {
  // Ruby from the palette on light. Night uses a lighter red so the button still
  // separates from the dark canvas (3:1+) while keeping white text at 4.5:1+.
  light: { bg: color.ruby, ink: "#FFFFFF" },
  dark: { bg: "#D1343E", ink: "#FFFFFF" },
};

/**
 * The header block. Navy in BOTH schemes: navy is a brand hue, not a surface
 * (docs/DESIGN.md; the web driver header says the same), so night darkens the
 * page under it and the header stays put (R-03). Everything on it is white-ish
 * at a fixed alpha, so it reads the same in both.
 */
export const HEADER = {
  surface: color.navy,
  text: "#FFFFFF",
  /** Secondary text on navy. >= 4.5:1, asserted in ui.test.ts. */
  sub: "rgba(255,255,255,0.72)",
  /** Not-yet-reached step labels. >= 4.5:1, asserted in ui.test.ts. */
  faint: "rgba(255,255,255,0.62)",
  /** The progress / step track. */
  track: "rgba(255,255,255,0.18)",
  /** Back button and step-badge fill. */
  control: "rgba(255,255,255,0.12)",
  /** Outline of the trip chip. */
  outline: "rgba(255,255,255,0.32)",
  /** Hairline under the header, visible against a night canvas only. */
  edge: { light: "transparent", dark: "rgba(255,255,255,0.10)" } as Record<Scheme, string>,
} as const;

/**
 * Connectivity on the navy header. The header is dark in both schemes, so the
 * chip uses the NIGHT status tones in both: dark tinted surface, bright ink.
 */
export type ConnectivityChipStyle = { surface: string; ink: string; dot: string };
export const CHIP_ON_NAVY: Record<"Checking" | "Connected" | "Offline", ConnectivityChipStyle> = {
  Checking: { surface: HEADER.control, ink: HEADER.text, dot: "rgba(255,255,255,0.7)" },
  Connected: {
    surface: nightTone.good.surface,
    ink: nightTone.good.ink,
    dot: nightTone.good.fg,
  },
  Offline: {
    surface: nightTone.warn.surface,
    ink: nightTone.warn.ink,
    dot: nightTone.warn.fg,
  },
};

/** Behind a modal sheet or menu. */
export const SCRIM = "rgba(8,12,22,0.55)";

/** The theme an app screen or primitive reads. */
export type Theme = {
  scheme: Scheme;
  c: Palette;
  /** The shared status tones (good/warn/bad/info: fg, ink, surface). */
  tone: ToneSet;
  /** The app's semantic table: every Tone, with borders. Prefer this. */
  tones: Record<Tone, ToneStyle>;
};

const THEMES: Record<Scheme, Theme> = {
  light: {
    scheme: "light",
    c: paletteFor("light"),
    tone: toneFor("light"),
    tones: toneStyles("light"),
  },
  dark: {
    scheme: "dark",
    c: paletteFor("dark"),
    tone: toneFor("dark"),
    tones: toneStyles("dark"),
  },
};

/**
 * The theme for a scheme. Pure and referentially stable (the same object every
 * call), so memoising on the scheme is free and a test can compare by identity.
 */
export function themeFor(scheme: Scheme): Theme {
  return THEMES[scheme];
}

/** The system's setting, as React Native's useColorScheme reports it. */
export function schemeFromSystem(system: string | null | undefined): Scheme {
  return system === "dark" ? "dark" : "light";
}

/**
 * The stop-status semantic (`StatusTone`, from the driver state machine) as a
 * `Tone`. `active` (on site / unloading) is the flame tone.
 */
export function toneForStatus(status: StatusTone): Tone {
  switch (status) {
    case "neutral":
      return "neutral";
    case "active":
      return "accent";
    case "good":
      return "good";
    case "bad":
      return "bad";
  }
}

/** The old shape: dot / text / surface. */
export type LegacyToneStyle = { dot: string; text: string; surface: string };

/**
 * Scheme-aware table keyed by the driver state machine's StatusTone. Kept for
 * StatusDot; new code uses `toneStyles` / `useTheme().tones`.
 */
export function toneTable(scheme: Scheme): Record<StatusTone, LegacyToneStyle> {
  const styles = toneStyles(scheme);
  const pick = (tone: Tone): LegacyToneStyle => ({
    dot: styles[tone].fg,
    text: styles[tone].ink,
    surface: styles[tone].surface,
  });
  return {
    neutral: pick("neutral"),
    active: pick("accent"),
    good: pick("good"),
    bad: pick("bad"),
  };
}
