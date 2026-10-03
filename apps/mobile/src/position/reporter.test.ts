import { describe, expect, it } from "vitest";
import type { PingBatch } from "./pings";
import { PositionReporter, type PostResult } from "./reporter";

const T0 = Date.UTC(2026, 3, 9, 1, 0, 0);

function setup(answers: Array<PostResult | "throw">) {
  const sent: PingBatch[] = [];
  let n = 0;
  const reporter = new PositionReporter({
    mintId: () => `PINGID${String(++n).padStart(6, "0")}`,
    post: async (batch) => {
      sent.push(structuredClone(batch));
      const next = answers.shift() ?? { status: 200 };
      if (next === "throw") throw new Error("network down");
      return next;
    },
  });
  const fix = (seconds: number) =>
    reporter.record({ latitude: 7.9, longitude: 79.8, accuracy: 12, takenAtMs: T0 + seconds * 1000 });
  return { reporter, sent, fix };
}

describe("PositionReporter", () => {
  it("sends the buffer, clears it, and reports when the FIX was taken", async () => {
    const { reporter, sent, fix } = setup([{ status: 200 }]);
    fix(0);
    fix(60);
    expect(reporter.getState().pendingCount).toBe(2);
    expect(await reporter.flush()).toBe("sent");
    expect(sent[0]?.pings.map((p) => p.recordedAt)).toEqual([
      new Date(T0).toISOString(),
      new Date(T0 + 60_000).toISOString(),
    ]);
    expect(reporter.getState()).toEqual({
      lastReportedAt: new Date(T0 + 60_000),
      pendingCount: 0,
      problem: null,
    });
  });

  it("does nothing when nothing is waiting", async () => {
    const { reporter, sent } = setup([]);
    expect(await reporter.flush()).toBe("idle");
    expect(sent).toHaveLength(0);
  });

  it("keeps the batch through a failure and resends the SAME ids (replay-safe)", async () => {
    const { reporter, sent, fix } = setup([{ status: 0 }, "throw", { status: 503 }, { status: 200 }]);
    fix(0);
    expect(await reporter.flush()).toBe("offline");
    expect(reporter.getState().problem).toBe("offline");
    expect(reporter.getState().pendingCount).toBe(1);
    fix(60);
    expect(await reporter.flush()).toBe("offline"); // thrown
    expect(await reporter.flush()).toBe("offline"); // 503
    expect(await reporter.flush()).toBe("sent");
    const ids = sent.map((b) => b.pings.map((p) => p.clientPingId));
    expect(ids[1]).toEqual(["PINGID000001", "PINGID000002"]);
    expect(ids[3]).toEqual(ids[1]);
    expect(reporter.getState().problem).toBeNull();
    expect(reporter.getState().pendingCount).toBe(0);
  });

  it("a duplicate answer (200) is success: the server already had it", async () => {
    const { reporter, fix } = setup([{ status: 200 }]);
    fix(0);
    expect(await reporter.flush()).toBe("sent");
  });

  it("drops the batch on PING_IN_FUTURE and reports a wrong clock, then recovers", async () => {
    const { reporter, fix } = setup([{ status: 422, code: "PING_IN_FUTURE" }, { status: 200 }]);
    fix(0);
    expect(await reporter.flush()).toBe("clock");
    expect(reporter.getState()).toEqual({ lastReportedAt: null, pendingCount: 0, problem: "clock" });
    fix(60);
    expect(await reporter.flush()).toBe("sent");
    expect(reporter.getState().problem).toBeNull();
  });

  it("drops a batch the server will never accept instead of resending it forever", async () => {
    const { reporter, fix } = setup([{ status: 422, code: "VALIDATION_ERROR" }]);
    fix(0);
    expect(await reporter.flush()).toBe("rejected");
    expect(reporter.getState().pendingCount).toBe(0);
    expect(reporter.getState().problem).toBe("rejected");
  });

  it("on 401 stops: keeps the batch, never calls the API again until resumed", async () => {
    const { reporter, sent, fix } = setup([{ status: 401 }, { status: 200 }]);
    fix(0);
    expect(await reporter.flush()).toBe("auth");
    expect(reporter.getState().problem).toBe("auth");
    expect(await reporter.flush()).toBe("halted");
    expect(await reporter.flush()).toBe("halted");
    expect(sent).toHaveLength(1);
    reporter.resume();
    expect(reporter.getState().problem).toBeNull();
    expect(await reporter.flush()).toBe("sent");
    expect(sent).toHaveLength(2);
  });

  it("on 403 (no vehicle) keeps the batch for when one is claimed", async () => {
    const { reporter, fix } = setup([{ status: 403 }, { status: 200 }]);
    fix(0);
    expect(await reporter.flush()).toBe("no-vehicle");
    expect(reporter.getState()).toMatchObject({ problem: "no-vehicle", pendingCount: 1 });
    expect(await reporter.flush()).toBe("sent");
  });

  it("never runs two sends at once", async () => {
    let release: (r: PostResult) => void = () => {};
    let calls = 0;
    const reporter = new PositionReporter({
      mintId: () => "PINGID000001",
      post: () => {
        calls += 1;
        return new Promise<PostResult>((resolve) => {
          release = resolve;
        });
      },
    });
    reporter.record({ latitude: 7, longitude: 79, takenAtMs: T0 });
    const first = reporter.flush();
    expect(await reporter.flush()).toBe("busy");
    release({ status: 200 });
    expect(await first).toBe("sent");
    expect(calls).toBe(1);
  });

  it("keeps a fix taken while a send was in flight", async () => {
    let release: (r: PostResult) => void = () => {};
    let n = 0;
    const reporter = new PositionReporter({
      mintId: () => `PINGID${String(++n).padStart(6, "0")}`,
      post: () => new Promise<PostResult>((resolve) => (release = resolve)),
    });
    reporter.record({ latitude: 7, longitude: 79, takenAtMs: T0 });
    const flushing = reporter.flush();
    reporter.record({ latitude: 7, longitude: 79, takenAtMs: T0 + 60_000 });
    release({ status: 200 });
    await flushing;
    expect(reporter.getState().pendingCount).toBe(1);
    expect(reporter.getState().lastReportedAt).toEqual(new Date(T0));
  });

  it("is bounded at 50 and drops the oldest", async () => {
    const { reporter, sent } = setup([{ status: 200 }]);
    for (let s = 0; s < 70; s++) {
      reporter.record({ latitude: 7, longitude: 79, takenAtMs: T0 + s * 1000 });
    }
    expect(reporter.getState().pendingCount).toBe(50);
    await reporter.flush();
    expect(sent[0]?.pings).toHaveLength(50);
    expect(sent[0]?.pings[0]?.recordedAt).toBe(new Date(T0 + 20_000).toISOString());
  });

  it("refuses an impossible fix without buffering it", () => {
    const { reporter } = setup([]);
    expect(reporter.record({ latitude: 200, longitude: 0, takenAtMs: T0 })).toBe(false);
    expect(reporter.getState().pendingCount).toBe(0);
  });

  it("reset forgets everything and ignores a send that was in flight", async () => {
    let release: (r: PostResult) => void = () => {};
    const reporter = new PositionReporter({
      mintId: () => "PINGID000001",
      post: () => new Promise<PostResult>((resolve) => (release = resolve)),
    });
    reporter.record({ latitude: 7, longitude: 79, takenAtMs: T0 });
    const flushing = reporter.flush();
    reporter.reset();
    release({ status: 200 });
    await flushing;
    expect(reporter.getState()).toEqual({ lastReportedAt: null, pendingCount: 0, problem: null });
  });

  it("tells subscribers about every change", async () => {
    const { reporter, fix } = setup([{ status: 200 }]);
    let calls = 0;
    const off = reporter.subscribe(() => (calls += 1));
    fix(0);
    await reporter.flush();
    off();
    fix(60);
    expect(calls).toBe(2);
  });

  it("keeps its buffer when the sender is swapped, and reads as no signal before one is set", async () => {
    const reporter = new PositionReporter({ mintId: () => "PINGID000001" });
    reporter.record({ latitude: 7, longitude: 79, takenAtMs: T0 });
    expect(await reporter.flush()).toBe("offline");
    expect(reporter.getState().pendingCount).toBe(1);
    reporter.setPost(async () => ({ status: 200 }));
    expect(await reporter.flush()).toBe("sent");
  });
});
