import { Glyph } from "@/components/ui/glyph";
import { DataTable, RowCard, Td, Th, Tr } from "@/components/ui/data-table";
import { StatCard, StatRow } from "@/components/ui/stat-card";
import { EmptyState } from "@/components/ui/states";
import { clockTime } from "@/lib/format";
import { readOf } from "@/lib/read-result";
import { BarChart } from "../charts/bar-chart";
import { RankedBars } from "../charts/meter-bar";
import { prepare, signInIfExpired } from "../load";
import { ReportCard, ReportError, ReportFrame } from "../report-frame";
import { dayLabel, kindWords, DASH } from "../report-format";

export const metadata = { title: "Exception reports · Katapatha" };

const HERE = "/dispatcher/reports/exceptions";

export default async function ExceptionsReportPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { requested, client } = await prepare(searchParams, HERE);
  const result = await readOf(client.GET("/reports/exceptions", { params: { query: requested } }));
  signInIfExpired(result, HERE);

  if (!result.ok) {
    return (
      <ReportFrame active="exceptions" requested={requested} shown={requested}>
        <ReportError failure={result} what="the exceptions report" />
      </ReportFrame>
    );
  }

  const r = result.data;
  return (
    <ReportFrame active="exceptions" requested={requested} shown={{ from: r.from, to: r.to }} source={r}>
      <StatRow>
        <StatCard icon={<Glyph name="alert" />} value={r.total} label="Exceptions in range" foot="Each order counts once per kind" />
      </StatRow>

      {r.notes.length ? (
        <ul className="flex flex-col gap-1 text-xs text-muted">
          {r.notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      ) : null}

      {r.total === 0 ? (
        <EmptyState title="No exceptions recorded" detail="Nothing was reported in this range." />
      ) : (
        <>
          <div className="grid gap-5 xl:grid-cols-3">
            <ReportCard title="By day" wide>
              <BarChart
                title="Exceptions by day"
                unit="exceptions"
                series={[{ label: "Exceptions", tone: "warn" }]}
                categories={r.byDay.map((d) => ({
                  label: dayLabel(d.date),
                  values: [d.count],
                  alt: `${dayLabel(d.date)}: ${d.count} exceptions`,
                }))}
              />
            </ReportCard>
            <ReportCard title="By kind">
              <RankedBars label="Exceptions by kind" items={r.byKind.map((k) => ({ key: k.kind, label: k.label || kindWords(k.kind), count: k.count }))} />
            </ReportCard>
          </div>

          <ReportCard title="Most recent" subtitle="Up to the 50 most recent, newest first">
            <DataTable
              caption="Recent exceptions"
              head={
                <tr>
                  <Th>Kind</Th>
                  <Th>Day</Th>
                  <Th>Order</Th>
                  <Th>Outlet</Th>
                  <Th>Source</Th>
                  <Th>Note</Th>
                </tr>
              }
              cards={r.recent.map((e, i) => (
                <RowCard key={`${e.kind}-${e.date}-${i}`}>
                  <p className="font-semibold text-ink">{e.label || kindWords(e.kind)}</p>
                  <p className="text-xs text-muted">
                    {dayLabel(e.date)}
                    {e.at ? ` · ${clockTime(e.at)}` : ""} · {e.orderRef ?? "no order"} · {e.outletId ?? "no outlet"} · {e.source === "live" ? "Katapatha" : "History"}
                  </p>
                  {e.note ? <p className="mt-1 text-sm text-ink">{e.note}</p> : null}
                </RowCard>
              ))}
            >
              {r.recent.map((e, i) => (
                <Tr key={`${e.kind}-${e.date}-${i}`}>
                  <Td>{e.label || kindWords(e.kind)}</Td>
                  <Td>
                    {dayLabel(e.date)}
                    {e.at ? <span className="text-muted"> · {clockTime(e.at)}</span> : null}
                  </Td>
                  <Td>{e.orderRef ?? DASH}</Td>
                  <Td>{e.outletId ?? DASH}</Td>
                  <Td>{e.source === "live" ? "Katapatha" : "History"}</Td>
                  <Td>{e.note ?? DASH}</Td>
                </Tr>
              ))}
            </DataTable>
          </ReportCard>
        </>
      )}
    </ReportFrame>
  );
}
