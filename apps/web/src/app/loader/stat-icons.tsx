/** The four glyphs the dock and progress KPI cards use. Decorative: StatCard
 *  hides its icon slot from assistive tech, the number and label carry it. */
const common = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.75,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  className: "size-5",
};

export function TruckIcon() {
  return (
    <svg {...common}>
      <path d="M3 7h11v9H3z" />
      <path d="M14 10h4l2 3v3h-6" />
      <circle cx="7" cy="18.5" r="1.5" />
      <circle cx="17" cy="18.5" r="1.5" />
    </svg>
  );
}

export function CheckIcon() {
  return (
    <svg {...common}>
      <circle cx="12" cy="12" r="9" />
      <path d="M8 12l3 3 5-6" />
    </svg>
  );
}

export function BoxIcon() {
  return (
    <svg {...common}>
      <path d="M12 3l9 5v8l-9 5-9-5V8z" />
      <path d="M3 8l9 5 9-5M12 13v8" />
    </svg>
  );
}

export function ClockIcon() {
  return (
    <svg {...common}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}

export function AlertIcon() {
  return (
    <svg {...common}>
      <path d="M12 3l10 17H2z" />
      <path d="M12 10v4M12 17h.01" />
    </svg>
  );
}

export function ThermometerIcon() {
  return (
    <svg {...common}>
      <path d="M14 14.8V5a2 2 0 0 0-4 0v9.8a4 4 0 1 0 4 0z" />
    </svg>
  );
}
