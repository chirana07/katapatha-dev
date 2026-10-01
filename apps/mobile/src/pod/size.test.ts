import { describe, it, expect } from "vitest";
import {
  MAX_PHOTO_BYTES,
  MAX_QUEUED_BLOB_BYTES,
  MAX_SIGNATURE_BYTES,
  checkPhoto,
  checkQueueHeadroom,
  checkSignature,
  dataUrlBytes,
} from "./size";

describe("dataUrlBytes", () => {
  it("counts a data URL's length, and treats absence as zero", () => {
    const url = "data:image/png;base64,AAAA";
    expect(dataUrlBytes(url)).toBe(url.length);
    expect(dataUrlBytes(null)).toBe(0);
    expect(dataUrlBytes(undefined)).toBe(0);
  });
});

describe("checkSignature", () => {
  it("accepts a normal signature", () => {
    expect(checkSignature("x".repeat(6 * 1024)).ok).toBe(true);
  });

  it("refuses one over the cap, with an instruction rather than a number", () => {
    const verdict = checkSignature("x".repeat(MAX_SIGNATURE_BYTES + 1));
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.message).toMatch(/sign again/i);
  });

  it("accepts a missing signature here — requiring one is the form's job", () => {
    expect(checkSignature(null).ok).toBe(true);
  });
});

describe("checkPhoto", () => {
  it("accepts a resized capture", () => {
    expect(checkPhoto("x".repeat(220 * 1024)).ok).toBe(true);
  });

  it("refuses a full-resolution one", () => {
    // An unresized 12MP capture is 1-2 MB of base64, which is exactly why
    // expo-image-manipulator is not optional.
    const verdict = checkPhoto("x".repeat(MAX_PHOTO_BYTES + 1));
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.message).toMatch(/further back/i);
  });
});

describe("checkQueueHeadroom", () => {
  it("allows an attachment while there is room", () => {
    expect(checkQueueHeadroom(1_000_000, 200_000).ok).toBe(true);
  });

  it("refuses explicitly rather than dropping it silently", () => {
    // A photo the driver believes they attached, quietly discarded, is worse than
    // being told to send what is already queued.
    const verdict = checkQueueHeadroom(MAX_QUEUED_BLOB_BYTES, 1);
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.message).toMatch(/send the records you already have/i);
  });

  it("allows filling the cap exactly", () => {
    expect(checkQueueHeadroom(MAX_QUEUED_BLOB_BYTES - 100, 100).ok).toBe(true);
  });
});
