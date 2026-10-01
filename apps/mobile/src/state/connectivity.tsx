import {
  createContext,
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
  const previous = useRef<ConnectivityLabel>("Checking");
  // Held in a ref and synced in an effect, so the poll below can call the latest
  // callback without the 15s interval being torn down and restarted whenever the
  // parent re-renders with a new closure.
  const reconnect = useRef(onReconnect);
  useEffect(() => {
    reconnect.current = onReconnect;
  }, [onReconnect]);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;

    const check = async (): Promise<void> => {
      const ok = await pingHealth(sql);
      if (cancelled) return;

      const next: ConnectivityLabel = ok ? "Connected" : "Offline";
      // Only the Offline -> Connected transition drains. Firing on every
      // Connected poll would start a drain every 15 seconds all shift.
      if (next === "Connected" && previous.current === "Offline") {
        reconnect.current?.();
      }
      previous.current = next;
      setLabel(next);
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
  }, [sql]);

  const value = useMemo<ConnectivityContextValue>(
    () => ({
      label,
      check: async () => {
        const ok = await pingHealth(sql);
        const next: ConnectivityLabel = ok ? "Connected" : "Offline";
        if (next === "Connected" && previous.current === "Offline") {
          reconnect.current?.();
        }
        previous.current = next;
        setLabel(next);
        return next;
      },
    }),
    [label, sql],
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
