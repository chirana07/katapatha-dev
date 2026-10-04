import { describe, expect, it } from "vitest";
import {
  DEPOT_POSITIONS,
  DISTRICT_POSITIONS,
  estimateLeg,
  haversineKm,
  syntheticOutletPosition,
  withinSriLanka,
} from "./geography";
import { decodePolyline, encodePolyline } from "./polyline";
import { buildTravelMatrix, depotKey, leg, outletKey, travelFromDistricts } from "./travel";
import { DISTRICTS, outlet } from "../validation/fixtures";

describe("haversineKm", () => {
  it("is zero for the same point and symmetric", () => {
    const a = DEPOT_POSITIONS.Peliyagoda!;
    const b = DISTRICT_POSITIONS.Kandy!;
    expect(haversineKm(a, a)).toBe(0);
    expect(haversineKm(a, b)).toBeCloseTo(haversineKm(b, a), 9);
  });

  it("puts Colombo and Kandy about 94 km apart", () => {
    expect(haversineKm(DISTRICT_POSITIONS.Colombo!, DISTRICT_POSITIONS.Kandy!)).toBeGreaterThan(88);
    expect(haversineKm(DISTRICT_POSITIONS.Colombo!, DISTRICT_POSITIONS.Kandy!)).toBeLessThan(100);
  });
});

describe("estimateLeg", () => {
  it("lengthens the straight line by the road factor and converts at free-flow speed", () => {
    const a = DISTRICT_POSITIONS.Colombo!;
    const b = DISTRICT_POSITIONS.Gampaha!;
    const crow = haversineKm(a, b);
    const e = estimateLeg(a, b, "urban", 30);
    expect(e.km).toBeCloseTo(crow * 1.35, 9);
    expect(e.min).toBeCloseTo((e.km / 30) * 60, 9);
  });
});

describe("syntheticOutletPosition", () => {
  const centre = DISTRICT_POSITIONS.Puttalam!;

  it("is the same for the same outlet and differs between outlets", () => {
    expect(syntheticOutletPosition("OUT074", centre, "suburban")).toEqual(
      syntheticOutletPosition("OUT074", centre, "suburban"),
    );
    expect(syntheticOutletPosition("OUT074", centre, "suburban")).not.toEqual(
      syntheticOutletPosition("OUT075", centre, "suburban"),
    );
  });

  it("stays inside Sri Lanka and within the spread of its district", () => {
    for (let i = 0; i < 200; i++) {
      const p = syntheticOutletPosition(`OUT${i}`, centre, "hill");
      expect(withinSriLanka(p)).toBe(true);
      expect(haversineKm(centre, p)).toBeLessThanOrEqual(6.05);
    }
  });
});

describe("withinSriLanka", () => {
  it("refuses a pin in the sea or a swapped lat/lng", () => {
    expect(withinSriLanka({ lat: 6.93, lng: 79.86 })).toBe(true);
    expect(withinSriLanka({ lat: 79.86, lng: 6.93 })).toBe(false);
    expect(withinSriLanka({ lat: Number.NaN, lng: 80 })).toBe(false);
  });
});

describe("polyline", () => {
  it("matches the published reference encoding at precision 5", () => {
    const pts = [
      { lat: 38.5, lng: -120.2 },
      { lat: 40.7, lng: -120.95 },
      { lat: 43.252, lng: -126.453 },
    ];
    expect(encodePolyline(pts, 5)).toBe("_p~iF~ps|U_ulLnnqC_mqNvxq`@");
  });

  it("round-trips at precision 6", () => {
    const pts = [
      { lat: 6.968912, lng: 79.893601 },
      { lat: 7.090001, lng: 79.999987 },
      { lat: 7.0, lng: 80.0 },
    ];
    const back = decodePolyline(encodePolyline(pts));
    expect(back).toHaveLength(3);
    back.forEach((p, i) => {
      expect(p.lat).toBeCloseTo(pts[i]!.lat, 6);
      expect(p.lng).toBeCloseTo(pts[i]!.lng, 6);
    });
  });

  it("refuses a truncated string", () => {
    expect(() => decodePolyline("_p~iF~ps|")).toThrow();
  });
});

describe("travel matrix", () => {
  const keys = [outletKey("B"), depotKey("Peliyagoda"), outletKey("A")];
  const m = buildTravelMatrix(keys, (a, b) => ({ min: a.length + b.length, km: 1 }), "estimate");

  it("indexes keys in sorted order and zeroes the diagonal", () => {
    expect(m.keys).toEqual([...keys].sort());
    expect(leg(m, outletKey("A"), outletKey("A"))).toEqual({ min: 0, km: 0 });
  });

  it("reads a leg by key and rejects an unknown one", () => {
    expect(leg(m, depotKey("Peliyagoda"), outletKey("A")).km).toBe(1);
    expect(() => leg(m, outletKey("A"), outletKey("Z"))).toThrow(/no leg/);
  });
});

describe("travelFromDistricts", () => {
  const m = travelFromDistricts(
    "Peliyagoda",
    [outlet("A"), outlet("B"), outlet("G", { district: "Gampaha" })],
    DISTRICTS,
  );

  it("reproduces the table: the way out to a district, and the hop between stops in it", () => {
    // Colombo: 24 min / 12 km out, 8 min / 4 km between stops.
    expect(leg(m, depotKey("Peliyagoda"), outletKey("A"))).toEqual({ min: 24, km: 12 });
    expect(leg(m, outletKey("A"), outletKey("B"))).toEqual({ min: 8, km: 4 });
  });

  it("brings the vehicle home by the way it went out", () => {
    expect(leg(m, outletKey("B"), depotKey("Peliyagoda"))).toEqual({ min: 24, km: 12 });
  });

  it("answers a pair from two districts, by way of the depot, though no trip uses it", () => {
    // Gampaha: 37 min / 28 km out.
    expect(leg(m, outletKey("A"), outletKey("G"))).toEqual({ min: 24 + 37, km: 12 + 28 });
  });

  it("says it is an estimate, not the road", () => {
    expect(m.source).toBe("estimate");
  });

  it("gives an outlet in an unknown district zero legs rather than failing", () => {
    const odd = travelFromDistricts("Peliyagoda", [outlet("Z", { district: "Atlantis" })], DISTRICTS);
    expect(leg(odd, depotKey("Peliyagoda"), outletKey("Z"))).toEqual({ min: 0, km: 0 });
  });
});
