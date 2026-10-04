import Link from "next/link";
import type { ReactNode } from "react";
import { ButtonLink } from "@/components/ui/button";
import { PageBody, PageHeader } from "@/components/ui/page-header";
import { EmptyState, ErrorPanel } from "@/components/ui/states";
import { requireRole } from "@/lib/auth";
import { dateParam, todayInColombo } from "@/lib/dates";
import { readFailure } from "@/lib/failures";
import { plural } from "@/lib/format";
import { loadDock, loadShift, type DockShift } from "../dock-data.server";
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
} from "../dock-model";
import { DockHeader } from "../dock-header";
import { Bar, DockStatus, KpiCard, Panel, Tag } from "../dock-ui";
import { chillerHeadline } from "../chiller";
import {
  AlertIcon,
  BoxMinusIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  ClockIcon,
  LockIcon,
  SnowflakeIcon,
  TrendingIcon,
} from "../icons";
import { shortName } from "../load-items";
import { WAVE_LABEL, WAVE_WINDOW, groupByWave } from "../wave";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
type View = "all" | "loading" | "risk" | "sealed";
type Sort = "departure" | "progress" | "bay";

const SORTS: { value: Sort; label: string }[] = [
  { value: "departure", label: "Departure time" },
  { value: "progress", label: "Least loaded first" },
  { value: "bay", label: "Bay" },
];

type Row = { trip: DockTrip; attention: Attention[]; behind: number | null };

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * L-05: every vehicle from first box to sealed door, by wave, with the bays,
 * what needs a look, and the dock's pace.
 */
export default async function LoadingProgressPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  await requireRole("LOADER", "/loader/progress");
  const date = dateParam(params.date);
  const rawView = first(params.view);
  const view: View = rawView === "loading" || rawView === "risk" || rawView === "sealed" ? rawView : "all";
  const rawSort = first(params.sort);
  const sort: Sort = rawSort === "progress" || rawSort === "bay" ? rawSort : "departure";
  const today = todayInColombo();

  const [day, shift] = await Promise.all([loadDock(date), loadShift(date)]);
  const subtitle = "Track every vehicle from first box to sealed door before it departs.";

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
  const clock: DockClock = { date, today, minutesNow: colomboMinutes() };
  const behindOf = new Map((shift?.trips ?? []).map((t) => [t.tripId, t.minutesBehind ?? null]));
  const rows: Row[] = trips.map((trip) => {
    const behind = behindOf.get(trip.id) ?? null;
    return { trip, behind, attention: attentionFor(trip, clock, behind) };
  });
  const counts = dockCounts(trips);
  const expectedUnits = trips.reduce((sum, trip) => sum + (trip.load?.expectedUnits ?? 0), 0);
  const sealedUnits = trips.filter((t) => isLoaded(t.status)).reduce((sum, trip) => sum + (trip.load?.loadedUnits ?? 0), 0);
  const loadingUnits = trips.filter((t) => !isLoaded(t.status)).reduce((sum, trip) => sum + (trip.load?.loadedUnits ?? 0), 0);
  const overall = expectedUnits > 0 ? Math.round(((sealedUnits + loadingUnits) / expectedUnits) * 100) : 0;

  const open = rows.filter((row) => !isLoaded(row.trip.status));
  const atRisk = open.filter((row) => row.attention.length > 0);
  const onTrack = open.length - atRisk.length;
  const next = nextToLoad(trips);
  const maxBehind = Math.max(0, ...rows.map((r) => r.behind ?? 0));

  const inView = (row: Row) =>
    view === "all" ? true : view === "loading" ? row.trip.status === "LOADING" : view === "risk" ? row.attention.length > 0 && !isLoaded(row.trip.status) : isLoaded(row.trip.status);
  const shown = rows.filter(inView);
  const rowOf = new Map(rows.map((row) => [row.trip.id, row]));
  const sorted = (list: DockTrip[]) =>
    sort === "progress"
      ? [...list].sort((a, b) => unitsPercent(a.load) - unitsPercent(b.load))
      : sort === "bay"
        ? [...list].sort((a, b) => (a.dockBay ?? 99) - (b.dockBay ?? 99))
        : list;
  const waves = groupByWave(shown.map((row) => row.trip)).map((group) => ({ ...group, trips: sorted(group.trips) }));

  const href = (over: { view?: View; sort?: Sort }) => {
    const query = new URLSearchParams({ date });
    const v = over.view ?? view;
    const s = over.sort ?? sort;
    if (v !== "all") query.set("view", v);
    if (s !== "departure") query.set("sort", s);
    return `/loader/progress?${query.toString()}`;
  };

  return (
    <PageBody>
      <DockHeader title="Loading progress" subtitle={subtitle} date={date} path="/loader/progress" keep={{ view: view === "all" ? undefined : view }} behindMinutes={maxBehind} isToday={date === today} />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-[1.25fr_1fr_1fr_1fr]">
        <div className="flex min-h-[110px] flex-col justify-between rounded-[10px] border border-[#ededed] bg-surface p-4">
          <p className="text-sm text-[#374151]">Overall progress</p>
          <p className="flex items-baseline gap-3">
            <span className="tabular text-[29px] font-bold text-[#111827]">{overall}%</span>
            <span className="tabular text-[15px] text-[#374151]">
              {sealedUnits + loadingUnits} of {expectedUnits} units loaded
            </span>
          </p>
          <Bar
            segments={[
              { value: sealedUnits, color: "green" },
              { value: loadingUnits, color: "blue" },
            ]}
            max={expectedUnits}
            label="Units loaded across the day: sealed, then loading"
            height="h-2"
          />
        </div>
        <KpiCard
          icon={<LockIcon className="size-5" />}
          iconTone="good"
          value={`${counts.loaded} / ${counts.total}`}
          label="Vehicles sealed"
          foot={next ? `Next seal: ${next.vehicleId}${next.dockBay != null ? ` · Bay ${next.dockBay}` : ""}` : counts.total === 0 ? "No trips this day." : "Every vehicle is sealed."}
        />
        <KpiCard icon={<TrendingIcon className="size-5.5" />} value={onTrack} label="On track" foot="Loading ahead of departure times" />
        <KpiCard
          icon={<AlertIcon className="size-5.5" />}
          iconTone="bad"
          tone={atRisk.length > 0 ? "bad" : "neutral"}
          value={atRisk.length}
          label="At risk"
          foot={atRisk.length > 0 ? <Link href={href({ view: "risk" })} className="font-semibold hover:underline">May miss departure · review now</Link> : "Nothing at risk."}
          footTone={atRisk.length > 0 ? "bad" : "neutral"}
        />
      </div>

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_440px]">
        <Panel className="min-w-0 p-2">
          <div className="flex flex-wrap items-center justify-between gap-2 px-1 pt-1">
            <nav aria-label="Progress view" className="flex flex-wrap gap-1">
              {(
                [
                  { key: "all", label: `All vehicles (${rows.length})` },
                  { key: "loading", label: `Loading (${counts.loading})` },
                  { key: "risk", label: `At risk (${atRisk.length})`, badge: atRisk.length },
                  { key: "sealed", label: `Sealed (${counts.loaded})` },
                ] as const
              ).map((item) => (
                <Link
                  key={item.key}
                  href={href({ view: item.key })}
                  aria-current={view === item.key ? "page" : undefined}
                  className={`flex min-h-11 items-center gap-2 rounded-t-[6px] border-b-[3px] px-3 text-[15px] ${
                    view === item.key ? "border-action bg-[#fff8e6] font-semibold text-[#111827]" : "border-transparent text-[#374151] hover:bg-raised"
                  }`}
                >
                  {"badge" in item && item.badge > 0 ? (
                    <>
                      At risk ({item.badge})
                      <span className="tabular grid size-5 place-items-center rounded-full bg-bad text-[11px] font-bold text-white">{item.badge}</span>
                    </>
                  ) : (
                    item.label
                  )}
                </Link>
              ))}
            </nav>
            <details className="relative">
              <summary className="flex h-10 cursor-pointer list-none items-center gap-6 rounded-[6px] border border-[#e5e7eb] bg-surface px-3 text-sm text-[#111827] [&::-webkit-details-marker]:hidden">
                Sort: {SORTS.find((s) => s.value === sort)!.label}
                <ChevronDownIcon className="size-4" />
              </summary>
              <div className="absolute right-0 z-20 mt-1 w-52 rounded-[8px] border border-line bg-surface p-1 text-sm shadow-lg">
                {SORTS.map((option) => (
                  <Link key={option.value} href={href({ sort: option.value })} className={`block rounded-[6px] px-2 py-1.5 ${sort === option.value ? "bg-[#fff8e6] font-semibold" : "hover:bg-raised"}`}>
                    {option.label}
                  </Link>
                ))}
              </div>
            </details>
          </div>

          {waves.length === 0 ? (
            <div className="p-2">
              <EmptyState
                title={rows.length === 0 ? "No trips published for this day" : "Nothing in this view"}
                detail={rows.length === 0 ? "The dispatcher has not published a plan for this day." : "Pick another view to see the rest of the day."}
              />
            </div>
          ) : (
            <div className="mt-2">
              <div className="grid grid-cols-[minmax(0,1.3fr)_minmax(0,1.6fr)_7rem_4.5rem_2rem] gap-2 rounded-[6px] bg-[#f9fafb] px-3 py-2 text-[12.5px] font-medium text-[#374151] max-md:hidden">
                <span>Vehicle</span>
                <span>Loading progress</span>
                <span>Status</span>
                <span>Departs</span>
                <span className="sr-only">Open</span>
              </div>
              {waves.map((group) => {
                const sealed = group.trips.filter((trip) => isLoaded(trip.status));
                const unsealed = group.trips.filter((trip) => !isLoaded(trip.status));
                const allInWave = trips.filter((t) => t.wave === group.wave);
                const sealedInWave = allInWave.filter((t) => isLoaded(t.status)).length;
                return (
                  <section key={group.wave} aria-labelledby={`wave-${group.wave}`}>
                    <div className="flex items-center justify-between gap-3 border-b border-[#f0f0f0] px-3 py-2.5">
                      <h2 id={`wave-${group.wave}`} className="text-[15px] font-bold text-[#111827]">
                        {WAVE_LABEL[group.wave]} <span className="font-normal text-muted">{WAVE_WINDOW[group.wave]}</span>
                      </h2>
                      <div className="flex items-center gap-3">
                        <span className="tabular text-[13px] text-[#374151]">
                          {sealedInWave} of {allInWave.length} sealed
                        </span>
                        <span className="w-32 max-sm:hidden">
                          <Bar segments={[{ value: sealedInWave, color: "green" }]} max={allInWave.length} label={`${WAVE_LABEL[group.wave]} sealed`} />
                        </span>
                      </div>
                    </div>
                    {unsealed.map((trip) => (
                      <ProgressRow key={trip.id} row={rowOf.get(trip.id)!} />
                    ))}
                    {sealed.length > 0 ? (
                      view === "sealed" ? (
                        sealed.map((trip) => <ProgressRow key={trip.id} row={rowOf.get(trip.id)!} />)
                      ) : (
                        <details className="group border-b border-[#f0f0f0] bg-good-surface/60">
                          <summary className="flex cursor-pointer list-none items-center gap-3 px-3 py-2.5 [&::-webkit-details-marker]:hidden">
                            <span aria-hidden className="grid size-7 shrink-0 place-items-center rounded-full bg-good text-white">
                              <CheckIcon className="size-4" />
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block text-[15px] font-semibold text-[#111827]">{plural(sealed.length, "vehicle")} sealed</span>
                              <span className="block truncate text-[13px] text-muted">{sealed.map((t) => t.vehicleId).join(", ")}</span>
                            </span>
                            <span className="flex items-center gap-1 text-sm font-semibold text-link">
                              <span className="group-open:hidden">Show</span>
                              <span className="hidden group-open:inline">Hide</span>
                              <ChevronDownIcon className="size-4 group-open:rotate-180" />
                            </span>
                          </summary>
                          <div className="bg-surface">
                            {sealed.map((trip) => (
                              <ProgressRow key={trip.id} row={rowOf.get(trip.id)!} />
                            ))}
                          </div>
                        </details>
                      )
                    ) : null}
                  </section>
                );
              })}
            </div>
          )}
        </Panel>

        <aside className="flex flex-col gap-4">
          {shift ? <DockBays shift={shift} rows={rows} /> : null}
          <NeedsAttention rows={atRisk} />
          {shift ? <PaceChart shift={shift} expectedUnits={expectedUnits} trips={trips} isToday={date === today} /> : null}
        </aside>
      </div>
    </PageBody>
  );
}

/** "Short 4 × Wheat Flour", "12 min behind loading plan", "Chiller at 6 °C". */
function warningOf(row: Row): string | null {
  const lead = row.attention[0];
  if (!lead) return null;
  if (lead.kind === "shortage") {
    const line = row.trip.lines.find((l) => l.shortfall?.status === "OPEN");
    const sku = line?.shortfall?.productSku;
    const item = sku ? line?.items?.find((i) => i.sku === sku) : null;
    return item ? `Short ${lead.shortUnits} × ${shortName(item.name)} (${sku})` : `Short ${lead.shortUnits} units · waiting on dispatch`;
  }
  if (lead.kind === "behind") return `${lead.minutes} min behind loading plan`;
  if (lead.kind === "chiller") return row.trip.chiller ? `Chiller at ${chillerHeadline(row.trip.chiller)} · needs ${row.trip.chiller.targetMaxC} °C before loading` : "Chiller out of range";
  return attentionLabel(lead);
}

function ProgressRow({ row }: { row: Row }) {
  const { trip, attention } = row;
  const load = trip.load;
  const percent = unitsPercent(load);
  const risk = attention.length > 0 && !isLoaded(trip.status);
  const warning = risk ? warningOf(row) : null;
  const status = isLoaded(trip.status)
    ? { label: "Sealed", tone: "good" as const }
    : risk
      ? { label: "At risk", tone: "bad" as const }
      : trip.status === "LOADING"
        ? { label: "Loading", tone: "info" as const }
        : { label: "Pending", tone: "neutral" as const };
  return (
    <Link
      href={`/loader/trips/${encodeURIComponent(trip.id)}`}
      className={`grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 border-b border-[#f0f0f0] px-3 py-2.5 md:grid-cols-[minmax(0,1.3fr)_minmax(0,1.6fr)_7rem_4.5rem_2rem] ${
        risk ? "bg-[#fef8f8] hover:bg-bad-surface" : "hover:bg-[#fafafa]"
      }`}
    >
      <span className="min-w-0">
        <span className="flex flex-wrap items-center gap-1.5">
          <span className="font-bold text-[#111827]">{trip.vehicleId}</span>
          <Tag>Trip {trip.tripNo}</Tag>
          {trip.refrigerated ? <Tag>Refrigerated</Tag> : null}
        </span>
        <span className="block truncate text-[13px] text-muted">
          {trip.dockBay != null ? `Bay ${trip.dockBay} · ` : ""}
          {trip.districtName}
          {load ? ` · ${plural(load.stops, "stop")}` : ""}
        </span>
      </span>
      <span className="col-span-2 row-start-2 min-w-0 md:col-span-1 md:row-start-auto">
        {load ? (
          <>
            <span className="tabular block text-sm font-medium text-[#111827]">
              {load.loadedUnits} / {load.expectedUnits} units
            </span>
            <span className="mt-1 flex items-center gap-2.5">
              <span className="flex-1">
                <Bar
                  segments={[{ value: load.loadedUnits, color: isLoaded(trip.status) ? "green" : risk ? (attention[0]?.kind === "behind" ? "amber" : "flame") : "blue" }]}
                  max={load.expectedUnits}
                  label={`${trip.vehicleId} units loaded`}
                />
              </span>
              <span className="tabular w-9 text-right text-[12.5px] text-muted">{percent}%</span>
            </span>
            {warning ? (
              <span className="mt-1 flex items-center gap-1 text-[12.5px] font-medium text-bad-ink">
                <AlertIcon className="size-3.5" />
                {warning}
              </span>
            ) : null}
          </>
        ) : (
          <span className="text-sm text-muted">Load list unavailable</span>
        )}
      </span>
      <span className="justify-self-end md:justify-self-start">
        <DockStatus label={status.label} tone={status.tone} />
      </span>
      <span className="tabular hidden text-[15px] font-semibold text-[#111827] md:block">{trip.plannedDepartAt ?? "—"}</span>
      <span className="hidden text-[#111827] md:block">
        <ChevronRightIcon className="size-4" />
      </span>
    </Link>
  );
}

/** L-05's bay grid: what is at each bay, or that it is free and who is next. */
function DockBays({ shift, rows }: { shift: DockShift; rows: Row[] }) {
  const rowOf = new Map(rows.map((row) => [row.trip.id, row]));
  const inUse = shift.bays.filter((bay) => bay.current).length;
  return (
    <Panel className="p-4">
      <div className="flex items-baseline justify-between">
        <h2 className="text-[17px] font-bold text-[#111827]">Dock bays</h2>
        <p className="text-[13px] text-muted">
          {inUse} of {shift.dockBays} in use
        </p>
      </div>
      <ul className="mt-3 grid grid-cols-2 gap-2.5 sm:grid-cols-3">
        {shift.bays.map((bay) => {
          const current = bay.current;
          const row = current ? rowOf.get(current.tripId) : undefined;
          const lead = row?.attention[0];
          const tone = !current ? "free" : lead ? (lead.kind === "behind" ? "warn" : "bad") : "loading";
          const dot = tone === "free" ? "bg-good" : tone === "bad" ? "bg-bad" : tone === "warn" ? "bg-warn" : "bg-link";
          return (
            <li key={bay.bay} className={`rounded-[8px] border p-2.5 ${current ? "border-[#e5e7eb] bg-surface" : "border-dashed border-[#d1d5db] bg-[#fafafa]"}`}>
              <p className="flex items-center justify-between text-[13px] text-muted">
                Bay {bay.bay}
                <span aria-hidden className={`size-2 rounded-full ${dot}`} />
              </p>
              {current ? (
                <Link href={`/loader/trips/${encodeURIComponent(current.tripId)}`} className="block">
                  <p className="mt-0.5 font-bold text-[#111827]">{current.vehicleId}</p>
                  <span className="mt-1.5 block">
                    <Bar
                      segments={[{ value: current.loadedUnits, color: tone === "bad" ? "flame" : tone === "warn" ? "amber" : "blue" }]}
                      max={current.expectedUnits}
                      label={`Bay ${bay.bay} progress`}
                      height="h-1"
                    />
                  </span>
                  <p className={`mt-1.5 text-[12px] ${tone === "bad" ? "font-medium text-bad-ink" : tone === "warn" ? "font-medium text-warn-ink" : "text-muted"}`}>
                    {lead ? warningOf(row!) : `${current.loadedUnits} / ${current.expectedUnits}${row ? ` · ${row.trip.districtName}` : ""}`}
                  </p>
                </Link>
              ) : (
                <>
                  <p className="mt-0.5 font-bold text-good">Free</p>
                  <p className="mt-1.5 text-[12px] text-muted">{bay.next ? `Next: ${bay.next.vehicleId}${bay.next.plannedDepartAt ? ` · ${bay.next.plannedDepartAt}` : ""}` : "Nothing due"}</p>
                </>
              )}
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}

function NeedsAttention({ rows }: { rows: Row[] }) {
  return (
    <Panel className="p-4">
      <h2 className="flex items-center gap-2 text-[17px] font-bold text-[#111827]">
        Needs attention
        {rows.length > 0 ? <span className="tabular grid size-5 place-items-center rounded-full bg-bad text-[11px] font-bold text-white">{rows.length}</span> : null}
      </h2>
      {rows.length === 0 ? (
        <p className="mt-2 text-sm text-muted">No open vehicle is short, behind its loading plan or reading warm.</p>
      ) : (
        <ul className="mt-3 flex flex-col divide-y divide-[#f0f0f0]">
          {rows.map((row) => {
            const lead = row.attention[0]!;
            const tripHref = `/loader/trips/${encodeURIComponent(row.trip.id)}`;
            const item: { icon: ReactNode; tone: string; title: string; detail: string; action: string; href: string } =
              lead.kind === "shortage"
                ? {
                    icon: <BoxMinusIcon className="size-4.5" />,
                    tone: "bg-bad-surface text-bad",
                    title: `${row.trip.vehicleId} · ${warningOf(row)}`,
                    detail: "Reported to the dispatcher, who decides in Exceptions. The vehicle is held until then.",
                    action: "Open list",
                    href: tripHref,
                  }
                : lead.kind === "behind"
                  ? {
                      icon: <ClockIcon className="size-4.5" />,
                      tone: "bg-warn-surface text-warn",
                      title: `${row.trip.vehicleId} · ${lead.minutes} min behind plan`,
                      detail: `${row.trip.load?.loadedUnits ?? 0} of ${row.trip.load?.expectedUnits ?? 0} units loaded${row.trip.dockBay != null ? ` at Bay ${row.trip.dockBay}` : ""}. Put another loader on it.`,
                      action: "Open list",
                      href: tripHref,
                    }
                  : lead.kind === "chiller"
                    ? {
                        icon: <SnowflakeIcon className="size-4.5" />,
                        tone: "bg-info-surface text-link",
                        title: `${row.trip.vehicleId} · Chiller ${row.trip.chiller ? chillerHeadline(row.trip.chiller) : "out of range"}`,
                        detail: row.trip.chiller
                          ? `Refrigerated load can start once the chiller reaches ${row.trip.chiller.targetMaxC} °C.`
                          : "Record a new gauge reading.",
                        action: "Recheck",
                        href: `${tripHref}?report=chiller`,
                      }
                    : {
                        icon: <ClockIcon className="size-4.5" />,
                        tone: "bg-warn-surface text-warn",
                        title: `${row.trip.vehicleId} · ${attentionLabel(lead)}`,
                        detail: lead.kind === "departing-soon" ? `${plural(lead.unchecked, "order")} still to check.` : "The planned departure has passed and it is not sealed.",
                        action: "Open list",
                        href: tripHref,
                      };
            return (
              <li key={row.trip.id} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
                <span aria-hidden className={`grid size-9 shrink-0 place-items-center rounded-full ${item.tone}`}>
                  {item.icon}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-[#111827]">{item.title}</p>
                  <p className="text-[13px] text-muted">{item.detail}</p>
                </div>
                <Link href={item.href} className="shrink-0 rounded-[6px] border border-[#e5e7eb] px-3 py-2 text-[13px] font-medium text-[#111827] hover:bg-raised">
                  {item.action}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

/**
 * Units loaded per 15 minutes, from the checks the dock recorded. The target
 * is the pace that loads the day's units between the first loading window
 * opening and the last departure.
 */
function PaceChart({ shift, expectedUnits, trips, isToday }: { shift: DockShift; expectedUnits: number; trips: DockTrip[]; isToday: boolean }) {
  const buckets = shift.unitsPerQuarterHour.slice(-8);
  const departs = trips.map((t) => t.plannedDepartAt).filter((d): d is string => !!d).map((d) => Number(d.slice(0, 2)) * 60 + Number(d.slice(3, 5)));
  const window = departs.length > 0 ? Math.max(...departs) - (Math.min(...departs) - shift.loadTargetMinutes) : 0;
  const target = window > 0 ? Math.round(expectedUnits / (window / 15)) : null;
  const top = Math.max(10, target ?? 0, ...buckets.map((b) => b.units));
  const scale = Math.ceil(top / 10) * 10;
  const W = 380;
  const H = 150;
  const pad = { left: 28, bottom: 20, top: 16 };
  const plotH = H - pad.bottom - pad.top;
  const step = buckets.length > 0 ? (W - pad.left) / buckets.length : 0;
  const y = (v: number) => pad.top + plotH - (v / scale) * plotH;

  return (
    <Panel className="p-4">
      <div className="flex items-baseline justify-between">
        <h2 className="text-[17px] font-bold text-[#111827]">Units loaded per 15 min</h2>
        {target != null ? (
          <p className="flex items-center gap-1.5 text-[13px] text-muted">
            <span aria-hidden className="h-0.5 w-5 bg-warn" />
            Target {target}
          </p>
        ) : null}
      </div>
      {buckets.length === 0 ? (
        <p className="mt-2 text-sm text-muted">Nothing has been checked onto a vehicle this day yet.</p>
      ) : (
        <svg viewBox={`0 0 ${W} ${H}`} className="mt-3 w-full" role="img" aria-label={`Units loaded per 15 minutes: ${buckets.map((b) => `${b.start} ${b.units}`).join(", ")}`}>
          {[0, scale / 2, scale].map((tick) => (
            <g key={tick}>
              <text x={0} y={y(tick) + 4} className="fill-[#9ca3af] text-[10px]">
                {tick}
              </text>
              <line x1={pad.left} x2={W} y1={y(tick)} y2={y(tick)} stroke="#f0f0f0" />
            </g>
          ))}
          {buckets.map((bucket, i) => {
            const x = pad.left + i * step + step * 0.18;
            const w = step * 0.64;
            const last = isToday && i === buckets.length - 1;
            return (
              <g key={bucket.start}>
                <rect x={x} y={y(bucket.units)} width={w} height={Math.max(0, pad.top + plotH - y(bucket.units))} rx={2} className={last ? "fill-[#bfdbfe]" : "fill-link"} />
                {bucket.units > 0 ? (
                  <text x={x + w / 2} y={y(bucket.units) - 4} textAnchor="middle" className="fill-[#111827] text-[10px]">
                    {bucket.units}
                  </text>
                ) : null}
                <text x={x + w / 2} y={H - 4} textAnchor="middle" className="fill-[#6b7280] text-[10px]">
                  {bucket.start}
                  {last ? " (now)" : ""}
                </text>
              </g>
            );
          })}
          {target != null ? <line x1={pad.left} x2={W} y1={y(target)} y2={y(target)} className="stroke-warn" strokeWidth={1.5} /> : null}
        </svg>
      )}
    </Panel>
  );
}
