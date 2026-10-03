import { ButtonLink } from "@/components/ui/button";
import { DataTable, RowCard, Td, Th, Tr } from "@/components/ui/data-table";
import { DateControl } from "@/components/ui/date-control";
import { PageBody, PageHeader } from "@/components/ui/page-header";
import { Meter, StatCard, StatRow } from "@/components/ui/stat-card";
import { EmptyState, ErrorPanel } from "@/components/ui/states";
import { StatusPill } from "@/components/ui/status-pill";
import { requireRole, scopeLabel } from "@/lib/auth";
import { dateParam } from "@/lib/dates";
import { longDate } from "@/lib/dates";
import { readFailure } from "@/lib/failures";
import { plural } from "@/lib/format";
import { loadDock } from "../dock-data.server";
import { HeaderClock } from "../header-clock";
import { CONDITION_LABEL } from "../reasons";
import { buildReport } from "../reports-model";
import { AlertIcon, BoxIcon, CheckIcon, TruckIcon } from "../stat-icons";
import { TRIP_STATUS_LABEL } from "../wave";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/**
 * The day, as the dock can honestly report it. See reports-model.ts for what is
 * left out and why: no on-time or load-duration figures (load checks carry no
 * timestamps), no bay timeline (a trip has no bay), no export (the API has none).
 */
export default async function LoaderReportsPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const user = await requireRole("LOADER", "/loader/reports");
  const date = dateParam(params.date);
  const day = await loadDock(date);
  const subtitle = `${scopeLabel(user)} · what was loaded, checked and reported on ${longDate(date)}.`;

  if (!day.ok) {
    const failure = readFailure(day.status, "the day's loading figures");
    return (
      <PageBody>
        <PageHeader title="Reports" subtitle={subtitle} />
        <ErrorPanel title={failure.title} detail={failure.detail} outcome="read" action={<ButtonLink href={`/loader/reports?date=${date}`}>Reload</ButtonLink>} />
      </PageBody>
    );
  }

  const report = buildReport(day.trips);
  const header = <PageHeader title="Reports" subtitle={subtitle} aside={<><DateControl date={date} path="/loader/reports" /><HeaderClock /></>} />;

  if (report.vehicles.total === 0) {
    return (
      <PageBody>
        {header}
        <EmptyState title="No trips published for this day" detail="There is nothing to report until the dispatcher publishes a plan. Pick another date." />
      </PageBody>
    );
  }

  return (
    <PageBody>
      {header}

      <StatRow>
        <StatCard
          icon={<TruckIcon />}
          value={`${report.vehicles.released} / ${report.vehicles.total}`}
          label="Vehicles released"
          foot="Ready, departed or completed"
        />
        <StatCard
          icon={<CheckIcon />}
          value={`${report.lines.checked} / ${report.lines.total}`}
          label="Orders checked"
          foot={report.lines.checked === report.lines.total ? "Every order has a load check." : `${report.lines.total - report.lines.checked} still to check`}
          footTone={report.lines.checked === report.lines.total ? "good" : "neutral"}
        />
        <StatCard
          icon={<BoxIcon />}
          value={`${report.units.percent}%`}
          label="Units loaded"
          foot={`${report.units.loaded} of ${report.units.expected} units`}
        >
          <Meter value={report.units.loaded} max={report.units.expected} level="near" label="Units loaded" />
        </StatCard>
        <StatCard
          icon={<AlertIcon />}
          value={report.shortages.length}
          label="Orders reported"
          tone={report.shortages.length > 0 ? "warn" : "neutral"}
          foot={
            report.shortages.length === 0
              ? "No shortage, damage or missing line reported."
              : `${report.shortageUnits} units short in all · ${report.waiting === 0 ? "none waiting on the dispatcher" : `${report.waiting} waiting on the dispatcher`}`
          }
          footTone={report.shortages.length > 0 ? "warn" : "neutral"}
        />
      </StatRow>

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
        <section className="flex min-w-0 flex-col gap-2" aria-labelledby="log-heading">
          <div className="flex items-baseline justify-between gap-3">
            <h2 id="log-heading" className="font-bold text-ink">
              Vehicle log
            </h2>
            <p className="text-sm text-muted">{plural(report.log.length, "vehicle")}</p>
          </div>
          <DataTable
            caption="Every vehicle on the day, with its load checks and result"
            head={
              <tr>
                <Th>Vehicle</Th>
                <Th>Route</Th>
                <Th>Departs</Th>
                <Th>Status</Th>
                <Th numeric>Orders checked</Th>
                <Th numeric>Units</Th>
                <Th>Result</Th>
              </tr>
            }
            cards={report.log.map(({ trip, result }) => (
              <RowCard key={trip.id}>
                <div className="flex items-start justify-between gap-3">
                  <p className="font-bold text-ink">
                    {trip.vehicleId} <span className="font-normal text-muted">Trip {trip.tripNo} · departs {trip.plannedDepartAt ?? "—"}</span>
                  </p>
                  <StatusPill label={result.label} tone={result.tone} />
                </div>
                <p className="tabular mt-1 text-sm text-muted">
                  {trip.districtName} · {TRIP_STATUS_LABEL[trip.status]}
                  {trip.load ? ` · ${trip.load.checked} of ${trip.load.lines} checked · ${trip.load.loadedUnits} / ${trip.load.expectedUnits} units` : ""}
                </p>
              </RowCard>
            ))}
          >
            {report.log.map(({ trip, result }) => (
              <Tr key={trip.id}>
                <Td>
                  <span className="whitespace-nowrap">
                    <span className="font-bold text-ink">{trip.vehicleId}</span> <span className="text-muted">Trip {trip.tripNo}</span>
                  </span>
                </Td>
                <Td>{trip.districtName}</Td>
                <Td>
                  <span className="tabular">{trip.plannedDepartAt ?? "—"}</span>
                </Td>
                <Td>{TRIP_STATUS_LABEL[trip.status]}</Td>
                <Td numeric><span className="whitespace-nowrap">{trip.load ? `${trip.load.checked} / ${trip.load.lines}` : "—"}</span></Td>
                <Td numeric><span className="whitespace-nowrap">{trip.load ? `${trip.load.loadedUnits} / ${trip.load.expectedUnits}` : "—"}</span></Td>
                <Td>
                  <StatusPill label={result.label} tone={result.tone} dot={false} />
                </Td>
              </Tr>
            ))}
          </DataTable>
        </section>

        <section className="rounded-card border border-line bg-surface p-4" aria-labelledby="reported-heading">
          <h2 id="reported-heading" className="flex items-center gap-2 font-bold text-ink">
            Reported at the dock
            {report.shortages.length > 0 ? <span className="tabular rounded-full bg-raised px-1.5 py-0.5 text-xs font-semibold text-muted">{report.shortages.length}</span> : null}
          </h2>
          {report.shortages.length === 0 ? (
            <p className="mt-2 text-sm text-muted">Nothing was reported short, damaged or missing on this day.</p>
          ) : (
            <ul className="mt-3 flex flex-col divide-y divide-line">
              {report.shortages.map((row) => (
                <li key={`${row.tripId}:${row.orderRef}`} className="py-3 first:pt-0 last:pb-0">
                  <p className="font-semibold text-ink">
                    {row.vehicleId} · {row.orderRef} · {CONDITION_LABEL[row.condition]}
                  </p>
                  <p className="tabular text-sm text-muted">
                    {row.outletId} · loaded {row.loadedUnits} of {row.expectedUnits}
                    {row.shortBy > 0 ? ` · ${row.shortBy} short` : ""}
                  </p>
                  <p className={`text-sm ${row.state === "waiting" ? "font-semibold text-warn-ink" : "text-muted"}`}>{row.outcome}</p>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-xs text-muted">
            The dock records what was reported; the dispatcher decides each one in Exceptions, and their decision shows here once
            made.
          </p>
        </section>
      </div>
    </PageBody>
  );
}
