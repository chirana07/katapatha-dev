import { color } from "@katapatha/tokens/tokens";
import type { StatusTone } from "../driver/stop-state";

/**
 * Semantic tone -> token. The only place a status becomes a colour.
 *
 * Kept away from the components so there is one table to audit, and so no screen
 * can reach for a raw palette value: packages/tokens/src/tokens.css says
 * "Components use these, never the raw --c-* values", and the same applies here.
 */
export const TONE: Record<StatusTone, { dot: string; text: string; surface: string }> = {
  neutral: { dot: color.muted, text: color.muted, surface: color.raised },
  active: { dot: color.flame, text: color.ink, surface: "#FEF6E0" },
  good: { dot: "#157347", text: "#115C3A", surface: "#ECFDF3" },
  bad: { dot: color.ruby, text: color.ruby, surface: "#FEF1F1" },
};
