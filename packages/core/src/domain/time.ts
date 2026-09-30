/**
 * Clock arithmetic on `"HH:MM"` strings.
 *
 * The datasets carry no dates on times and no timezone, so everything here is
 * minutes-since-midnight in Asia/Colombo. Ported from the previous prototype's
 * `src/lib/time.ts`, with one fix: that version had no day rollover, so any
 * span crossing midnight silently went negative. Pre-dawn loading starts at
 * 01:30 and Fresh windows open at 03:00, so a span crossing midnight is
 * plausible enough to be worth handling rather than hoping.
 */

import type { ClockTime } from "./types";

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

export const MINUTES_PER_DAY = 24 * 60;

/** `"07:04"` -> `424`. Throws on malformed input rather than returning NaN. */
export function toMin(t: ClockTime): number {
  const m = HHMM.exec(t);
  if (!m) throw new Error(`Not an HH:MM clock time: ${JSON.stringify(t)}`);
  return Number(m[1]) * 60 + Number(m[2]);
}

/** `424` -> `"07:04"`. Wraps across midnight so callers cannot produce `"25:30"`. */
export function fromMin(m: number): ClockTime {
  const wrapped = ((Math.round(m) % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  const h = Math.floor(wrapped / 60);
  const min = wrapped % 60;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

/** Signed minutes from `a` to `b` within one day. May be negative. */
export function diffMin(a: ClockTime, b: ClockTime): number {
  return toMin(b) - toMin(a);
}

/**
 * Minutes from `a` forward to `b`, treating `b` as being on the next day when
 * it reads earlier than `a`. Use this for durations you know run forwards —
 * a departure to an arrival, say — where `diffMin` would give a negative.
 */
export function forwardMin(a: ClockTime, b: ClockTime): number {
  const d = diffMin(a, b);
  return d < 0 ? d + MINUTES_PER_DAY : d;
}

/** `"05:30"` + 45 -> `"06:15"`. */
export function addMin(t: ClockTime, minutes: number): ClockTime {
  return fromMin(toMin(t) + minutes);
}

/** True when `t` falls in `[open, close]` inclusive. Handles a window that wraps midnight. */
export function withinWindow(t: ClockTime, open: ClockTime, close: ClockTime): boolean {
  const x = toMin(t);
  const o = toMin(open);
  const c = toMin(close);
  return o <= c ? x >= o && x <= c : x >= o || x <= c;
}

/** Minutes as `MM:SS` for a countdown. 48 -> `"48:00"`. */
export function countdown(min: number): string {
  const whole = Math.max(0, Math.floor(min));
  const secs = Math.round((Math.max(0, min) - whole) * 60);
  return `${String(whole).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

/** 630 -> `"10 h 30 m"`. */
export function hoursMinutes(min: number): string {
  const whole = Math.max(0, Math.round(min));
  const h = Math.floor(whole / 60);
  const m = whole % 60;
  if (h === 0) return `${m} m`;
  if (m === 0) return `${h} h`;
  return `${h} h ${m} m`;
}

/** The later of two clock times, by minutes-since-midnight. */
export function laterOf(a: ClockTime, b: ClockTime): ClockTime {
  return toMin(a) >= toMin(b) ? a : b;
}
