import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { AppState } from "react-native";
import type { SqlDriver } from "../db/driver";
import { pingHealth } from "../api/health";

/**
 * Observed reachability.
 *
 * The label is a three-member union, so a fourth wording is a compile error.
 * docs/DESIGN.md restricts the connectivity label to exactly these three, and it
 * must reflect VERIFIED reachability against /health -- which the contract calls
 * "the connectivity authority". A radio being associated with a network says
 * nothing about whether Katapatha can be reached, which is why
 * @react-native-community/netinfo is not a dependency.
 */
export type ConnectivityLabel = "Checking" | "Connected" | "Offline";

const POLL_MS = 15_000;

type ConnectivityContextValue = {
  label: ConnectivityLabel;
  /** Forces a check now; returns the resulting label. */
  check: () => Promise<ConnectivityLabel>;
  /**
   * When the last successful /health check of this session completed, or null
   * if none has. The phone's clock, read when the response arrived: it says when
   * this phone last had verified contact with the server, not when anything was
   * received by anyone else.
   */
  lastConnectedAt: Date | null;
  /**
   * Since when verified contact has been missing: `lastConnectedAt` while the
   * label is Offline, null otherwise. Set when the label goes Offline and held
   * until it is Connected again, so it does not creep forward on every failed
   * poll. If the app was LAUNCHED offline and has never connected, there is no
   * last contact to point to; it is then the provider's mount time -- "no signal
   * since" is true from the moment this session began looking, and no earlier
   * claim is available.
   */
  offlineSince: Date | null;
};

const ConnectivityContext = createContext<ConnectivityContextValue | null>(null);

export function ConnectivityProvider({
  sql,
  onReconnect,
  children,
}: {
  sql: SqlDriver;
  /**
   * Called on the Offline -> Connected edge. The drain passed here should use
   * `immediate`: a backoff set by a failed send is obsolete the moment signal
   * returns.
   */
  onReconnect?: () => void;
  children: ReactNode;
}) {
  const [label, setLabel] = useState<ConnectivityLabel>("Checking");
  const [lastConnectedAt, setLastConnectedAt] = useState<Date | null>(null);
  const [offlineSince, setOfflineSince] = useState<Date | null>(null);
  const previous = useRef<ConnectivityLabel>("Checking");
  // Kept in state AND mirrored in refs: state is what renders, refs are what the
  // poll's closure reads (it must not be rebuilt as state changes).
  const lastConnected = useRef<Date | null>(null);
  const offlineFrom = useRef<Date | null>(null);
  const mountedAt = useRef(new Date());
  // Held in a ref and synced in an effect, so the poll below can call the latest
  // callback without the 15s interval being torn down and restarted whenever the
  // parent re-renders with a new closure.
  const reconnect = useRef(onReconnect);
  useEffect(() => {
    reconnect.current = onReconnect;
  }, [onReconnect]);

  // The one place a /health result becomes state, shared by the poll and the
  // manual check so they cannot disagree about the edge.
  const apply = useCallback((ok: boolean): ConnectivityLabel => {
    const next: ConnectivityLabel = ok ? "Connected" : "Offline";

    if (ok) {
      const now = new Date();
      lastConnected.current = now;
      offlineFrom.current = null;
      setLastConnectedAt(now);
      setOfflineSince(null);
    } else if (offlineFrom.current === null) {
      // First failure since contact (or since launch): fix the moment once.
      offlineFrom.current = lastConnected.current ?? mountedAt.current;
      setOfflineSince(offlineFrom.current);
    }

    // Only the Offline -> Connected transition drains. Firing on every
    // Connected poll would start a drain every 15 seconds all shift.
    if (next === "Connected" && previous.current === "Offline") {
      reconnect.current?.();
    }
    previous.current = next;
    setLabel(next);
    return next;
  }, []);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;

    const check = async (): Promise<void> => {
      const ok = await pingHealth(sql);
      if (cancelled) return;
      apply(ok);
    };

    const start = (): void => {
      void check();
      timer ??= setInterval(() => void check(), POLL_MS);
    };

    const stop = (): void => {
      if (timer) clearInterval(timer);
      timer = null;
    };

    start();

    // Polling a backgrounded app would burn battery for a screen nobody is
    // looking at, and this app makes no background promises anyway.
    const subscription = AppState.addEventListener("change", (status) => {
      if (status === "active") start();
      else stop();
    });

    return () => {
      cancelled = true;
      stop();
      subscription.remove();
    };
  }, [sql, apply]);

  const value = useMemo<ConnectivityContextValue>(
    () => ({
      label,
      lastConnectedAt,
      offlineSince,
      check: async () => apply(await pingHealth(sql)),
    }),
    [label, lastConnectedAt, offlineSince, sql, apply],
  );

  return (
    <ConnectivityContext.Provider value={value}>{children}</ConnectivityContext.Provider>
  );
}

export function useConnectivity(): ConnectivityContextValue {
  const context = useContext(ConnectivityContext);
  if (!context) {
    throw new Error(
      "useConnectivity must be used inside ConnectivityProvider (see src/app/_layout.tsx).",
    );
  }
  return context;
}
