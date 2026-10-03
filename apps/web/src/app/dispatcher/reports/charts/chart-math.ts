/**
 * The arithmetic behind the report charts, kept apart from the SVG so it can be
 * tested. Everything is plain numbers in, plain numbers or path strings out.
 *
 * Charts are drawn on the server as inline SVG (no chart library), so these
 * helpers are the whole "library".
 */

export interface Point {
  x: number;
  y: number;
}

/** A linear map from a data domain to a pixel range. A zero-width domain maps to the range's start. */
export function scaleLinear(domain: [number, number], range: [number, number]): (value: number) => number {
  const [d0, d1] = domain;
  const [r0, r1] = range;
  if (d1 === d0) return () => r0;
  return (value) => r0 + ((value - d0) / (d1 - d0)) * (r1 - r0);
}

/** Round one step of a scale up to 1, 2, 2.5, 5 or 10 times a power of ten. */
export function niceStep(rough: number): number {
  if (!(rough > 0)) return 1;
  const power = Math.pow(10, Math.floor(Math.log10(rough)));
  const fraction = rough / power;
  const nice = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 2.5 ? 2.5 : fraction <= 5 ? 5 : 10;
  return nice * power;
}

/**
 * Ticks from 0 to a rounded-up maximum, for bar charts (which must start at 0
 * or the bars lie about proportion). `max` of 0 still yields a usable axis.
 */
export function zeroBasedTicks(max: number, count = 4): number[] {
  const step = niceStep(Math.max(max, 1) / count);
  const top = Math.ceil(Math.max(max, 1) / step) * step;
  const ticks: number[] = [];
  for (let value = 0; value <= top + step / 1000; value += step) ticks.push(Math.round(value * 1000) / 1000);
  return ticks;
}

/**
 * The y-range of a percentage line chart. A line may zoom (its meaning is the
 * slope against the target, not the area), but never below 0 or above 100, and
 * always includes the target so the target line is on the plot. Returns the
 * lower bound and ticks every 5, 10 or 20 points depending on the spread.
 */
export function percentDomain(values: readonly number[], target: number | null): { lo: number; hi: number; ticks: number[] } {
  const all = target === null ? [...values] : [...values, target];
  if (all.length === 0) return { lo: 0, hi: 100, ticks: [0, 25, 50, 75, 100] };
  const min = Math.min(...all);
  const spread = 100 - min;
  const step = spread <= 20 ? 5 : spread <= 40 ? 10 : 20;
  const lo = Math.max(0, Math.floor((min - 1) / step) * step);
  const ticks: number[] = [];
  for (let value = lo; value <= 100; value += step) ticks.push(value);
  if (ticks[ticks.length - 1] !== 100) ticks.push(100);
  return { lo, hi: 100, ticks };
}

/** Runs of consecutive non-null points. A missing day breaks the line rather than being drawn as zero. */
export function runsOf(points: readonly (Point | null)[]): Point[][] {
  const runs: Point[][] = [];
  let current: Point[] = [];
  for (const point of points) {
    if (point) current.push(point);
    else if (current.length) {
      runs.push(current);
      current = [];
    }
  }
  if (current.length) runs.push(current);
  return runs;
}

const fixed = (value: number) => (Math.round(value * 100) / 100).toString();

/** SVG path data for the runs: one M…L… subpath each. A single point is a dot, not a line, so it is skipped here. */
export function linePath(runs: readonly Point[][]): string {
  return runs
    .filter((run) => run.length > 1)
    .map((run) => run.map((p, i) => `${i === 0 ? "M" : "L"}${fixed(p.x)} ${fixed(p.y)}`).join(" "))
    .join(" ");
}

/** The same runs closed down to `baseY`, for the soft fill under a line. */
export function areaPath(runs: readonly Point[][], baseY: number): string {
  return runs
    .filter((run) => run.length > 1)
    .map((run) => {
      const first = run[0]!;
      const last = run[run.length - 1]!;
      const top = run.map((p) => `L${fixed(p.x)} ${fixed(p.y)}`).join(" ");
      return `M${fixed(first.x)} ${fixed(baseY)} ${top} L${fixed(last.x)} ${fixed(baseY)} Z`;
    })
    .join(" ");
}

/** X centres for `count` evenly spread points across [left, right]; one point sits in the middle. */
export function spreadX(count: number, left: number, right: number): number[] {
  if (count <= 0) return [];
  if (count === 1) return [(left + right) / 2];
  return Array.from({ length: count }, (_, i) => left + ((right - left) * i) / (count - 1));
}

/** Which of `count` category labels to print so at most `max` appear, always including the first and last. */
export function labelIndexes(count: number, max: number): number[] {
  if (count <= 0) return [];
  if (count <= max) return Array.from({ length: count }, (_, i) => i);
  const stride = Math.ceil((count - 1) / (max - 1));
  const picked: number[] = [];
  for (let i = 0; i < count - 1; i += stride) picked.push(i);
  // Keep the last label only if it does not crowd the one before it.
  const previous = picked[picked.length - 1]!;
  if (count - 1 - previous >= stride / 2) picked.push(count - 1);
  else picked[picked.length - 1] = count - 1;
  return picked;
}

export interface Band {
  /** Left edge of the whole band (the slot a bar sits in). */
  x: number;
  width: number;
  /** Bar position within the band. */
  barX: number;
  barWidth: number;
}

/** Equal bands across [left, right], each holding one bar with `gap` (0–1) of the band left empty. */
export function bands(count: number, left: number, right: number, gap = 0.35): Band[] {
  if (count <= 0) return [];
  const width = (right - left) / count;
  const barWidth = Math.max(1, width * (1 - gap));
  return Array.from({ length: count }, (_, i) => {
    const x = left + width * i;
    return { x, width, barX: x + (width - barWidth) / 2, barWidth };
  });
}

export interface Segment {
  y: number;
  height: number;
}

/** Stack `values` from the baseline up. Negative or missing values take no height. */
export function stackSegments(values: readonly number[], yOf: (value: number) => number): Segment[] {
  let running = 0;
  return values.map((raw) => {
    const value = Number.isFinite(raw) && raw > 0 ? raw : 0;
    const bottom = yOf(running);
    running += value;
    const top = yOf(running);
    return { y: top, height: Math.max(0, bottom - top) };
  });
}

/** 1240 -> "1,240"; keeps one decimal only when there is one worth showing. */
export function compactNumber(value: number): string {
  if (!Number.isFinite(value)) return "—";
  const rounded = Math.round(value * 10) / 10;
  return rounded.toLocaleString("en-GB", { maximumFractionDigits: 1 });
}
