import { getRandomValues } from "expo-crypto";

/**
 * Installs globalThis.crypto.getRandomValues.
 *
 * @katapatha/core/offline/ulid calls globalThis.crypto.getRandomValues, and
 * neither react-native@0.87 nor expo@57 provides it: Expo's "winter" runtime
 * installs FormData, TextDecoder, AbortSignal, DOMException, URL and fetch, and
 * stops there. Grepping both packages for getRandomValues returns nothing.
 *
 * So without this, ulid() throws on the first call, and every StopEvent the
 * driver records is minted by ulid() -- the outbox cannot queue a single row.
 * It runs fine under Node and in a browser, which is why the test suite and the
 * web app never noticed.
 *
 * This has to run before any module that mints an id, so src/app/_layout.tsx
 * imports it as its first statement. Patching the global rather than forking
 * ulid.ts keeps one ULID implementation in the monorepo: the id is the server's
 * primary key, and two generators is two chances to break idempotency.
 */
export function installCrypto(): void {
  const existing = globalThis.crypto as Crypto | undefined;

  if (typeof existing?.getRandomValues === "function") return;

  const shim = { getRandomValues } as unknown as Crypto;

  if (existing) {
    // Hermes gives a non-writable `crypto`, so assign the one property.
    Object.defineProperty(existing, "getRandomValues", {
      value: getRandomValues,
      configurable: true,
      writable: true,
    });
    return;
  }

  Object.defineProperty(globalThis, "crypto", {
    value: shim,
    configurable: true,
    writable: true,
  });
}

/**
 * Throws if the polyfill is missing, with the reason rather than the symptom.
 * Called once at startup: a ULID failure five screens later reads as a random
 * crash, and this is the single assumption the offline outbox rests on.
 */
export function assertCryptoInstalled(): void {
  if (typeof globalThis.crypto?.getRandomValues !== "function") {
    throw new Error(
      "crypto.getRandomValues is missing. installCrypto() must run before any " +
        "module that mints a ULID, or no stop event can be recorded.",
    );
  }
}
