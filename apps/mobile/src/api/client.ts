import * as SecureStore from "expo-secure-store";
import Constants from "expo-constants";
import { createKatapathaClient, type Katapatha } from "@katapatha/api-client/client";
import type { SqlDriver } from "../db/driver";

const TOKEN_KEY = "katapatha.session";
const BASE_URL_OVERRIDE_KEY = "base_url_override";
const FALLBACK_BASE_URL = "http://localhost:4010";

export async function saveToken(token: string): Promise<void> {
  await SecureStore.setItemAsync(TOKEN_KEY, token);
}

export async function clearToken(): Promise<void> {
  await SecureStore.deleteItemAsync(TOKEN_KEY);
}

export async function getToken(): Promise<string | undefined> {
  return (await SecureStore.getItemAsync(TOKEN_KEY)) ?? undefined;
}

export async function hasToken(): Promise<boolean> {
  return (await getToken()) !== undefined;
}

/**
 * The base URL, with the runtime override taking precedence.
 *
 * Constants.expoConfig is baked at build time, but the base URL sometimes has to
 * change on a handset in someone's hand -- a demo moving from the mock to the real
 * API, or onto a LAN address because `localhost` on a phone is the phone. So the
 * Connection screen writes meta.base_url_override and that wins here.
 *
 * This is why the module exports an async getApi() rather than the eagerly
 * constructed `api` it used to: reading SQLite cannot happen at module scope.
 * Nothing imported the old export, so the change cost nothing.
 */
export async function resolveBaseUrl(sql?: SqlDriver): Promise<string> {
  if (sql) {
    const row = await sql.first<{ value: string }>(
      "SELECT value FROM meta WHERE key = ?",
      [BASE_URL_OVERRIDE_KEY],
    );
    if (row?.value) return row.value;
  }
  return (
    (Constants.expoConfig?.extra?.apiBaseUrl as string | undefined) ??
    FALLBACK_BASE_URL
  );
}

export async function setBaseUrlOverride(
  sql: SqlDriver,
  baseUrl: string | null,
): Promise<void> {
  if (baseUrl === null) {
    await sql.run("DELETE FROM meta WHERE key = ?", [BASE_URL_OVERRIDE_KEY]);
  } else {
    await sql.run(
      `INSERT INTO meta (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      [BASE_URL_OVERRIDE_KEY, baseUrl.trim()],
    );
  }
  resetApi();
}

/**
 * True when pointed at the Prism mock.
 *
 * The transport needs to know, because the mock returns a static example whatever
 * it is sent and the app would otherwise never settle a row. Keyed on the port
 * rather than the hostname so a LAN address during a demo still counts.
 */
export function isMockBaseUrl(baseUrl: string): boolean {
  return baseUrl.includes(":4010");
}

let cached: { baseUrl: string; client: Katapatha } | null = null;

/**
 * The API client.
 *
 * Memoised per base URL, so changing the override rebuilds it rather than
 * leaving requests going to the old host.
 *
 * The device authenticates with a BEARER token, not a cookie. It is the same
 * opaque token the web app keeps in its httpOnly cookie and the same session row
 * -- the API accepts either transport, so supporting the device needed no schema
 * change. The 30-day non-rotating session is deliberate: a driver must stay
 * signed in across a stretch with no coverage, which is what the outbox depends
 * on.
 */
export async function getApi(sql?: SqlDriver): Promise<Katapatha> {
  const baseUrl = await resolveBaseUrl(sql);
  if (cached && cached.baseUrl === baseUrl) return cached.client;

  const client = createKatapathaClient({ baseUrl, getToken });
  cached = { baseUrl, client };
  return client;
}

/** Drops the memoised client, so the next getApi() rebuilds it. */
export function resetApi(): void {
  cached = null;
}
