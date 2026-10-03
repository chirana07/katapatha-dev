import Link from "next/link";
import { ButtonLink } from "@/components/ui/button";
import { DataTable, RowCard, Td, Th, Tr } from "@/components/ui/data-table";
import { DateControl } from "@/components/ui/date-control";
import { PageBody, PageHeader } from "@/components/ui/page-header";
import { Meter, StatCard, StatRow } from "@/components/ui/stat-card";
import { EmptyState, ErrorPanel } from "@/components/ui/states";
import { StatusPill } from "@/components/ui/status-pill";
import { Tabs } from "@/components/ui/tabs";
import { requireRole } from "@/lib/auth";
import { dateParam, todayInColombo } from "@/lib/dates";
import { readFailure } from "@/lib/failures";
import { plural } from "@/lib/format";
import { loadDock } from "../dock-data.server";
import {
  attentionFor,
  attentionLabel,
  checksMissing,
  colomboMinutes,
  dockCounts,
  isLoaded,
  nextToLoad,
  unitsPercent,
  type Attention,
  type DockClock,
  type DockTrip,
} from "../dock-model";
import { chillerByline, chillerHeadline } from "../chiller";
import { HeaderClock } from "../header-clock";
import { AlertIcon, CheckIcon, TruckIcon, ThermometerIcon } from "../stat-icons";
import { TRIP_STATUS_LABEL, WAVE_LABEL, WAVE_WINDOW, groupByWave } from "../wave";
import { statusTone } from "../dock-model";
import { ChillerRecheck } from "./chiller-recheck";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
type View = "all" | "loading" | "attention" | "released";

type Row = { trip: DockTrip; attention: Attention[] };

export default async function LoadingProgressPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  await requireRole("LOADER", "/loader/progress");
  const date = dateParam(params.date);
  const rawView = Array.isArray(params.view) ? params.view[0] : params.view;
  const view: View = rawView === "loading" || rawView === "attention" || rawView === "released" ? rawView : "all";

  const day = await loadDock(date);
  const subtitle = "Track every vehicle from the first box to a released door.";

  if (!day.ok) {
    const failure = readFailure(day.status, "loading progress");
    return (
      <PageBody>
        <PageHeader title="Loading progress" subtitle={subtitle} />
        <ErrorPanel title={failure.title} detail={failure.detail} outcome="read" action={<ButtonLink href={`/loader/progress?date=${date}`}>Reload</ButtonLink>} />
      </PageBody>
    );
  }

  const { trips } = day;
  const clock: DockClock = { date, today: todayInColombo(), minutesNow: colomboMinutes() };
  const rows: Row[] = trips.map((trip) => ({ trip, attention: attentionFor(trip, clock) }));

  const counts = dockCounts(trips);
  const expectedUnits = trips.reduce((sum, trip) => sum + (trip.load?.expectedUnits ?? 0), 0);
  const loadedUnits = trips.reduce((sum, trip) => sum + (trip.load?.loadedUnits ?? 0), 0);
  const overall = expectedUnits > 0 ? Math.round((loadedUnits / expectedUnits) * 100) : 0;

  const open = rows.filter((row) => !isLoaded(row.trip.status));
  const attention = open.filter((row) => row.attention.length > 0);
  const onTrack = open.length - attention.length;
  const next = nextToLoad(trips);

  const inView = (row: Row) =>
    view === "all"
      ? true
      : view === "loading"
        ? row.trip.status === "LOADING"
        : view === "attention"
          ? row.attention.length > 0 && !isLoaded(row.trip.status)
          : isLoaded(row.trip.status);
  const shown = rows.filter(inView);
  const waves = groupByWave(shown.map((row) => row.trip));
  const rowOf = new Map(rows.map((row) => [row.trip.id, row]));

  const href = (next: View) => `/loader/progress?date=${date}${next === "all" ? "" : `&view=${next}`}`;
  const chillerTrips = open.filter((row) => row.trip.refrigerated).map((row) => row.trip);

  return (
    <PageBody>
      <PageHeader
        title="Loading progress"
        subtitle={subtitle}
        aside={
          <>
            <DateControl date={date} path="/loader/progress" keep={{ view: view === "all" ? undefined : view }} />
            <HeaderClock />
          </>
        }
      />

      <StatRow>
        <StatCard
          icon={<TruckIcon />}
          value={`${overall}%`}
          label="Overall progress"
          foot={`${loadedUnits} of ${expectedUnits} units loaded`}
        >
          <Meter value={loadedUnits} max={expectedUnits} level="near" label="Units loaded across the day" />
        </StatCard>
        <StatCard
          icon={<CheckIcon />}
          value={`${counts.loaded} / ${counts.total}`}
          label="Vehicles released"
          foot={next ? `Next: ${next.vehicleId}${next.plannedDepartAt ? ` · departs ${next.plannedDepartAt}` : ""}` : counts.total === 0 ? "No trips this day." : "Every vehicle is released."}
          footTone="good"
        />
        <StatCard
          icon={<CheckIcon />}
          value={onTrack}
          label="Nothing flagged"
          foot="Open vehicles with no shortage and no timing warning"
        />
        <StatCard
          icon={<AlertIcon />}
          value={attention.length}
          label="Needs attention"
          tone={attention.length > 0 ? "bad" : "neutral"}
          foot={attention.length > 0 ? "A shortage is reported, or a departure time is close or past" : "Nothing needs attention."}
          footTone={attention.length > 0 ? "bad" : "neutral"}
        />
      </StatRow>

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="flex min-w-0 flex-col gap-4">
          <Tabs
            label="Progress view"
            items={[
              { label: "All vehicles", href: href("all"), current: view === "all", count: rows.length },
              { label: "Loading", href: href("loading"), current: view === "loading", count: counts.loading },
              { label: "Needs attention", href: href("attention"), current: view === "attention", count: attention.length, alert: true },
              { label: "Released", href: href("released"), current: view === "released", count: counts.loaded },
            ]}
          />
          {waves.length === 0 ? (
            <EmptyState
              title={rows.length === 0 ? "No trips published for this day" : "Nothing in this view"}
              detail={rows.length === 0 ? "The dispatcher has not published a plan for this day." : "Pick another view to see the rest of the day."}
            />
          ) : (
            waves.map((group) => {
              const released = group.trips.filter((trip) => isLoaded(trip.status)).length;
              return (
                <section key={group.wave} aria-labelledby={`wave-${group.wave}`} className="flex flex-col gap-2">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <h2 id={`wave-${group.wave}`} className="font-bold text-ink">
                      {WAVE_LABEL[group.wave]} <span className="font-normal text-muted">{WAVE_WINDOW[group.wave]}</span>
                    </h2>
                    <p className="tabular text-sm text-muted">
                      {released} of {group.trips.length} released
                    </p>
                  </div>
                  <DataTable
                    caption={`${WAVE_LABEL[group.wave]} vehicles`}
                    head={
                      <tr>
                        <Th>Vehicle</Th>
                        <Th>Loading progress</Th>
                        <Th>Status</Th>
                        <Th>Departs</Th>
                        <Th>
                          <span className="sr-only">Open</span>
                        </Th>
                      </tr>
                    }
                    cards={group.trips.map((trip) => (
                      <ProgressCard key={trip.id} row={rowOf.get(trip.id)!} />
                    ))}
                  >
                    {group.trips.map((trip) => (
                      <ProgressRow key={trip.id} row={rowOf.get(trip.id)!} />
                    ))}
                  </DataTable>
                </section>
              );
            })
          )}
        </div>

        <aside className="flex flex-col gap-4">
          <section className="rounded-card border border-line bg-surface p-4">
            <h2 className="flex items-center gap-2 font-bold text-ink">
              Needs attention
              {attention.length > 0 ? <span className="tabular rounded-full bg-bad px-1.5 py-0.5 text-xs font-semibold text-white">{attention.length}</span> : null}
            </h2>
            {attention.length === 0 ? (
              <p className="mt-2 text-sm text-muted">No open vehicle has a reported shortage or a departure time to worry about.</p>
            ) : (
              <ul className="mt-3 flex flex-col divide-y divide-line">
                {attention.map((row) => (
                  <li key={row.trip.id} className="flex items-start justify-between gap-3 py-3 first:pt-0 last:pb-0">
                    <div className="min-w-0">
                      <p className="font-semibold text-ink">
                        {row.trip.vehicleId} · Trip {row.trip.tripNo} · {row.attention.map(attentionLabel).join(", ")}
                      </p>
                      <p className="text-sm text-muted">{attentionDetail(row)}</p>
                    </div>
                    <ButtonLink href={`/loader/trips/${encodeURIComponent(row.trip.id)}`} className="shrink-0">
                      Open list
                    </ButtonLink>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {chillerTrips.length > 0 ? (
            <section className="rounded-card border border-line bg-surface p-4">
              <h2 className="flex items-center gap-2 font-bold text-ink">
                <span className="text-muted" aria-hidden>
                  <ThermometerIcon />
                </span>
                Chiller readings
              </h2>
              <ul className="mt-3 flex flex-col divide-y divide-line">
                {chillerTrips.map((trip) => (
                  <li key={trip.id} className="py-3 first:pt-0 last:pb-0">
                    <ChillerRecheck tripId={trip.id} vehicleId={trip.vehicleId} tripNo={trip.tripNo} latest={trip.chiller ?? null} />
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-xs text-muted">
                A reading is a person&rsquo;s look at the gauge, saved with their name and the time &mdash; not a sensor feed. The
                latest one for each trip is shown here; an out-of-range reading blocks nothing by itself, and the dispatcher sees it
                in Exceptions.
              </p>
            </section>
          ) : null}
        </aside>
      </div>
    </PageBody>
  );
}

function attentionDetail(row: Row): string {
  const first = row.attention[0]!;
  switch (first.kind) {
    case "shortage":
      return "Waiting on the dispatcher, who decides in Exceptions. The vehicle is held until they have.";
    case "chiller":
      return row.trip.chiller
        ? `${chillerHeadline(row.trip.chiller)}, ${chillerByline(row.trip.chiller)}. Record a new reading to recheck.`
        : "Out-of-range chiller reading.";
    case "overdue":
      return "The planned departure time has passed and the vehicle is not released.";
    case "departing-soon":
      return `${plural(first.unchecked, "order")} still to check before the planned departure.`;
  }
}

function ProgressRow({ row }: { row: Row }) {
  const { trip, attention } = row;
  const load = trip.load;
  const percent = unitsPercent(load);
  return (
    <Tr>
      <Td>
        <Link href={`/loader/trips/${encodeURIComponent(trip.id)}`} className="block min-h-11">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="font-bold text-ink">{trip.vehicleId}</span>
            <span className="rounded-control border border-line bg-raised px-1.5 py-0.5 text-xs font-semibold text-muted">Trip {trip.tripNo}</span>
            {trip.refrigerated ? <StatusPill label="Refrigerated" tone="info" dot={false} /> : null}
          </span>
          <span className="block text-sm text-muted">
            {trip.districtName}
            {load ? ` · ${plural(load.stops, "stop")}` : ""}
          </span>
        </Link>
      </Td>
      <Td>
        {load ? (
          <div className="min-w-44">
            <div className="flex items-center justify-between gap-3 text-sm">
              <span className="tabular font-semibold text-ink">
                {load.loadedUnits} / {load.expectedUnits} units
              </span>
              <span className="tabular text-muted">{percent}%</span>
            </div>
            <div className="mt-1">
              <Meter value={load.loadedUnits} max={load.expectedUnits} level={trip.status === "LOADING" ? "near" : "ok"} label={`${trip.vehicleId} units loaded`} />
            </div>
            {attention.length > 0 ? <p className="mt-1 text-xs font-semibold text-bad-ink">{attention.map(attentionLabel).join(" · ")}</p> : null}
            {checksMissing(trip) ? <p className="mt-1 text-xs text-muted">No load checks recorded</p> : null}
          </div>
        ) : (
          <span className="text-sm text-muted">Load list unavailable</span>
        )}
      </Td>
      <Td>
        <StatusPill
          label={attention.length > 0 ? "Needs attention" : TRIP_STATUS_LABEL[trip.status]}
          tone={attention.length > 0 ? "bad" : statusTone(trip.status)}
        />
      </Td>
      <Td>
        <span className="tabular">{trip.plannedDepartAt ?? "—"}</span>
      </Td>
      <Td>
        <Link href={`/loader/trips/${encodeURIComponent(trip.id)}`} aria-label={`Open ${trip.vehicleId} trip ${trip.tripNo}`} className="grid size-11 place-items-center text-muted hover:text-ink">
          <span aria-hidden>&rsaquo;</span>
        </Link>
      </Td>
    </Tr>
  );
}

function ProgressCard({ row }: { row: Row }) {
  const { trip, attention } = row;
  const load = trip.load;
  return (
    <RowCard>
      <Link href={`/loader/trips/${encodeURIComponent(trip.id)}`} className="block min-h-11">
        <div className="flex items-start justify-between gap-3">
          <p className="font-bold text-ink">
            {trip.vehicleId} <span className="font-normal text-muted">Trip {trip.tripNo} · departs {trip.plannedDepartAt ?? "—"}</span>
          </p>
          <StatusPill label={attention.length > 0 ? "Needs attention" : TRIP_STATUS_LABEL[trip.status]} tone={attention.length > 0 ? "bad" : statusTone(trip.status)} />
        </div>
        <p className="mt-1 text-sm text-muted">
          {trip.districtName}
          {trip.refrigerated ? " · Refrigerated" : ""}
          {load ? ` · ${load.loadedUnits} / ${load.expectedUnits} units` : ""}
        </p>
        {load ? (
          <div className="mt-2">
            <Meter value={load.loadedUnits} max={load.expectedUnits} level={trip.status === "LOADING" ? "near" : "ok"} label={`${trip.vehicleId} units loaded`} />
          </div>
        ) : null}
        {attention.length > 0 ? <p className="mt-1.5 text-xs font-semibold text-bad-ink">{attention.map(attentionLabel).join(" · ")}</p> : null}
        {checksMissing(trip) ? <p className="mt-1.5 text-xs text-muted">No load checks recorded</p> : null}
      </Link>
    </RowCard>
  );
}
