import { describe, it, expect, afterEach, vi } from "vitest";
import { installCrypto, assertCryptoInstalled } from "./crypto";

// expo-crypto is a native module, so stand in for it with Node's own CSPRNG.
// What is under test is the patching, not the entropy source.
vi.mock("expo-crypto", () => ({
  getRandomValues: (array: Uint8Array) => {
    for (let i = 0; i < array.length; i++) array[i] = i % 256;
    return array;
  },
}));

const original = globalThis.crypto;

afterEach(() => {
  Object.defineProperty(globalThis, "crypto", {
    value: original,
    configurable: true,
    writable: true,
  });
});

function removeCrypto(): void {
  Object.defineProperty(globalThis, "crypto", {
    value: undefined,
    configurable: true,
    writable: true,
  });
}

describe("installCrypto", () => {
  it("installs getRandomValues when there is no crypto global at all", () => {
    removeCrypto();
    expect(globalThis.crypto?.getRandomValues).toBeUndefined();

    installCrypto();

    expect(typeof globalThis.crypto.getRandomValues).toBe("function");
  });

  it("adds getRandomValues to a crypto object that lacks it", () => {
    // This is the shape that matters on device: Hermes may expose a partial
    // crypto (randomUUID only) and replacing the whole object would lose it.
    Object.defineProperty(globalThis, "crypto", {
      value: { randomUUID: () => "kept" } as unknown as Crypto,
      configurable: true,
      writable: true,
    });

    installCrypto();

    expect(typeof globalThis.crypto.getRandomValues).toBe("function");
    expect(globalThis.crypto.randomUUID()).toBe("kept");
  });

  it("leaves a working implementation alone", () => {
    const existing = globalThis.crypto.getRandomValues;
    installCrypto();
    expect(globalThis.crypto.getRandomValues).toBe(existing);
  });

  it("makes ulid() work, which is the only reason this exists", async () => {
    removeCrypto();
    installCrypto();

    const { ulid } = await import("@katapatha/core/offline/ulid");

    expect(ulid()).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
  });
});

describe("assertCryptoInstalled", () => {
  it("throws with the reason, not the symptom, when the polyfill is missing", () => {
    removeCrypto();
    expect(() => assertCryptoInstalled()).toThrow(/getRandomValues is missing/);
  });

  it("passes once installed", () => {
    removeCrypto();
    installCrypto();
    expect(() => assertCryptoInstalled()).not.toThrow();
  });
});
