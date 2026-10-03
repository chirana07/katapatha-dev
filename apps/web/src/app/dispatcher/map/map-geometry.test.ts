import { describe, expect, it } from "vitest";
import { DEPOT_POSITIONS, DISTRICT_POSITIONS, positionFor } from "@katapatha/core/domain/geography";
import { fitViewport, placeLabels } from "./map-geometry";

describe("fitViewport", () => {
  const depot = DEPOT_POSITIONS.Peliyagoda!;
  const puttalam = positionFor("Puttalam")!;
  const colombo = positionFor("Colombo")!;
  const view = fitViewport([depot, puttalam, colombo]);

  it("puts north above south and west left of east", () => {
    const north = view.project(puttalam);
    const south = view.project(colombo);
    expect(north.y).toBeLessThan(south.y);
    const west = view.project({ lat: 7, lng: 79.8 });
    const east = view.project({ lat: 7, lng: 80.8 });
    expect(west.x).toBeLessThan(east.x);
  });

  it("keeps every fitted point inside the padded frame", () => {
    for (const p of [depot, puttalam, colombo]) {
      expect(view.contains(view.project(p), 72 - 1)).toBe(true);
    }
  });

  it("scales longitude by cos(latitude) so a degree east is a little shorter than a degree north", () => {
    const o = view.project({ lat: 7, lng: 80 });
    const east = view.project({ lat: 7, lng: 81 });
    const north = view.project({ lat: 8, lng: 80 });
    const dx = east.x - o.x;
    const dy = o.y - north.y;
    // The fitted midpoint latitude is halfway between Colombo and Puttalam.
    const mid = (puttalam.lat + colombo.lat) / 2;
    expect(dx / dy).toBeCloseTo(Math.cos((mid * Math.PI) / 180), 2);
  });

  it("does not zoom in past the minimum span for a single point", () => {
    const single = fitViewport([depot]);
    const nearby = single.project({ lat: depot.lat + 0.1, lng: depot.lng });
    const centre = single.project(depot);
    // 0.1 degree is a sixth of the minimum span, so well under a third of the frame.
    expect(centre.y - nearby.y).toBeLessThan(single.height / 3);
    expect(centre).toEqual({ x: 480, y: 360 });
  });

  it("fits into the space left of a reserved right-hand inset", () => {
    const inset = fitViewport([depot, puttalam, colombo], { insetRight: 400 });
    for (const p of [depot, puttalam, colombo]) {
      expect(inset.project(p).x).toBeLessThanOrEqual(960 - 400 - 72 + 1);
    }
  });

  it("gives up the reserved space when the picture is too wide to fit beside it", () => {
    const wide = fitViewport(Object.values(DISTRICT_POSITIONS), { insetRight: 600 });
    const plain = fitViewport(Object.values(DISTRICT_POSITIONS));
    const p = { lat: 7, lng: 80.2 };
    expect(wide.project(p)).toEqual(plain.project(p));
  });

  it("copes with an empty list", () => {
    const empty = fitViewport([]);
    expect(empty.width).toBe(960);
    expect(Number.isFinite(empty.project({ lat: 7, lng: 80 }).x)).toBe(true);
  });

  it("projects every district centroid to a finite point", () => {
    const wide = fitViewport(Object.values(DISTRICT_POSITIONS));
    for (const position of Object.values(DISTRICT_POSITIONS)) {
      const p = wide.project(position);
      expect(wide.contains(p)).toBe(true);
    }
  });
});

describe("placeLabels", () => {
  const frame = { width: 960, height: 720 };

  it("puts a lone tag to the right of its marker", () => {
    const placed = placeLabels([{ id: "A", at: { x: 100, y: 100 }, width: 60 }], [], frame);
    expect(placed.get("A")).toEqual({ x: 122, y: 88, width: 60, height: 24 });
  });

  it("moves a tag that would sit on another one", () => {
    const placed = placeLabels(
      [
        { id: "A", at: { x: 100, y: 100 }, width: 60 },
        { id: "B", at: { x: 100, y: 108 }, width: 60 },
      ],
      [],
      frame,
    );
    const a = placed.get("A")!;
    const b = placed.get("B")!;
    const apart = a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y;
    expect(apart).toBe(true);
  });

  it("keeps clear of obstacles such as the depot's label", () => {
    const depotLabel = { x: 110, y: 80, width: 100, height: 40 };
    const placed = placeLabels([{ id: "A", at: { x: 100, y: 100 }, width: 60 }], [depotLabel], frame);
    const a = placed.get("A")!;
    expect(a.x + a.width <= depotLabel.x || a.x >= depotLabel.x + depotLabel.width || a.y + a.height <= depotLabel.y || a.y >= depotLabel.y + depotLabel.height).toBe(true);
  });

  it("flips to the left at the right-hand edge so the tag stays in the frame", () => {
    const placed = placeLabels([{ id: "A", at: { x: 930, y: 100 }, width: 60 }], [], frame);
    const a = placed.get("A")!;
    expect(a.x + a.width).toBeLessThanOrEqual(960);
    expect(a.x).toBeLessThan(930);
  });

  it("drops a context label with no clear spot when strict", () => {
    const wall = { x: 0, y: 0, width: 960, height: 720 };
    const placed = placeLabels([{ id: "A", at: { x: 100, y: 100 }, width: 60 }], [wall], frame, { strict: true });
    expect(placed.has("A")).toBe(false);
  });

  it("places earlier anchors first, so the caller can give the selected vehicle priority", () => {
    const placed = placeLabels(
      [
        { id: "selected", at: { x: 100, y: 100 }, width: 60 },
        { id: "other", at: { x: 100, y: 100 }, width: 60 },
      ],
      [],
      frame,
    );
    expect(placed.get("selected")!.x).toBe(122);
    expect(placed.get("other")).not.toEqual(placed.get("selected"));
  });
});
