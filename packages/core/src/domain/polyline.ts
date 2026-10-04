import type { LatLng } from "./geography";

/**
 * Encoded polylines (Google's algorithm). OSRM's `polyline6` is the same
 * encoding at precision 1e6, which is what routes are stored in: about a tenth
 * of a metre, at a fraction of the size of a coordinate array.
 */

export function encodePolyline(points: readonly LatLng[], precision = 6): string {
  const factor = 10 ** precision;
  let lastLat = 0;
  let lastLng = 0;
  let out = "";
  for (const p of points) {
    const lat = Math.round(p.lat * factor);
    const lng = Math.round(p.lng * factor);
    out += encodeValue(lat - lastLat) + encodeValue(lng - lastLng);
    lastLat = lat;
    lastLng = lng;
  }
  return out;
}

export function decodePolyline(encoded: string, precision = 6): LatLng[] {
  const factor = 10 ** precision;
  const points: LatLng[] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;
  while (index < encoded.length) {
    const dLat = decodeValue(encoded, index);
    index = dLat.next;
    const dLng = decodeValue(encoded, index);
    index = dLng.next;
    lat += dLat.value;
    lng += dLng.value;
    points.push({ lat: lat / factor, lng: lng / factor });
  }
  return points;
}

function encodeValue(value: number): string {
  let v = value < 0 ? ~(value << 1) : value << 1;
  let out = "";
  while (v >= 0x20) {
    out += String.fromCharCode((0x20 | (v & 0x1f)) + 63);
    v >>= 5;
  }
  return out + String.fromCharCode(v + 63);
}

function decodeValue(encoded: string, start: number): { value: number; next: number } {
  let result = 0;
  let shift = 0;
  let index = start;
  let byte: number;
  do {
    if (index >= encoded.length) throw new Error("Truncated polyline.");
    byte = encoded.charCodeAt(index++) - 63;
    result |= (byte & 0x1f) << shift;
    shift += 5;
  } while (byte >= 0x20);
  return { value: result & 1 ? ~(result >> 1) : result >> 1, next: index };
}
