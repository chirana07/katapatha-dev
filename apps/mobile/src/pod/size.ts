/**
 * Payload caps for proof of delivery.
 *
 * These matter more here than they look. A base64 data URL goes into a JSON body
 * AND into SQLite, where it sits until the batch drains -- which on a bad day is
 * the whole shift. An unbounded photo turns a 2 KB event into a 2 MB one, and a
 * driver with eight undelivered stops would be carrying 16 MB of queue on a
 * phone, uploading it over the worst connection of the day.
 *
 * So an over-size attachment is refused with an explicit message rather than
 * silently dropped: a signature the driver believes they captured and that was
 * quietly discarded is worse than one they were told to retake.
 */

export const MAX_SIGNATURE_BYTES = 64 * 1024;
export const MAX_PHOTO_BYTES = 400 * 1024;
/** Across every queued event, not per event. */
export const MAX_QUEUED_BLOB_BYTES = 8 * 1024 * 1024;

/** Bytes a data URL will occupy. Its length IS its byte count; it is ASCII. */
export function dataUrlBytes(dataUrl: string | null | undefined): number {
  return dataUrl ? dataUrl.length : 0;
}

export type SizeVerdict = { ok: true } | { ok: false; message: string };

export function checkSignature(dataUrl: string | null): SizeVerdict {
  if (dataUrlBytes(dataUrl) <= MAX_SIGNATURE_BYTES) return { ok: true };
  return {
    ok: false,
    message:
      "That signature is too large to send. Tap Clear and sign again with fewer strokes.",
  };
}

export function checkPhoto(dataUrl: string | null): SizeVerdict {
  if (dataUrlBytes(dataUrl) <= MAX_PHOTO_BYTES) return { ok: true };
  return {
    ok: false,
    message: "That photo is too large to send. Take it again from further back.",
  };
}

/** Refuses a new attachment when the queue is already carrying too much. */
export function checkQueueHeadroom(
  queuedBytes: number,
  incomingBytes: number,
): SizeVerdict {
  if (queuedBytes + incomingBytes <= MAX_QUEUED_BLOB_BYTES) return { ok: true };
  return {
    ok: false,
    message:
      "This phone is holding as much unsent photo evidence as it can. Send the records you already have before adding another photo.",
  };
}
