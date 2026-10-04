/**
 * Approximate coordinates for the network.
 *
 * The competition datasets describe distance and travel time but carry no
 * latitude or longitude, so the map needs geography from somewhere. These are
 * the well-known positions of the two depots and the twelve district centres
 * the network serves — public geographic fact, not competition data, and kept
 * here rather than in the database because nothing derives from them except
 * the picture.
 *
 * The map is therefore schematic: a stop is drawn at its district's centre,
 * not at the outlet's real address. That is honest for a planning view, where
 * what matters is which district a trip serves and how far out it reaches, and
 * the UI says so rather than implying a precision we do not have.
 */

export interface LatLng {
  lat: number;
  lng: number;
}

export const DEPOT_POSITIONS: Record<string, LatLng> = {
  Peliyagoda: { lat: 6.9689, lng: 79.8936 },
  Kandy: { lat: 7.2906, lng: 80.6337 },
};

export const DISTRICT_POSITIONS: Record<string, LatLng> = {
  Colombo: { lat: 6.9271, lng: 79.8612 },
  Gampaha: { lat: 7.0917, lng: 79.9999 },
  Kalutara: { lat: 6.5854, lng: 79.9607 },
  Galle: { lat: 6.0535, lng: 80.221 },
  Matara: { lat: 5.9549, lng: 80.555 },
  Kurunegala: { lat: 7.4863, lng: 80.3647 },
  Puttalam: { lat: 8.0362, lng: 79.8283 },
  Kandy: { lat: 7.2906, lng: 80.6337 },
  Matale: { lat: 7.4675, lng: 80.6234 },
  "Nuwara Eliya": { lat: 6.9497, lng: 80.7891 },
  Badulla: { lat: 6.9934, lng: 81.055 },
  Kegalle: { lat: 7.2513, lng: 80.3464 },
};

/**
 * Fan several stops in one district out around its centre, so trips serving
 * the same district do not stack into a single unreadable dot.
 */
export function spread(base: LatLng, index: number, total: number): LatLng {
  if (total <= 1) return base;
  const radius = 0.055;
  const angle = (2 * Math.PI * index) / total - Math.PI / 2;
  return {
    lat: base.lat + radius * Math.sin(angle) * 0.75,
    lng: base.lng + radius * Math.cos(angle),
  };
}

export function positionFor(district: string): LatLng | null {
  return DISTRICT_POSITIONS[district] ?? null;
}

/* ---------------------------------------------------------------------------
   Outlet positions and road estimates.

   The datasets carry no coordinates for outlets, so until a CSV or a dispatcher
   supplies one an outlet gets a deterministic position near its district
   centre. It is approximate and the UI says so. When the road network is not
   reachable, legs are estimated from straight-line distance instead.
   --------------------------------------------------------------------------- */

export type RoadClass = "urban" | "suburban" | "highway" | "hill";

/** Sri Lanka's bounding box; a pin outside it is a typo, not a location. */
export const SRI_LANKA_BOUNDS = { minLat: 5.8, maxLat: 9.9, minLng: 79.5, maxLng: 82.0 } as const;

export function withinSriLanka(p: LatLng): boolean {
  return (
    Number.isFinite(p.lat) &&
    Number.isFinite(p.lng) &&
    p.lat >= SRI_LANKA_BOUNDS.minLat &&
    p.lat <= SRI_LANKA_BOUNDS.maxLat &&
    p.lng >= SRI_LANKA_BOUNDS.minLng &&
    p.lng <= SRI_LANKA_BOUNDS.maxLng
  );
}

const EARTH_RADIUS_KM = 6371.0088;

export function haversineKm(a: LatLng, b: LatLng): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** How much longer a real road is than the crow flies, by the district's road class. */
export const ROAD_FACTOR: Record<RoadClass, number> = {
  urban: 1.35,
  suburban: 1.3,
  highway: 1.2,
  hill: 1.5,
};

/** A leg estimated from straight-line distance, for when the road network is unavailable. */
export function estimateLeg(
  from: LatLng,
  to: LatLng,
  roadClass: RoadClass,
  freeFlowKmh: number,
): { min: number; km: number } {
  const km = haversineKm(from, to) * ROAD_FACTOR[roadClass];
  return { km, min: freeFlowKmh > 0 ? (km / freeFlowKmh) * 60 : 0 };
}

/** FNV-1a, 32 bit. Used for deterministic spreading; not for anything secret. */
export function fnv1a(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

const SPREAD_KM: Record<RoadClass, number> = { urban: 3, suburban: 5, highway: 6, hill: 6 };

/**
 * A stable stand-in position for an outlet with none: the id picks an angle and
 * a distance from the district centre, so the same outlet is always in the same
 * place and no two sit on each other.
 */
export function syntheticOutletPosition(outletId: string, centre: LatLng, roadClass: RoadClass): LatLng {
  const h = fnv1a(outletId);
  const angle = ((h & 0xffff) / 0x10000) * 2 * Math.PI;
  // sqrt for an even spread over the disc rather than a bunch at the centre.
  const radiusKm = Math.sqrt(((h >>> 16) + 1) / 0x10000) * SPREAD_KM[roadClass];
  const dLat = (radiusKm * Math.sin(angle)) / 111.32;
  const dLng = (radiusKm * Math.cos(angle)) / (111.32 * Math.cos((centre.lat * Math.PI) / 180));
  return { lat: round5(centre.lat + dLat), lng: round5(centre.lng + dLng) };
}

const round5 = (n: number) => Math.round(n * 1e5) / 1e5;
