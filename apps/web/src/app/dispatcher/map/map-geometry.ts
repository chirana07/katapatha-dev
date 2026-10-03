import type { LatLng } from "@katapatha/core/domain/geography";

/**
 * Turning latitude and longitude into SVG coordinates for the schematic map.
 *
 * Sri Lanka is near enough to the equator that an equirectangular projection is
 * honest at this scale, but a degree of longitude is still about 0.99 of a
 * degree of latitude there, so x is scaled by cos(latitude) rather than letting
 * the island come out slightly stretched. The map fits whatever is on it (the
 * depot, the districts being served, the vehicles) instead of always showing
 * the whole island: a morning with every vehicle on the west coast should not
 * be drawn at the size of a thumbnail.
 */

export interface Point {
  x: number;
  y: number;
}

export interface Viewport {
  width: number;
  height: number;
  project: (position: LatLng) => Point;
  contains: (point: Point, margin?: number) => boolean;
}

const DEFAULTS = { width: 960, height: 720, padding: 72, minSpanDeg: 0.6 };

export function fitViewport(
  positions: LatLng[],
  options: { width?: number; height?: number; padding?: number; minSpanDeg?: number; insetRight?: number } = {},
): Viewport {
  const { width, height, padding, minSpanDeg } = { ...DEFAULTS, ...options };
  const insetRequested = Math.max(0, options.insetRight ?? 0);

  // With nothing to fit, centre on the middle of the island so the caller still
  // gets a usable (empty) map.
  const points = positions.length > 0 ? positions : [{ lat: 7.5, lng: 80.6 }];

  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLng = Infinity;
  let maxLng = -Infinity;
  for (const p of points) {
    minLat = Math.min(minLat, p.lat);
    maxLat = Math.max(maxLat, p.lat);
    minLng = Math.min(minLng, p.lng);
    maxLng = Math.max(maxLng, p.lng);
  }
  // Never zoom closer than minSpanDeg on either axis: a single vehicle sitting
  // on its depot would otherwise fill the screen with one dot.
  const midLat = (minLat + maxLat) / 2;
  const midLng = (minLng + maxLng) / 2;
  const cos = Math.cos((midLat * Math.PI) / 180);
  const spanLat = Math.max(maxLat - minLat, minSpanDeg);
  const spanX = Math.max((maxLng - minLng) * cos, minSpanDeg * cos);

  const fullScale = Math.min((width - 2 * padding) / spanX, (height - 2 * padding) / spanLat);

  // Room kept clear on the right for a card laid over the map, but only when
  // the picture still fits beside it at the size it would have had anyway.
  // Squeezing a wide spread of vehicles into a sliver to make room would hide
  // more than the card does, so then the card simply overlays.
  const insetRight = spanX * fullScale + 2 * padding <= width - insetRequested ? insetRequested : 0;
  const usable = width - insetRight;
  const scale = Math.min((usable - 2 * padding) / spanX, (height - 2 * padding) / spanLat);

  const project = (position: LatLng): Point => ({
    x: round(usable / 2 + (position.lng - midLng) * cos * scale),
    y: round(height / 2 - (position.lat - midLat) * scale),
  });

  const contains = (point: Point, margin = 0) =>
    point.x >= margin && point.x <= width - margin && point.y >= margin && point.y <= height - margin;

  return { width, height, project, contains };
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LabelAnchor {
  id: string;
  at: Point;
  width: number;
}

function overlaps(a: Box, b: Box): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

/**
 * Place each vehicle's tag beside its marker without sitting on another tag,
 * another marker or the depot's label. Several vehicles near one depot is the
 * normal morning, and tags stacked on top of each other would hide exactly the
 * vehicles the dispatcher is looking for.
 *
 * Each tag tries the right of its marker, then the left, nudging up and down in
 * turn, and takes the first spot that is clear and inside the frame. Anchors
 * are placed in the order given, so the caller passes the selected vehicle
 * first. If nothing is clear the plain right-hand spot is used: an overlap is a
 * better failure than a tag that has gone missing. `strict` flips that for
 * labels that are only context: better dropped than drawn on top of something.
 */
export function placeLabels(
  anchors: LabelAnchor[],
  obstacles: Box[],
  frame: { width: number; height: number },
  options: { height?: number; offset?: number; strict?: boolean } = {},
): Map<string, Box> {
  const height = options.height ?? 24;
  const offset = options.offset ?? 22;
  const nudges = [0, -(height + 4), height + 4, -2 * (height + 4), 2 * (height + 4)];
  const placed = new Map<string, Box>();
  const taken: Box[] = [...obstacles];

  for (const anchor of anchors) {
    const sides = [anchor.at.x + offset, anchor.at.x - offset - anchor.width];
    let chosen: Box | null = null;
    search: for (const dy of nudges) {
      for (const x of sides) {
        const box = { x, y: anchor.at.y - height / 2 + dy, width: anchor.width, height };
        const inside = box.x >= 0 && box.x + box.width <= frame.width && box.y >= 0 && box.y + box.height <= frame.height;
        if (inside && !taken.some((other) => overlaps(box, other))) {
          chosen = box;
          break search;
        }
      }
    }
    if (!chosen && options.strict) continue;
    const result = chosen ?? { x: sides[0]!, y: anchor.at.y - height / 2, width: anchor.width, height };
    placed.set(anchor.id, result);
    taken.push(result);
  }
  return placed;
}
