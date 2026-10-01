import {
  createContext,
  useContext,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import type { SqlDriver } from "../db/driver";
import type { ProjectedStop, RunSnapshot, RunStore } from "./store";
import { snapshotProgress } from "./store";
import type { OutboxCounts } from "../outbox/repo";

/**
 * React's view of the store.
 *
 * useSyncExternalStore rather than useState, so the run list and the stop detail
 * render from ONE snapshot. With per-screen state the two could disagree about
 * the same stop after a drain, which on a delivery screen would be a lie about
 * whether work had been recorded.
 */

type StoreContextValue = {
  store: RunStore;
  sql: SqlDriver;
  drain: (options?: { immediate?: boolean }) => Promise<void>;
  bootstrap: () => Promise<void>;
};

const StoreContext = createContext<StoreContextValue | null>(null);

export function StoreProvider({
  value,
  children,
}: {
  value: StoreContextValue;
  children: ReactNode;
}) {
  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

function useStoreContext(): StoreContextValue {
  const context = useContext(StoreContext);
  if (!context) {
    throw new Error("useStore must be used inside StoreProvider (see src/app/_layout.tsx).");
  }
  return context;
}

export function useRunActions(): Omit<StoreContextValue, "store" | "sql"> & {
  store: RunStore;
  sql: SqlDriver;
} {
  return useStoreContext();
}

export function useSnapshot(): RunSnapshot {
  const { store } = useStoreContext();
  return useSyncExternalStore(store.subscribe, store.getSnapshot);
}

export function useRun(): {
  snapshot: RunSnapshot;
  progress: ReturnType<typeof snapshotProgress>;
} {
  const snapshot = useSnapshot();
  // snapshotProgress is pure over the snapshot, and the snapshot is replaced
  // wholesale on every refresh, so identity is a sufficient dependency.
  const progress = useMemo(() => snapshotProgress(snapshot), [snapshot]);
  return { snapshot, progress };
}

export function useStop(stopId: string): ProjectedStop | null {
  const snapshot = useSnapshot();
  return useMemo(
    () => snapshot.stops.find((stop) => stop.id === stopId) ?? null,
    [snapshot, stopId],
  );
}

export function useOutboxCounts(): OutboxCounts {
  return useSnapshot().outbox;
}
