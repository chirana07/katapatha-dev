/**
 * How report figures are written. The rule that matters: a figure the API
 * could not back arrives as null, and null is "—", never 0. A 0% on-time rate
 * and "no stop had a recorded arrival" are different statements.
 */

export const DASH = "—";

/** "94.2%", "100%", or "—" for null. One decimal at most, none when whole. */
export function pctText(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return DASH;
  const rounded = Math.round(value * 10) / 10;
  return `${Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(1)}%`;
}

/** A whole count, or "—" for null. */
export function countText(value: number | null | undefined): string {
  return value === null || value === undefined ? DASH : value.toLocaleString("en-GB");
}

/** Minutes against plan: "−14 min" early, "+6 min" late, "0 min", or "—". */
export function deltaMinutesText(value: number | null | undefined): string {
  if (value === null || value === undefined) return DASH;
  if (value === 0) return "0 min";
  return `${value < 0 ? "−" : "+"}${Math.abs(value)} min`;
}

/**
 * A change against the previous period. `better` says which direction is good
 * for this metric (more on-time is good; more discrepancies is not), so the
 * tone follows the meaning and the arrow follows the sign.
 */
export function changeText(
  value: number | null | undefined,
  unit: string,
  better: "up" | "down",
): { text: string; tone: "good" | "bad" | "neutral" } | null {
  if (value === null || value === undefined) return null;
  if (value === 0) return { text: `No change ${unit}`.trim(), tone: "neutral" };
  const arrow = value > 0 ? "▲" : "▼";
  const good = (value > 0) === (better === "up");
  return { text: `${arrow} ${Math.abs(Math.round(value * 10) / 10)} ${unit}`.trim(), tone: good ? "good" : "bad" };
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function parts(date: string): [number, number, number] {
  const [y, m, d] = date.split("-").map(Number);
  return [y!, m!, d!];
}

/** "3–9 Apr 2026", "28 Mar – 3 Apr 2026", "28 Dec 2025 – 3 Jan 2026". */
export function rangeText(from: string, to: string): string {
  const [fy, fm, fd] = parts(from);
  const [ty, tm, td] = parts(to);
  if (from === to) return `${td} ${MONTHS[tm - 1]} ${ty}`;
  if (fy !== ty) return `${fd} ${MONTHS[fm - 1]} ${fy} – ${td} ${MONTHS[tm - 1]} ${ty}`;
  if (fm !== tm) return `${fd} ${MONTHS[fm - 1]} – ${td} ${MONTHS[tm - 1]} ${ty}`;
  return `${fd}–${td} ${MONTHS[tm - 1]} ${ty}`;
}

/** "5–10 Oct", "30 Mar – 4 Apr": a week's dates without the year. */
export function weekDatesText(start: string, end: string): string {
  const [, sm, sd] = parts(start);
  const [, em, ed] = parts(end);
  return sm === em ? `${sd}–${ed} ${MONTHS[em - 1]}` : `${sd} ${MONTHS[sm - 1]} – ${ed} ${MONTHS[em - 1]}`;
}

export function weekLabel(isoWeek: number): string {
  return `W${String(isoWeek).padStart(2, "0")}`;
}

/** "9 Apr" for a chart axis. */
export function dayLabel(date: string): string {
  const [, m, d] = parts(date);
  return `${d} ${MONTHS[m - 1]}`;
}

/** The outlet as a table row names it: id, then its name where the API has one, else its district. */
export function outletLabel(outlet: { outletId: string; displayName: string | null; districtName: string | null }): string {
  const place = outlet.displayName ?? outlet.districtName;
  return place ? `${outlet.outletId} · ${place}` : outlet.outletId;
}

/** A SCREAMING_SNAKE kind as words, for kinds the API sent no label for. */
export function kindWords(kind: string): string {
  const words = kind.toLowerCase().replaceAll("_", " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}
