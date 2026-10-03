"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  INITIAL_CONNECTIVITY,
  LINK_LABEL,
  applyProbe,
  backOnlineNotice,
  offlineNotice,
  probeIntervalMs,
  showBackOnline,
  type ConnectivityState,
  type LinkStatus,
} from "./connectivity-state";

/**
 * One probe loop for the whole driver workspace, shared through context so the
 * header pill, the page banner and every submit button agree.
 *
 * The probe is a real same-origin request to /driver/health (which asks the
 * API), with a timeout, so a phone that shows full bars but cannot reach the
 * server reads Offline. `online`/`offline` events and returning to the tab only
 * trigger a probe sooner; they never decide the answer on their own.
 */
const ConnectivityContext = createContext<ConnectivityState>(INITIAL_CONNECTIVITY);

const PROBE_TIMEOUT_MS = 6_000;

async function probe(): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    const response = await fetch("/driver/health", { cache: "no-store", credentials: "same-origin", signal: controller.signal });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export function ConnectivityProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ConnectivityState>(INITIAL_CONNECTIVITY);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const check = async () => {
      clearTimeout(timer);
      const reachable = await probe();
      if (cancelled) return;
      setState((previous) => applyProbe(previous, reachable, new Date().toISOString()));
      timer = setTimeout(check, probeIntervalMs(reachable ? "connected" : "offline"));
    };

    const soon = () => void check();
    const onVisible = () => {
      if (document.visibilityState === "visible") void check();
    };
    void check();
    window.addEventListener("online", soon);
    window.addEventListener("offline", soon);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      window.removeEventListener("online", soon);
      window.removeEventListener("offline", soon);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  return <ConnectivityContext.Provider value={state}>{children}</ConnectivityContext.Provider>;
}

export function useConnectivity(): ConnectivityState {
  return useContext(ConnectivityContext);
}

const PILL: Record<LinkStatus, { pill: string; dot: string }> = {
  checking: { pill: "bg-white/10 text-white/80", dot: "bg-white/60 animate-pulse" },
  connected: { pill: "bg-good-surface text-good-ink", dot: "bg-good" },
  offline: { pill: "bg-warn-surface text-warn-ink", dot: "bg-warn" },
};

/** The Checking / Connected / Offline pill for the navy header. */
export function ConnectivityPill() {
  const { status } = useConnectivity();
  const style = PILL[status];
  return (
    <span
      role="status"
      aria-label={`Connection: ${LINK_LABEL[status]}`}
      className={`inline-flex min-h-8 items-center gap-1.5 rounded-full px-3 text-xs font-semibold ${style.pill}`}
    >
      <span aria-hidden className={`size-2 rounded-full ${style.dot}`} />
      {LINK_LABEL[status]}
    </span>
  );
}

/**
 * The offline and back-online notices (R-06, R-10), worded for a page that has
 * no offline store: nothing is saved while offline, and nothing is promised
 * when the connection returns.
 */
export function ConnectivityBanner() {
  const state = useConnectivity();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!state.backOnlineAt) return;
    // Re-evaluate once the "Back online" window closes so the notice goes away on its own.
    const id = setInterval(() => setNow(Date.now()), 10_000);
    return () => clearInterval(id);
  }, [state.backOnlineAt]);

  const online = useMemo(() => showBackOnline(state, now), [state, now]);

  if (state.status === "offline") {
    const notice = offlineNotice(state);
    return (
      <div role="alert" className="rounded-card border border-warn/40 bg-warn-surface p-4">
        <p className="font-semibold text-warn-ink">{notice.title}</p>
        <p className="mt-1 text-sm text-ink">{notice.detail}</p>
      </div>
    );
  }
  if (online) {
    const notice = backOnlineNotice(state);
    return (
      <div role="status" className="rounded-card border border-good/30 bg-good-surface p-4">
        <p className="font-semibold text-good-ink">{notice.title}</p>
        <p className="mt-1 text-sm text-ink">{notice.detail}</p>
      </div>
    );
  }
  return null;
}
