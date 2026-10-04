/**
 * The temperature classes an order or product can have, in one place.
 *
 * Chilled and frozen goods both need a refrigerated vehicle; ambient goods ride
 * anything. The class is always said in words and an icon, never by colour
 * alone, because it decides which vehicle can carry the goods.
 */
export type Temp = "ambient" | "chilled" | "frozen";

/** Display order: the everyday goods first, the cold chain after. */
export const TEMPS: readonly Temp[] = ["ambient", "chilled", "frozen"];

export const TEMP_LABEL: Record<Temp, string> = {
  ambient: "Ambient",
  chilled: "Chilled",
  frozen: "Frozen",
};

export function isTemp(value: unknown): value is Temp {
  return value === "ambient" || value === "chilled" || value === "frozen";
}

/** "Chilled", "Frozen" or "Ambient"; anything unrecognised reads as ambient. */
export function tempLabel(temp: string): string {
  return isTemp(temp) ? TEMP_LABEL[temp] : TEMP_LABEL.ambient;
}

/** Whether goods of this class need a refrigerated vehicle. */
export function needsReefer(temp: string): boolean {
  return temp === "chilled" || temp === "frozen";
}

/** "7 chilled · 2 frozen · 11 ambient", leaving out a class with none. */
export function tempBreakdown(counts: Partial<Record<Temp, number>>): string {
  return (["chilled", "frozen", "ambient"] as const)
    .filter((t) => (counts[t] ?? 0) > 0 || t === "chilled" || t === "ambient")
    .map((t) => `${counts[t] ?? 0} ${t}`)
    .join(" · ");
}

/** How many of these orders (or products) are in each class. */
export function countTemps(items: readonly { tempRequirement: string }[]): Record<Temp, number> {
  const counts: Record<Temp, number> = { ambient: 0, chilled: 0, frozen: 0 };
  for (const item of items) if (isTemp(item.tempRequirement)) counts[item.tempRequirement] += 1;
  return counts;
}
