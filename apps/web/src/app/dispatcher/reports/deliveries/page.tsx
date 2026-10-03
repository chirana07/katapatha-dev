import { Glyph } from "@/components/ui/glyph";
import { DataTable, RowCard, Td, Th, Tr } from "@/components/ui/data-table";
import { StatCard, StatRow } from "@/components/ui/stat-card";
import { EmptyState } from "@/components/ui/states";
import { BrandPill } from "@/components/ui/status-pill";
import { readOf } from "@/lib/read-result";
import { BarChart } from "../charts/bar-chart";
import { prepare, signInIfExpired } from "../load";
import { Note, ReportCard, ReportError, ReportFrame } from "../report-frame";
import { countText, dayLabel, deltaMinutesText, pctText } from "../report-format";

export const metadata = { title: "Delivery reports · Katapatha" };

const HERE = "/dispatcher/reports/deliveries";

export default async function DeliveriesReportPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { requested, client } = await prepare(searchParams, HERE);
  const result = await readOf(client.GET("/reports/deliveries", { params: { query: requested } }));
  signInIfExpired(result, HERE);

  if (!result.ok) {
    return (
      <ReportFrame active="deliveries" requested={requested} shown={requested}>
        <ReportError failure={result} what="the deliveries report" />
      </ReportFrame>
    );
  }

  const r = result.data;
  const t = r.totals;
  const hasDemand = r.days.some((d) => d.planned > 0);

  return (
    <ReportFrame active="deliveries" requested={requested} shown={{ from: r.from, to: r.to }} source={r}>
      <StatRow>
        <StatCard icon={<Glyph name="box" />} value={countText(t.planned)} label="Orders planned" foot="Deferred and never-run included" />
        <StatCard
          icon={<Glyph name="check" />}
          value={countText(t.delivered)}
          label="Delivered"
          foot={`${countText(t.deferred)} deferred · ${countText(t.undelivered)} not delivered`}
        />
        <StatCard
          icon={<Glyph name="clock" />}
          value={pctText(t.onTimePct)}
          label="On-time"
          foot={t.onTimePct === null ? "No stop had a recorded arrival" : `${countText(t.stops)} stops with a recorded arrival`}
        />
        <StatCard
          icon={<Glyph name="timer" />}
          value={deltaMinutesText(t.avgArrivalDeltaMin)}
          label="Avg. arrival against plan"
          foot={t.avgArrivalDeltaMin === null ? "No stop carried a planned arrival" : "Negative is earlier than planned"}
        />
      </StatRow>

      {r.notes.length ? (
        <ul className="flex flex-col gap-1 text-xs text-muted">
          {r.notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      ) : null}

      <ReportCard title="Orders by day" subtitle="Planned orders split by what became of them">
        {hasDemand ? (
          <BarChart
            title="Orders by day"
            unit="orders"
            series={[
              { label: "Delivered", tone: "good" },
              { label: "Deferred", tone: "warn" },
              { label: "Not delivered", tone: "bad" },
            ]}
            categories={r.days.map((d) => ({
              label: dayLabel(d.date),
              values: [d.delivered, d.deferred, d.undelivered],
              alt: `${dayLabel(d.date)}: ${d.planned} planned, ${d.delivered} delivered, ${d.deferred} deferred, ${d.undelivered} not delivered${d.source === "none" ? " (no data)" : ""}`,
            }))}
          />
        ) : (
          <EmptyState title="No orders in this range" detail="Pick a range that includes days with deliveries." />
        )}
      </ReportCard>

      <ReportCard title="By brand">
        <DataTable
          caption="Deliveries by brand"
          head={
            <tr>
              <Th>Brand</Th>
              <Th numeric>Planned</Th>
              <Th numeric>Delivered</Th>
              <Th numeric>Deferred</Th>
              <Th numeric>Not delivered</Th>
              <Th numeric>On-time</Th>
              <Th numeric>Avg. arrival</Th>
            </tr>
          }
          cards={r.byBrand.map((b) => (
            <RowCard key={b.brand}>
              <BrandPill brand={b.brand} />
              <dl className="mt-2 grid grid-cols-3 gap-2 text-xs">
                <Cell label="Planned" value={countText(b.planned)} />
                <Cell label="Delivered" value={countText(b.delivered)} />
                <Cell label="Deferred" value={countText(b.deferred)} />
                <Cell label="Not delivered" value={countText(b.undelivered)} />
                <Cell label="On-time" value={pctText(b.onTimePct)} />
                <Cell label="Avg. arrival" value={deltaMinutesText(b.avgArrivalDeltaMin)} />
              </dl>
            </RowCard>
          ))}
        >
          {r.byBrand.map((b) => (
            <Tr key={b.brand}>
              <Td>
                <BrandPill brand={b.brand} />
              </Td>
              <Td numeric>{countText(b.planned)}</Td>
              <Td numeric>{countText(b.delivered)}</Td>
              <Td numeric>{countText(b.deferred)}</Td>
              <Td numeric>{countText(b.undelivered)}</Td>
              <Td numeric>{pctText(b.onTimePct)}</Td>
              <Td numeric>{deltaMinutesText(b.avgArrivalDeltaMin)}</Td>
            </Tr>
          ))}
        </DataTable>
        <Note>On-time is the share of stops where the vehicle arrived before the outlet&apos;s window closed.</Note>
      </ReportCard>
    </ReportFrame>
  );
}

function Cell({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-muted">{label}</dt>
      <dd className="tabular font-semibold text-ink">{value}</dd>
    </div>
  );
}
