"use client";

import { useEffect, useState } from "react";

type Status = "checking" | "connected" | "offline";

const LABEL: Record<Status, string> = {
  checking: "Checking signal",
  connected: "Connected",
  offline: "Offline",
};

const STYLE: Record<Status, { pill: string; dot: string }> = {
  checking: { pill: "border border-line bg-raised text-muted", dot: "bg-muted animate-pulse" },
  connected: { pill: "border border-emerald-200 bg-emerald-50 text-emerald-800", dot: "bg-emerald-600" },
  offline: { pill: "border border-red-300 bg-red-50 text-critical", dot: "bg-critical" },
};

const CHECK_INTERVAL_MS = 15_000;

export function Connectivity() {
  const [status, setStatus] = useState<Status>("checking");

  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      try {
        const response = await fetch("/driver/health", {
          cache: "no-store",
          credentials: "same-origin",
        });
        if (cancelled) return;
        setStatus(response.ok ? "connected" : "offline");
      } catch {
        if (!cancelled) setStatus("offline");
      }
    };

    void check();
    const timer = setInterval(check, CHECK_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  const style = STYLE[status];
  return (
    <span
      aria-live="polite"
      aria-label={`Signal: ${LABEL[status]}`}
      className={`inline-flex min-h-[32px] items-center gap-1.5 rounded-md px-2 text-xs font-semibold ${style.pill}`}
    >
      <span aria-hidden className={`size-2 rounded-full ${style.dot}`} />
      {LABEL[status]}
    </span>
  );
}
