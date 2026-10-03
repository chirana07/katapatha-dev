/**
 * The four role glyphs, shared by the landing page's role cards and the
 * role-scoped sign-in. Stroke icons that inherit `currentColor`, so the caller
 * decides whether they sit on navy or on a light card.
 */
export type RoleGlyphKind = "dispatcher" | "loader" | "driver" | "store";

const COMMON = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.75,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
} as const;

export function RoleGlyph({ kind, className = "h-5 w-5" }: { kind: RoleGlyphKind; className?: string }) {
  switch (kind) {
    case "dispatcher":
      return (
        <svg {...COMMON} className={className}>
          <path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z" />
          <circle cx="12" cy="10" r="2.4" />
        </svg>
      );
    case "loader":
      return (
        <svg {...COMMON} className={className}>
          <path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z" />
          <path d="M4 7.5l8 4.5 8-4.5M12 12v9" />
        </svg>
      );
    case "driver":
      return (
        <svg {...COMMON} className={className}>
          <path d="M3 6h11v10H3z" />
          <path d="M14 9.5h4l3 3.5v3h-7" />
          <circle cx="7" cy="17.5" r="1.7" />
          <circle cx="17" cy="17.5" r="1.7" />
        </svg>
      );
    case "store":
      return (
        <svg {...COMMON} className={className}>
          <path d="M3 10l9-6 9 6" />
          <path d="M5 10v10h14V10" />
          <path d="M10 20v-5h4v5" />
        </svg>
      );
  }
}
