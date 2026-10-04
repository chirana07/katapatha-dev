import { describe, it, expect } from "vitest";
import { MAX_PHOTO_BYTES } from "../../pod/size";
import { CAMERA_DENIED_NOTE, PHOTO_TOO_LARGE_NOTE, captureOutcome } from "./capture";

describe("what a camera result means", () => {
  it("a good photo becomes a page, keeping the capture time", () => {
    expect(
      captureOutcome({ kind: "ok", dataUrl: "data:image/jpeg;base64,AAAA", capturedAt: "2026-10-01T04:09:00.000Z" }),
    ).toEqual({ kind: "page", dataUrl: "data:image/jpeg;base64,AAAA", capturedAt: "2026-10-01T04:09:00.000Z" });
  });

  it("an over-size photo is a note, never a page", () => {
    const outcome = captureOutcome({
      kind: "ok",
      dataUrl: "data:image/jpeg;base64," + "A".repeat(MAX_PHOTO_BYTES),
      capturedAt: "2026-10-01T04:09:00.000Z",
    });
    expect(outcome.kind).toBe("note");
  });

  it("explains a denied camera and points to signing on the phone", () => {
    expect(captureOutcome({ kind: "denied" })).toEqual({ kind: "note", message: CAMERA_DENIED_NOTE });
    expect(CAMERA_DENIED_NOTE).toMatch(/not allowed for Katapatha/);
    expect(CAMERA_DENIED_NOTE).toMatch(/sign on the phone/);
  });

  it("keeps today's wording for too-large and failed, and says nothing for a cancel", () => {
    expect(captureOutcome({ kind: "too-large" })).toEqual({ kind: "note", message: PHOTO_TOO_LARGE_NOTE });
    expect(captureOutcome({ kind: "failed", message: "boom" })).toEqual({ kind: "note", message: "boom" });
    expect(captureOutcome({ kind: "cancelled" })).toEqual({ kind: "none" });
  });
});
