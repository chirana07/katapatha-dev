/**
 * Capacity ratios, ported from the previous prototype's `src/lib/capacity.ts`.
 *
 * `level` compares the ROUNDED percentage on purpose: the badge and the number
 * beside it are read together, so a bar labelled "90%" must not be styled as
 * comfortable. Exactly at capacity counts as "near", not "over" — a full
 * vehicle is legal.
 */

export type Level = "ok" | "near" | "over";

export function percent(used: number, cap: number): number {
  if (cap <= 0) return 0;
  return Math.round((used / cap) * 100);
}

export function level(used: number, cap: number): Level {
  if (cap <= 0 || used > cap) return "over";
  return percent(used, cap) >= 90 ? "near" : "ok";
}

/** Which of two constraints binds first — volume or weight, say. */
export function tighter(
  a: { used: number; cap: number },
  b: { used: number; cap: number },
): "a" | "b" {
  const ra = a.cap > 0 ? a.used / a.cap : Infinity;
  const rb = b.cap > 0 ? b.used / b.cap : Infinity;
  return rb > ra ? "b" : "a";
}
