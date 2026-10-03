"use client";

import { useEffect, useState } from "react";

/**
 * The dock clock: the time in Colombo, ticking, beside the date picker.
 *
 * It renders a placeholder until it mounts so the server never ships a stale
 * minute that hydration then contradicts. The old version also showed a green
 * "On time" lamp that nothing computed; a clock that vouches for the dock's
 * punctuality without a basis is worse than none, so it is gone.
 */
export function HeaderClock() {
  const [time, setTime] = useState<string | null>(null);

  useEffect(() => {
    const format = () =>
      new Intl.DateTimeFormat("en-GB", {
        timeZone: "Asia/Colombo",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      }).format(new Date());
    const tick = () => setTime(format());
    tick();
    const handle = setInterval(tick, 15_000);
    return () => clearInterval(handle);
  }, []);

  return (
    <span className="inline-flex min-h-11 items-center gap-2 rounded-control border border-line bg-surface px-3 text-sm font-semibold text-ink">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="size-4 text-muted" aria-hidden>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </svg>
      <span className="sr-only">Time in Colombo</span>
      <span className="tabular">{time ?? "--:--"}</span>
    </span>
  );
}
