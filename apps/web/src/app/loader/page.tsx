import Link from "next/link";
import { ButtonLink } from "@/components/ui/button";
import { DataTable, RowCard, Td, Th, Tr } from "@/components/ui/data-table";
import { DateControl } from "@/components/ui/date-control";
import { DetailPanel, SplitLayout } from "@/components/ui/detail-panel";
import { PageBody, PageHeader } from "@/components/ui/page-header";
import { Meter, StatCard, StatRow } from "@/components/ui/stat-card";
import { EmptyState, ErrorPanel } from "@/components/ui/states";
import { StatusPill } from "@/components/ui/status-pill";
import { Tabs } from "@/components/ui/tabs";
import { requireRole, scopeLabel } from "@/lib/auth";
import { dateParam, todayInColombo } from "@/lib/dates";
import { readFailure } from "@/lib/failures";
import { plural } from "@/lib/format";
import { loadDock } from "./dock-data.server";
import {
  attentionFor,
  colomboMinutes,
  dockCounts,
  checksMissing,
  isLoaded,
  nextToLoad,
  queueStatus,
  unitsPercent,
  type DockClock,
  type DockTrip,
} from "./dock-model";
import { HeaderClock } from "./header-clock";
import { BoxIcon, CheckIcon, ClockIcon, TruckIcon } from "./stat-icons";
import { TripDetail } from "./trip-detail";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
type View = "queue" | "loaded" | "all";

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function DockPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const user = await requireRole("LOADER", "/loader");
  const date = dateParam(params.date);
  const rawView = first(params.view);
  const view: View = rawView === "loaded" || rawView === "all" ? rawView : "queue";
  const tab = first(params.tab) === "vehicle" ? "vehicle" : "list";

  const day = await loadDock(date);
  const title = scopeLabel(user);

  if (!day.ok) {
    const failure = readFailure(day.status, "the dock board");
    return (
      <PageBody>
        <PageHeader title={title} subtitle="Load each vehicle in the order shown. The last stop goes in first." />
        <ErrorPanel
          title={failure.title}
          detail={failure.detail}
          outcome="read"
          action={<ButtonLink href={`/loader?date=${date}`}>Reload</ButtonLink>}
        />
      </PageBody>
    );
  }

  const { trips, districts, vehicles } = day;
  const counts = dockCounts(trips);
  const clock: DockClock = { date, today: todayInColombo(), minutesNow: colomboMinutes() };

  const queue = trips.filter((trip) => !isLoaded(trip.status));
  const loaded = trips.filter((trip) => isLoaded(trip.status));
  const shown = view === "queue" ? queue : view === "loaded" ? loaded : trips;

  const requested = first(params.trip);
  const selected = shown.find((trip) => trip.id === requested) ?? nextToLoad(shown) ?? shown[0] ?? null;
  const next = nextToLoad(trips);

  const href = (over: { view?: View; trip?: string; tab?: string }) => {
    const query = new URLSearchParams({ date });
    const nextView = over.view ?? view;
    if (nextView !== "queue") query.set("view", nextView);
    if (over.trip) query.set("trip", over.trip);
    if (over.tab && over.tab !== "list") query.set("tab", over.tab);
    return `/loader?${query.toString()}`;
  };

  const loadingNow = trips.filter((trip) => trip.status === "LOADING");

  return (
    <PageBody>
      <PageHeader
        title={title}
        subtitle="Load each vehicle in the order shown. The last stop goes in first."
        aside={
          <>
            <DateControl date={date} path="/loader" keep={{ view: view === "queue" ? undefined : view }} />
            <HeaderClock />
          </>
        }
      />

      {/* On a phone the four cards would push the queue off the first screen, so
          it gets one line of progress instead; the queue is the screen. */}
      <div className="rounded-card border border-line bg-surface p-4 sm:hidden">
        <div className="flex items-baseline justify-between gap-3">
          <p className="font-bold text-ink">
            <span className="tabular">{counts.loaded}</span> of <span className="tabular">{counts.total}</span> vehicles loaded
          </p>
          <p className="tabular text-sm text-muted">{counts.loadedPercent}%</p>
        </div>
        <div className="mt-2">
          <Meter value={counts.loaded} max={counts.total} level="near" label="Vehicles loaded" />
        </div>
        <p className="mt-2 text-xs text-muted">
          {counts.loading} loading · {counts.planned} not started
        </p>
      </div>

      <div className="hidden sm:block">
      <StatRow>
        <StatCard
          icon={<TruckIcon />}
          value={counts.total}
          label="Vehicles today"
          foot={counts.total === 0 ? "No trips published for this day." : `${counts.loaded} loaded · ${counts.total} total`}
        >
          {counts.total > 0 ? <Meter value={counts.loaded} max={counts.total} level="near" label="Vehicles loaded" /> : null}
        </StatCard>
        <StatCard
          icon={<CheckIcon />}
          value={counts.loaded}
          label="Loaded"
          foot={counts.total === 0 ? "Nothing released yet." : `${counts.loadedPercent}% complete`}
          footTone="good"
        />
        <StatCard
          icon={<BoxIcon />}
          value={counts.loading}
          label="Currently loading"
          foot={
            loadingNow.length === 0
              ? "No vehicle is being loaded."
              : loadingNow
                  .slice(0, 3)
                  .map((trip) => trip.vehicleId)
                  .join(", ") + (loadingNow.length > 3 ? ` +${loadingNow.length - 3}` : "")
          }
          footTone="info"
        />
        <StatCard
          icon={<ClockIcon />}
          value={counts.planned}
          label="Pending"
          foot={counts.planned === 0 ? "Nothing waiting." : "Not started — see the loading queue"}
        />
      </StatRow>
      </div>

      <SplitLayout
        list={
          <div className="flex flex-col gap-4">
            <Tabs
              label="Dock view"
              items={[
                { label: "Loading queue", href: href({ view: "queue" }), current: view === "queue", count: queue.length },
                { label: "Loaded", href: href({ view: "loaded" }), current: view === "loaded", count: loaded.length },
                { label: "All vehicles", href: href({ view: "all" }), current: view === "all", count: trips.length },
              ]}
            />
            <DataTable
              caption="Vehicles at the dock, in departure order"
              empty={
                shown.length === 0 ? (
                  <EmptyState
                    title={
                      trips.length === 0
                        ? "No trips published for this day"
                        : view === "queue"
                          ? "The queue is clear"
                          : "Nothing loaded yet"
                    }
                    detail={
                      trips.length === 0
                        ? "The dispatcher has not published a plan for this day. Pick another date, or check back once it is."
                        : view === "queue"
                          ? "Every vehicle has been released."
                          : "Vehicles appear here once they are marked ready."
                    }
                  />
                ) : undefined
              }
              head={
                <tr>
                  <Th>#</Th>
                  <Th>Vehicle / trip</Th>
                  <Th>Route</Th>
                  <Th numeric>Stops</Th>
                  <Th numeric>Orders</Th>
                  <Th>Depart</Th>
                  <Th>Status</Th>
                  <Th>Progress</Th>
                </tr>
              }
              cards={shown.map((trip) => (
                <TripCard key={trip.id} trip={trip} clock={clock} selected={trip.id === next?.id} />
              ))}
            >
              {shown.map((trip, index) => (
                <TripRow
                  key={trip.id}
                  trip={trip}
                  index={index + 1}
                  clock={clock}
                  selectHref={href({ trip: trip.id })}
                  selected={trip.id === selected?.id}
                />
              ))}
            </DataTable>
          </div>
        }
        panel={
          <div className="hidden lg:block">
            {selected ? (
              <DetailPanel>
                <TripDetail
                  tripId={selected.id}
                  trip={selected}
                  status={selected.status}
                  lines={selected.lines}
                  districts={districts}
                  vehicle={vehicles[selected.vehicleId] ?? null}
                  checkerName={user.name}
                  tab={tab}
                  tabs={{ list: href({ trip: selected.id }), vehicle: href({ trip: selected.id, tab: "vehicle" }) }}
                />
              </DetailPanel>
            ) : (
              <DetailPanel>
                <p className="text-sm text-muted">Pick a vehicle in the queue to see its loading list.</p>
              </DetailPanel>
            )}
          </div>
        }
      />

      {next ? (
        <div className="sticky bottom-0 -mx-4 -mb-4 border-t border-line bg-surface p-4 sm:-mx-6 sm:-mb-6 sm:px-6 lg:hidden">
          <ButtonLink
            href={`/loader/trips/${encodeURIComponent(next.id)}`}
            variant="primary"
            className="w-full"
          >
            Open {next.vehicleId} loading list
          </ButtonLink>
        </div>
      ) : null}
    </PageBody>
  );
}

/** The vehicle cell links two ways: the panel beside the queue on a wide
 *  screen, the full loading-list page where there is no room for a panel. */
function TripLink({ trip, selectHref, children }: { trip: DockTrip; selectHref: string; children: React.ReactNode }) {
  const page = `/loader/trips/${encodeURIComponent(trip.id)}`;
  return (
    <>
      <Link href={page} className="block min-h-11 lg:hidden">
        {children}
      </Link>
      <Link href={selectHref} scroll={false} className="hidden min-h-11 lg:block">
        {children}
      </Link>
    </>
  );
}

function VehicleCell({ trip }: { trip: DockTrip }) {
  return (
    <span className="flex min-h-11 flex-wrap items-center gap-x-2 gap-y-1">
      <span className="font-bold text-ink">{trip.vehicleId}</span>
      <span className="rounded-control border border-line bg-raised px-1.5 py-0.5 text-xs font-semibold text-muted">Trip {trip.tripNo}</span>
      {trip.refrigerated ? <StatusPill label="Refrigerated" tone="info" dot={false} /> : null}
    </span>
  );
}

function ProgressCell({ trip }: { trip: DockTrip }) {
  if (!trip.load) return <span className="text-sm text-muted">Load list unavailable</span>;
  const percent = unitsPercent(trip.load);
  return (
    <div className="flex min-w-32 flex-col gap-0.5">
      <div className="flex items-center gap-2">
        <div className="flex-1">
          <Meter value={trip.load.loadedUnits} max={trip.load.expectedUnits} level={trip.status === "LOADING" ? "near" : "ok"} label={`${trip.vehicleId} units loaded`} />
        </div>
        <span className="tabular w-10 text-right text-sm text-muted">{percent}%</span>
      </div>
      {trip.load.products > 0 ? <p className="text-xs text-muted">{plural(trip.load.products, "product")}</p> : null}
      {checksMissing(trip) ? <p className="text-xs text-muted">No load checks recorded</p> : null}
    </div>
  );
}

function TripRow({
  trip,
  index,
  clock,
  selectHref,
  selected,
}: {
  trip: DockTrip;
  index: number;
  clock: DockClock;
  selectHref: string;
  selected: boolean;
}) {
  const status = queueStatus(trip, attentionFor(trip, clock));
  return (
    <Tr selected={selected}>
      <Td numeric>{index}</Td>
      <Td>
        <TripLink trip={trip} selectHref={selectHref}>
          <VehicleCell trip={trip} />
        </TripLink>
      </Td>
      <Td>{trip.districtName}</Td>
      <Td numeric>{trip.load?.stops ?? "—"}</Td>
      <Td numeric>{trip.load?.lines ?? "—"}</Td>
      <Td>
        <span className="tabular">{trip.plannedDepartAt ?? "—"}</span>
      </Td>
      <Td>
        <StatusPill label={status.label} tone={status.tone} />
      </Td>
      <Td>
        <ProgressCell trip={trip} />
      </Td>
    </Tr>
  );
}

function TripCard({ trip, clock, selected }: { trip: DockTrip; clock: DockClock; selected: boolean }) {
  const status = queueStatus(trip, attentionFor(trip, clock));
  const load = trip.load;
  return (
    <RowCard>
      <Link
        href={`/loader/trips/${encodeURIComponent(trip.id)}`}
        className={`block min-h-11 rounded-control ${selected ? "-m-3 border-2 border-action bg-warn-surface p-3" : ""}`}
      >
        <div className="flex items-start justify-between gap-3">
          <p className="font-bold text-ink">
            {trip.vehicleId} <span className="font-normal text-muted">departs {trip.plannedDepartAt ?? "—"}</span>
          </p>
          <StatusPill label={status.label} tone={status.tone} />
        </div>
        <div className="mt-1 flex items-center justify-between gap-3 text-sm text-muted">
          <p>
            Trip {trip.tripNo}
            {trip.refrigerated ? " · Refrigerated" : ""} · {trip.districtName}
            {load && load.products > 0 ? ` · ${plural(load.products, "product")}` : ""}
          </p>
          <p className="tabular font-semibold text-ink">
            {load ? `${load.loadedUnits} / ${load.expectedUnits} units` : "no list"}
          </p>
        </div>
        <div className="mt-2">
          {load ? (
            <Meter value={load.loadedUnits} max={load.expectedUnits} level={trip.status === "LOADING" ? "near" : "ok"} label={`${trip.vehicleId} units loaded`} />
          ) : null}
        </div>
        {load ? (
          <p className="mt-1.5 text-xs text-muted">
            {checksMissing(trip) ? "No load checks recorded" : `${load.checked} of ${plural(load.lines, "order")} checked`}
          </p>
        ) : null}
      </Link>
    </RowCard>
  );
}
