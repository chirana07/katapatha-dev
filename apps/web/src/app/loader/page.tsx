import Link from "next/link";
import { ButtonLink } from "@/components/ui/button";
import { PageBody, PageHeader } from "@/components/ui/page-header";
import { EmptyState, ErrorPanel } from "@/components/ui/states";
import type { Tone } from "@/components/ui/status-pill";
import { requireRole, scopeLabel } from "@/lib/auth";
import { dateParam, todayInColombo } from "@/lib/dates";
import { readFailure } from "@/lib/failures";
import { loadDock, loadShift } from "./dock-data.server";
import {
  attentionFor,
  attentionLabel,
  colomboMinutes,
  dockCounts,
  isLoaded,
  nextToLoad,
  unitsPercent,
  type Attention,
  type DockClock,
  type DockTrip,
} from "./dock-model";
import { DockHeader } from "./dock-header";
import { Bar, DockStatus, KpiCard, KpiRow, NumberDisc, Panel, Tag } from "./dock-ui";
import { BoxCheckIcon, CheckCircleFilledIcon, ChevronRightIcon, ClockIcon, FilterIcon, PinIcon, ScanIcon, SearchIcon, TruckIcon, DocumentIcon } from "./icons";
import { MobileHeader } from "./mobile-header";
import { TripDetail, type DetailTab } from "./trip-detail";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
type View = "queue" | "loaded" | "all";
type Filter = "all" | "loading" | "pending" | "attention";

const FILTERS: { value: Filter; label: string }[] = [
  { value: "all", label: "Every status" },
  { value: "loading", label: "Loading" },
  { value: "pending", label: "Pending" },
  { value: "attention", label: "Needs attention" },
];

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * L-02 (tablet) and L-07 (phone): the dock queue.
 *
 * The queue is every vehicle still at the dock in departure order, each with
 * its bay; the panel beside it is the selected vehicle's loading list. On a
 * phone there is no room for the panel, so the queue is the screen and each
 * vehicle opens its own loading list (L-08).
 */
export default async function DockPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const user = await requireRole("LOADER", "/loader");
  const date = dateParam(params.date);
  const rawView = first(params.view);
  const view: View = rawView === "loaded" || rawView === "all" ? rawView : "queue";
  const rawTab = first(params.tab);
  const tab: DetailTab = rawTab === "vehicle" || rawTab === "stops" ? rawTab : "list";
  const q = (first(params.q) ?? "").trim();
  const rawFilter = first(params.status);
  const filter: Filter = FILTERS.some((f) => f.value === rawFilter) ? (rawFilter as Filter) : "all";
  const bayParam = Number(first(params.bay));
  const bayFilter = Number.isInteger(bayParam) && bayParam > 0 ? bayParam : null;

  const [day, shift] = await Promise.all([loadDock(date), loadShift(date)]);
  const title = scopeLabel(user);
  const subtitle = "Load each vehicle in the order shown. The last stop goes in first.";
  const today = todayInColombo();

  if (!day.ok) {
    const failure = readFailure(day.status, "the dock board");
    return (
      <PageBody>
        <PageHeader title={title} subtitle={subtitle} />
        <ErrorPanel title={failure.title} detail={failure.detail} outcome="read" action={<ButtonLink href={`/loader?date=${date}`}>Reload</ButtonLink>} />
      </PageBody>
    );
  }

  const { trips, districts, vehicles } = day;
  const counts = dockCounts(trips);
  const clock: DockClock = { date, today, minutesNow: colomboMinutes() };
  const behind = new Map((shift?.trips ?? []).map((t) => [t.tripId, t.minutesBehind ?? null]));
  const attentionOf = (trip: DockTrip) => attentionFor(trip, clock, behind.get(trip.id) ?? null);
  const maxBehind = Math.max(0, ...[...behind.values()].map((v) => v ?? 0));

  const queue = trips.filter((trip) => !isLoaded(trip.status));
  const loaded = trips.filter((trip) => isLoaded(trip.status));
  const inView = view === "queue" ? queue : view === "loaded" ? loaded : trips;
  const needle = q.toLowerCase();
  const shown = inView.filter((trip) => {
    if (bayFilter != null && trip.dockBay !== bayFilter) return false;
    if (needle && ![trip.vehicleId, trip.districtName, `bay ${trip.dockBay ?? ""}`, `trip ${trip.tripNo}`].some((s) => s.toLowerCase().includes(needle))) {
      return false;
    }
    if (filter === "loading") return trip.status === "LOADING";
    if (filter === "pending") return trip.status === "PLANNED";
    if (filter === "attention") return attentionOf(trip).length > 0;
    return true;
  });

  const requested = first(params.trip);
  const selected = shown.find((trip) => trip.id === requested) ?? nextToLoad(shown) ?? shown[0] ?? null;
  const next = nextToLoad(trips);
  const loadingNow = trips.filter((trip) => trip.status === "LOADING");

  const href = (over: { view?: View; trip?: string; tab?: DetailTab; status?: Filter; bay?: number | null; q?: string | null }) => {
    const query = new URLSearchParams({ date });
    const nextView = over.view ?? view;
    if (nextView !== "queue") query.set("view", nextView);
    const nextQ = over.q === undefined ? q : over.q;
    if (nextQ) query.set("q", nextQ);
    const nextFilter = over.status ?? filter;
    if (nextFilter !== "all") query.set("status", nextFilter);
    const nextBay = over.bay === undefined ? bayFilter : over.bay;
    if (nextBay != null) query.set("bay", String(nextBay));
    if (over.trip) query.set("trip", over.trip);
    if (over.tab && over.tab !== "list") query.set("tab", over.tab);
    return `/loader?${query.toString()}`;
  };
  const bays = Array.from({ length: shift?.dockBays ?? 6 }, (_, i) => i + 1);

  return (
    <PageBody>
      <MobileHeader
        title={title}
        line={`${user.name} · ${date === today ? "today" : date}`}
        progressLabel={`${counts.loaded} of ${counts.total} vehicles sealed`}
        value={counts.loaded}
        max={counts.total}
        bays={{
          label: bayFilter != null ? `Bay ${bayFilter}` : "All bays",
          options: [{ label: "All bays", href: href({ bay: null }), current: bayFilter == null }, ...bays.map((b) => ({ label: `Bay ${b}`, href: href({ bay: b }), current: bayFilter === b }))],
        }}
      />

      <div className="hidden lg:block">
        <DockHeader title={title} subtitle={subtitle} date={date} path="/loader" keep={{ view: view === "queue" ? undefined : view }} behindMinutes={maxBehind} isToday={date === today} />
      </div>

      <div className="hidden sm:block">
        <KpiRow wide>
          <KpiCard
            icon={<TruckIcon className="size-6.5" />}
            value={counts.total}
            label="Vehicles today"
            foot={counts.total === 0 ? "No trips published for this day." : `${counts.loaded} loaded · ${counts.total} total`}
          >
            {counts.total > 0 ? <Bar segments={[{ value: counts.loaded, color: "flame" }]} max={counts.total} label="Vehicles loaded" height="h-2" /> : null}
          </KpiCard>
          <KpiCard
            icon={<CheckCircleFilledIcon className="size-11.5" />}
            iconTone="good"
            value={counts.loaded}
            label="Loaded"
            foot={counts.total === 0 ? "Nothing sealed yet." : `${counts.loadedPercent}% complete`}
            footTone="neutral"
          />
          <KpiCard
            icon={<BoxCheckIcon className="size-6.5" />}
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
          />
          <KpiCard
            icon={<ClockIcon className="size-6" />}
            iconTone="neutral"
            value={counts.planned}
            label="Pending"
            foot={counts.planned === 0 ? "Nothing waiting." : <Link href={href({ status: "pending" })} className="hover:underline">See loading sequence</Link>}
          />
        </KpiRow>
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_460px]">
        <div className="min-w-0">
          {/* Phone (L-07): the queue as cards. */}
          <section className="flex flex-col gap-2.5 sm:hidden" aria-labelledby="queue-phone">
            <div className="flex items-baseline justify-between">
              <h2 id="queue-phone" className="text-[17px] font-bold text-[#111827]">
                Loading queue
              </h2>
              <p className="text-[12.5px] font-medium text-muted">by departure</p>
            </div>
            {shown.length === 0 ? (
              <EmptyQueue trips={trips.length} view={view} />
            ) : (
              shown.map((trip) => <QueueCard key={trip.id} trip={trip} attention={attentionOf(trip)} highlighted={trip.id === next?.id} />)
            )}
          </section>

          {/* Tablet and desktop (L-02): the queue as a table. */}
          <Panel className="hidden p-2 sm:block">
            <div className="flex flex-wrap items-center justify-between gap-2 px-1 pt-1">
              <nav aria-label="Dock view" className="flex gap-1">
                {(
                  [
                    { key: "queue", label: `Loading queue (${queue.length})` },
                    { key: "loaded", label: `Loaded (${loaded.length})` },
                    { key: "all", label: "All vehicles" },
                  ] as const
                ).map((item) => (
                  <Link
                    key={item.key}
                    href={href({ view: item.key })}
                    aria-current={view === item.key ? "page" : undefined}
                    className={`flex min-h-11 items-center rounded-t-[6px] border-b-[3px] px-3 text-[15px] ${
                      view === item.key ? "border-action bg-[#fff8e6] font-semibold text-[#111827]" : "border-transparent text-[#374151] hover:bg-raised"
                    }`}
                  >
                    {item.label}
                  </Link>
                ))}
              </nav>
              <div className="flex items-center gap-2">
                <form method="get" action="/loader" className="relative">
                  <input type="hidden" name="date" value={date} />
                  {view !== "queue" ? <input type="hidden" name="view" value={view} /> : null}
                  {filter !== "all" ? <input type="hidden" name="status" value={filter} /> : null}
                  <SearchIcon className="pointer-events-none absolute left-3 top-1/2 size-4.5 -translate-y-1/2 text-muted" />
                  <label className="sr-only" htmlFor="dock-search">
                    Search vehicle, route or bay
                  </label>
                  <input
                    id="dock-search"
                    name="q"
                    defaultValue={q}
                    placeholder="Search vehicle, route or bay…"
                    className="h-9.5 w-64 rounded-[8px] border border-[#e5e7eb] bg-surface pl-9 pr-3 text-[13px] text-ink placeholder:text-muted"
                  />
                </form>
                <details className="relative">
                  <summary className="flex h-9.5 cursor-pointer list-none items-center gap-2 rounded-[6px] border border-[#e5e7eb] bg-surface px-3 text-[15px] text-[#111827] [&::-webkit-details-marker]:hidden">
                    <FilterIcon className="size-4" />
                    Filter
                    {filter !== "all" || bayFilter != null ? <span aria-hidden className="size-1.5 rounded-full bg-link" /> : null}
                  </summary>
                  <div className="absolute right-0 z-20 mt-1 w-52 rounded-[8px] border border-line bg-surface p-1 text-sm shadow-lg">
                    <p className="px-2 pb-1 pt-1.5 text-xs font-semibold uppercase tracking-wide text-muted">Status</p>
                    {FILTERS.map((option) => (
                      <Link
                        key={option.value}
                        href={href({ status: option.value })}
                        aria-current={filter === option.value ? "true" : undefined}
                        className={`block rounded-[6px] px-2 py-1.5 ${filter === option.value ? "bg-[#fff8e6] font-semibold" : "hover:bg-raised"}`}
                      >
                        {option.label}
                      </Link>
                    ))}
                    <p className="px-2 pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-muted">Bay</p>
                    <div className="flex flex-wrap gap-1 px-1 pb-1">
                      <Link href={href({ bay: null })} className={`rounded-[6px] px-2 py-1 ${bayFilter == null ? "bg-[#fff8e6] font-semibold" : "hover:bg-raised"}`}>
                        All
                      </Link>
                      {bays.map((b) => (
                        <Link key={b} href={href({ bay: b })} className={`rounded-[6px] px-2 py-1 ${bayFilter === b ? "bg-[#fff8e6] font-semibold" : "hover:bg-raised"}`}>
                          {b}
                        </Link>
                      ))}
                    </div>
                  </div>
                </details>
              </div>
            </div>

            {q || filter !== "all" || bayFilter != null ? (
              <p className="px-2 pt-2 text-[13px] text-muted">
                {shown.length} of {inView.length} shown
                {q ? ` · “${q}”` : ""}
                {filter !== "all" ? ` · ${FILTERS.find((f) => f.value === filter)!.label}` : ""}
                {bayFilter != null ? ` · Bay ${bayFilter}` : ""} ·{" "}
                <Link href={href({ q: null, status: "all", bay: null })} className="font-semibold text-link">
                  Clear
                </Link>
              </p>
            ) : null}

            {shown.length === 0 ? (
              <div className="p-2">
                <EmptyQueue trips={trips.length} view={view} />
              </div>
            ) : (
              <table className="mt-2 w-full text-[14.5px]">
                <caption className="sr-only">Vehicles at the dock, in departure order</caption>
                <thead>
                  <tr className="bg-[#f9fafb] text-left text-[12.5px] font-medium text-[#374151]">
                    <th className="rounded-l-[6px] px-3 py-2 font-medium">#</th>
                    <th className="px-2 py-2 font-medium">Vehicle / Trip</th>
                    <th className="px-2 py-2 font-medium">Route</th>
                    <th className="px-2 py-2 font-medium">Bay</th>
                    <th className="px-2 py-2 text-right font-medium">Stops</th>
                    <th className="px-2 py-2 text-right font-medium">Orders</th>
                    <th className="px-2 py-2 font-medium">Depart</th>
                    <th className="px-2 py-2 font-medium">Status</th>
                    <th className="px-2 py-2 font-medium">Progress</th>
                    <th className="rounded-r-[6px] px-2 py-2">
                      <span className="sr-only">Open</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((trip, index) => (
                    <QueueRow
                      key={trip.id}
                      trip={trip}
                      index={index + 1}
                      attention={attentionOf(trip)}
                      selectHref={href({ trip: trip.id })}
                      selected={trip.id === selected?.id}
                      isNext={trip.id === next?.id}
                    />
                  ))}
                </tbody>
              </table>
            )}
          </Panel>
        </div>

        <div className="hidden lg:block">
          <aside className="flex max-h-[calc(100vh-2rem)] flex-col overflow-hidden rounded-[10px] border border-[#e5e7eb] bg-surface lg:sticky lg:top-4">
            <div className="min-h-0 flex-1 overflow-y-auto px-4 pt-4">
              {selected ? (
                <TripDetail
                  tripId={selected.id}
                  trip={selected}
                  status={selected.status}
                  lines={selected.lines}
                  districts={districts}
                  vehicle={vehicles[selected.vehicleId] ?? null}
                  checkerName={user.name}
                  tab={tab}
                  tabs={{
                    list: href({ trip: selected.id }),
                    stops: href({ trip: selected.id, tab: "stops" }),
                    vehicle: href({ trip: selected.id, tab: "vehicle" }),
                  }}
                  dispatcherName={shift?.dispatcherName ?? null}
                />
              ) : (
                <p className="pb-4 text-sm text-muted">Pick a vehicle in the queue to see its loading list.</p>
              )}
            </div>
          </aside>
        </div>
      </div>

      {/* Phone (L-07): the bottom action bar. */}
      {next ? (
        <div className="sticky bottom-0 -mx-4 -mb-4 flex flex-col gap-2 border-t border-[#e5e7eb] bg-[#fafafa] p-4 sm:hidden">
          <div className="grid grid-cols-2 gap-2">
            <form method="get" action="/loader" className="relative">
              <input type="hidden" name="date" value={date} />
              <ScanIcon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[#111827]" />
              <label htmlFor="scan-vehicle" className="sr-only">
                Scan or type a vehicle
              </label>
              <input
                id="scan-vehicle"
                name="q"
                placeholder="Scan vehicle"
                autoComplete="off"
                className="h-11 w-full rounded-[6px] border border-[#e5e7eb] bg-surface pl-9 pr-2 text-[13px] font-medium text-[#111827] placeholder:text-[#111827]"
              />
            </form>
            <Link
              href={`/loader/trips/${encodeURIComponent(next.id)}?report=1`}
              className="flex h-11 items-center justify-center gap-2 rounded-[6px] border border-[#e5e7eb] bg-surface text-[13px] font-medium text-[#111827]"
            >
              <DocumentIcon className="size-4" />
              Report issue
            </Link>
          </div>
          <ButtonLink href={`/loader/trips/${encodeURIComponent(next.id)}`} variant="primary" className="w-full">
            Open {next.vehicleId} loading list
          </ButtonLink>
        </div>
      ) : null}
    </PageBody>
  );
}

function EmptyQueue({ trips, view }: { trips: number; view: View }) {
  return (
    <EmptyState
      title={trips === 0 ? "No trips published for this day" : view === "queue" ? "Nothing to show here" : "Nothing loaded yet"}
      detail={
        trips === 0
          ? "The dispatcher has not published a plan for this day. Pick another date, or check back once it is."
          : view === "queue"
            ? "Every vehicle in this view has been sealed, or the search and filter hide the rest."
            : "Vehicles appear here once they are marked ready."
      }
    />
  );
}

/** The row's status, as the Figma words it: Loading, Pending, or the first
 *  thing that needs a look. */
function rowStatus(trip: DockTrip, attention: Attention[]): { label: string; tone: Tone } {
  const lead = attention[0];
  if (lead) return { label: attentionLabel(lead), tone: lead.kind === "shortage" || lead.kind === "chiller" ? "bad" : "warn" };
  switch (trip.status) {
    case "LOADING":
      return { label: "Loading", tone: "info" };
    case "PLANNED":
      return { label: "Pending", tone: "neutral" };
    case "READY":
      return { label: "Sealed", tone: "good" };
    case "DEPARTED":
      return { label: "Departed", tone: "good" };
    case "COMPLETED":
      return { label: "Completed", tone: "good" };
    default:
      return { label: "Cancelled", tone: "bad" };
  }
}

const PIN_TONE = { Fresh: "text-good", Style: "text-[#ec4899]", Tech: "text-link" } as const;

function QueueRow({
  trip,
  index,
  attention,
  selectHref,
  selected,
  isNext,
}: {
  trip: DockTrip;
  index: number;
  attention: Attention[];
  selectHref: string;
  selected: boolean;
  isNext: boolean;
}) {
  const status = rowStatus(trip, attention);
  const percent = unitsPercent(trip.load);
  const page = `/loader/trips/${encodeURIComponent(trip.id)}`;
  return (
    <tr className={`border-b border-[#f0f0f0] last:border-b-0 ${selected ? "bg-[#fff8e6]" : "hover:bg-[#fafafa]"}`}>
      <td className="rounded-l-[6px] px-2 py-2">
        <NumberDisc n={index} tone={isNext ? "flame" : "neutral"} />
      </td>
      <td className="px-2 py-2">
        <Link href={selectHref} scroll={false} className="hidden min-h-11 flex-col justify-center lg:flex">
          <VehicleCell trip={trip} />
        </Link>
        <Link href={page} className="flex min-h-11 flex-col justify-center lg:hidden">
          <VehicleCell trip={trip} />
        </Link>
      </td>
      <td className="px-2 py-2">
        <span className="inline-flex items-center gap-1.5 text-[#111827]">
          <PinIcon className={`size-3.5 ${PIN_TONE[trip.brand]}`} />
          {trip.districtName}
        </span>
      </td>
      <td className="tabular px-2 py-2 text-[#374151]">{trip.dockBay ?? "—"}</td>
      <td className="tabular px-2 py-2 text-right text-[#111827]">{trip.load?.stops ?? "—"}</td>
      <td className="tabular px-2 py-2 text-right text-[#111827]">{trip.load?.lines ?? "—"}</td>
      <td className="tabular px-2 py-2 text-[#111827]">{trip.plannedDepartAt ?? "—"}</td>
      <td className="px-2 py-2">
        <DockStatus label={status.label} tone={status.tone} />
      </td>
      <td className="px-2 py-2">
        {trip.load ? (
          <span className="flex min-w-36 items-center gap-2.5">
            <span className="flex-1">
              <Bar
                segments={[{ value: trip.load.loadedUnits, color: status.tone === "bad" ? "red" : status.tone === "warn" ? "amber" : "blue" }]}
                max={trip.load.expectedUnits}
                label={`${trip.vehicleId} units loaded`}
              />
            </span>
            <span className="tabular w-9 text-right text-[12.5px] text-muted">{percent}%</span>
          </span>
        ) : (
          <span className="text-[13px] text-muted">List unavailable</span>
        )}
      </td>
      <td className="rounded-r-[6px] px-1 py-2">
        <Link href={selectHref} scroll={false} aria-label={`Open ${trip.vehicleId} trip ${trip.tripNo}`} className="hidden size-9 place-items-center text-[#111827] lg:grid">
          <ChevronRightIcon className="size-4" />
        </Link>
        <Link href={page} aria-label={`Open ${trip.vehicleId} trip ${trip.tripNo}`} className="grid size-9 place-items-center text-[#111827] lg:hidden">
          <ChevronRightIcon className="size-4" />
        </Link>
      </td>
    </tr>
  );
}

function VehicleCell({ trip }: { trip: DockTrip }) {
  return (
    <>
      <span className="flex items-center gap-2">
        <span className="font-bold text-[#111827]">{trip.vehicleId}</span>
        <Tag>Trip {trip.tripNo}</Tag>
      </span>
      {trip.refrigerated ? (
        <span className="mt-1">
          <Tag>Refrigerated</Tag>
        </span>
      ) : null}
    </>
  );
}

/** L-07's vehicle card. */
function QueueCard({ trip, attention, highlighted }: { trip: DockTrip; attention: Attention[]; highlighted: boolean }) {
  const status = rowStatus(trip, attention);
  const load = trip.load;
  return (
    <Link
      href={`/loader/trips/${encodeURIComponent(trip.id)}`}
      className={`flex flex-col gap-1.5 rounded-[12px] px-3 py-2.5 ${highlighted ? "border-2 border-action bg-[#fff8e6]" : "border border-[#e5e7eb] bg-surface"}`}
    >
      <span className="flex items-center justify-between gap-2">
        <span className="flex items-baseline gap-2">
          <span className="text-[15.5px] font-bold text-[#111827]">{trip.vehicleId}</span>
          <span className="text-[12.5px] font-medium text-muted">departs {trip.plannedDepartAt ?? "—"}</span>
        </span>
        <DockStatus label={status.label} tone={status.tone} round />
      </span>
      <span className="flex items-start justify-between gap-2 text-[12.5px] text-[#374151]">
        <span>
          {trip.refrigerated ? "Reefer" : `Trip ${trip.tripNo}`}
          {trip.dockBay != null ? ` · Bay ${trip.dockBay}` : ""} · {trip.districtName}
        </span>
        <span className="tabular font-semibold">{load ? `${load.loadedUnits} / ${load.expectedUnits} units` : "no list"}</span>
      </span>
      {load ? (
        <Bar
          segments={[{ value: load.loadedUnits, color: highlighted ? "flame" : status.tone === "bad" ? "red" : "blue" }]}
          max={load.expectedUnits}
          label={`${trip.vehicleId} units loaded`}
          height="h-1.5"
        />
      ) : null}
    </Link>
  );
}
