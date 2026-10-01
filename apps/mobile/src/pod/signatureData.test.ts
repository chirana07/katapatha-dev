import { describe, it, expect } from "vitest";
import {
  isSigned,
  strokeToPath,
  strokesToSvg,
  toBase64,
  toSignatureDataUrl,
  type Stroke,
} from "./signatureData";

const SIZE = { width: 320, height: 160 };

describe("strokeToPath", () => {
  it("moves to the first point and lines through the rest", () => {
    expect(
      strokeToPath([
        { x: 10, y: 20 },
        { x: 30, y: 40 },
        { x: 50, y: 60 },
      ]),
    ).toBe("M 10 20 L 30 40 L 50 60");
  });

  it("renders a single tap as a visible dot", () => {
    // A zero-length line draws nothing. A driver who dots the box has signed.
    expect(strokeToPath([{ x: 5, y: 5 }])).toBe("M 5 5 l 0.5 0");
  });

  it("rounds to whole pixels, because sub-pixel precision triples the payload", () => {
    expect(strokeToPath([{ x: 10.4821, y: 20.9134 }, { x: 11.5, y: 21.49 }])).toBe(
      "M 10 21 L 12 21",
    );
  });

  it("returns nothing for an empty stroke", () => {
    expect(strokeToPath([])).toBe("");
  });
});

describe("isSigned", () => {
  it("is false for no strokes and for empty strokes", () => {
    expect(isSigned([])).toBe(false);
    expect(isSigned([[], []])).toBe(false);
  });

  it("is true once there is a mark", () => {
    expect(isSigned([[{ x: 1, y: 1 }]])).toBe(true);
  });
});

describe("toBase64", () => {
  it("encodes ASCII correctly, including both padding lengths", () => {
    // Known vectors: the SVG is ASCII by construction, so a byte-per-character
    // encoder is correct and Buffer (absent in RN) is not needed.
    expect(toBase64("a")).toBe("YQ==");
    expect(toBase64("ab")).toBe("YWI=");
    expect(toBase64("abc")).toBe("YWJj");
    expect(toBase64("<svg/>")).toBe("PHN2Zy8+");
  });

  it("round-trips through the platform decoder", () => {
    const svg = strokesToSvg([[{ x: 1, y: 2 }, { x: 3, y: 4 }]], SIZE);
    expect(atob(toBase64(svg))).toBe(svg);
  });
});

describe("strokesToSvg", () => {
  it("produces a standalone document with a viewBox", () => {
    const svg = strokesToSvg([[{ x: 0, y: 0 }, { x: 10, y: 10 }]], SIZE);
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(svg).toContain('viewBox="0 0 320 160"');
    expect(svg).toContain("<path");
  });

  it("drops empty strokes rather than emitting empty paths", () => {
    const svg = strokesToSvg([[], [{ x: 1, y: 1 }], []], SIZE);
    expect(svg.match(/<path/g)).toHaveLength(1);
  });
});

describe("toSignatureDataUrl", () => {
  it("returns null when nothing was drawn, so the caller can require a signature", () => {
    expect(toSignatureDataUrl([], SIZE)).toBe(null);
    expect(toSignatureDataUrl([[]], SIZE)).toBe(null);
  });

  it("returns an svg+xml data URL", () => {
    const url = toSignatureDataUrl([[{ x: 1, y: 1 }, { x: 2, y: 2 }]], SIZE);
    expect(url).toMatch(/^data:image\/svg\+xml;base64,/);
  });

  it("stays small for a realistic signature", () => {
    // ~300 points is a full signature. SVG keeps this in single-digit KB, where a
    // rasterised PNG of the same pad is ~40 KB -- and this payload sits in SQLite
    // until the batch drains.
    const stroke: Stroke = Array.from({ length: 300 }, (_, index) => ({
      x: index,
      y: 80 + Math.sin(index / 5) * 30,
    }));
    const url = toSignatureDataUrl([stroke], SIZE);
    expect(url!.length).toBeLessThan(8 * 1024);
  });
});
