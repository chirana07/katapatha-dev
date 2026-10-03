import { DataTableAlt, Legend, Responsive } from "./chart-shell";
import {
  areaPath,
  labelIndexes,
  linePath,
  percentDomain,
  runsOf,
  scaleLinear,
  spreadX,
  type Point,
} from "./chart-math";

export interface LinePoint {
  /** Axis label, e.g. "Thu 9 Apr". */
  label: string;
  /** Null: no data that day. The line breaks there; it is never drawn as zero. */
  value: number | null;
  /** The hover/alt text, e.g. "94.2% (118 of 125 stops)". */
  detail: string;
}

/**
 * The on-time line, as server-drawn SVG: a percentage per day against a target
 * line. Days with no data leave a gap. Hover text comes from <title> on each
 * point; the same numbers are in the screen-reader table, and the page offers
 * them visibly too, since a tooltip does not exist on a phone.
 */
export function PercentLineChart({
  title,
  points,
  target,
  targetLabel,
  seriesLabel,
}: {
  title: string;
  points: LinePoint[];
  target: number | null;
  targetLabel: string;
  seriesLabel: string;
}) {
  const known = points.filter((p) => p.value !== null).length;
  const summary = `${title}. ${known} of ${points.length} days have data${target !== null ? `; ${targetLabel}` : ""}.`;

  return (
    <figure>
      <figcaption className="mb-2">
        <Legend
          items={[
            { label: seriesLabel, tone: "link", line: true },
            ...(target !== null ? [{ label: targetLabel, tone: "warn" as const, dashed: true }] : []),
          ]}
        />
      </figcaption>
      <Responsive
        wide={<Drawing width={1040} height={280} compact={false} points={points} target={target} summary={summary} />}
        medium={<Drawing width={640} height={260} compact={false} points={points} target={target} summary={summary} />}
        narrow={<Drawing width={340} height={240} compact points={points} target={target} summary={summary} />}
      />
      <DataTableAlt
        caption={title}
        columns={[seriesLabel]}
        rows={points.map((p) => ({ label: p.label, cells: [p.detail] }))}
      />
    </figure>
  );
}

function Drawing({
  width,
  height,
  compact,
  points,
  target,
  summary,
}: {
  width: number;
  height: number;
  compact: boolean;
  points: LinePoint[];
  target: number | null;
  summary: string;
}) {
  const margin = { top: 14, right: compact ? 10 : 16, bottom: 30, left: compact ? 34 : 42 };
  const left = margin.left;
  const right = width - margin.right;
  const top = margin.top;
  const bottom = height - margin.bottom;

  const domain = percentDomain(
    points.flatMap((p) => (p.value === null ? [] : [p.value])),
    target,
  );
  const y = scaleLinear([domain.lo, domain.hi], [bottom, top]);
  const xs = spreadX(points.length, left + 8, right - 8);
  const dots: (Point | null)[] = points.map((p, i) => (p.value === null ? null : { x: xs[i]!, y: y(p.value) }));
  const runs = runsOf(dots);
  const showMarkers = points.length <= (compact ? 14 : 31);
  const labels = labelIndexes(points.length, compact ? 4 : 7);

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={summary}
      className="block h-auto w-full"
    >
      {domain.ticks.map((tick) => (
        <g key={tick}>
          <line x1={left} x2={right} y1={y(tick)} y2={y(tick)} className="stroke-line" strokeWidth={1} />
          <text x={left - 6} y={y(tick) + 4} textAnchor="end" className="fill-muted text-[11px]">
            {tick}%
          </text>
        </g>
      ))}

      <path d={areaPath(runs, bottom)} className="fill-info/10" />
      {target !== null ? (
        <line
          x1={left}
          x2={right}
          y1={y(target)}
          y2={y(target)}
          className="stroke-warn"
          strokeWidth={1.5}
          strokeDasharray="5 4"
        />
      ) : null}
      <path d={linePath(runs)} fill="none" className="stroke-link" strokeWidth={2.25} strokeLinejoin="round" strokeLinecap="round" />

      {points.map((p, i) =>
        dots[i] && (showMarkers || runs.every((r) => r.length === 1)) ? (
          <circle key={p.label} cx={dots[i]!.x} cy={dots[i]!.y} r={3.5} className="fill-surface stroke-link" strokeWidth={2}>
            <title>{`${p.label}: ${p.detail}`}</title>
          </circle>
        ) : null,
      )}

      {labels.map((i) => (
        <text
          key={points[i]!.label}
          x={xs[i]}
          y={height - 10}
          textAnchor={i === 0 ? "start" : i === points.length - 1 ? "end" : "middle"}
          className="fill-muted text-[11px]"
        >
          {points[i]!.label}
        </text>
      ))}
    </svg>
  );
}
