// Must stay the first import: it installs globalThis.crypto.getRandomValues,
// which @katapatha/core/offline/ulid needs and neither react-native@0.87 nor
// expo@57 provides. Every StopEvent id comes from ulid().
import "@/platform/install-crypto";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { Stack } from "expo-router";
import { color, space } from "@katapatha/tokens/tokens";

import type { SqlDriver } from "@/db/driver";
import { openDeviceSqlite } from "@/db/sqlite";
import { migrate } from "@/db/migrations";
import { getApi, isMockBaseUrl, resolveBaseUrl } from "@/api/client";
import { deviceId } from "@/platform/device";
import { log } from "@/platform/log";
import { createRunStore } from "@/state/store";
import { StoreProvider } from "@/state/useStore";
import { SessionProvider } from "@/state/session";
import { ConnectivityProvider } from "@/state/connectivity";
import { createDrain } from "@/outbox/drain";
import { createTransport } from "@/outbox/transport";
import { bootstrap } from "@/sync/bootstrap";
import { pullSince, readServerSeq } from "@/sync/pull";

/**
 * Opens the database, migrates it, and wires the providers.
 *
 * Order matters: SQLite must be open before the store, the session or the
 * connectivity poll, because all three read from it -- the session's base URL
 * override, the store's run, the poll's client. So the tree is held behind a
 * loading state rather than rendered against a half-ready app.
 */
export default function RootLayout() {
  const [sql, setSql] = useState<SqlDriver | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const driver = await openDeviceSqlite();
        await migrate(driver);
        if (!cancelled) setSql(driver);
      } catch (error) {
        log.error("Could not open the device database", {
          message: error instanceof Error ? error.message : String(error),
        });
        if (!cancelled) {
          setFailure(
            "This phone's storage could not be opened, so nothing can be recorded offline. Reinstall the app or contact the depot.",
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (failure) return <Fatal message={failure} />;
  if (!sql) return <Booting />;

  return <App sql={sql} />;
}

function App({ sql }: { sql: SqlDriver }) {
  const store = useMemo(() => createRunStore({ sql }), [sql]);

  // A ref so the connectivity provider can trigger a drain without the drain
  // being rebuilt on every render.
  const drainRef = useRef<((options?: { immediate?: boolean }) => Promise<void>) | null>(null);

  const refreshRun = useCallback(async () => {
    const result = await bootstrap(sql, store.getDate());
    if (result.kind === "ok") {
      const seq = await readServerSeq(sql);
      if (seq > 0) await pullSince(sql, seq);
    }
    await store.refresh();
  }, [sql, store]);

  const drain = useMemo(() => {
    const transport = createTransport({
      client: () => getApi(sql),
      deviceId: () => deviceId(sql),
      // Resolved per send, so switching the base URL mid-demo is picked up.
      isMock: async () => isMockBaseUrl(await resolveBaseUrl(sql)),
    });
    return createDrain({
      sql,
      transport,
      // After a settle, re-read the server's run so the screens snap to its
      // truth rather than arguing with it.
      onSettled: async () => {
        await refreshRun();
      },
    });
  }, [sql, refreshRun]);

  const runDrain = useCallback(
    async (options?: { immediate?: boolean }) => {
      await drain.drainAll({ immediate: options?.immediate });
      await store.refresh();
    },
    [drain, store],
  );
  useEffect(() => {
    drainRef.current = runDrain;
  }, [runDrain]);

  // First read is from the cache, so the run is on screen before any request.
  useEffect(() => {
    void store.refresh();
  }, [store]);

  const storeValue = useMemo(
    () => ({ store, sql, drain: runDrain, bootstrap: refreshRun }),
    [store, sql, runDrain, refreshRun],
  );

  return (
    <SessionProvider sql={sql}>
      <StoreProvider value={storeValue}>
        <ConnectivityProvider
          sql={sql}
          // immediate, because the backoff was set by a failure that regaining
          // signal has just made obsolete.
          onReconnect={() => void drainRef.current?.({ immediate: true })}
        >
          <Stack
            screenOptions={{
              headerStyle: { backgroundColor: color.navy },
              headerTintColor: color.surface,
              headerTitleStyle: { fontWeight: "700" },
              contentStyle: { backgroundColor: color.canvas },
            }}
          />
        </ConnectivityProvider>
      </StoreProvider>
    </SessionProvider>
  );
}

function Booting() {
  return (
    <View
      style={{
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: color.canvas,
        gap: space.sm,
      }}
    >
      <ActivityIndicator color={color.navy} />
      <Text style={{ color: color.muted }}>Opening this phone&apos;s records…</Text>
    </View>
  );
}

function Fatal({ message }: { message: string }) {
  return (
    <View
      style={{
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: color.canvas,
        padding: space.md,
        gap: space.xs,
      }}
    >
      <Text style={{ fontSize: 18, fontWeight: "700", color: color.ink }}>
        Katapatha cannot start
      </Text>
      <Text style={{ color: color.muted, textAlign: "center" }}>{message}</Text>
    </View>
  );
}
