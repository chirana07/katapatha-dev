import type { components } from "@katapatha/contracts/types";
import { BrandPill, StatusPill } from "@/components/ui/status-pill";
import { storeStateLabel, storeStateTone } from "./order-state";
import { weatherCaption } from "./today-view";

type Weather = components["schemas"]["Weather"];
type Brand = components["schemas"]["Brand"];

/** The order's state as the store manager sees it, always with its word. */
export function OrderStatePill({ state }: { state: string }) {
  return <StatusPill label={storeStateLabel(state)} tone={storeStateTone(state)} />;
}

/**
 * "OUT074 · Fresh Puttalam  [Fresh]  [Receiving 05:30–08:00]" — the line under the
 * page title on the screens that already know the outlet's day.
 */
export function OutletLine({
  outletId,
  name,
  brand,
  window,
}: {
  outletId: string;
  name: string;
  brand?: Brand | null;
  window?: { open: string; close: string } | null;
}) {
  return (
    <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted">
      <span className="font-semibold text-ink">{outletId} · {name}</span>
      {brand ? <BrandPill brand={brand} /> : null}
      {window ? (
        <span className="tabular inline-flex items-center gap-1.5 rounded-control border border-line bg-surface px-2 py-0.5 text-xs font-semibold text-ink">
          <StoreIcon kind="clock" className="size-3.5" />
          Receiving {window.open}–{window.close}
        </span>
      ) : null}
    </div>
  );
}

/**
 * The weather chip. Weather is context, not an operational figure, so it is
 * small and says plainly when it is the calendar's seasonal note rather than a
 * reading — see `weatherCaption`.
 */
export function WeatherChip({ weather }: { weather: Weather }) {
  const { headline, note } = weatherCaption(weather);
  return (
    <div className="flex items-center gap-3 rounded-card border border-line bg-surface px-3 py-2">
      <WeatherGlyph kind={weather.kind} />
      <div className="min-w-0 text-sm">
        <p className="truncate text-xs text-muted">{weather.place}</p>
        <p className="tabular font-bold text-ink">{headline}</p>
        <p className="text-xs text-muted">{note}</p>
      </div>
    </div>
  );
}

function WeatherGlyph({ kind }: { kind: Weather["kind"] }) {
  const common = {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.75,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    className: "size-7 shrink-0 text-muted",
    "aria-hidden": true,
  };
  if (kind === "clear")
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="4" />
        <path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6 7 7M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4" />
      </svg>
    );
  if (kind === "rain" || kind === "storm")
    return (
      <svg {...common}>
        <path d="M7 15a4 4 0 0 1 .5-8 5 5 0 0 1 9.6 1.5A3.3 3.3 0 0 1 17 15" />
        <path d="M9 18l-1 2M13 18l-1 2M17 18l-1 2" />
      </svg>
    );
  if (kind === "fog")
    return (
      <svg {...common}>
        <path d="M7 12a4 4 0 0 1 .5-6 5 5 0 0 1 9.6 1.5A3.3 3.3 0 0 1 17 12" />
        <path d="M4 16h16M6 20h12" />
      </svg>
    );
  return (
    <svg {...common}>
      <path d="M7 18a4 4 0 0 1 .5-8 5 5 0 0 1 9.6 1.5A3.3 3.3 0 0 1 17 18z" />
    </svg>
  );
}

export type StoreIconKind = "truck" | "check" | "clock" | "alert" | "plus" | "chevron" | "bell";

/** Inline icons for the KPI tiles and actions; `currentColor` so the parent tints them. */
export function StoreIcon({ kind, className = "size-5" }: { kind: StoreIconKind; className?: string }) {
  const body = {
    truck: (
      <>
        <path d="M3 7h11v9H3z" />
        <path d="M14 10h4l2 3v3h-6" />
        <circle cx="7" cy="18.5" r="1.5" />
        <circle cx="17" cy="18.5" r="1.5" />
      </>
    ),
    check: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M8 12l3 3 5-6" />
      </>
    ),
    clock: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </>
    ),
    alert: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v6M12 16v.01" />
      </>
    ),
    plus: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 8v8M8 12h8" />
      </>
    ),
    chevron: <path d="M9 6l6 6-6 6" />,
    bell: (
      <>
        <path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z" />
        <path d="M10 20a2 2 0 0 0 4 0" />
      </>
    ),
  }[kind];
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      {body}
    </svg>
  );
}
