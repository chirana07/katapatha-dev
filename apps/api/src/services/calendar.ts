import { isOperatingDay as ruleFor } from "@katapatha/core/domain/deferral";
import { prisma } from "../lib/db";

/**
 * Whether the depot runs on a date: the reference calendar where it has a row,
 * Monday to Saturday where it has none. One answer for the planner and the
 * fuel week, so they cannot disagree about which days exist.
 */
export async function isOperatingDay(date: Date): Promise<boolean> {
  const row = await prisma.calendarDay.findUnique({ where: { date }, select: { isOperating: true } });
  return ruleFor(date.toISOString().slice(0, 10), row?.isOperating);
}
