/**
 * The few glyphs the dispatcher's KPI tiles use. Inline for the same reason the
 * rail's are: they never change, and the web app has no icon dependency.
 */
const PATHS = {
  orders: (
    <>
      <rect x="4" y="3" width="16" height="18" rx="2" />
      <path d="M8 7h8M8 11h8M8 15h5" />
    </>
  ),
  check: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M8 12l3 3 5-6" />
    </>
  ),
  alert: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v6M12 16v.01" />
    </>
  ),
  truck: (
    <>
      <path d="M3 7h11v9H3z" />
      <path d="M14 10h4l2 3v3h-6" />
      <circle cx="7" cy="18.5" r="1.5" />
      <circle cx="17" cy="18.5" r="1.5" />
    </>
  ),
  route: (
    <>
      <circle cx="6" cy="19" r="2" />
      <circle cx="18" cy="5" r="2" />
      <path d="M8 19h8a4 4 0 0 0 0-8H8a4 4 0 0 1 0-8h8" />
    </>
  ),
  box: (
    <>
      <path d="M12 3l9 5v8l-9 5-9-5V8z" />
      <path d="M3 8l9 5 9-5M12 13v8" />
    </>
  ),
} as const;

export type GlyphKind = keyof typeof PATHS;

export function Glyph({ kind }: { kind: GlyphKind }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="size-5"
      aria-hidden
    >
      {PATHS[kind]}
    </svg>
  );
}
