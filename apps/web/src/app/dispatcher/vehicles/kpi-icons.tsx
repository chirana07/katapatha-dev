import type { ReactNode } from "react";

/** The four KPI glyphs. Inline for the same reason the rail's are: a dozen strokes are not worth a package. */
function Glyph({ children }: { children: ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="size-5" aria-hidden>
      {children}
    </svg>
  );
}

export const TruckIcon = () => (
  <Glyph>
    <path d="M3 7h13v10H3z" />
    <path d="M16 10h3l2 3v4h-5" />
    <circle cx="7" cy="19" r="1.5" />
    <circle cx="18" cy="19" r="1.5" />
  </Glyph>
);

export const CheckIcon = () => (
  <Glyph>
    <path d="m5 12 5 5 9-10" />
  </Glyph>
);

export const RouteIcon = () => (
  <Glyph>
    <circle cx="6" cy="19" r="2" />
    <circle cx="18" cy="5" r="2" />
    <path d="M8 19h6a3 3 0 0 0 0-6h-4a3 3 0 0 1 0-6h6" />
  </Glyph>
);

export const WrenchIcon = () => (
  <Glyph>
    <path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.4-.6-.6-2.4z" />
  </Glyph>
);
