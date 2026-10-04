import Link from "next/link";
import { ButtonLink, BlockedAction, Button } from "@/components/ui/button";
import { DataTable, RowCard, Td, Th, Tr } from "@/components/ui/data-table";
import { DateControl } from "@/components/ui/date-control";
import { DetailPanel, Facts, PanelSection } from "@/components/ui/detail-panel";
import { PageBody, PageHeader } from "@/components/ui/page-header";
import { Meter, StatCard, StatRow } from "@/components/ui/stat-card";
import { Advisory, EmptyState, ErrorPanel } from "@/components/ui/states";
import { StatusPill } from "@/components/ui/status-pill";
import { Tabs } from "@/components/ui/tabs";
import { api } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { longDate, todayInColombo } from "@/lib/dates";
import { deskDate } from "../desk-date";
import { readFailure } from "@/lib/failures";
import { ageLabel, clockTime, percent, plural } from "@/lib/format";
import { BackInService, MarkUnavailable } from "./availability-controls";
import { CheckIcon, RouteIcon, TruckIcon, WrenchIcon } from "./kpi-icons";
import {
  capacityLabel,
  chillerSummary,
  filterVehicles,
  initials,
  parseTab,
  STATUS_VIEW,
  TAB_ORDER,
  tabCounts,
  TRIP_STATUS_VIEW,
  typeLabel,
  vehicleKind,
  type VehicleTab,
} from "./vehicle-view";

export const dynamic = "force-dynamic";

const PATH = "/dispatcher/vehicles";

type Query = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

/** A link back to this screen that keeps the day, tab and search the dispatcher is on. */
function href(state: { date: string; tab: VehicleTab; q: string; vehicle?: string }) {
  const params = new URLSearchParams();
  params.set("date", state.date);
  if (state.tab !== "all") params.set("tab", state.tab);
  if (state.q) params.set("q", state.q);
  if (state.vehicle) params.set("vehicle", state.vehicle);
  return `${PATH}?${params.toString()}`;
}

export default async function VehiclesPage({ searchParams }: { searchParams: Promise<Query> }) {
  const query = await searchParams;
  const user = await requireRole("DISPATCHER", PATH);
  const date = await deskDate(query.date);
  const tab = parseTab(query.tab);
  const q = (first(query.q) ?? "").trim().slice(0, 60);
  const selectedId = first(query.vehicle) || undefined;
  const notice = first(query.notice);

  const client = await api();
  const [list, fleet] = await Promise.all([
    client.GET("/vehicles", { params: { query: { date } } }).catch(() => null),
    client.GET("/fleet/status", { params: { query: { date } } }).catch(() => null),
  ]);

  const header = (
    <PageHeader
      title="Vehicles"
      subtitle={`Fleet status, capacity and availability at ${user.depotCode ?? "your depot"}.`}
      aside={<DateControl date={date} path={PATH} keep={{ tab: tab === "all" ? undefined : tab, q: q || undefined }} />}
    />
  );

  if (!list?.data) {
    const failure = readFailure(list?.response.status ?? 0, "the fleet");
    return (
      <PageBody>
        {header}
        <ErrorPanel title={failure.title} detail={failure.detail} outcome={failure.outcome} />
      </PageBody>
    );
  }

  const { summary, vehicles } = list.data;
  const counts = tabCounts(summary);
  const rows = filterVehicles(vehicles, tab, q);
  const workshop = vehicles.filter((v) => v.status === "IN_WORKSHOP");
  const editable = fleet?.data?.editable ?? false;
  const lockedReason = fleet?.data?.lockedReason ?? null;
  const selected = selectedId ? vehicles.find((v) => v.vehicleId === selectedId) : undefined;
  const linkFor = (vehicleId: string) => href({ date, tab, q, vehicle: vehicleId });

  return (
    <PageBody>
      {header}

      {notice === "unavailable" || notice === "available" ? (
        <Advisory>
          {selectedId} is {notice === "unavailable" ? "marked unavailable" : "back in service"} for {longDate(date)}.
          {notice === "unavailable" ? " The next auto-plan run will not use it." : ""}
        </Advisory>
      ) : null}

      <StatRow>
        <StatCard
          icon={<TruckIcon />}
          value={summary.total}
          label="Total vehicles"
          foot={`${summary.refrigerated} refrigerated · ${summary.ambient} ambient`}
        />
        <StatCard
          icon={<CheckIcon />}
          value={summary.available}
          label={date === todayInColombo() ? "Available today" : "Available"}
          foot={`${percent(summary.available, summary.total)}% of fleet · ${summary.idle} idle`}
          footTone="good"
        />
        <StatCard
          icon={<RouteIcon />}
          value={summary.onRoute}
          label="On route"
          foot={`${summary.loading} loading · ${summary.returned} returned`}
          footTone="info"
        />
        <StatCard
          icon={<WrenchIcon />}
          value={summary.inWorkshop}
          label="In workshop"
          foot={workshop.length > 0 ? workshop.map((v) => v.vehicleId).join(", ") : "None"}
          footTone={workshop.length > 0 ? "bad" : "neutral"}
        />
      </StatRow>

      {/*
        Not SplitLayout: its panel sits beside the list from 1024px, which leaves
        this seven-column table about 350px and pushes Utilisation and Status off
        the edge. The panel therefore waits for xl, and when stacked it comes first
        (a tapped row lands the dispatcher at the top of the page, on its panel)
        and is not height-capped, so nothing inside it scrolls on its own.
      */}
      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_400px]">
        <div className="min-w-0">
          <section aria-label="Vehicles" className="flex flex-col gap-4">
            <Tabs
              label="Vehicle status"
              items={TAB_ORDER.map((item) => ({
                label: item.label,
                href: href({ date, tab: item.key, q, vehicle: selectedId }),
                current: item.key === tab,
                count: counts[item.key],
              }))}
            />

            <form method="get" action={PATH} role="search" className="flex flex-wrap gap-2">
              <input type="hidden" name="date" value={date} />
              {tab !== "all" ? <input type="hidden" name="tab" value={tab} /> : null}
              <label className="min-w-0 flex-1 basis-56">
                <span className="sr-only">Search vehicle or driver</span>
                <input
                  type="search"
                  name="q"
                  defaultValue={q}
                  maxLength={60}
                  placeholder="Search vehicle or driver…"
                  className="min-h-11 w-full rounded-control border border-line bg-surface px-3 text-sm text-ink"
                />
              </label>
              <Button type="submit" variant="secondary">
                Search
              </Button>
              {q ? (
                <ButtonLink href={href({ date, tab, q: "", vehicle: selectedId })} variant="ghost">
                  Clear
                </ButtonLink>
              ) : null}
            </form>

            <DataTable
              caption="Vehicles"
              empty={
                vehicles.length === 0 ? (
                  <EmptyState
                    title="No vehicles at this depot"
                    detail="The depot has no vehicles on record for this day."
                  />
                ) : rows.length === 0 ? (
                  <EmptyState
                    title="No vehicles match"
                    detail={q ? `Nothing in this tab matches "${q}".` : "Nothing is in this tab for the day."}
                    action={
                      <ButtonLink href={href({ date, tab: "all", q: "" })} variant="secondary">
                        Show all vehicles
                      </ButtonLink>
                    }
                  />
                ) : undefined
              }
              head={
                <tr>
                  <Th>Vehicle</Th>
                  <Th>Type</Th>
                  <Th>Capacity</Th>
                  <Th numeric>Trips</Th>
                  <Th>Utilisation</Th>
                  <Th>Status</Th>
                  <Th>
                    <span className="sr-only">Open</span>
                  </Th>
                </tr>
              }
              cards={rows.map((v) => (
                <RowCard key={v.vehicleId}>
                  <Link
                    href={linkFor(v.vehicleId)}
                    aria-current={v.vehicleId === selectedId ? "true" : undefined}
                    className="block"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="font-bold text-ink">{v.vehicleId}</p>
                        <p className="text-xs text-muted">{v.driverName ?? "No driver yet"}</p>
                      </div>
                      <StatusPill label={STATUS_VIEW[v.status].label} tone={STATUS_VIEW[v.status].tone} />
                    </div>
                    <p className="mt-2 text-xs text-muted">
                      {typeLabel(v)} {vehicleKind(v).toLowerCase()} · {capacityLabel(v)} · {plural(v.tripsToday, "trip")}
                    </p>
                    <div className="mt-2 flex items-center gap-2">
                      <Meter value={v.utilisationPct} max={100} label={`${v.vehicleId} utilisation`} />
                      <span className="tabular w-10 shrink-0 text-right text-xs text-muted">{v.utilisationPct}%</span>
                    </div>
                  </Link>
                </RowCard>
              ))}
            >
              {rows.map((v) => (
                <Tr key={v.vehicleId} selected={v.vehicleId === selectedId}>
                  <Td>
                    <Link
                      href={linkFor(v.vehicleId)}
                      aria-current={v.vehicleId === selectedId ? "true" : undefined}
                      className="block font-bold text-ink hover:underline"
                    >
                      {v.vehicleId}
                    </Link>
                    <span className="text-xs text-muted">{v.driverName ?? "—"}</span>
                  </Td>
                  <Td>
                    <span className="text-ink">{typeLabel(v)}</span>
                    <span className="block text-xs text-muted">{vehicleKind(v)}</span>
                  </Td>
                  <Td>
                    <span className="tabular whitespace-nowrap text-ink">{capacityLabel(v)}</span>
                  </Td>
                  <Td numeric>{v.tripsToday}</Td>
                  <Td>
                    <div className="flex min-w-32 items-center gap-2">
                      <Meter value={v.utilisationPct} max={100} label={`${v.vehicleId} utilisation`} />
                      <span className="tabular w-10 shrink-0 text-right text-xs text-muted">{v.utilisationPct}%</span>
                    </div>
                  </Td>
                  <Td>
                    <StatusPill label={STATUS_VIEW[v.status].label} tone={STATUS_VIEW[v.status].tone} />
                  </Td>
                  <Td>
                    <Link
                      href={linkFor(v.vehicleId)}
                      aria-label={`Open ${v.vehicleId}`}
                      className="grid size-9 place-items-center rounded-control text-muted hover:bg-canvas hover:text-ink"
                    >
                      <span aria-hidden>›</span>
                    </Link>
                  </Td>
                </Tr>
              ))}
            </DataTable>

            <p className="text-xs text-muted">
              {rows.length === vehicles.length
                ? plural(vehicles.length, "vehicle")
                : `${rows.length} of ${plural(vehicles.length, "vehicle")}`}
            </p>
          </section>
        </div>
        <div className="max-xl:order-first max-xl:[&>aside]:max-h-none">
            {selected ? (
              <VehiclePanel
                vehicleId={selected.vehicleId}
                date={date}
                editable={editable}
                lockedReason={lockedReason}
                closeHref={href({ date, tab, q })}
              />
            ) : selectedId ? (
              <ErrorPanel
                title={`${selectedId} is not in this fleet`}
                detail="It may belong to another depot, or the link is out of date."
                outcome="read"
                action={
                  <ButtonLink href={href({ date, tab, q })} variant="secondary">
                    Close
                  </ButtonLink>
                }
              />
            ) : (
              <div className="hidden rounded-card border border-dashed border-line bg-surface p-8 text-center text-sm text-muted xl:block">
                Select a vehicle to see its day.
              </div>
            )}
        </div>
      </div>
    </PageBody>
  );
}

async function VehiclePanel({
  vehicleId,
  date,
  editable,
  lockedReason,
  closeHref,
}: {
  vehicleId: string;
  date: string;
  editable: boolean;
  lockedReason: string | null;
  closeHref: string;
}) {
  const client = await api();
  const result = await client
    .GET("/vehicles/{vehicleId}", { params: { path: { vehicleId }, query: { date } } })
    .catch(() => null);

  if (!result?.data) {
    const failure = readFailure(result?.response.status ?? 0, `${vehicleId}`);
    return <ErrorPanel title={failure.title} detail={failure.detail} outcome={failure.outcome} />;
  }

  const v = result.data;
  const status = STATUS_VIEW[v.status];
  const chiller = v.chiller ? chillerSummary(v.chiller) : null;
  const onMap = v.status === "ON_ROUTE" || v.status === "LOADING";
  const inWorkshop = v.status === "IN_WORKSHOP";

  return (
    <DetailPanel
      footer={
        <>
          {onMap ? (
            <ButtonLink href={`/dispatcher/map?date=${date}&vehicle=${encodeURIComponent(v.vehicleId)}`} variant="dark" className="flex-1">
              View on map
            </ButtonLink>
          ) : null}
          {editable ? (
            inWorkshop ? (
              <BackInService vehicleId={v.vehicleId} date={date} />
            ) : v.status === "ON_ROUTE" ? (
              <p className="flex-1 self-center text-xs text-muted">On the road, so it cannot be marked unavailable.</p>
            ) : (
              <MarkUnavailable vehicleId={v.vehicleId} date={date} />
            )
          ) : (
            <BlockedAction reason={lockedReason ?? "This day's plan is published, so vehicle status can no longer be changed here."}>
              <Button variant="secondary" disabled>
                {inWorkshop ? "Back in service" : "Mark unavailable"}
              </Button>
            </BlockedAction>
          )}
        </>
      }
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-xl font-bold text-ink">{v.vehicleId}</h2>
            <span className="rounded-control border border-line bg-raised px-2 py-0.5 text-xs font-semibold text-muted">
              {typeLabel(v)}
            </span>
          </div>
          <p className="mt-0.5 text-sm text-muted">
            {vehicleKind(v)} · {capacityLabel(v)} · {Math.round(v.weightCapKg).toLocaleString("en-GB")} kg
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

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <StatusPill label={status.label} tone={status.tone} />
        {v.note ? <span className="text-sm text-muted">{v.note}</span> : null}
      </div>

      <PanelSection title="Capacity">
        <Facts
          items={[
            { label: "Volume", value: `${v.volumeCapM3} m³` },
            { label: "Weight", value: `${Math.round(v.weightCapKg).toLocaleString("en-GB")} kg` },
            { label: "Trips", value: v.tripsToday },
          ]}
        />
        <div className="mt-3">
          <div className="flex items-baseline justify-between text-sm">
            <span className="text-muted">Utilisation</span>
            <span className="tabular font-bold text-ink">{v.utilisationPct}%</span>
          </div>
          <div className="mt-1.5">
            <Meter value={v.utilisationPct} max={100} label={`${v.vehicleId} utilisation`} />
          </div>
          <p className="mt-1.5 text-xs text-muted">
            How full the day&apos;s loads are, averaged over its trips. It is not how busy the vehicle has been.
          </p>
        </div>
      </PanelSection>

      {v.temp === "reefer" ? (
        <PanelSection title="Chiller">
          {chiller ? (
            <div className={`rounded-control border p-3 ${chiller.inRange ? "border-good/25 bg-good-surface" : "border-bad/25 bg-bad-surface"}`}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="tabular text-lg font-bold text-ink">{chiller.headline}</p>
                  <p className="text-xs text-muted">{chiller.target}</p>
                </div>
                <StatusPill label={chiller.inRange ? "In range" : "Outside range"} tone={chiller.inRange ? "good" : "bad"} />
              </div>
              <p className="mt-2 text-xs text-muted">{chiller.byline}</p>
            </div>
          ) : (
            <p className="text-sm text-muted">Nobody has recorded a chiller reading for this vehicle yet.</p>
          )}
        </PanelSection>
      ) : null}

      <PanelSection title="Trips">
        {v.trips.length === 0 ? (
          <p className="text-sm text-muted">No trips on the published plan for this day.</p>
        ) : (
          <ol className="flex flex-col gap-2">
            {v.trips.map((trip) => {
              const tripStatus = TRIP_STATUS_VIEW[trip.status];
              return (
                <li key={trip.tripId} className="rounded-control border border-line p-3">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm text-ink">
                      <span className="font-bold">Trip {trip.tripNo}</span> <span className="text-muted">·</span> {trip.route}
                    </p>
                    <StatusPill label={tripStatus.label} tone={tripStatus.tone} />
                  </div>
                  <p className="tabular mt-1 text-xs text-muted">
                    Planned departure {trip.plannedDepartAt} · {plural(trip.stops, "stop")} · {plural(trip.orders, "order")}
                  </p>
                </li>
              );
            })}
          </ol>
        )}
      </PanelSection>

      <PanelSection title="Driver">
        {v.driverName ? (
          <div className="flex items-center gap-3 rounded-control bg-raised p-3">
            <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-full bg-rail text-xs font-bold text-white">
              {initials(v.driverName)}
            </span>
            <div>
              <p className="font-semibold text-ink">{v.driverName}</p>
              <p className="text-xs text-muted">Picked this vehicle at the dock</p>
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted">No driver has picked this vehicle yet.</p>
        )}
      </PanelSection>

      <PanelSection title="Last reported position">
        {v.position ? (
          <p className="text-sm text-ink">
            Last reported {clockTime(v.position.recordedAt)} · {ageLabel(v.position.ageSeconds)}
            {v.position.lamp ? <span className="ml-2 font-semibold text-warn-ink">Lamp Mode</span> : null}
            <span className="mt-0.5 block text-xs text-muted">
              From the driver&apos;s phone{v.position.accuracyM ? `, accurate to about ${Math.round(v.position.accuracyM)} m` : ""}.
            </span>
          </p>
        ) : (
          <p className="text-sm text-muted">No position reported yet.</p>
        )}
      </PanelSection>
    </DetailPanel>
  );
}
