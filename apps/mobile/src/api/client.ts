import * as SecureStore from "expo-secure-store";
import Constants from "expo-constants";
import { createKatapathaClient } from "@katapatha/api-client/client";

const TOKEN_KEY = "katapatha.session";

export async function saveToken(token: string) {
  await SecureStore.setItemAsync(TOKEN_KEY, token);
}
export async function clearToken() {
  await SecureStore.deleteItemAsync(TOKEN_KEY);
}

/**
 * The mobile client authenticates with a BEARER token, not a cookie.
 *
 * It is the same opaque token the web app keeps in its httpOnly cookie, and the
 * same session row — the API accepts either transport, so supporting the device
 * needed no schema change. The 30-day non-rotating session is deliberate: a
 * driver must stay signed in across a stretch with no coverage, which is also
 * what the offline outbox depends on.
 */
export const api = createKatapathaClient({
  baseUrl:
    (Constants.expoConfig?.extra?.apiBaseUrl as string | undefined) ??
    "http://localhost:3001/v1",
  getToken: () => SecureStore.getItemAsync(TOKEN_KEY).then((v) => v ?? undefined),
});
