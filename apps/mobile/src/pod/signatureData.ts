/**
 * A signature, as an SVG data URL.
 *
 * SVG rather than a raster screenshot, for three reasons: no second native module
 * (react-native-view-shot is avoided), 2-6 KB instead of ~40 KB -- and these
 * payloads travel in a JSON body AND sit in SQLite until they drain -- and it
 * stays sharp at any zoom, which matters if a delivery is ever disputed.
 *
 * Pure, so the serialisation is tested without a gesture or a device.
 *
 * Note for whoever renders POD later: a browser <img> handles image/svg+xml, but
 * React Native's <Image> does not -- use react-native-svg's SvgXml.
 */

export type Point = { x: number; y: number };
export type Stroke = Point[];

/** Rounded to whole pixels: sub-pixel precision triples the payload for nothing. */
function round(value: number): number {
  return Math.round(value);
}

/** One stroke as an SVG path: move to the first point, line through the rest. */
export function strokeToPath(stroke: Stroke): string {
  if (stroke.length === 0) return "";
  if (stroke.length === 1) {
    // A tap is a dot. A zero-length line renders as nothing, so close it onto
    // itself -- a driver who dots the box has still signed.
    const { x, y } = stroke[0];
    return `M ${round(x)} ${round(y)} l 0.5 0`;
  }
  const [first, ...rest] = stroke;
  return [
    `M ${round(first.x)} ${round(first.y)}`,
    ...rest.map((point) => `L ${round(point.x)} ${round(point.y)}`),
  ].join(" ");
}

export function strokesToPaths(strokes: readonly Stroke[]): string[] {
  return strokes.map(strokeToPath).filter((path) => path.length > 0);
}

export function isSigned(strokes: readonly Stroke[]): boolean {
  return strokesToPaths(strokes).length > 0;
}

/** Base64 without Buffer, which React Native does not provide. */
const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

export function toBase64(input: string): string {
  // The SVG is ASCII by construction -- digits, letters and punctuation only --
  // so a byte-per-character encoder is correct here.
  let output = "";
  for (let index = 0; index < input.length; index += 3) {
    const a = input.charCodeAt(index);
    const b = input.charCodeAt(index + 1);
    const c = input.charCodeAt(index + 2);

    output += B64[a >> 2];
    output += B64[((a & 3) << 4) | (Number.isNaN(b) ? 0 : b >> 4)];
    output += Number.isNaN(b) ? "=" : B64[((b & 15) << 2) | (Number.isNaN(c) ? 0 : c >> 6)];
    output += Number.isNaN(c) ? "=" : B64[c & 63];
  }
  return output;
}

export function strokesToSvg(
  strokes: readonly Stroke[],
  size: { width: number; height: number },
): string {
  const paths = strokesToPaths(strokes)
    .map(
      (path) =>
        `<path d="${path}" fill="none" stroke="#0F172A" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`,
    )
    .join("");

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${round(size.width)}" ` +
    `height="${round(size.height)}" viewBox="0 0 ${round(size.width)} ${round(size.height)}">` +
    paths +
    `</svg>`
  );
}

/** The value that goes on the POD event's signatureData, or null if unsigned. */
export function toSignatureDataUrl(
  strokes: readonly Stroke[],
  size: { width: number; height: number },
): string | null {
  if (!isSigned(strokes)) return null;
  return `data:image/svg+xml;base64,${toBase64(strokesToSvg(strokes, size))}`;
}
