import type { components } from "@katapatha/contracts/types";
import { splitUnits } from "@katapatha/core/domain/orderSize";

type OrderLimits = components["schemas"]["OrderLimits"];
type Temp = "ambient" | "chilled";

export interface PlanLine {
  temp: Temp;
  units: number;
  /** How the units will be raised: one entry per order. */
  parts: number[];
  /** No vehicle at the depot can carry this temperature to the outlet. */
  blocked: boolean;
  /** Estimates from the outlet's own order history; null without limits. */
  volumeM3: number | null;
  weightKg: number | null;
}

export interface OrderPlan {
  lines: PlanLine[];
  totalUnits: number;
  volumeM3: number | null;
  weightKg: number | null;
  blocked: boolean;
}

/**
 * What placing these quantities would do, as the server action will do it.
 *
 * Mirrors the action's split (rule 5: an order travels whole, so a quantity
 * bigger than the largest vehicle is raised as several equal orders) so the
 * review step can say "3 orders of 200 + 200 + 150" before the button is
 * pressed. Volume and weight are estimates; without limits they are unknown
 * rather than zero.
 */
export function planOrder(quantities: Record<Temp, number>, limits: OrderLimits | null): OrderPlan {
  const lines: PlanLine[] = [];
  for (const temp of ["ambient", "chilled"] as const) {
    const units = quantities[temp];
    if (!Number.isInteger(units) || units <= 0) continue;
    const limit = limits?.[temp];
    const blocked = limit != null && limit.maxUnitsPerOrder <= 0;
    const parts = limit && limit.maxUnitsPerOrder > 0 ? splitUnits(units, limit.maxUnitsPerOrder) : [units];
    lines.push({
      temp,
      units,
      parts,
      blocked,
      volumeM3: limit ? units * limit.m3PerUnit : null,
      weightKg: limit ? units * limit.kgPerUnit : null,
    });
  }
  const sum = (pick: (line: PlanLine) => number | null) =>
    lines.length > 0 && lines.every((line) => pick(line) != null)
      ? lines.reduce((total, line) => total + (pick(line) ?? 0), 0)
      : null;
  return {
    lines,
    totalUnits: lines.reduce((total, line) => total + line.units, 0),
    volumeM3: sum((line) => line.volumeM3),
    weightKg: sum((line) => line.weightKg),
    blocked: lines.some((line) => line.blocked),
  };
}

/** "3 orders of 200 + 200 + 150 units", or null when it stays one order. */
export function splitSummary(line: Pick<PlanLine, "parts">): string | null {
  return line.parts.length > 1 ? `${line.parts.length} orders of ${line.parts.join(" + ")} units` : null;
}
