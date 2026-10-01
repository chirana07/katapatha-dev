import { getApi } from "./client";
import type { SqlDriver } from "../db/driver";

/**
 * Reachability, as the contract defines it.
 *
 * GET /health is described in the spec as "the connectivity authority":
 * navigator.onLine, and its React Native equivalents, report whether a radio is
 * associated with a network -- not whether Katapatha can be reached. A phone on
 * depot wifi with no route to the server is "online" by that measure and useless
 * by this one. DESIGN.md requires the connectivity label to reflect verified
 * reachability, which is why @react-native-community/netinfo is deliberately not
 * a dependency.
 *
 * The timeout matters: without it a request on a stalled connection can hang for
 * a minute, and the badge would read Checking the whole time.
 */
const TIMEOUT_MS = 4_000;

export async function pingHealth(sql?: SqlDriver): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const client = await getApi(sql);
    const result = await client.GET("/health", { signal: controller.signal });
    return result.response.ok;
  } catch {
    // A throw here is an abort, a DNS failure or no route. All mean Offline.
    return false;
  } finally {
    clearTimeout(timer);
  }
}
