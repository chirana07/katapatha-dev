import { describe, expect, it } from "vitest";
import {
  conflictSentence,
  eventLabel,
  groupOutboxRows,
  lastSentLine,
  lastAttemptLines,
  outboxTitle,
  rejectionSentence,
  sendNowResult,
  stoppedRetrying,
  waitingStateLabel,
  type OutboxRowInput,
} from "./outboxModel";

const row = (state: OutboxRowInput["state"], over: Partial<OutboxRowInput> = {}): OutboxRowInput => ({
  id: `e-${state}`,
  stop_id: "s",
  type: "ARRIVED",
  occurred_at: "2026-09-27T01:00:00.000Z",
  state,
  attempts: 0,
  last_error: null,
  conflict_state: null,
  ...over,
});

describe("outbox groups", () => {
  it("covers every unconfirmed row exactly once and drops confirmed ones", () => {
    const rows = [row("queued"), row("sending"), row("rejected"), row("conflict"), row("confirmed")];
    const groups = groupOutboxRows(rows);
    expect(groups.waiting.map((r) => r.state)).toEqual(["queued", "sending"]);
    expect(groups.rejected).toHaveLength(1);
    expect(groups.conflicts).toHaveLength(1);
    expect(groups.waiting.length + groups.rejected.length + groups.conflicts.length).toBe(4);
  });

  it("names the title by what is waiting, and does not say everything was sent over a refused record", () => {
    expect(outboxTitle({ unsent: 3, rejected: 0, conflicts: 0 })).toBe("3 waiting to send");
    expect(outboxTitle({ unsent: 0, rejected: 1, conflicts: 0 })).toBe("Nothing is waiting to send");
    expect(outboxTitle({ unsent: 0, rejected: 0, conflicts: 2 })).toBe("Nothing is waiting to send");
    expect(outboxTitle({ unsent: 0, rejected: 0, conflicts: 0 })).toBe("Everything has been sent");
  });
});

describe("outbox wording", () => {
  it("labels events in driver words and never shows a raw code", () => {
    expect(eventLabel("UNLOAD_START")).toBe("Unload started");
    expect(eventLabel("POD_CAPTURED")).toBe("Proof of delivery");
    expect(eventLabel("SOMETHING_NEW")).toBe("something new");
  });

  it("never calls an unconfirmed or refused record failed", () => {
    const texts = [
      ...["queued", "sending"].map((s) => waitingStateLabel(s as "queued")),
      rejectionSentence({ last_error: null }),
      conflictSentence({ conflict_state: "STALE_ASSIGNMENT" }),
      conflictSentence({ conflict_state: null }),
      sendNowResult({ remaining: 2, attemptedAt: new Date(0) }).text,
      sendNowResult({ remaining: 0, attemptedAt: new Date(0) }).text,
      eventLabel("FAILED"),
    ];
    for (const text of texts) expect(text.toLowerCase()).not.toMatch(/fail|lost|unknown/);
  });

  it("uses the stored sentence for a refused record", () => {
    expect(rejectionSentence({ last_error: "  The stop was closed.  " })).toBe("The stop was closed.");
    expect(rejectionSentence({ last_error: null })).toMatch(/did not accept/);
  });

  it("reports what is left after Send now, from the phone's own clock in Colombo", () => {
    expect(sendNowResult({ remaining: 0, attemptedAt: new Date() })).toEqual({
      tone: "good",
      text: "Sent. Nothing is waiting.",
    });
    expect(sendNowResult({ remaining: 3, attemptedAt: new Date("2026-09-27T02:04:00.000Z") })).toEqual({
      tone: "info",
      text: "Tried at 07:34 · 3 still waiting.",
    });
  });

  it("says when the app stopped retrying", () => {
    expect(stoppedRetrying(7)).toBe(false);
    expect(stoppedRetrying(8)).toBe(true);
  });

  it("lists the last attempt's counts, including refused ones", () => {
    expect(
      lastAttemptLines({
        endpoint: "/sync/events",
        outcome: "sent",
        sent: 4,
        accepted: 3,
        duplicates: 1,
        conflicts: 0,
        rejected: null,
      }),
    ).toEqual({
      headline: "/sync/events · sent",
      counts: "sent 4 · accepted 3 · already held 1 · replaced 0 · not accepted 0",
    });
    expect(
      lastAttemptLines({ endpoint: "/x", outcome: "offline", sent: null, accepted: null, duplicates: null, conflicts: null, rejected: null }).counts,
    ).toBeNull();
  });
});

describe("lastSentLine", () => {
  it("shows the device clock in Colombo, labelled as the phone's", () => {
    expect(lastSentLine("2026-09-27T02:04:00.000Z")).toBe("Last sent at 07:34 (this phone's clock).");
    expect(lastSentLine(null)).toBeNull();
    expect(lastSentLine("nope")).toBeNull();
  });
});
