import Link from "next/link";
import { DataTable, RowCard, Td, Th, Tr } from "@/components/ui/data-table";
import { StatCard, StatRow } from "@/components/ui/stat-card";
import { EmptyState } from "@/components/ui/states";
import { StatusPill } from "@/components/ui/status-pill";
import { plural } from "@/lib/format";
import { readOf } from "@/lib/read-result";
import { BarChart } from "../charts/bar-chart";
import { compactNumber } from "../charts/chart-math";
import { prepare, signInIfExpired } from "../load";
import { Note, ReportCard, ReportError, ReportFrame } from "../report-frame";
import { DASH, pctText, weekDatesText, weekLabel } from "../report-format";
import { reportHref } from "../report-params";
import { ActionCard } from "./action-card";
import { chilledCategories, demandCategories, levelTone, parseWeekParam, reeferTripsText, weekParam } from "./capacity-model";

export const metadata = { title: "Capacity forecast · Katapatha" };

const HERE = "/dispatcher/reports/capacity-forecast";
const BRANDS = ["Fresh", "Style", "Tech"] as const;

export default async function CapacityForecastPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { params, requested, client } = await prepare(searchParams, HERE);
  const askedBrand = Array.isArray(params.brand) ? params.brand[0] : params.brand;
  const brand = BRANDS.find((b) => b === askedBrand);
  const focus = parseWeekParam(params.week);
  const keep = { brand };

  const result = await readOf(client.GET("/reports/capacity-forecast", { params: { query: { ...requested, ...(brand ? { brand } : {}) } } }));
  signInIfExpired(result, HERE);

  if (!result.ok) {
    return (
      <ReportFrame active="capacity" requested={requested} shown={requested} keep={keep}>
        <ReportError failure={result} what="the capacity forecast" />
      </ReportFrame>
    );
  }

  const f = result.data;
  const weekHref = (week: { isoYear: number; isoWeek: number } | null) =>
    reportHref(HERE, requested, { brand, week: week ? weekParam(week) : undefined });

  // A focused week lists every action on it, including the rejected ones the
  // recommendations leave out; otherwise the recommendations are shown.
  let actions = f.recommendedActions;
  let focusWeek = null as (typeof f.weeks)[number] | null;
  let focusFailed = false;
  if (focus) {
    focusWeek = f.weeks.find((w) => w.isoYear === focus.isoYear && w.isoWeek === focus.isoWeek) ?? null;
    const list = await readOf(
      client.GET("/capacity-actions", { params: { query: { isoYear: String(focus.isoYear), isoWeek: String(focus.isoWeek) } } }),
    );
    if (list.ok) actions = list.data.items;
    else focusFailed = true;
  }

  const peak = f.peakWeek;
  const chilledPeak = f.chilledPeak;
  const short = f.reeferShortfallWeeks;
  const regardBrand = brand ? `${brand} only` : "All brands";

  return (
    <ReportFrame active="capacity" requested={requested} shown={{ from: f.from ?? undefined, to: f.to ?? undefined }} keep={keep} source={f}>
      <StatRow>
        <StatCard
          value={peak ? `${weekLabel(peak.isoWeek)} · ${weekDatesText(peak.startDate, peak.endDate)}` : DASH}
          label="Peak week"
          foot={
            peak
              ? [peak.signals.join(", "), peak.vsRecentPct === null ? null : `${peak.vsRecentPct > 0 ? "+" : ""}${peak.vsRecentPct}% vs last 4 known weeks`].filter(Boolean).join(" · ")
              : "No weeks in this range"
          }
        />
        <StatCard
          value={chilledPeak ? `${compactNumber(chilledPeak.chilledM3)} m³ / week` : DASH}
          label="Chilled peak"
          foot={
            chilledPeak
              ? `${weekLabel(chilledPeak.isoWeek)}${chilledPeak.vsRecentPct === null ? "" : ` · ${chilledPeak.vsRecentPct > 0 ? "+" : ""}${chilledPeak.vsRecentPct}% vs last 4 known weeks`}`
              : undefined
          }
        />
        <StatCard
          value={`${short.count} of ${plural(short.of, "week")}`}
          label="Reefer shortfall"
          tone={short.count > 0 ? "bad" : "neutral"}
          foot={short.count > 0 ? `Up to ${plural(short.maxTripsPerDayShort, "reefer trip")} a day short` : "Every forecast week is covered"}
          footTone={short.count > 0 ? "bad" : "neutral"}
        />
        <StatCard
          value={f.forecastErrorPct === null ? DASH : `± ${pctText(f.forecastErrorPct)}`}
          label="Forecast error"
          foot={
            f.forecastErrorPct === null
              ? f.forecastError.note
              : `Backtested on the last ${f.forecastError.weeksTested} weeks, ${f.forecastError.leadWeeks} ${f.forecastError.leadWeeks === 1 ? "week" : "weeks"} ahead`
          }
        />
      </StatRow>

      <div className="grid gap-5 xl:grid-cols-3">
        <ReportCard wide title="Weekly demand vs fleet capacity" subtitle={`${f.depotCode} · ${regardBrand} · m³ per week`}>
          {f.weeks.length ? (
            <BarChart
              title="Weekly demand against fleet capacity"
              unit="m³"
              series={[
                { label: "Chilled", tone: "link" },
                { label: "Ambient", tone: "soft" },
              ]}
              categories={demandCategories(f.weeks)}
              limit={{ label: "Fleet capacity", values: f.weeks.map((w) => w.fleetCapacityM3) }}
            />
          ) : (
            <EmptyState title="No weeks in this range" />
          )}
        </ReportCard>
        <ReportCard title="Chilled demand vs reefer capacity" subtitle={`Chilled only · m³ per week · ${plural(f.reeferCount, "refrigerated vehicle")}`}>
          {f.weeks.length ? (
            <BarChart
              title="Chilled demand against reefer capacity"
              unit="m³"
              series={[{ label: "Chilled", tone: "link" }]}
              alertTone="bad"
              categories={chilledCategories(f.weeks)}
              limit={{ label: "Reefer capacity", values: f.weeks.map((w) => w.chilledCapacityM3) }}
            />
          ) : (
            <EmptyState title="No weeks in this range" />
          )}
        </ReportCard>
      </div>

      <div className="grid gap-5 xl:grid-cols-3">
        <ReportCard
          wide
          title="Plan by week"
          aside={
            <nav aria-label="Filter by brand" className="flex flex-wrap gap-2">
              {[undefined, ...BRANDS].map((b) => (
                <Link
                  key={b ?? "all"}
                  href={reportHref(HERE, requested, { brand: b })}
                  aria-current={b === brand ? "true" : undefined}
                  className={`inline-flex min-h-9 items-center rounded-full border px-3 text-sm font-semibold ${
                    b === brand ? "border-rail bg-rail text-white" : "border-line bg-surface text-ink hover:bg-raised"
                  }`}
                >
                  {b ?? "All brands"}
                </Link>
              ))}
            </nav>
          }
        >
          {f.weeks.length === 0 ? (
            <EmptyState title="No weeks in this range" detail="Pick a range that includes weeks with a forecast or history." />
          ) : (
            <DataTable
              caption="Plan by week"
              head={
                <tr>
                  <Th>Week</Th>
                  <Th>Dates</Th>
                  <Th>Signals</Th>
                  <Th numeric>Total m³</Th>
                  <Th numeric>Chilled m³</Th>
                  <Th numeric>Reefer trips/day</Th>
                  <Th>Action</Th>
                </tr>
              }
              cards={f.weeks.map((w) => (
                <RowCard key={weekParam(w)}>
                  <div className="flex items-start justify-between gap-2">
                    <Link href={`${weekHref(w)}#actions`} className="font-semibold text-link hover:underline">
                      {weekLabel(w.isoWeek)} · {weekDatesText(w.startDate, w.endDate)}
                    </Link>
                    <StatusPill label={w.action} tone={levelTone(w.level)} />
                  </div>
                  <p className="mt-1 text-xs text-muted">
                    {w.kind === "forecast" ? "Forecast" : "Actual"}
                    {w.signals.length ? ` · ${w.signals.join(", ")}` : ""}
                  </p>
                  <p className="tabular mt-1 text-xs text-muted">
                    {compactNumber(w.totalM3)} m³ total · {compactNumber(w.chilledM3)} chilled · reefer trips/day {reeferTripsText(w)}
                  </p>
                </RowCard>
              ))}
            >
              {f.weeks.map((w) => (
                <Tr key={weekParam(w)} selected={focus !== null && weekParam(w) === weekParam(focus)}>
                  <Td>
                    <Link href={`${weekHref(w)}#actions`} className="font-semibold text-link hover:underline">
                      {weekLabel(w.isoWeek)}
                    </Link>
                    <span className="block text-xs text-muted">{w.kind === "forecast" ? "forecast" : "actual"}</span>
                  </Td>
                  <Td>
                    <span className="whitespace-nowrap">{weekDatesText(w.startDate, w.endDate)}</span>
                  </Td>
                  <Td>{w.signals.length ? w.signals.join(", ") : DASH}</Td>
                  <Td numeric>{compactNumber(w.totalM3)}</Td>
                  <Td numeric>{compactNumber(w.chilledM3)}</Td>
                  <Td numeric>
                    <span className={w.reeferTripsPerDay.shortfall > 0 ? "font-semibold text-bad-ink" : ""}>{reeferTripsText(w)}</span>
                  </Td>
                  <Td>
                    <StatusPill label={w.action} tone={levelTone(w.level)} dot={false} />
                  </Td>
                </Tr>
              ))}
            </DataTable>
          )}
          <Note>
            {f.forecastMethod ?? "Forecast method not recorded"}
            {f.forecastGeneratedAt ? ` · generated ${new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Colombo", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(f.forecastGeneratedAt))}` : ""}
          </Note>
          <details className="mt-2 text-sm">
            <summary className="inline-flex min-h-11 cursor-pointer items-center font-semibold text-link">What these numbers assume</summary>
            <ul className="mt-1 list-disc space-y-1 pl-5 text-muted">
              {f.assumptions.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </details>
        </ReportCard>

        <section id="actions" className="scroll-mt-4">
          <ReportCard
            title={focus ? `Actions for ${weekLabel(focus.isoWeek)}${focusWeek ? ` · ${weekDatesText(focusWeek.startDate, focusWeek.endDate)}` : ""}` : "Recommended actions"}
            subtitle={focus ? "Every action on this week, including rejected ones" : "Largest relief first"}
            aside={
              focus ? (
                <Link href={weekHref(null)} className="inline-flex min-h-11 items-center text-sm font-semibold text-link hover:underline">
                  Show all recommended
                </Link>
              ) : undefined
            }
          >
            {focusFailed ? (
              <EmptyState title="That week's actions could not be loaded" detail="Reload to try again." />
            ) : actions.length === 0 ? (
              <EmptyState
                title="No actions proposed"
                detail={focus ? "Nothing has been proposed for this week." : "Every forecast week in this range is covered."}
              />
            ) : (
              <ul className="flex flex-col gap-3">
                {actions.map((action, index) => (
                  <ActionCard key={action.id} action={action} index={index} />
                ))}
              </ul>
            )}
          </ReportCard>
        </section>
      </div>
    </ReportFrame>
  );
}
