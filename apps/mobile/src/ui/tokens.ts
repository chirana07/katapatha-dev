import { color, paletteFor, toneFor, type Scheme } from "@katapatha/tokens/tokens";
import type { StatusTone } from "../driver/stop-state";

export type ToneStyle = { dot: string; text: string; surface: string };

/**
 * Semantic tone -> token. The only place a status becomes a colour.
 *
 * Kept away from the components so there is one table to audit, and so no screen
 * can reach for a raw palette value: packages/tokens/src/tokens.css says
 * "Components use these, never the raw --c-* values", and the same applies here.
 *
 * Scheme-aware because the driver runs this app at 03:30 in a dark cab — see
 * DESIGN.md "Night theme". `neutral` and `active` come from the palette, which
 * re-maps under night; `good` and `bad` come from the status tones, which
 * re-map with it.
 */
export function toneTable(scheme: Scheme): Record<StatusTone, ToneStyle> {
  const palette = paletteFor(scheme);
  const status = toneFor(scheme);

  return {
    neutral: { dot: palette.muted, text: palette.muted, surface: palette.raised },
    active: { dot: palette.flame, text: palette.ink, surface: status.warn.surface },
    good: { dot: status.good.fg, text: status.good.ink, surface: status.good.surface },
    bad: { dot: status.bad.fg, text: status.bad.ink, surface: status.bad.surface },
  };
}

/**
 * The light table, for screens that have not yet been threaded with a scheme.
 * Prefer `toneTable(scheme)`; this exists so the night rollout can land screen
 * by screen rather than as one unreviewable change.
 */
export const TONE: Record<StatusTone, ToneStyle> = toneTable("light");

export { color };
