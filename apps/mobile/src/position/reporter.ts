import {
  PingBuffer,
  buildPing,
  classifyResponse,
  mintPingId,
  type Fix,
  type PingBatch,
  type SendKind,
} from "./pings";

/**
 * What stands between a fix and the server, with no React and no Expo in it, so
 * the whole send/keep/drop policy is tested over a fake `post`.
 *
 * It owns the bounded buffer, a single in-flight send, and the facts the hook
 * reports: when the newest CONFIRMED fix was taken, how many are waiting, and
 * what last went wrong.
 */

export type Problem = "offline" | "clock" | "auth" | "no-vehicle" | "rejected";

/** `status` 0 means the request threw. `code` is the API error code, if any. */
export interface PostResult {
  status: number;
  code?: string;
}

export interface ReporterState {
  /** When the newest confirmed fix was TAKEN (not received). */
  lastReportedAt: Date | null;
  pendingCount: number;
  problem: Problem | null;
}

export interface ReporterDeps {
  /** Can be supplied later with `setPost`; until then every send reads as no connectivity. */
  post?: (batch: PingBatch) => Promise<PostResult>;
  mintId?: () => string;
}

export type FlushResult = SendKind | "idle" | "busy" | "halted";

export class PositionReporter {
  private readonly buffer = new PingBuffer();
  private readonly mintId: () => string;
  private inFlight = false;
  private halted = false;
  /** Bumped by reset(), so a send that was in flight then cannot report afterwards. */
  private epoch = 0;
  private listeners = new Set<() => void>();
  private current: ReporterState = { lastReportedAt: null, pendingCount: 0, problem: null };

  private post: (batch: PingBatch) => Promise<PostResult>;

  constructor(deps: ReporterDeps) {
    this.mintId = deps.mintId ?? mintPingId;
    this.post = deps.post ?? (async () => ({ status: 0 }));
  }

  /** Swap the sender (the API client getter changed) without losing the buffer. */
  setPost(post: (batch: PingBatch) => Promise<PostResult>): void {
    this.post = post;
  }

  getState = (): ReporterState => this.current;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** Buffers a fix. Returns false when it could not be a real position. */
  record(fix: Fix): boolean {
    const ping = buildPing(fix, this.mintId());
    if (!ping) return false;
    this.buffer.add(ping);
    this.publish({});
    return true;
  }

  /**
   * Sends what is waiting, once. Never throws. After a 401 it refuses to send
   * again until `resume()`, so an ended session cannot loop.
   */
  async flush(): Promise<FlushResult> {
    if (this.halted) return "halted";
    if (this.inFlight) return "busy";
    const batch = this.buffer.peek();
    if (batch.length === 0) return "idle";

    this.inFlight = true;
    const epoch = this.epoch;
    let result: PostResult;
    try {
      result = await this.post({ pings: batch });
    } catch {
      result = { status: 0 };
    } finally {
      this.inFlight = false;
    }

    const kind = classifyResponse(result.status, result.code);
    // Sharing was turned off (or the driver signed out) while this was on the
    // wire. Its outcome is no longer anybody's to show.
    if (epoch !== this.epoch) return kind;
    switch (kind) {
      case "sent": {
        this.buffer.remove(batch);
        const newest = Math.max(...batch.map((p) => Date.parse(p.recordedAt)));
        const previous = this.current.lastReportedAt?.getTime() ?? -Infinity;
        this.publish({
          lastReportedAt: new Date(Math.max(newest, previous)),
          problem: null,
        });
        break;
      }
      case "clock":
      case "rejected":
        // The whole batch is unusable and always will be.
        this.buffer.remove(batch);
        this.publish({ problem: kind });
        break;
      case "auth":
        this.halted = true;
        this.publish({ problem: "auth" });
        break;
      case "no-vehicle":
        this.publish({ problem: "no-vehicle" });
        break;
      case "offline":
        this.publish({ problem: "offline" });
        break;
    }
    return kind;
  }

  /** Clears an auth halt (the driver signed in again, or turned sharing back on). */
  resume(): void {
    this.halted = false;
    if (this.current.problem === "auth") this.publish({ problem: null });
  }

  /** Forget everything: sharing was turned off or the driver signed out. */
  reset(): void {
    this.epoch += 1;
    this.inFlight = false;
    this.buffer.clear();
    this.halted = false;
    this.current = { lastReportedAt: null, pendingCount: 0, problem: null };
    this.emit();
  }

  private publish(change: Partial<ReporterState>): void {
    this.current = { ...this.current, ...change, pendingCount: this.buffer.size };
    this.emit();
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}
