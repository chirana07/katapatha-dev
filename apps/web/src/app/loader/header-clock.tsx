"use client";

import { useEffect, useState } from "react";

/**
 * Live-ticking clock + the day's date, matching the Figma dock header.
 * Hydrates on the client so the server render never flashes a stale timestamp.
 */
export function HeaderClock() {
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    const tick = () => setNow(new Date());
    tick();
    const handle = setInterval(tick, 15_000);
    return () => clearInterval(handle);
  }, []);

  if (!now) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted">
        <span aria-hidden className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-line text-ink">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden>
            <circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" />
          </svg>
        </span>
        <span className="tabular font-semibold text-ink">--:--</span>
      </div>
    );
  }

  const date = now.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
  const time = now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false });

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="inline-flex min-h-10 items-center gap-2 rounded-[var(--radius-control)] border border-line bg-surface px-3 text-sm font-semibold text-ink">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 text-muted" aria-hidden>
          <rect x="3" y="4" width="18" height="17" rx="2" /><path d="M8 2v4M16 2v4M3 10h18" />
        </svg>
        {date}
      </span>
      <span className="inline-flex min-h-10 items-center gap-2 rounded-[var(--radius-control)] border border-line bg-surface px-3 text-sm font-semibold text-ink">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 text-muted" aria-hidden>
          <circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" />
        </svg>
        <span className="tabular">{time}</span>
        <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
        <span className="text-xs font-semibold text-emerald-700">On time</span>
      </span>
    </div>
  );
}
