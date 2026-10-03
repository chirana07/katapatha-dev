import { serialiseBasket, type Basket } from "./basket";

/**
 * Where the basket waits while the page is reloaded.
 *
 * `sessionStorage`, so it belongs to this tab and goes when the tab does: a
 * half-chosen order must not follow a manager to tomorrow. Every access is in a
 * try/catch because private windows and blocked site data make the accessor
 * throw, and the wizard works without it (it keeps the basket in memory too).
 * Listeners exist because `useSyncExternalStore` needs to hear about a write
 * made in the same tab, which the browser's own `storage` event does not report.
 */
const KEY = "katapatha.store.basket";
const listeners = new Set<() => void>();

export function subscribeSaved(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function readSaved(): string | null {
  try {
    return window.sessionStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function writeSaved(basket: Basket): void {
  try {
    if (Object.keys(basket).length === 0) window.sessionStorage.removeItem(KEY);
    else window.sessionStorage.setItem(KEY, serialiseBasket(basket));
  } catch {
    // Nothing to do: the in-memory basket still works.
  }
  listeners.forEach((listener) => listener());
}
