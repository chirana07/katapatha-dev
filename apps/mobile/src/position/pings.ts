import { ulid } from "@katapatha/core/offline/ulid";

/**
 * The pure half of position reporting: what a ping is, how a batch is built,
 * what the server's answer means, and how long a fix may take.
 *
 * Pings are best-effort and deliberately NOT part of the durable outbox
 * (src/outbox). A position that arrives hours late is useless: the product's
 * claim is "last reported, with its age" (docs/DOMAIN.md), and an old fix sent
 * late is just an old fix with an honest, large age. So unsent fixes live in a
 * bounded in-memory buffer and are lost if the app is closed. The copy says so.
 * A resend of the same buffer is replay-safe: the server keys on clientPingId.
 */

/** Same cadence as the web driver (apps/web/src/app/driver/position-share.ts). */
export const PING_INTERVAL_MS = 60_000;

/** The contract's maxItems for one POST /drivers/me/pings. */
export const MAX_PINGS_PER_REQUEST = 50;

/** A missing fix must never block the loop. */
export const FIX_TIMEOUT_MS = 20_000;

/**
 * Minted here, not in the outbox: this id is for a ping, not a stop event. The
 * "only module that calls ulid()" comment in src/outbox/intents.ts is about stop
 * event ids.
 */
export function mintPingId(): string {
  return ulid();
}

/** A fix as the location module hands it over. */
export interface Fix {
  latitude: number;
  longitude: number;
  accuracy?: number | null;
  /** When the phone took the fix, epoch ms. */
  takenAtMs: number;
}

/** Exactly the fields the contract's ping item declares (additionalProperties: false). */
export interface Ping {
  clientPingId: string;
  lat: number;
  lng: number;
  accuracyM?: number;
  recordedAt: string;
}

export interface PingBatch {
  pings: Ping[];
}

/**
 * A fix as the API wants it, or null when it cannot be real. Coordinates are
 * rounded to 5 decimals (about a metre), more precision than a phone fix has.
 * `recordedAt` is the phone's clock at the moment of the fix, never the send time.
 */
export function buildPing(fix: Fix, clientPingId: string): Ping | null {
  const { latitude, longitude, takenAtMs } = fix;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null;
  if (!Number.isFinite(takenAtMs)) return null;
  if (clientPingId.length < 8 || clientPingId.length > 64) return null;
  const ping: Ping = {
    clientPingId,
    lat: Math.round(latitude * 1e5) / 1e5,
    lng: Math.round(longitude * 1e5) / 1e5,
    recordedAt: new Date(takenAtMs).toISOString(),
  };
  if (typeof fix.accuracy === "number" && Number.isFinite(fix.accuracy) && fix.accuracy >= 0) {
    ping.accuracyM = Math.round(fix.accuracy);
  }
  return ping;
}

/**
 * The time to stamp on a fix. The location module's own timestamp is when the
 * fix was taken (so an age measured from it is honest), but a timestamp ahead of
 * the phone's clock is nonsense and would be refused by the server for the whole
 * batch, so it falls back to now.
 */
export function fixTakenAt(timestampMs: number | null | undefined, nowMs: number): number {
  if (typeof timestampMs !== "number" || !Number.isFinite(timestampMs)) return nowMs;
  return timestampMs > nowMs ? nowMs : timestampMs;
}

/** True when it is time for another fix: the first one at once, then once a minute. */
export function shouldTakeFix(lastFixAtMs: number | null, nowMs: number): boolean {
  return lastFixAtMs === null || nowMs - lastFixAtMs >= PING_INTERVAL_MS;
}

/**
 * Unsent pings, newest last. Bounded by the contract's per-request maximum, and
 * the oldest are dropped first: a stale position is worth less than a fresh one.
 */
export class PingBuffer {
  private items: Ping[] = [];

  constructor(private readonly capacity: number = MAX_PINGS_PER_REQUEST) {
    if (capacity < 1) throw new Error("PingBuffer needs a capacity of at least 1.");
  }

  get size(): number {
    return this.items.length;
  }

  add(ping: Ping): void {
    this.items.push(ping);
    if (this.items.length > this.capacity) {
      this.items.splice(0, this.items.length - this.capacity);
    }
  }

  /** A copy of what is waiting, oldest first. */
  peek(): Ping[] {
    return this.items.slice();
  }

  /** Removes exactly the given pings (by id); fixes added meanwhile stay. */
  remove(sent: readonly Ping[]): void {
    const ids = new Set(sent.map((p) => p.clientPingId));
    this.items = this.items.filter((p) => !ids.has(p.clientPingId));
  }

  clear(): void {
    this.items = [];
  }
}

/** What the server's answer means for the buffered batch. */
export type SendKind =
  /** 200: stored or already stored. Remove the batch. */
  | "sent"
  /** 422 PING_IN_FUTURE: the phone's clock is ahead. Drop the batch; every ping in it is wrong. */
  | "clock"
  /** Any other 4xx the batch can never satisfy (400, 422 body). Drop it. */
  | "rejected"
  /** 401: the session ended. Stop, keep the batch, do not loop. */
  | "auth"
  /** 403: no vehicle claimed. Keep the batch; it is sent once a vehicle is picked. */
  | "no-vehicle"
  /** No answer, 408/429, or 5xx. Keep the batch and try again next cycle. */
  | "offline";

/** `status` is 0 for a request that threw (no connectivity). */
export function classifyResponse(status: number, code?: string): SendKind {
  if (status >= 200 && status < 300) return "sent";
  if (status === 401) return "auth";
  if (status === 403) return "no-vehicle";
  if (status === 422 && code === "PING_IN_FUTURE") return "clock";
  if (status === 408 || status === 429 || status === 0 || status >= 500) return "offline";
  if (status >= 400) return "rejected";
  return "offline";
}

/** Resolves with the promise's value, or `null` when it takes longer than `ms` (or rejects). */
export async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race<T | null>([
      promise,
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), ms);
      }),
    ]);
  } catch {
    return null;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
