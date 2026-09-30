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
