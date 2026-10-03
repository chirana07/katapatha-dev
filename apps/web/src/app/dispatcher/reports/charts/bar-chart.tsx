import { DataTableAlt, Legend, Responsive } from "./chart-shell";
import { bands, compactNumber, labelIndexes, scaleLinear, stackSegments, zeroBasedTicks } from "./chart-math";
import { FILL, STROKE, type ChartTone } from "./tones";

export interface BarCategory {
  /** Axis label: "W45". */
  label: string;
  /** Under the label: "forecast", "short". Words, so colour is never the only signal. */
  sublabel?: string;
  /** One value per series, stacked in order. */
  values: number[];
  /** Painted in the alert tone (and its label too) when the bar is over its limit. */
  alert?: boolean;
  /** A forecast, not an observation: shaded behind. */
  forecast?: boolean;
  /** Text for the screen-reader table. */
  alt: string;
}

export interface BarSeries {
  label: string;
  tone: ChartTone;
}

export interface LimitLine {
  label: string;
  /** One level per category; null where there is none. Drawn across each category's band. */
  values: (number | null)[];
}

/**
 * Bars per category, stacked or single, with an optional limit drawn across
 * each band (capacity can differ week to week, so it is a step, not one line).
 * Server-drawn SVG; the numbers are repeated in a screen-reader table.
 */
export function BarChart({
  title,
  unit,
  categories,
  series,
  limit,
  alertTone = "bad",
}: {
  title: string;
  unit: string;
  categories: BarCategory[];
  series: BarSeries[];
  limit?: LimitLine;
  /** Applied to a bar's segments when its category is flagged. Only meaningful for single-series charts. */
  alertTone?: ChartTone;
}) {
  const alerts = categories.filter((c) => c.alert).length;
  const summary = `${title}. ${categories.length} periods${alerts ? `, ${alerts} over the limit` : ""}.`;
  const hasForecast = categories.some((c) => c.forecast);

  return (
    <figure>
      <figcaption className="mb-2">
        <Legend
          items={[
            ...series.map((s) => ({ label: s.label, tone: s.tone })),
            ...(limit ? [{ label: limit.label, tone: "warn" as const, dashed: true }] : []),
            ...(hasForecast ? [{ label: "Forecast weeks are shaded", tone: "muted" as const, line: true }] : []),
          ]}
        />
      </figcaption>
      <Responsive
        wide={<Drawing width={1040} height={300} compact={false} {...{ unit, categories, series, limit, alertTone, summary }} />}
        medium={<Drawing width={640} height={280} compact={false} {...{ unit, categories, series, limit, alertTone, summary }} />}
        narrow={<Drawing width={340} height={260} compact {...{ unit, categories, series, limit, alertTone, summary }} />}
      />
      <DataTableAlt
        caption={title}
        columns={[...series.map((s) => `${s.label} (${unit})`), ...(limit ? [`${limit.label} (${unit})`] : [])]}
        rows={categories.map((c, i) => ({
          label: c.alt,
          cells: [
            ...c.values.map((v) => compactNumber(v)),
            ...(limit ? [limit.values[i] === null || limit.values[i] === undefined ? "—" : compactNumber(limit.values[i]!)] : []),
          ],
        }))}
      />
    </figure>
  );
}

function Drawing({
  width,
  height,
  compact,
  unit,
  categories,
  series,
  limit,
  alertTone,
  summary,
}: {
  width: number;
  height: number;
  compact: boolean;
  unit: string;
  categories: BarCategory[];
  series: BarSeries[];
  limit?: LimitLine;
  alertTone: ChartTone;
  summary: string;
}) {
  const margin = { top: 20, right: 10, bottom: 44, left: compact ? 38 : 46 };
  const left = margin.left;
  const right = width - margin.right;
  const top = margin.top;
  const bottom = height - margin.bottom;

  const totals = categories.map((c) => c.values.reduce((a, v) => a + (v > 0 ? v : 0), 0));
  const limits = limit ? limit.values.flatMap((v) => (v === null ? [] : [v])) : [];
  const ticks = zeroBasedTicks(Math.max(0, ...totals, ...limits), compact ? 3 : 4);
  const y = scaleLinear([0, ticks[ticks.length - 1]!], [bottom, top]);
  const slots = bands(categories.length, left, right, compact ? 0.3 : 0.4);
  const labelled = new Set(labelIndexes(categories.length, compact ? 6 : 16));
  const firstForecast = categories.findIndex((c) => c.forecast);

  return (
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={summary} className="block h-auto w-full">
      {categories.map((c, i) =>
        c.forecast ? <rect key={`f${c.label}`} x={slots[i]!.x} y={top - 4} width={slots[i]!.width} height={bottom - top + 4} className="fill-raised" /> : null,
      )}
      {firstForecast >= 0 ? (
        <text x={slots[firstForecast]!.x + 4} y={top + 6} className="fill-muted text-[11px]">
          Forecast
        </text>
      ) : null}

      {ticks.map((tick) => (
        <g key={tick}>
          <line x1={left} x2={right} y1={y(tick)} y2={y(tick)} className="stroke-line" strokeWidth={1} />
          <text x={left - 6} y={y(tick) + 4} textAnchor="end" className="fill-muted text-[11px]">
            {tick >= 1000 ? `${compactNumber(tick / 1000)}k` : compactNumber(tick)}
          </text>
        </g>
      ))}
      <text x={4} y={top - 8} textAnchor="start" className="fill-muted text-[11px]">
        {unit}
      </text>

      {categories.map((c, i) => {
        const slot = slots[i]!;
        const segments = stackSegments(c.values, y);
        return (
          <g key={c.label}>
            <title>{c.alt}</title>
            {segments.map((segment, s) =>
              segment.height > 0 ? (
                <rect
                  key={s}
                  x={slot.barX}
                  y={segment.y}
                  width={slot.barWidth}
                  height={segment.height}
                  className={FILL[c.alert && series.length === 1 ? alertTone : series[s]!.tone]}
                />
              ) : null,
            )}
            {!compact && totals[i]! > 0 ? (
              <text x={slot.x + slot.width / 2} y={y(totals[i]!) - 5} textAnchor="middle" className="fill-ink text-[11px] font-semibold">
                {compactNumber(totals[i]!)}
              </text>
            ) : null}
            {labelled.has(i) ? (
              <>
                <text
                  x={slot.x + slot.width / 2}
                  y={bottom + 16}
                  textAnchor="middle"
                  className={`text-[11px] ${c.alert ? "fill-bad font-bold" : "fill-muted"}`}
                >
                  {c.label}
                </text>
                {c.sublabel ? (
                  <text x={slot.x + slot.width / 2} y={bottom + 29} textAnchor="middle" className={`text-[10px] ${c.alert ? "fill-bad" : "fill-muted"}`}>
                    {c.sublabel}
                  </text>
                ) : null}
              </>
            ) : null}
          </g>
        );
      })}

      {limit
        ? limit.values.map((value, i) =>
            value === null ? null : (
              <line
                key={`l${categories[i]!.label}`}
                x1={slots[i]!.x}
                x2={slots[i]!.x + slots[i]!.width}
                y1={y(value)}
                y2={y(value)}
                className={STROKE.warn}
                strokeWidth={2}
                strokeDasharray="5 3"
              />
            ),
          )
        : null}
    </svg>
  );
}
