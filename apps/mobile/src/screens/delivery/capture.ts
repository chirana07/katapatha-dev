import type { PhotoResult } from "../../pod/photo";
import { checkPhoto } from "../../pod/size";

/**
 * What one tap on the camera means for the screen: a page to add, a note to show,
 * or nothing (the driver backed out of the camera, which is not an error).
 */
export type CaptureOutcome =
  | { kind: "page"; dataUrl: string; capturedAt: string }
  | { kind: "note"; message: string }
  | { kind: "none" };

export const CAMERA_DENIED_NOTE =
  "The camera is not allowed for Katapatha on this phone. You can allow it in Settings, or sign on the phone instead.";

export const PHOTO_TOO_LARGE_NOTE = "That photo is too large to send. Take it again from further back.";

export function captureOutcome(result: PhotoResult): CaptureOutcome {
  switch (result.kind) {
    case "ok": {
      const verdict = checkPhoto(result.dataUrl);
      if (!verdict.ok) return { kind: "note", message: verdict.message };
      return { kind: "page", dataUrl: result.dataUrl, capturedAt: result.capturedAt };
    }
    case "denied":
      return { kind: "note", message: CAMERA_DENIED_NOTE };
    case "too-large":
      return { kind: "note", message: PHOTO_TOO_LARGE_NOTE };
    case "failed":
      return { kind: "note", message: result.message };
    case "cancelled":
      return { kind: "none" };
  }
}
