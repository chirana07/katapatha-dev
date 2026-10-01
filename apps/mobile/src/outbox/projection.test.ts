import { describe, it, expect } from "vitest";
import { projectStopStatus, projectRun, type PendingEvent } from "./projection";
import type { StopStatus } from "../driver/stop-state";

const queued = (id: string, type: PendingEvent["type"]): PendingEvent => ({
  id,
  type,
  state: "queued",
});

/**
 * The projection is the one place the app could lie to a driver: it decides what
 * a stop looks like before the server has agreed. So these cases are mostly
 * about what it must REFUSE to claim.
 */

describe("folding pending events over server truth", () => {
  it("shows an arrival the server has not seen yet", () => {
    expect(projectStopStatus("PENDING", [queued("01A", "ARRIVED")])).toEqual({
      status: "ARRIVED",
      unsent: 1,
      state: "unsent",
      ahead: false,
    });
  });

  it("walks arrive -> unload -> delivered entirely offline", () => {
    const events = [
      queued("01A", "ARRIVED"),
      queued("01B", "UNLOAD_START"),
      queued("01C", "DELIVERED"),
      queued("01D", "POD_CAPTURED"),
    ];
    expect(projectStopStatus("PENDING", events)).toMatchObject({
      status: "DONE",
      unsent: 4,
      state: "unsent",
    });
  });

  it("closes the stop on a delivery even if arrive and unload were never tapped", () => {
    expect(projectStopStatus("PENDING", [queued("01A", "DELIVERED")]).status).toBe("DONE");
  });

  it("folds a reported problem to FAILED", () => {
    expect(projectStopStatus("ARRIVED", [queued("01A", "FAILED")]).status).toBe("FAILED");
  });

  it("folds a skip to SKIPPED", () => {
    expect(projectStopStatus("PENDING", [queued("01A", "SKIPPED")]).status).toBe("SKIPPED");
  });

  it("reports clean when there is nothing pending", () => {
    expect(projectStopStatus("PENDING", [])).toEqual({
      status: "PENDING",
      unsent: 0,
      state: "clean",
      ahead: false,
    });
  });
});

describe("what the projection refuses to do", () => {
  it("never overrides a terminal server status", () => {
    // The server does not move a stop out of DONE/FAILED/SKIPPED, so a local
    // event on top could only contradict a decision already recorded.
    for (const terminal of ["DONE", "SKIPPED", "FAILED"] as StopStatus[]) {
      const result = projectStopStatus(terminal, [queued("01A", "ARRIVED")]);
      expect(result.status).toBe(terminal);
      expect(result.ahead).toBe(true);
    }
  });

  it("does not fold a confirmed event, because server_status already includes it", () => {
    // This is the double-count the single-status-column design exists to avoid:
    // if confirmed rows folded, an accepted arrival would advance the stop twice.
    const result = projectStopStatus("ARRIVED", [
      { id: "01A", type: "ARRIVED", state: "confirmed" },
    ]);
    expect(result).toEqual({
      status: "ARRIVED",
      unsent: 0,
      state: "clean",
      ahead: false,
    });
  });

  it("does not fold a conflicted event — it did not apply", () => {
    const result = projectStopStatus("PENDING", [
      { id: "01A", type: "ARRIVED", state: "conflict" },
    ]);
    expect(result.status).toBe("PENDING");
    expect(result.state).toBe("conflict");
  });

  it("does not fold a rejected event", () => {
    const result = projectStopStatus("PENDING", [
      { id: "01A", type: "DELIVERED", state: "rejected" },
    ]);
    expect(result.status).toBe("PENDING");
    expect(result.state).toBe("rejected");
  });

  it("flags `ahead` instead of inventing a status for an event that does not fit", () => {
    // An unload queued against a stop the server still calls PENDING. Showing
    // UNLOADING would be a guess; showing PENDING with `ahead` is the truth.
    const result = projectStopStatus("PENDING", [queued("01B", "UNLOAD_START")]);
    expect(result.status).toBe("PENDING");
    expect(result.ahead).toBe(true);
  });
});

describe("which state the stop card reports", () => {
  it("ranks rejected above conflict above unsent", () => {
    // Rejection is the only outcome that loses the driver's record, so it must
    // be the one that surfaces.
    expect(
      projectStopStatus("PENDING", [
        queued("01A", "ARRIVED"),
        { id: "01B", type: "UNLOAD_START", state: "conflict" },
        { id: "01C", type: "DELIVERED", state: "rejected" },
      ]).state,
    ).toBe("rejected");

    expect(
      projectStopStatus("PENDING", [
        queued("01A", "ARRIVED"),
        { id: "01B", type: "UNLOAD_START", state: "conflict" },
      ]).state,
    ).toBe("conflict");

    expect(projectStopStatus("PENDING", [queued("01A", "ARRIVED")]).state).toBe("unsent");
  });

  it("counts only queued and sending as unsent", () => {
    const result = projectStopStatus("PENDING", [
      queued("01A", "ARRIVED"),
      { id: "01B", type: "UNLOAD_START", state: "sending" },
      { id: "01C", type: "DELIVERED", state: "confirmed" },
      { id: "01D", type: "FAILED", state: "rejected" },
    ]);
    expect(result.unsent).toBe(2);
  });
});

describe("event ordering", () => {
  it("applies events in ULID order, which is the order the driver tapped", () => {
    // ULIDs sort lexicographically by mint time, and the generator is monotonic
    // within a millisecond, so this ordering is the driver's actual sequence.
    const inOrder = projectStopStatus("PENDING", [
      queued("01A", "ARRIVED"),
      queued("01B", "UNLOAD_START"),
    ]);
    expect(inOrder.status).toBe("UNLOADING");
    expect(inOrder.ahead).toBe(false);
  });

  it("flags the reversed sequence rather than silently accepting it", () => {
    const reversed = projectStopStatus("PENDING", [
      queued("01A", "UNLOAD_START"),
      queued("01B", "ARRIVED"),
    ]);
    // UNLOAD_START cannot apply to PENDING, so it is skipped and flagged; the
    // later ARRIVED does apply.
    expect(reversed.status).toBe("ARRIVED");
    expect(reversed.ahead).toBe(true);
  });
});

describe("projectRun", () => {
  it("projects each stop against only its own pending events", () => {
    const stops = [
      { id: "s1", serverStatus: "PENDING" as StopStatus },
      { id: "s2", serverStatus: "PENDING" as StopStatus },
      { id: "s3", serverStatus: "DONE" as StopStatus },
    ];
    const pending = new Map<string, PendingEvent[]>([
      ["s1", [queued("01A", "ARRIVED")]],
      ["s2", []],
    ]);

    const projected = projectRun(stops, pending);

    expect(projected.map((stop) => stop.projection.status)).toEqual([
      "ARRIVED",
      "PENDING",
      "DONE",
    ]);
    expect(projected[0].projection.unsent).toBe(1);
    expect(projected[1].projection.state).toBe("clean");
  });
});
