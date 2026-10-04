/**
 * The chilled-load temperature band.
 *
 * A chiller reading is a person looking at a gauge (DOMAIN.md, "What the
 * product may claim, and how"), so this is the policy that person's number is
 * judged against — nothing more. The band is copied onto every reading when
 * it is taken, so changing the constant later never rewrites whether an old
 * reading was in range.
 *
 * 2–5 °C is the "Target 2–5 °C" the loader and driver screens print.
 */
export interface ChillerBand {
  minC: number;
  maxC: number;
}

export const CHILLED_TARGET: ChillerBand = { minC: 2, maxC: 5 };

/** Frozen goods: the usual deep-freeze band, -25 to -15 °C. */
export const FROZEN_TARGET: ChillerBand = { minC: -25, maxC: -15 };

/** The band a load of this temperature class is judged against; ambient has none. */
export function bandFor(temp: "chilled" | "frozen" | "ambient"): ChillerBand | null {
  if (temp === "chilled") return CHILLED_TARGET;
  if (temp === "frozen") return FROZEN_TARGET;
  return null;
}

/** Both ends are inside the band: 5.0 °C is on target, 5.1 °C is not. */
export function isInRange(tempC: number, band: ChillerBand): boolean {
  return tempC >= band.minC && tempC <= band.maxC;
}
