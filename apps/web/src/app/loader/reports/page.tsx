import Link from "next/link";
import { ButtonLink } from "@/components/ui/button";
import { PageBody, PageHeader } from "@/components/ui/page-header";
import { EmptyState, ErrorPanel } from "@/components/ui/states";
import type { Tone } from "@/components/ui/status-pill";
import { requireRole, scopeLabel } from "@/lib/auth";
import { dateParam, todayInColombo } from "@/lib/dates";
import { readFailure } from "@/lib/failures";
import { plural } from "@/lib/format";
import { loadDock, loadShift, type DockShift } from "../dock-data.server";
import { attentionFor, colomboMinutes, isLoaded, type DockClock, type DockTrip } from "../dock-model";
import { DockHeader } from "../dock-header";
import { DockStatus, KpiCard, Panel } from "../dock-ui";
import { AlertIcon, BoxMinusIcon, CheckIcon, ClockIcon, DownloadIcon, LockIcon, ThermometerIcon, TimerIcon } from "../icons";
import { CONDITION_LABEL } from "../reasons";
import { buildReport } from "../reports-model";
import { shortName } from "../load-items";
import { HandoverNote } from "./handover-note";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
type Tab = "shift" | "nights" | "vehicle" | "bay";

const TABS: { value: Tab; label: string }[] = [
  { value: "shift", label: "Tonight’s shift" },
  { value: "nights", label: "Last 7 nights" },
  { value: "vehicle", label: "By vehicle" },
  { value: "bay", label: "By bay" },
];

type ShiftTrip = DockShift["trips"][number];

/** "04:12" on the Colombo clock, from an instant. */
function clockOf(iso: string | null | undefined): string | null {
  if (!iso) return null;
  return new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Colombo", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso));
}

function minutesOf(clock: string): number {
  return Number(clock.slice(0, 2)) * 60 + Number(clock.slice(3, 5));
}

/** Minutes into the planning day (Colombo) of an instant. */
function dayMinutes(date: string, iso: string): number {
  return (Date.parse(iso) - Date.parse(`${date}T00:00:00Z`)) / 60000 + 330;
}

/** The latest thing the dock recorded on a trip on its own planning day: a
 *  check or a count. A record made on another day (a correction days later)
 *  says nothing about how long that night's load took, so it is left out. */
function lastActivity(trip: DockTrip, date: string): string | null {
  const stamps = trip.lines
    .flatMap((line) => [line.checkedAt, line.progress?.updatedAt])
    .filter((s): s is string => !!s && dayMinutes(date, s) >= 0 && dayMinutes(date, s) < 1440);
  return stamps.sort().at(-1) ?? null;
}

/**
 * L-06: how the dock did — tonight's shift, the last seven nights, by vehicle
 * and by bay. Every time here is one the dock recorded: when loading started
 * (first check or count), when it was sealed (marked ready). Nothing is
 * estimated, so a vehicle that was never checked shows dashes, not a guess.
 */
export default async function LoaderReportsPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const user = await requireRole("LOADER", "/loader/reports");
  const date = dateParam(params.date);
  const rawTab = Array.isArray(params.tab) ? params.tab[0] : params.tab;
  const tab: Tab = TABS.some((t) => t.value === rawTab) ? (rawTab as Tab) : "shift";
  const today = todayInColombo();
  const [day, shift] = await Promise.all([loadDock(date), loadShift(date)]);
  const subtitle = `${scopeLabel(user)} · loading performance for ${date === today ? "tonight’s shift" : "the shift on this day"}.`;

  if (!day.ok) {
    const failure = readFailure(day.status, "the day's loading figures");
    return (
      <PageBody>
        <PageHeader title="Reports" subtitle={subtitle} />
        <ErrorPanel title={failure.title} detail={failure.detail} outcome="read" action={<ButtonLink href={`/loader/reports?date=${date}`}>Reload</ButtonLink>} />
      </PageBody>
    );
  }

  const download = (
    <a
      href={`/loader/reports/export?date=${date}`}
      className="inline-flex h-13 items-center gap-2.5 rounded-control bg-action px-5 text-[15px] font-semibold text-[#111] hover:brightness-95"
    >
      <DownloadIcon className="size-4.5" />
      Download shift report
    </a>
  );
  const header = <DockHeader title="Reports" subtitle={subtitle} date={date} path="/loader/reports" keep={{ tab: tab === "shift" ? undefined : tab }} behindMinutes={null} isToday={date === today} action={download} />;
  const tabs = (
    <nav aria-label="Report" className="-mt-1 flex flex-wrap gap-1 border-b border-[#e5e7eb]">
      {TABS.map((t) => (
        <Link
          key={t.value}
          href={`/loader/reports?date=${date}${t.value === "shift" ? "" : `&tab=${t.value}`}`}
          aria-current={tab === t.value ? "page" : undefined}
          className={`flex min-h-11 items-center rounded-t-[6px] border-b-[3px] px-3 text-[15px] ${
            tab === t.value ? "border-action bg-[#fff8e6] font-semibold text-[#111827]" : "border-transparent text-[#374151] hover:bg-raised"
          }`}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );

  const trips = day.trips;
  if (trips.length === 0) {
    return (
      <PageBody>
        {header}
        {tabs}
        <EmptyState title="No trips published for this day" detail="There is nothing to report until the dispatcher publishes a plan. Pick another date." />
      </PageBody>
    );
  }

  const report = buildReport(trips);
  const timing = new Map((shift?.trips ?? []).map((t) => [t.tripId, t]));
  const sealed = trips.filter((t) => isLoaded(t.status));
  const sealedTimed = (shift?.trips ?? []).filter((t) => t.sealedAt);
  const onTime = sealedTimed.filter((t) => t.sealedOnTime).length;
  const late = sealedTimed.filter((t) => t.sealedOnTime === false).sort((a, b) => (b.lateMinutes ?? 0) - (a.lateMinutes ?? 0));
  const target = shift?.loadTargetMinutes ?? 45;
  const avg = shift?.averageLoadMinutes ?? null;
  const clock: DockClock = { date, today, minutesNow: colomboMinutes() };
  const flags = trips.flatMap((trip) => {
    const t = timing.get(trip.id);
    return attentionFor(trip, clock, t?.minutesBehind ?? null).map((a) => ({ trip, attention: a }));
  });
  const flagKinds = [...new Set(flags.map((f) => (f.attention.kind === "shortage" ? "Shortage" : f.attention.kind === "chiller" ? "chiller" : "behind plan")))];
  const starts = (shift?.trips ?? []).map((t) => t.loadStartedAt).filter((s): s is string => !!s).sort();
  const departs = trips.map((t) => t.plannedDepartAt).filter((d): d is string => !!d).sort();
  const shiftLine = starts[0] && departs.length ? `Shift runs ${clockOf(starts[0])} – ${departs.at(-1)}` : departs.length ? `Departures ${departs[0]} – ${departs.at(-1)}` : "";

  return (
    <PageBody>
      {header}
      {tabs}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard icon={<LockIcon className="size-5" />} iconTone="good" value={`${sealed.length} / ${trips.length}`} label="Vehicles sealed" foot={shiftLine} />
        <KpiCard
          icon={<CheckIcon className="size-5" />}
          value={`${onTime} of ${sealedTimed.length}`}
          label="Sealed on time"
          foot={late[0] ? `${late[0].vehicleId} sealed ${late[0].lateMinutes} min late` : sealedTimed.length === 0 ? "Nothing sealed with a time yet." : "Every seal before its slot."}
          footTone={late.length > 0 ? "warn" : "good"}
        />
        <KpiCard
          icon={<TimerIcon className="size-5" />}
          iconTone="violet"
          value={avg != null ? `${avg} min` : "—"}
          label="Avg. load time"
          foot={`Target ${target} min per vehicle`}
          footTone={avg != null && avg > target ? "warn" : "neutral"}
        />
        <KpiCard
          icon={<AlertIcon className="size-5" />}
          iconTone="bad"
          value={flags.length}
          label="Open flags"
          foot={flags.length > 0 ? flagKinds.join(" · ") : "Nothing open."}
          footTone={flags.length > 0 ? "bad" : "neutral"}
        />
      </div>

      {tab === "shift" ? (
        <>
          <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
            <BayTimeline date={date} trips={trips} shift={shift} isToday={date === today} />
            <NightsChart history={shift?.history ?? []} date={date} isToday={date === today} />
          </div>
          <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
            <VehicleLog date={date} trips={trips} timing={timing} target={target} limit={8} />
            <div className="flex flex-col gap-4">
              <OpenFlags flags={flags} report={report} />
              <HandoverNote date={date} note={shift?.handover ?? null} authorName={user.name} />
            </div>
          </div>
        </>
      ) : tab === "nights" ? (
        <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <NightsChart history={shift?.history ?? []} date={date} isToday={date === today} />
          <NightsTable history={shift?.history ?? []} />
        </div>
      ) : tab === "vehicle" ? (
        <VehicleLog date={date} trips={trips} timing={timing} target={target} />
      ) : (
        <BaySummary trips={trips} timing={timing} bays={shift?.dockBays ?? 6} />
      )}
    </PageBody>
  );
}

const BAR = {
  ontime: "bg-good text-white",
  late: "bg-[#f59e0b] text-white",
  loading: "bg-link text-white",
  waiting: "border border-dashed border-[#9ca3af] bg-transparent text-muted",
} as const;

/** L-06's bay timeline: each bay a row, each vehicle a bar from first box to
 *  seal, coloured by whether it sealed on time. */
function BayTimeline({ date, trips, shift, isToday }: { date: string; trips: DockTrip[]; shift: DockShift | null; isToday: boolean }) {
  const timing = new Map((shift?.trips ?? []).map((t) => [t.tripId, t]));
  const bays = shift?.dockBays ?? 6;
  type Seg = { trip: DockTrip; from: number; to: number; kind: keyof typeof BAR; note?: string };
  const segs: Seg[] = [];
  const nowMin = isToday && shift?.nowClock ? minutesOf(shift.nowClock) : null;
  for (const trip of trips) {
    const t = timing.get(trip.id);
    if (trip.dockBay == null || !t) continue;
    const depart = trip.plannedDepartAt ? minutesOf(trip.plannedDepartAt) : null;
    if (t.loadStartedAt) {
      const from = dayMinutes(date, t.loadStartedAt);
      const endIso = t.sealedAt ?? (nowMin == null ? lastActivity(trip, date) : null);
      const to = endIso ? dayMinutes(date, endIso) : (nowMin ?? from + 10);
      const risk = !t.sealedAt && (t.minutesBehind ?? 0) > 0;
      segs.push({ trip, from, to: Math.max(to, from + 6), kind: t.sealedAt ? (t.sealedOnTime ? "ontime" : "late") : risk || trip.blocked ? "late" : "loading" });
    } else if (depart != null && !isLoaded(trip.status)) {
      segs.push({ trip, from: depart - target(shift), to: depart, kind: "waiting" });
    }
  }
  if (segs.length === 0) {
    return (
      <Panel className="p-4">
        <h2 className="text-[17px] font-bold text-[#111827]">Bay timeline</h2>
        <p className="mt-2 text-sm text-muted">No vehicle has a bay or a recorded load yet.</p>
      </Panel>
    );
  }
  const lo = Math.floor((Math.min(...segs.map((s) => s.from), nowMin ?? Infinity) - 30) / 60) * 60;
  const hi = Math.ceil((Math.max(...segs.map((s) => s.to), nowMin ?? -Infinity) + 30) / 60) * 60;
  const span = Math.max(60, hi - lo);
  const pct = (m: number) => `${((m - lo) / span) * 100}%`;
  const hours = Array.from({ length: span / 60 + 1 }, (_, i) => lo + i * 60);
  const label = (m: number) => `${String(Math.floor((((m % 1440) + 1440) % 1440) / 60)).padStart(2, "0")}:00`;

  return (
    <Panel className="p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-[17px] font-bold text-[#111827]">Bay timeline {isToday ? "· tonight" : ""}</h2>
          <p className="text-[13px] text-muted">When each vehicle was loaded, by dock bay</p>
        </div>
        <ul className="flex flex-wrap gap-3 text-[12.5px] text-[#374151]">
          <li className="flex items-center gap-1.5"><span aria-hidden className="size-2.5 rounded-[2px] bg-good" />Sealed on time</li>
          <li className="flex items-center gap-1.5"><span aria-hidden className="size-2.5 rounded-[2px] bg-[#f59e0b]" />Late / at risk</li>
          <li className="flex items-center gap-1.5"><span aria-hidden className="size-2.5 rounded-[2px] bg-link" />Loading now</li>
          <li className="flex items-center gap-1.5"><span aria-hidden className="size-2.5 rounded-[2px] border border-dashed border-[#9ca3af]" />Waiting</li>
        </ul>
      </div>
      <div className="mt-4 overflow-x-auto">
        <div className="relative min-w-[560px] pl-14">
          {Array.from({ length: bays }, (_, i) => i + 1).map((bay) => {
            const here = segs.filter((s) => s.trip.dockBay === bay);
            return (
              <div key={bay} className="relative flex h-8.5 items-center border-b border-[#f3f4f6]">
                <span className="absolute -left-14 w-12 text-[13px] text-[#374151]">Bay {bay}</span>
                {hours.map((h) => (
                  <span key={h} aria-hidden className="absolute top-0 h-full w-px bg-[#f3f4f6]" style={{ left: pct(h) }} />
                ))}
                {here.length === 0 ? <span className="relative ml-2 text-[11px] text-[#9ca3af]">Free</span> : null}
                {here.map((s) => (
                  <Link
                    key={s.trip.id}
                    href={`/loader/trips/${encodeURIComponent(s.trip.id)}`}
                    title={`${s.trip.vehicleId} · ${s.kind === "waiting" ? `due ${s.trip.plannedDepartAt}` : s.kind === "ontime" ? "sealed on time" : s.kind === "late" ? "late or at risk" : "loading"}`}
                    className={`absolute flex h-5.5 items-center overflow-hidden rounded-[3px] px-1.5 text-[11px] font-semibold ${BAR[s.kind]}`}
                    style={{ left: pct(s.from), width: `${((s.to - s.from) / span) * 100}%` }}
                  >
                    <span className="truncate">{s.trip.vehicleId}</span>
                  </Link>
                ))}
              </div>
            );
          })}
          {nowMin != null ? (
            <div aria-hidden className="absolute bottom-0 top-0 w-0.5 bg-bad" style={{ left: `calc(3.5rem + (100% - 3.5rem) * ${(nowMin - lo) / span})` }}>
              <span className="absolute -top-5 -translate-x-1/2 rounded-full bg-bad px-1.5 text-[10px] font-semibold text-white">{shift?.nowClock}</span>
            </div>
          ) : null}
          <div className="relative mt-1 h-5">
            {hours.map((h) => (
              <span key={h} className="absolute -translate-x-1/2 text-[11px] text-[#6b7280]" style={{ left: pct(h) }}>
                {label(h)}
              </span>
            ))}
          </div>
        </div>
      </div>
    </Panel>
  );
}

function target(shift: DockShift | null): number {
  return shift?.loadTargetMinutes ?? 45;
}

function NightsChart({ history, date, isToday }: { history: DockShift["history"]; date: string; isToday: boolean }) {
  const nights = history.slice(-7);
  return (
    <Panel className="p-4">
      <h2 className="text-[17px] font-bold text-[#111827]">Sealed on time · last 7 nights</h2>
      <p className="text-[13px] text-muted">Share of vehicles sealed before their slot</p>
      {nights.length === 0 ? (
        <p className="mt-3 text-sm text-muted">No published nights to compare yet.</p>
      ) : (
        <>
          <ol className="mt-4 flex h-44 items-end gap-3 border-b border-[#e5e7eb] pb-0" aria-label="Sealed on time, by night">
            {nights.map((night) => {
              const share = night.sealed > 0 ? Math.round((night.sealedOnTime / night.sealed) * 100) : null;
              const tonight = night.date === date && isToday;
              const colour = share == null ? "bg-[#e5e7eb]" : tonight ? "bg-[#fcd34d]" : share >= 90 ? "bg-good" : "bg-[#f59e0b]";
              const weekday = new Intl.DateTimeFormat("en-GB", { weekday: "short", timeZone: "UTC" }).format(new Date(`${night.date}T00:00:00Z`));
              return (
                <li key={night.date} className="flex h-full flex-1 flex-col items-center justify-end gap-1">
                  <span className="tabular text-[11.5px] font-semibold text-[#111827]">{share == null ? "—" : `${share}%`}</span>
                  <span className={`w-full max-w-10 rounded-t-[3px] ${colour}`} style={{ height: `${Math.max(4, share ?? 4)}%` }} />
                  <span className={`text-[12px] ${night.date === date ? "font-bold text-[#111827]" : "text-muted"}`}>
                    {weekday}
                    {tonight ? "*" : ""}
                  </span>
                </li>
              );
            })}
          </ol>
          <p className="mt-2 text-[12px] text-muted">
            {nights.length < 7 ? `${plural(nights.length, "published night")} so far. ` : ""}
            {isToday ? "* Tonight so far." : ""}
          </p>
        </>
      )}
    </Panel>
  );
}

function NightsTable({ history }: { history: DockShift["history"] }) {
  return (
    <Panel className="overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-[#f9fafb] text-left text-[12.5px] text-[#374151]">
          <tr>
            <th className="px-4 py-2 font-medium">Night</th>
            <th className="px-2 py-2 text-right font-medium">Vehicles</th>
            <th className="px-2 py-2 text-right font-medium">Sealed</th>
            <th className="px-4 py-2 text-right font-medium">On time</th>
          </tr>
        </thead>
        <tbody>
          {[...history].reverse().map((night) => (
            <tr key={night.date} className="border-t border-[#f0f0f0]">
              <td className="px-4 py-2.5 text-[#111827]">
                <Link href={`/loader/reports?date=${night.date}`} className="hover:underline">
                  {new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${night.date}T00:00:00Z`))}
                </Link>
              </td>
              <td className="tabular px-2 py-2.5 text-right">{night.vehicles}</td>
              <td className="tabular px-2 py-2.5 text-right">{night.sealed}</td>
              <td className="tabular px-4 py-2.5 text-right">{night.sealed > 0 ? `${night.sealedOnTime} (${Math.round((night.sealedOnTime / night.sealed) * 100)}%)` : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Panel>
  );
}

function resultOf(trip: DockTrip, t: ShiftTrip | undefined): { label: string; tone: Tone } {
  if (t?.sealedAt) return t.sealedOnTime ? { label: "On time", tone: "good" } : { label: `Late ${t.lateMinutes ?? 0} min`, tone: "warn" };
  if (isLoaded(trip.status)) return { label: "Released · no times", tone: "neutral" };
  if (trip.status === "LOADING") {
    const pct = t && t.expectedUnits > 0 ? Math.round((t.loadedUnits / t.expectedUnits) * 100) : 0;
    return { label: `Loading · ${pct}%`, tone: "info" };
  }
  return { label: "Not started", tone: "neutral" };
}

function VehicleLog({ date, trips, timing, target, limit }: { date: string; trips: DockTrip[]; timing: Map<string, ShiftTrip>; target: number; limit?: number }) {
  const ordered = [...trips].sort((a, b) => {
    const as = timing.get(a.id)?.loadStartedAt ?? "9";
    const bs = timing.get(b.id)?.loadStartedAt ?? "9";
    return as.localeCompare(bs) || (a.plannedDepartAt ?? "").localeCompare(b.plannedDepartAt ?? "");
  });
  const shown = limit ? ordered.slice(0, limit) : ordered;
  return (
    <Panel className="p-4">
      <div className="flex items-baseline justify-between">
        <h2 className="text-[17px] font-bold text-[#111827]">Vehicle log</h2>
        <p className="text-[13px] text-muted">
          {shown.length} of {plural(trips.length, "vehicle")}
          {limit && trips.length > limit ? (
            <>
              {" · "}
              <Link href="?tab=vehicle" className="font-semibold text-link">
                See all
              </Link>
            </>
          ) : null}
        </p>
      </div>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[600px] text-sm">
          <thead className="bg-[#f9fafb] text-left text-[12.5px] text-[#374151]">
            <tr>
              <th className="rounded-l-[6px] px-3 py-2 font-medium">Vehicle</th>
              <th className="px-2 py-2 font-medium">Bay</th>
              <th className="px-2 py-2 font-medium">Started</th>
              <th className="px-2 py-2 font-medium">Sealed</th>
              <th className="px-2 py-2 font-medium">Duration</th>
              <th className="px-2 py-2 font-medium">Units</th>
              <th className="rounded-r-[6px] px-2 py-2 font-medium">Result</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((trip) => {
              const t = timing.get(trip.id);
              const last = lastActivity(trip, date);
              const minutes = t?.loadMinutes ?? (t?.loadStartedAt && !t.sealedAt && last ? Math.max(0, Math.round((Date.parse(last) - Date.parse(t.loadStartedAt)) / 60000)) : null);
              const result = resultOf(trip, t);
              return (
                <tr key={trip.id} className="border-b border-[#f0f0f0] last:border-b-0">
                  <td className="px-3 py-3 font-bold text-[#111827]">
                    <Link href={`/loader/trips/${encodeURIComponent(trip.id)}`} className="hover:underline">
                      {trip.vehicleId}
                    </Link>{" "}
                    <span className="font-normal text-muted">T{trip.tripNo}</span>
                  </td>
                  <td className="px-2 py-3 text-[#374151]">{trip.dockBay != null ? `Bay ${trip.dockBay}` : "—"}</td>
                  <td className="tabular px-2 py-3 text-[#374151]">{clockOf(t?.loadStartedAt) ?? "—"}</td>
                  <td className="tabular px-2 py-3 text-[#374151]">{clockOf(t?.sealedAt) ?? "—"}</td>
                  <td className={`tabular px-2 py-3 ${minutes != null && minutes > target ? "font-semibold text-[#f59e0b]" : "text-[#374151]"}`}>
                    {minutes != null ? `${minutes} min` : "—"}
                  </td>
                  <td className="tabular px-2 py-3 text-[#374151]">
                    {t ? `${t.loadedUnits} / ${t.expectedUnits}` : trip.load ? `${trip.load.loadedUnits} / ${trip.load.expectedUnits}` : "—"}
                  </td>
                  <td className="px-2 py-3">
                    <DockStatus label={result.label} tone={result.tone} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

function OpenFlags({ flags, report }: { flags: { trip: DockTrip; attention: ReturnType<typeof attentionFor>[number] }[]; report: ReturnType<typeof buildReport> }) {
  return (
    <Panel className="p-4">
      <h2 className="flex items-center gap-2 text-[17px] font-bold text-[#111827]">
        Open flags
        {flags.length > 0 ? <span className="tabular grid size-5 place-items-center rounded-full bg-bad text-[11px] font-bold text-white">{flags.length}</span> : null}
      </h2>
      {flags.length === 0 ? (
        <p className="mt-2 text-sm text-muted">Nothing is open on this day.</p>
      ) : (
        <ul className="mt-3 flex flex-col divide-y divide-[#f0f0f0]">
          {flags.map(({ trip, attention }) => {
            const row = report.shortages.find((s) => s.tripId === trip.id && s.state === "waiting");
            const line = trip.lines.find((l) => l.shortfall?.status === "OPEN");
            const item = line?.shortfall?.productSku ? line.items?.find((i) => i.sku === line.shortfall?.productSku) : null;
            const view =
              attention.kind === "shortage"
                ? {
                    icon: <BoxMinusIcon className="size-4" />,
                    tone: "bg-bad-surface text-bad",
                    title: `${trip.vehicleId} · ${row ? CONDITION_LABEL[row.condition] : "Short"} ${attention.shortUnits}${item ? ` × ${shortName(item.name)}` : " units"}`,
                    detail: `Sent to dispatch${row ? ` · ${row.orderRef}` : ""} · awaiting decision`,
                  }
                : attention.kind === "chiller"
                  ? { icon: <ThermometerIcon className="size-4" />, tone: "bg-info-surface text-link", title: `${trip.vehicleId} · Chiller at ${attention.tempC} °C`, detail: "Recheck the gauge before loading" }
                  : {
                      icon: <ClockIcon className="size-4" />,
                      tone: "bg-warn-surface text-warn",
                      title: `${trip.vehicleId} · ${attention.kind === "behind" ? `${attention.minutes} min behind plan` : attention.kind === "overdue" ? "Past departure time" : `Departs in ${attention.minutes} min`}`,
                      detail: trip.dockBay != null ? `At Bay ${trip.dockBay}` : "At the dock",
                    };
            return (
              <li key={`${trip.id}:${attention.kind}`} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
                <span aria-hidden className={`grid size-8 shrink-0 place-items-center rounded-[8px] ${view.tone}`}>
                  {view.icon}
                </span>
                <div className="min-w-0">
                  <p className="font-semibold text-[#111827]">{view.title}</p>
                  <p className="text-[13px] text-muted">{view.detail}</p>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

function BaySummary({ trips, timing, bays }: { trips: DockTrip[]; timing: Map<string, ShiftTrip>; bays: number }) {
  return (
    <Panel className="overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-[#f9fafb] text-left text-[12.5px] text-[#374151]">
          <tr>
            <th className="px-4 py-2 font-medium">Bay</th>
            <th className="px-2 py-2 font-medium">Vehicles</th>
            <th className="px-2 py-2 text-right font-medium">Sealed</th>
            <th className="px-2 py-2 text-right font-medium">On time</th>
            <th className="px-4 py-2 text-right font-medium">Avg. load</th>
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: bays }, (_, i) => i + 1).map((bay) => {
            const here = trips.filter((t) => t.dockBay === bay);
            const times = here.map((t) => timing.get(t.id)).filter((t): t is ShiftTrip => !!t);
            const sealedHere = times.filter((t) => t.sealedAt);
            const loads = times.map((t) => t.loadMinutes).filter((m): m is number => m != null);
            return (
              <tr key={bay} className="border-t border-[#f0f0f0]">
                <td className="px-4 py-2.5 font-semibold text-[#111827]">Bay {bay}</td>
                <td className="px-2 py-2.5 text-[#374151]">{here.length === 0 ? "—" : here.map((t) => t.vehicleId).join(", ")}</td>
                <td className="tabular px-2 py-2.5 text-right">{sealedHere.length}</td>
                <td className="tabular px-2 py-2.5 text-right">{sealedHere.filter((t) => t.sealedOnTime).length}</td>
                <td className="tabular px-4 py-2.5 text-right">{loads.length > 0 ? `${Math.round(loads.reduce((a, b) => a + b, 0) / loads.length)} min` : "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Panel>
  );
}
