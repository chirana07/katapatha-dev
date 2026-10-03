import Link from "next/link";
import { DISTRICT_POSITIONS, positionFor, type LatLng } from "@katapatha/core/domain/geography";
import { fitViewport, placeLabels, type Box } from "./map-geometry";
import { plottable, reportedAt, STATE_VIEW, type MapVehicle } from "./map-view";

/**
 * The schematic map: depot and district centres joined by straight lines, with
 * each vehicle drawn where its driver's phone last reported it.
 *
 * It is a server-rendered inline SVG on purpose. There are no tiles and no road
 * geometry, so there is nothing a map library could add except the impression
 * of road routes the data cannot support. A leg is therefore the straight line
 * from the depot to the district the trip serves, and a vehicle marker is a
 * reported position — it need not lie on that line, and is not meant to.
 */

const LABEL_FONT = 16;

export function FleetMap({
  depotName,
  depot,
  vehicles,
  selectedId,
  hrefFor,
  insetRight = 0,
}: {
  depotName: string;
  depot: LatLng | null;
  vehicles: MapVehicle[];
  selectedId?: string;
  hrefFor: (vehicleId: string) => string;
  /** Viewbox units to keep clear on the right for the callout card. */
  insetRight?: number;
}) {
  const placed = plottable(vehicles);
  const served = new Map<string, LatLng>();
  for (const v of vehicles) {
    const at = positionFor(v.trip.districtName);
    if (at) served.set(v.trip.districtName, at);
  }

  const view = fitViewport([
    ...(depot ? [depot] : []),
    ...served.values(),
    ...placed.map((v) => ({ lat: v.position.lat, lng: v.position.lng })),
  ], { insetRight });
  const depotAt = depot ? view.project(depot) : null;

  // The other district centres give the picture its bearings, but only those
  // that fall inside the frame; the rest would just be edge clutter.
  const context = Object.entries(DISTRICT_POSITIONS)
    .filter(([name]) => !served.has(name))
    .map(([name, at]) => ({ name, at: view.project(at) }))
    .filter(({ at }) => view.contains(at, 24));

  // Draw the selected vehicle last so nothing covers it, but place its tag first
  // so it gets the clearest spot.
  const selectedLast = [...placed].sort((a, b) => Number(a.vehicleId === selectedId) - Number(b.vehicleId === selectedId));
  const points = new Map(placed.map((v) => [v.vehicleId, view.project({ lat: v.position.lat, lng: v.position.lng })]));

  const depotLabel: Box | null = depotAt
    ? { x: depotAt.x - 18 - (depotName.length + 3) * 8.6, y: depotAt.y - 12, width: (depotName.length + 3) * 8.6, height: 24 }
    : null;
  const markers: Box[] = [...points.values()].map((p) => ({ x: p.x - 16, y: p.y - 16, width: 32, height: 32 }));
  const fixed: Box[] = [
    ...(depotAt ? [{ x: depotAt.x - 13, y: depotAt.y - 13, width: 26, height: 26 }] : []),
    ...(depotLabel ? [depotLabel] : []),
    ...markers,
  ];

  // Destination names first (a district a vehicle is heading for matters more
  // than where a tag happens to fit), then the vehicle tags around them, then
  // the other districts only where there is room.
  const districtAnchors = [...served.entries()].map(([name, at]) => ({
    id: name,
    at: view.project(at),
    width: name.length * 8.6 + 8,
  }));
  const districtBoxes = placeLabels(districtAnchors, fixed, view, { height: 20, offset: 10 });
  const tags = placeLabels(
    [...placed]
      .sort((a, b) => Number(b.vehicleId === selectedId) - Number(a.vehicleId === selectedId))
      .map((v) => ({ id: v.vehicleId, at: points.get(v.vehicleId)!, width: v.vehicleId.length * 9 + 14 })),
    [...fixed, ...districtBoxes.values()],
    view,
  );
  const contextBoxes = placeLabels(
    context.map(({ name, at }) => ({ id: name, at, width: name.length * 7 + 6 })),
    [...fixed, ...districtBoxes.values(), ...tags.values()],
    view,
    { height: 18, offset: 9, strict: true },
  );

  return (
    <svg
      viewBox={`0 0 ${view.width} ${view.height}`}
      role="img"
      aria-label={`Schematic map of ${placed.length} vehicles around ${depotName}, drawn where each driver's phone last reported them`}
      className="block h-auto w-full min-w-[720px]"
    >
      <rect width={view.width} height={view.height} className="fill-raised" />

      {context.map(({ name, at }) => {
        const box = contextBoxes.get(name);
        return (
          <g key={name}>
            <circle cx={at.x} cy={at.y} r={4} className="fill-surface stroke-muted" strokeWidth={1.5} />
            {box ? (
              <text x={box.x} y={box.y + 13} fontSize={LABEL_FONT - 2} className="fill-muted">
                {name}
              </text>
            ) : null}
          </g>
        );
      })}

      {/* Planned legs: straight lines, one per trip, under everything else. */}
      {depotAt
        ? vehicles.map((v) => {
            const to = positionFor(v.trip.districtName);
            if (!to) return null;
            const end = view.project(to);
            const state = STATE_VIEW[v.state];
            return (
              <line
                key={`leg-${v.vehicleId}`}
                x1={depotAt.x}
                y1={depotAt.y}
                x2={end.x}
                y2={end.y}
                className={state.leg}
                strokeWidth={3}
                strokeLinecap="round"
                strokeOpacity={0.55}
                strokeDasharray={v.state === "LAMP" ? "8 6" : undefined}
              />
            );
          })
        : null}

      {[...served.entries()].map(([name, at]) => {
        const p = view.project(at);
        const box = districtBoxes.get(name)!;
        return (
          <g key={`dest-${name}`}>
            <circle cx={p.x} cy={p.y} r={6} className="fill-surface stroke-ink" strokeWidth={2} />
            <text x={box.x} y={box.y + 15} fontSize={LABEL_FONT} className="fill-ink" fontWeight={600}>
              {name}
            </text>
          </g>
        );
      })}

      {depotAt ? (
        <g>
          <rect x={depotAt.x - 11} y={depotAt.y - 11} width={22} height={22} rx={5} className="fill-navy" />
          <path
            d={`M${depotAt.x - 6} ${depotAt.y + 1}l6-6 6 6v6h-12z`}
            className="fill-none stroke-white"
            strokeWidth={1.8}
            strokeLinejoin="round"
          />
          <text x={depotAt.x - 18} y={depotAt.y + 5} textAnchor="end" fontSize={LABEL_FONT} fontWeight={700} className="fill-ink">
            {depotName} DC
          </text>
        </g>
      ) : null}

      {selectedLast.map((v) => {
        const p = points.get(v.vehicleId)!;
        const state = STATE_VIEW[v.state];
        const selected = v.vehicleId === selectedId;
        const lamp = v.state === "LAMP";
        const tag = tags.get(v.vehicleId)!;
        return (
          <Link
            key={v.vehicleId}
            href={hrefFor(v.vehicleId)}
            aria-label={`${v.vehicleId}, ${state.label}, last reported ${reportedAt(v.position)}`}
            aria-current={selected ? "true" : undefined}
          >
            {selected ? <circle cx={p.x} cy={p.y} r={22} className="fill-none stroke-ink" strokeWidth={2.5} /> : null}
            <circle
              cx={p.x}
              cy={p.y}
              r={14}
              className={`${state.fill} ${lamp ? state.stroke : "stroke-surface"}`}
              strokeWidth={lamp ? 3 : 2.5}
              strokeDasharray={lamp ? "4 3" : undefined}
            />
            {/* A small truck, white on a filled marker and amber on the hollow Lamp one. */}
            <g transform={`translate(${p.x - 8} ${p.y - 8}) scale(0.67)`} className={`fill-none ${lamp ? "stroke-warn" : "stroke-white"}`} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 7h13v10H3z" />
              <path d="M16 10h3l2 3v4h-5" />
            </g>
            <rect x={tag.x} y={tag.y} width={tag.width} height={tag.height} rx={6} className="fill-surface stroke-line" />
            <text x={tag.x + 7} y={tag.y + 17} fontSize={LABEL_FONT} fontWeight={700} className="fill-ink">
              {v.vehicleId}
            </text>
          </Link>
        );
      })}
    </svg>
  );
}
