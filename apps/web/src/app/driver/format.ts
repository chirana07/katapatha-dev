export function colomboToday(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Colombo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const map: Record<string, string> = {};
  for (const part of parts) if (part.type !== "literal") map[part.type] = part.value;
  return `${map.year}-${map.month}-${map.day}`;
}

export function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export function formatClock(clock: string | undefined | null): string {
  if (!clock || !/^\d{2}:\d{2}$/.test(clock)) return "—";
  return clock;
}

export function formatWindow(open?: string | null, close?: string | null): string {
  if (open && close) return `${open}–${close}`;
  if (open) return `From ${open}`;
  if (close) return `Until ${close}`;
  return "No window set";
}

// Generates a Crockford base32 ULID string. The client mints each event's id so
// a replay (online or from an outbox) is idempotent by the server contract.
const ULID_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export function generateUlid(): string {
  const now = Date.now();
  let time = now;
  const timeChars: string[] = [];
  for (let index = 9; index >= 0; index--) {
    timeChars[index] = ULID_ALPHABET[time % 32]!;
    time = Math.floor(time / 32);
  }
  const randomChars: string[] = [];
  const bytes = new Uint8Array(16);
  if (typeof globalThis.crypto?.getRandomValues === "function") {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index++) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }
  for (const byte of bytes) randomChars.push(ULID_ALPHABET[byte % 32]!);
  return timeChars.join("") + randomChars.join("");
}

// A stable per-browser device id. Not a security credential — it travels with
// every event so the server can distinguish devices on the same account, which
// is what the deduplication story needs.
export function deviceId(): string {
  const key = "katapatha_device_id";
  try {
    const existing = window.localStorage.getItem(key);
    if (existing) return existing;
    const minted = `device-${generateUlid().slice(-10).toLowerCase()}`;
    window.localStorage.setItem(key, minted);
    return minted;
  } catch {
    return `device-ephemeral-${Math.random().toString(36).slice(2, 10)}`;
  }
}
