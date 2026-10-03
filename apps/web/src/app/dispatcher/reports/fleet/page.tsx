import { Glyph } from "@/components/ui/glyph";
import { DataTable, RowCard, Td, Th, Tr } from "@/components/ui/data-table";
import { StatCard, StatRow } from "@/components/ui/stat-card";
import { EmptyState } from "@/components/ui/states";
import { StatusPill } from "@/components/ui/status-pill";
import { plural } from "@/lib/format";
import { readOf } from "@/lib/read-result";
import { MeterBar } from "../charts/meter-bar";
import { prepare, signInIfExpired } from "../load";
import { Note, ReportCard, ReportError, ReportFrame } from "../report-frame";
import { countText, pctText } from "../report-format";

export const metadata = { title: "Fleet reports · Katapatha" };

const HERE = "/dispatcher/reports/fleet";

export default async function FleetReportPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { requested, client } = await prepare(searchParams, HERE);
  const result = await readOf(client.GET("/reports/fleet", { params: { query: requested } }));
  signInIfExpired(result, HERE);

  if (!result.ok) {
    return (
      <ReportFrame active="fleet" requested={requested} shown={requested}>
        <ReportError failure={result} what="the fleet report" />
      </ReportFrame>
    );
  }

  const r = result.data;
  const tempLabel = (temp: string) => (temp === "reefer" ? "Refrigerated" : "Ambient");

  return (
    <ReportFrame active="fleet" requested={requested} shown={{ from: r.from, to: r.to }} source={r}>
      <StatRow>
        <StatCard
          icon={<Glyph name="truck" />}
          value={pctText(r.utilisation.pct)}
          label="Fleet utilisation"
          foot={
            <>
              {`Target ${pctText(r.utilisation.targetPct)}`}
              {r.utilisation.note ? <Note>{r.utilisation.note}</Note> : null}
            </>
          }
        />
        {r.byTemp.map((group) => (
          <StatCard
            key={group.temp}
            icon={<Glyph name={group.temp === "reefer" ? "snow" : "box"} />}
            value={pctText(group.avgLoadPct)}
            label={`${tempLabel(group.temp)} · average load`}
            foot={`${plural(group.vehicles, "vehicle")} · ${plural(group.trips, "trip")}`}
          />
        ))}
      </StatRow>

      {r.notes.length ? (
        <ul className="flex flex-col gap-1 text-xs text-muted">
          {r.notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      ) : null}

      <ReportCard title="Vehicles" subtitle="Average load is only known for trips published in Katapatha">
        {r.vehicles.length === 0 ? (
          <EmptyState title="No vehicles in this range" />
        ) : (
          <DataTable
            caption="Vehicle usage"
            head={
              <tr>
                <Th>Vehicle</Th>
                <Th>Type</Th>
                <Th numeric>Capacity</Th>
                <Th numeric>Trips</Th>
                <Th numeric>Stops</Th>
                <Th numeric>On-time</Th>
                <Th>Avg. load</Th>
                <Th numeric>Workshop days</Th>
              </tr>
            }
            cards={r.vehicles.map((v) => (
              <RowCard key={v.vehicleId}>
                <div className="flex items-start justify-between gap-2">
                  <p className="font-semibold text-ink">{v.vehicleId}</p>
                  <StatusPill label={tempLabel(v.temp)} tone={v.temp === "reefer" ? "info" : "neutral"} dot={false} />
                </div>
                <p className="text-xs text-muted">
                  {v.type === "truck" ? "Truck" : "Van"} · {v.volumeCapM3} m³
                </p>
                <div className="mt-2 flex items-center gap-2">
                  <div className="w-24">
                    <MeterBar value={v.avgLoadPct} label={`Average load ${pctText(v.avgLoadPct)}`} />
                  </div>
                  <span className="tabular text-sm font-semibold">{pctText(v.avgLoadPct)}</span>
                  <span className="text-xs text-muted">avg. load</span>
                </div>
                <p className="tabular mt-2 text-xs text-muted">
                  {v.trips} trips · {v.stops} stops · on-time {pctText(v.onTimePct)} · workshop {v.workshopDays} d
                </p>
              </RowCard>
            ))}
          >
            {r.vehicles.map((v) => (
              <Tr key={v.vehicleId}>
                <Td>{v.vehicleId}</Td>
                <Td>
                  {v.type === "truck" ? "Truck" : "Van"} · {tempLabel(v.temp).toLowerCase()}
                </Td>
                <Td numeric>{v.volumeCapM3} m³</Td>
                <Td numeric>{countText(v.trips)}</Td>
                <Td numeric>{countText(v.stops)}</Td>
                <Td numeric>{pctText(v.onTimePct)}</Td>
                <Td>
                  <span className="flex items-center gap-2">
                    <span className="w-16 shrink-0">
                      <MeterBar value={v.avgLoadPct} label={`Average load ${pctText(v.avgLoadPct)}`} />
                    </span>
                    <span className="tabular w-10 text-right">{pctText(v.avgLoadPct)}</span>
                  </span>
                </Td>
                <Td numeric>{v.workshopDays}</Td>
              </Tr>
            ))}
          </DataTable>
        )}
      </ReportCard>
    </ReportFrame>
  );
}
