import Link from "next/link";
import { Glyph } from "@/components/ui/glyph";
import { StatCard, StatRow } from "@/components/ui/stat-card";
import { EmptyState } from "@/components/ui/states";
import { plural } from "@/lib/format";
import { readOf } from "@/lib/read-result";
import { PercentLineChart } from "./charts/line-chart";
import { MeterBar, RankedBars } from "./charts/meter-bar";
import { DailyTable } from "./daily-table";
import { OutletTable } from "./outlet-table";
import { Note, ReportCard, ReportError, ReportFrame } from "./report-frame";
import { changeText, countText, dayLabel, kindWords, pctText } from "./report-format";
import { prepare, signInIfExpired } from "./load";
import { reportHref } from "./report-params";

export const metadata = { title: "Reports · Katapatha" };

const HERE = "/dispatcher/reports";

export default async function ReportsOverviewPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { requested, client } = await prepare(searchParams, HERE);
  const result = await readOf(client.GET("/reports/overview", { params: { query: requested } }));
  signInIfExpired(result, HERE);

  if (!result.ok) {
    return (
      <ReportFrame active="overview" requested={requested} shown={requested}>
        <ReportError failure={result} what="the overview report" />
      </ReportFrame>
    );
  }

  const r = result.data;
  const shown = { from: r.from, to: r.to };
  const onTimeChange = changeText(r.onTime.vsPreviousPts, "pts vs previous period", "up");
  const discChange = changeText(r.discrepancies.vsPrevious, "vs previous period", "down");
  const depot = r.utilisationByDepot[0];
  const points = r.onTimeSeries.map((day) => ({
    label: dayLabel(day.date),
    value: day.onTimePct,
    detail:
      day.onTimePct === null
        ? "no stop had a recorded arrival"
        : `${pctText(day.onTimePct)} (${day.onTime} of ${day.total} stops${day.source === "history" ? ", from history" : ""})`,
  }));

  return (
    <ReportFrame active="overview" requested={requested} shown={shown} source={r}>
      <StatRow>
        <StatCard
          icon={<Glyph name="check" />}
          value={pctText(r.onTime.pct)}
          label="On-time delivery"
          foot={
            <>
              {r.onTime.pct === null ? "No stop had a recorded arrival" : [onTimeChange?.text, `target ${pctText(r.onTime.targetPct)}`].filter(Boolean).join(" · ")}
              {r.onTime.note ? <Note>{r.onTime.note}</Note> : null}
            </>
          }
          footTone={r.onTime.pct === null ? "neutral" : (onTimeChange?.tone ?? "neutral")}
        />
        <StatCard
          icon={<Glyph name="box" />}
          value={countText(r.orders.delivered)}
          label="Orders delivered"
          foot={
            <>
              {`of ${countText(r.orders.planned)} planned · ${countText(r.orders.deferred)} deferred`}
              {r.orders.note ? <Note>{r.orders.note}</Note> : null}
            </>
          }
        />
        <StatCard
          icon={<Glyph name="truck" />}
          value={pctText(r.utilisation.pct)}
          label="Fleet utilisation"
          foot={
            <>
              {r.utilisation.pct === null
                ? `Target ${pctText(r.utilisation.targetPct)}`
                : `Target ${pctText(r.utilisation.targetPct)} · ${plural(r.utilisation.trips, "trip")} on ${plural(r.utilisation.vehicles, "vehicle")}`}
              {r.utilisation.note ? <Note>{r.utilisation.note}</Note> : null}
            </>
          }
        />
        <StatCard
          icon={<Glyph name="alert" />}
          value={countText(r.discrepancies.count)}
          label="Discrepancies"
          foot={
            <>
              {r.discrepancies.count === null
                ? "Not recorded for these days"
                : [r.discrepancies.pctOfOrders === null ? null : `${pctText(r.discrepancies.pctOfOrders)} of orders`, discChange?.text].filter(Boolean).join(" · ")}
              {r.discrepancies.note ? <Note>{r.discrepancies.note}</Note> : null}
            </>
          }
          footTone={r.discrepancies.count === null ? "neutral" : (discChange?.tone ?? "neutral")}
        />
      </StatRow>

      <div className="grid gap-5 xl:grid-cols-3">
        <ReportCard wide title="On-time delivery" subtitle="Share of stops where the vehicle arrived before the outlet's window closed">
          {points.some((p) => p.value !== null) ? (
            <>
              <PercentLineChart
                title="On-time delivery by day"
                points={points}
                target={r.onTime.targetPct}
                targetLabel={`Target ${pctText(r.onTime.targetPct)}`}
                seriesLabel="On-time"
              />
              <DailyTable
                summary="Show the daily figures"
                head={["Day", "On time", "Stops", "Share", "Source"]}
                rows={r.onTimeSeries.map((d) => ({
                  key: d.date,
                  cells: [dayLabel(d.date), d.onTime, d.total, pctText(d.onTimePct), d.source === "none" ? "No data" : d.source === "live" ? "Katapatha" : "History"],
                }))}
              />
            </>
          ) : (
            <EmptyState title="No arrivals recorded in this range" detail="Pick a range that includes days with deliveries." />
          )}
        </ReportCard>

        <ReportCard title="Fleet utilisation" subtitle="Mean trip load against vehicle volume capacity">
          {depot ? (
            <div>
              <div className="flex items-baseline justify-between gap-3">
                <div>
                  <p className="font-semibold text-ink">{depot.depotCode} DC</p>
                  <p className="text-xs text-muted">{plural(depot.vehicles, "vehicle")}</p>
                </div>
                <p className="tabular text-xl font-bold text-ink">{pctText(depot.utilisationPct)}</p>
              </div>
              <div className="mt-2">
                <MeterBar
                  value={depot.utilisationPct}
                  target={depot.targetPct}
                  tone={depot.utilisationPct !== null && depot.utilisationPct >= depot.targetPct ? "good" : "link"}
                  label={`Fleet utilisation ${pctText(depot.utilisationPct)}, target ${pctText(depot.targetPct)}`}
                />
              </div>
              {depot.utilisationPct === null && r.utilisation.note ? <p className="mt-2 text-xs text-muted">{r.utilisation.note}</p> : null}
              <p className="mt-4 text-xs text-muted">Marker = {pctText(depot.targetPct)} target</p>
            </div>
          ) : (
            <EmptyState title="No vehicles reported" />
          )}
        </ReportCard>

        <ReportCard
          wide
          title="Outlet performance"
          aside={
            <Link href={reportHref("/dispatcher/reports/outlets", requested)} className="inline-flex min-h-11 items-center text-sm font-semibold text-link hover:underline">
              View all {r.totalOutlets} outlets →
            </Link>
          }
        >
          {r.topOutlets.length ? <OutletTable outlets={r.topOutlets} /> : <EmptyState title="No outlets in this range" />}
        </ReportCard>

        <ReportCard title="Top exceptions" aside={<span className="text-sm text-muted">{r.topExceptions.total} total</span>}>
          {r.topExceptions.items.length ? (
            <>
              <RankedBars
                label="Exceptions by kind"
                items={r.topExceptions.items.slice(0, 6).map((item) => ({ key: item.kind, label: item.label || kindWords(item.kind), count: item.count }))}
              />
              <Link href={reportHref("/dispatcher/reports/exceptions", requested)} className="mt-4 inline-flex min-h-11 items-center text-sm font-semibold text-link hover:underline">
                All exceptions →
              </Link>
            </>
          ) : (
            <EmptyState title="No exceptions recorded" detail="Nothing was reported in this range." />
          )}
        </ReportCard>
      </div>
    </ReportFrame>
  );
}
