/**
 * Fitting a phone photo into one proof-of-delivery page.
 *
 * The API takes up to 8 pages per delivery, each a data URL of at most
 * 1,048,576 characters. A phone camera photo is several megabytes, so the
 * browser re-encodes it: scale the long edge down and lower the JPEG quality
 * until the data URL fits, trying gentler settings first so a receipt stays
 * readable. The maths is pure so it is testable; the canvas work is in
 * `pod-pages.ts`.
 */
export const MAX_POD_PAGES = 8;

/** The API's hard limit on one page's data URL, in characters. */
export const API_PAGE_LIMIT_CHARS = 1_048_576;

/** What we aim for: under the limit with a margin, so a header-length quirk never tips it over. */
export const TARGET_PAGE_CHARS = 1_000_000;

export interface FitStep {
  /** Longest edge in pixels. */
  maxEdge: number;
  /** JPEG quality, 0 to 1. */
  quality: number;
}

/** Gentlest first. A receipt is text, so dimensions are kept as long as possible. */
export const FIT_STEPS: readonly FitStep[] = [
  { maxEdge: 2000, quality: 0.85 },
  { maxEdge: 1600, quality: 0.78 },
  { maxEdge: 1400, quality: 0.7 },
  { maxEdge: 1200, quality: 0.62 },
  { maxEdge: 1000, quality: 0.55 },
  { maxEdge: 800, quality: 0.5 },
];

/** Scale to fit the long edge within `maxEdge`; never enlarge. */
export function fitWithin(width: number, height: number, maxEdge: number): { width: number; height: number } {
  if (!(width > 0) || !(height > 0)) return { width: 0, height: 0 };
  const longest = Math.max(width, height);
  if (longest <= maxEdge) return { width: Math.round(width), height: Math.round(height) };
  const scale = maxEdge / longest;
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

export function fitsPage(dataUrl: string): boolean {
  return dataUrl.length <= TARGET_PAGE_CHARS;
}

/** "3.4 MB", "820 KB" for a byte count, for the "reduced to fit" note. */
export function byteLabel(bytes: number): string {
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1000))} KB`;
}

export function canAddPage(pageCount: number): boolean {
  return pageCount < MAX_POD_PAGES;
}
