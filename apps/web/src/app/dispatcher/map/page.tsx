import Link from "next/link";
import { DEPOT_POSITIONS } from "@katapatha/core/domain/geography";
import { Button, ButtonLink } from "@/components/ui/button";
import { DateControl } from "@/components/ui/date-control";
import { PageBody, PageHeader } from "@/components/ui/page-header";
import { Advisory, EmptyState, ErrorPanel } from "@/components/ui/states";
import { StatusPill } from "@/components/ui/status-pill";
import { api } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { dateParam } from "@/lib/dates";
import { readFailure } from "@/lib/failures";
import { ageLabel, clockTime, plural } from "@/lib/format";
import { FleetMap } from "./fleet-map";
import {
  etaLabel,
  filterCounts,
  filterMapVehicles,
  FILTERS,
  parseFilter,
  progressLine,
  reportedAt,
  reportLine,
  STATE_VIEW,
  stateLabel,
  type MapFilter,
  type MapVehicle,
} from "./map-view";

export const dynamic = "force-dynamic";

const PATH = "/dispatcher/map";

type Query = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function href(state: { date: string; filter: MapFilter; q: string; vehicle?: string }) {
  const params = new URLSearchParams();
  params.set("date", state.date);
  if (state.filter !== "all") params.set("filter", state.filter);
  if (state.q) params.set("q", state.q);
  if (state.vehicle) params.set("vehicle", state.vehicle);
  return `${PATH}?${params.toString()}`;
}

export default async function MapPage({ searchParams }: { searchParams: Promise<Query> }) {
  const query = await searchParams;
  const user = await requireRole("DISPATCHER", PATH);
  const date = dateParam(query.date);
  const filter = parseFilter(query.filter);
  const q = (first(query.q) ?? "").trim().slice(0, 60);
  const selectedId = first(query.vehicle) || undefined;

  const client = await api();
  const result = await client.GET("/fleet/positions", { params: { query: { date } } }).catch(() => null);

  const subtitle = "Where each vehicle last reported itself, with the age of that report.";

  if (!result?.data) {
    const failure = readFailure(result?.response.status ?? 0, "the map");
    return (
      <PageBody>
        <PageHeader
          title="Map"
          subtitle={subtitle}
          aside={<DateControl date={date} path={PATH} />}
        />
        <ErrorPanel title={failure.title} detail={failure.detail} outcome={failure.outcome} />
      </PageBody>
    );
  }

  const { vehicles, summary, updatedAt } = result.data;
  const depotName = user.depotCode ?? result.data.depotCode;
  const rows = filterMapVehicles(vehicles, filter, q);
  const counts = filterCounts(summary);
  const selected = selectedId ? vehicles.find((v) => v.vehicleId === selectedId) : undefined;
  const unplaced = vehicles.filter((v) => v.position === null);
  const linkFor = (vehicleId: string) => href({ date, filter, q, vehicle: vehicleId });

  return (
    <PageBody>
      <PageHeader
        title="Map"
        subtitle={subtitle}
        aside={
          <>
            <DateControl date={date} path={PATH} keep={{ filter: filter === "all" ? undefined : filter, q: q || undefined }} />
            {/* The time the response was assembled, not a claim that anything on the map is current. */}
            <span className="inline-flex min-h-11 items-center rounded-control border border-line bg-surface px-3 text-sm font-semibold text-ink">
              Updated <span className="tabular ml-1">{clockTime(updatedAt)}</span>
            </span>
          </>
        }
      />

      {vehicles.length === 0 ? (
        <EmptyState
          title="No vehicles are out or loading on this day"
          detail="A vehicle appears here once its trip is being loaded or has departed on the published plan."
        />
      ) : (
        <div className="grid items-start gap-4 xl:grid-cols-[380px_minmax(0,1fr)]">
          <section aria-label="Vehicles on the map" className="rounded-card border border-line bg-surface max-xl:order-last">
            <div className="flex flex-col gap-3 border-b border-line p-4">
              <h2 className="text-lg font-bold text-ink">
                On the map <span className="tabular text-muted">({counts.all})</span>
              </h2>
              <form method="get" action={PATH} role="search" className="flex gap-2">
                <input type="hidden" name="date" value={date} />
                {filter !== "all" ? <input type="hidden" name="filter" value={filter} /> : null}
                {selectedId ? <input type="hidden" name="vehicle" value={selectedId} /> : null}
                <label className="min-w-0 flex-1">
                  <span className="sr-only">Search vehicle, driver, district or outlet</span>
                  <input
                    type="search"
                    name="q"
                    defaultValue={q}
                    maxLength={60}
                    placeholder="Search vehicle, outlet or driver…"
                    className="min-h-11 w-full rounded-control border border-line bg-surface px-3 text-sm text-ink"
                  />
                </label>
                <Button type="submit" variant="secondary">
                  Search
                </Button>
              </form>
              <nav aria-label="Filter vehicles" className="flex flex-wrap gap-2">
                {FILTERS.map((item) => (
                  <Link
                    key={item.key}
                    href={href({ date, filter: item.key, q, vehicle: selectedId })}
                    aria-current={item.key === filter ? "page" : undefined}
                    className={`inline-flex min-h-11 items-center gap-1.5 rounded-full border px-4 text-sm font-semibold ${
                      item.key === filter ? "border-rail bg-rail text-white" : "border-line bg-surface text-ink hover:bg-raised"
                    }`}
                  >
                    {item.label}
                    <span className="tabular opacity-80">({counts[item.key]})</span>
                  </Link>
                ))}
              </nav>
            </div>

            {rows.length === 0 ? (
              <div className="p-4">
                <EmptyState
                  title="No vehicles match"
                  detail={q ? `Nothing in this view matches "${q}".` : "Nothing is in this view."}
                  action={
                    <ButtonLink href={href({ date, filter: "all", q: "", vehicle: selectedId })} variant="secondary">
                      Show all
                    </ButtonLink>
                  }
                />
              </div>
            ) : (
              <ul className="divide-y divide-line">
                {rows.map((v) => (
                  <li key={v.vehicleId}>
                    <VehicleRow vehicle={v} selected={v.vehicleId === selectedId} href={linkFor(v.vehicleId)} />
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section aria-label="Map" id="map-region" className="min-w-0 xl:sticky xl:top-4">
            <div className="relative overflow-hidden rounded-card border border-line bg-surface">
              <p className="border-b border-line bg-surface px-4 py-2.5 text-sm font-semibold text-ink">
                Schematic — positions as last reported by each driver&apos;s phone
              </p>
              <div role="region" aria-label="Schematic map, scrolls sideways on narrow screens" tabIndex={0} className="overflow-x-auto">
                <FleetMap
                  depotName={depotName}
                  depot={DEPOT_POSITIONS[depotName] ?? null}
                  vehicles={vehicles}
                  selectedId={selectedId}
                  hrefFor={linkFor}
                  insetRight={selected ? 470 : 0}
                />
              </div>
              <Legend />
              {selected ? <Callout vehicle={selected} closeHref={href({ date, filter, q })} /> : null}
            </div>
            <p className="mt-2 text-xs text-muted">
              Depots and districts are drawn at their centres and legs are straight lines, not roads. A marker is where the
              phone last reported, so it need not sit on its line.
            </p>
            {unplaced.length > 0 ? (
              <div className="mt-3">
                <Advisory>
                  {plural(unplaced.length, "vehicle")} not shown on the map: {unplaced.map((v) => v.vehicleId).join(", ")}.{" "}
                  {unplaced.some((v) => v.state !== "NOT_STARTED")
                    ? "No position has been reported yet."
                    : "They are at the dock and have not reported a position."}
                </Advisory>
              </div>
            ) : null}
          </section>
        </div>
      )}
    </PageBody>
  );
}

function VehicleRow({ vehicle: v, selected, href }: { vehicle: MapVehicle; selected: boolean; href: string }) {
  const state = STATE_VIEW[v.state];
  const eta = etaLabel(v);
  return (
    <Link
      href={href}
      aria-current={selected ? "true" : undefined}
      className={`flex min-h-11 items-start gap-3 p-4 ${selected ? "bg-warn-surface" : "hover:bg-raised"}`}
    >
      <span aria-hidden className={`grid size-9 shrink-0 place-items-center rounded-full ${state.iconTile}`}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="size-5">
          <path d="M3 7h13v10H3z" />
          <path d="M16 10h3l2 3v4h-5" />
          <circle cx="7" cy="19" r="1.5" />
          <circle cx="18" cy="19" r="1.5" />
        </svg>
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-bold text-ink">
          {v.vehicleId} <span className="font-normal text-muted">· {v.trip.districtName}</span>
        </span>
        <span className="block text-sm text-muted">
          {v.nextStop ? `${progressLine(v)} · ETA ${eta}` : progressLine(v)}
        </span>
        <span className="mt-1.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <StatusPill label={stateLabel(v)} tone={state.tone} />
          <span className={`text-xs ${v.state === "LAMP" ? "font-semibold text-warn-ink" : "text-muted"}`}>{reportLine(v)}</span>
        </span>
      </span>
    </Link>
  );
}

function Legend() {
  const items: { label: string; swatch: string }[] = [
    { label: "On time", swatch: "bg-good" },
    { label: "Late", swatch: "bg-warn" },
    { label: "Returning", swatch: "bg-info" },
    { label: "At the dock", swatch: "bg-muted" },
  ];
  return (
    <ul className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-line px-4 py-3 text-sm text-ink">
      {items.map((item) => (
        <li key={item.label} className="flex items-center gap-2">
          <span aria-hidden className={`size-3 rounded-full ${item.swatch}`} />
          {item.label}
        </li>
      ))}
      <li className="flex items-center gap-2">
        <span aria-hidden className="size-3 rounded-full border-2 border-dashed border-warn" />
        Lamp Mode · last reliable update shown
      </li>
      <li className="flex items-center gap-2">
        <span aria-hidden className="size-3 rounded-sm bg-navy" />
        Depot
      </li>
    </ul>
  );
}

/**
 * The selected vehicle's card. Everything on it is a report or an estimate and
 * is worded as one: the position carries its age, and the arrival is
 * "estimated" — under Lamp Mode, "about" as well, because it rests on a
 * position that is no longer fresh.
 */
function Callout({ vehicle: v, closeHref }: { vehicle: MapVehicle; closeHref: string }) {
  const state = STATE_VIEW[v.state];
  const stop = v.nextStop;
  const lamp = v.state === "LAMP";
  return (
    <aside
      aria-label={`${v.vehicleId} details`}
      className={`border-t bg-surface p-4 min-[1400px]:absolute min-[1400px]:right-4 min-[1400px]:top-14 min-[1400px]:w-[22rem] min-[1400px]:rounded-card min-[1400px]:border min-[1400px]:shadow-lg ${
        lamp ? "border-warn/40" : "border-line"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-lg font-bold text-ink">{v.vehicleId}</h3>
            <span className="rounded-control border border-line bg-raised px-2 py-0.5 text-xs font-semibold text-muted">
              Trip {v.trip.tripNo}
            </span>
            <StatusPill label={stateLabel(v)} tone={state.tone} />
          </div>
          <p className="mt-1 text-sm text-muted">
            {v.driverName ?? "No driver yet"} · {v.trip.districtName} run
          </p>
        </div>
        <Link
          href={closeHref}
          aria-label={`Close ${v.vehicleId}`}
          className="-mr-1 -mt-1 grid size-9 shrink-0 place-items-center rounded-control text-muted hover:bg-raised hover:text-ink"
        >
          <span aria-hidden>&times;</span>
        </Link>
      </div>

      <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
        {stop ? (
          <>
            <dt className="text-muted">Next stop</dt>
            <dd className="font-semibold text-ink">
              {stop.outletName === stop.outletId ? stop.outletId : `${stop.outletId} · ${stop.outletName}`}
            </dd>
            <dt className="text-muted">Arrival</dt>
            <dd className="tabular font-semibold text-ink">
              {etaLabel(v)}
              <span className="block font-normal text-muted">
                window {stop.windowOpen}–{stop.windowClose}
              </span>
            </dd>
          </>
        ) : null}
        <dt className="text-muted">Progress</dt>
        <dd className="tabular font-semibold text-ink">
          {stop ? `${progressLine(v)} · ${stop.deliveredStops} delivered` : progressLine(v)}
        </dd>
        <dt className="text-muted">{lamp ? "Last reliable update" : "Last report"}</dt>
        <dd className={`tabular font-semibold ${lamp ? "text-warn-ink" : "text-ink"}`}>
          {v.position ? `${reportedAt(v.position)} · ${ageLabel(v.position.ageSeconds)}` : "No position reported yet"}
        </dd>
      </dl>

      {lamp ? (
        <p className="mt-3 rounded-control bg-warn-surface p-3 text-sm text-ink">
          This report is more than 10 minutes old, so the marker shows where the vehicle last was, not where it is. The
          arrival time is an estimate.
        </p>
      ) : null}
    </aside>
  );
}
