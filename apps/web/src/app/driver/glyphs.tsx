/**
 * The few icons the driver screens use. Stroke icons on currentColor; decorative
 * unless a caller labels the surrounding control.
 */
const BASE = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
} as const;

export function CheckGlyph({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg {...BASE} className={className}>
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </svg>
  );
}

export function ClockGlyph({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg {...BASE} className={className}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}

export function PinGlyph({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg {...BASE} className={className}>
      <path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z" />
      <circle cx="12" cy="10" r="2.2" />
    </svg>
  );
}

export function ClipboardGlyph({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg {...BASE} className={className}>
      <rect x="6" y="4.5" width="12" height="16" rx="2" />
      <path d="M9.5 4.5h5v2h-5zM9 11h6M9 15h4" />
    </svg>
  );
}

export function WarningGlyph({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg {...BASE} className={className}>
      <path d="M12 4l9 16H3z" />
      <path d="M12 10v4M12 17.2v.1" />
    </svg>
  );
}

export function PlusGlyph({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg {...BASE} className={className}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}
