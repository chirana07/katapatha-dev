import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { AppState } from "react-native";
import * as Location from "expo-location";
import type { Katapatha } from "@katapatha/api-client/client";
import type { SqlDriver } from "../db/driver";
import { useSession } from "../state/session";
import { useSnapshot } from "../state/useStore";
import { readPositionSharing, writePositionSharing } from "./consent";
import {
  FIX_TIMEOUT_MS,
  PING_INTERVAL_MS,
  fixTakenAt,
  shouldTakeFix,
  withTimeout,
} from "./pings";
import { PositionReporter, type PostResult } from "./reporter";
import {
  deriveStatus,
  type PositionPermission,
  type PositionStatus,
  type StatusDetail,
} from "./status";

/**
 * Opt-in, foreground-only position reporting.
 *
 * What it does: while the driver has turned sharing on, the app is `active`, the
 * driver is signed in and a vehicle is claimed, it takes one fix a minute and
 * sends it to POST /drivers/me/pings. Dispatch and the outlet see the newest as
 * "last reported", with its age.
 *
 * What it never does: background location (no expo-task-manager, no
 * expo-background-fetch, no ACCESS_BACKGROUND_LOCATION), a watch, or anything
 * that runs while the app is not in the foreground. Nothing here is tracking.
 *
 * Pings are best-effort and not part of the durable outbox (see pings.ts).
 *
 * Mount it inside SessionProvider and StoreProvider (it reads the signed-in
 * state and the run snapshot's vehicleId).
 */

export type SetEnabledResult = "ok" | "denied" | "unavailable";

export interface PositionSharing {
  /** The driver's opt-in. Off until they turn it on. */
  enabled: boolean;
  /** Turning on asks for FOREGROUND permission. A refusal leaves sharing off. */
  setEnabled(on: boolean): Promise<SetEnabledResult>;
  permission: PositionPermission;
  /** When the newest confirmed fix was TAKEN (not received); null if none yet. */
  lastReportedAt: Date | null;
  status: PositionStatus;
  /** Fixes taken but not yet confirmed sent. Kept in memory only. */
  pendingCount: number;
  /** Why `waiting`/`offline` is what it is, for the Connection screen's one line. */
  detail: StatusDetail;
}

const PositionContext = createContext<PositionSharing | null>(null);

function toPermission(status: string): PositionPermission {
  return status === "granted" || status === "denied" ? status : "undetermined";
}

export function PositionProvider({
  sql,
  getApi,
  children,
}: {
  sql: SqlDriver;
  /** The API client getter, e.g. `() => getApi(sql)` from src/api/client.ts. */
  getApi: () => Promise<Katapatha>;
  children: ReactNode;
}) {
  const session = useSession();
  const { vehicleId } = useSnapshot();
  const signedIn = session.status === "signed-in";
  const hasVehicle = vehicleId !== null;

  const [enabled, setEnabledState] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [permission, setPermission] = useState<PositionPermission>("undetermined");
  const [appActive, setAppActive] = useState(AppState.currentState === "active");
  const [fixMissing, setFixMissing] = useState(false);

  const [reporter] = useState(() => new PositionReporter({}));
  useEffect(() => {
    reporter.setPost(async (batch): Promise<PostResult> => {
      const client = await getApi();
      const result = await client.POST("/drivers/me/pings", { body: batch });
      const body = result.error as { error?: { code?: string } } | undefined;
      return { status: result.response.status, code: body?.error?.code };
    });
  }, [reporter, getApi]);
  const reported = useSyncExternalStore(reporter.subscribe, reporter.getState);

  // Consent, read once. Off unless the stored value is exactly 'on'.
  useEffect(() => {
    let cancelled = false;
    void readPositionSharing(sql)
      .catch(() => "off" as const)
      .then((value) => {
        if (cancelled) return;
        setEnabledState(value === "on");
        setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [sql]);

  const refreshPermission = useCallback((): Promise<void> => {
    return Location.getForegroundPermissionsAsync().then(
      (result) => setPermission(toPermission(result.status)),
      () => {
        // Leave it as it was; the next foreground tries again.
      },
    );
  }, []);

  useEffect(() => {
    void refreshPermission();
  }, [refreshPermission]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      setAppActive(state === "active");
      if (state === "active") void refreshPermission();
    });
    return () => subscription.remove();
  }, [refreshPermission]);

  const turnOff = useCallback((): Promise<void> => {
    reporter.reset();
    // Persist first, then flip the switch, so a read of either agrees. A failed
    // write cannot turn sharing on, so the switch goes off regardless.
    return writePositionSharing(sql, "off")
      .catch(() => undefined)
      .then(() => setEnabledState(false));
  }, [reporter, sql]);

  // Permission taken away in the phone's settings while sharing was on: it is no
  // longer sharing, so the switch must not say it is.
  useEffect(() => {
    if (loaded && enabled && permission === "denied") void turnOff();
  }, [loaded, enabled, permission, turnOff]);

  // Consent belongs to the driver who gave it. Another driver signing in on this
  // phone starts with sharing off.
  useEffect(() => {
    if (loaded && session.status === "signed-out") void turnOff();
  }, [loaded, session.status, turnOff]);

  // A fix and its pending siblings belong to the vehicle that was claimed when
  // they were taken; the server files a ping against the CURRENT vehicle.
  const lastVehicle = useRef<string | null>(vehicleId);
  useEffect(() => {
    if (lastVehicle.current !== vehicleId) {
      lastVehicle.current = vehicleId;
      reporter.reset();
    }
  }, [vehicleId, reporter]);

  const lastFixAtMs = useRef<number | null>(null);
  const permissionGranted = permission === "granted";
  const running = loaded && enabled && permissionGranted && appActive && signedIn && hasVehicle;

  useEffect(() => {
    if (!running) return;
    let live = true;
    let busy = false;
    lastFixAtMs.current = null;

    const tick = async (): Promise<void> => {
      if (busy) return;
      busy = true;
      try {
        if (shouldTakeFix(lastFixAtMs.current, Date.now())) {
          const location = await withTimeout(
            Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
            FIX_TIMEOUT_MS,
          );
          if (!live) return;
          const nowMs = Date.now();
          const recorded =
            location !== null &&
            reporter.record({
              latitude: location.coords.latitude,
              longitude: location.coords.longitude,
              accuracy: location.coords.accuracy,
              takenAtMs: fixTakenAt(location.timestamp, nowMs),
            });
          if (recorded) lastFixAtMs.current = nowMs;
          setFixMissing(!recorded);
        }
        if (live) await reporter.flush();
      } finally {
        busy = false;
      }
    };

    // Now (this also flushes whatever waited while the app was in the
    // background), then once a minute for as long as the app stays active.
    void tick();
    const timer = setInterval(() => void tick(), PING_INTERVAL_MS);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [running, reporter]);

  const setEnabled = useCallback(
    async (on: boolean): Promise<SetEnabledResult> => {
      if (!on) {
        await turnOff();
        return "ok";
      }
      try {
        const result = await Location.requestForegroundPermissionsAsync();
        setPermission(toPermission(result.status));
        if (!result.granted) {
          await turnOff();
          return "denied";
        }
        if (!(await Location.hasServicesEnabledAsync())) return "unavailable";
        await writePositionSharing(sql, "on");
        reporter.resume();
        setFixMissing(false);
        setEnabledState(true);
        return "ok";
      } catch {
        return "unavailable";
      }
    },
    [reporter, sql, turnOff],
  );

  const { status, detail } = deriveStatus({
    enabled,
    permission,
    hasVehicle,
    problem: reported.problem,
    hasReported: reported.lastReportedAt !== null,
    fixMissing,
  });

  const value = useMemo<PositionSharing>(
    () => ({
      enabled,
      setEnabled,
      permission,
      lastReportedAt: reported.lastReportedAt,
      status,
      pendingCount: reported.pendingCount,
      detail,
    }),
    [enabled, setEnabled, permission, reported.lastReportedAt, reported.pendingCount, status, detail],
  );

  return <PositionContext.Provider value={value}>{children}</PositionContext.Provider>;
}

export function usePositionSharing(): PositionSharing {
  const context = useContext(PositionContext);
  if (!context) {
    throw new Error(
      "usePositionSharing must be used inside PositionProvider (see src/app/_layout.tsx).",
    );
  }
  return context;
}
