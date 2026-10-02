import Link from "next/link";
import { api } from "@/lib/api";
import { readError } from "./api-errors";
import { colomboToday, formatPlannedTime, formatVolume, formatWeight } from "./format";
import { HeaderClock } from "./header-clock";
import {
  TRIP_STATUS_LABEL,
  WAVE_LABEL,
  WAVE_WINDOW,
  groupByWave,
  type Trip,
  type TripStatus,
} from "./wave";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const STATUS_FILTERS: { value: "" | TripStatus; label: string }[] = [
  { value: "", label: "All open" },
  { value: "PLANNED", label: "Pending" },
  { value: "LOADING", label: "Loading" },
  { value: "READY", label: "Ready" },
  { value: "DEPARTED", label: "Departed" },
];

export default async function LoaderDockBoard({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const dateParam = typeof params.date === "string" ? params.date : "";
  const date = /^\d{4}-\d{2}-\d{2}$/.test(dateParam) ? dateParam : colomboToday();
  const statusParam = typeof params.status === "string" ? params.status : "";
  const status = STATUS_FILTERS.find((filter) => filter.value === statusParam)?.value ?? "";

  const client = await api();
  const result = await client.GET("/trips", {
    params: {
      query: {
        date,
        ...(status ? { status: status as TripStatus } : {}),
      },
    },
  });

  if (result.error || !result.data) {
    const error = readError(result.response.status, "trips");
    return <BoardError date={date} title={error.title} detail={error.detail} expired={error.expired} />;
  }

  const trips = result.data;
  const groups = groupByWave(trips);
  const total = trips.length;
  const loadingTrips = trips.filter((trip) => trip.status === "LOADING");
  const loadedCount = trips.filter((trip) => trip.status === "READY" || trip.status === "DEPARTED").length;
  const pendingCount = trips.filter((trip) => trip.status === "PLANNED").length;
  const loadedPct = total > 0 ? Math.round((loadedCount / total) * 100) : 0;

  return (
    <main className="min-w-0 flex-1 p-4 sm:p-6 lg:p-8">
      <header className="flex flex-col gap-4 border-b border-line pb-5 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-ink sm:text-3xl">Peliyagoda dock</h1>
          <p className="mt-2 max-w-xl text-sm text-muted">
            Load each vehicle in the order shown. The last stop goes in first.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <form method="get" className="flex items-center gap-2">
            <label htmlFor="date" className="sr-only">Dock date</label>
            <input
              id="date"
              name="date"
              type="date"
              defaultValue={date}
              className="min-h-10 rounded-[var(--radius-control)] border border-line bg-surface px-3 text-sm text-ink"
            />
            {status && <input type="hidden" name="status" value={status} />}
            <button
              type="submit"
              className="min-h-10 rounded-[var(--radius-control)] bg-[color:var(--c-navy)] px-3 text-sm font-semibold text-white hover:brightness-110"
            >
              Reload
            </button>
          </form>
          <HeaderClock />
        </div>
      </header>

      <section aria-label="Dock summary" className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryCard
          icon="truck"
          label="Vehicles today"
          value={total}
          detail={total === 0 ? "No trips scheduled." : `${loadedCount} loaded · ${total} total`}
          progress={total > 0 ? loadedPct : undefined}
        />
        <SummaryCard
          icon="check"
          label="Loaded"
          value={loadedCount}
          detail={total === 0 ? "Nothing released yet." : `${loadedPct}% complete`}
          accent="success"
        />
        <SummaryCard
          icon="box"
          label="Currently loading"
          value={loadingTrips.length}
          detail={
            loadingTrips.length === 0
              ? "No vehicle in loading state."
              : loadingTrips.slice(0, 3).map((t) => t.vehicleId).join(", ") +
                (loadingTrips.length > 3 ? ` +${loadingTrips.length - 3}` : "")
          }
          accent="info"
        />
        <SummaryCard
          icon="clock"
          label="Pending"
          value={pendingCount}
          detail={pendingCount === 0 ? "Queue is clear." : "See loading sequence"}
          accent="muted"
        />
      </section>

      <section aria-label="Status filter" className="mt-6 flex flex-wrap gap-6 border-b border-line">
        {STATUS_FILTERS.map((filter) => {
          const active = (filter.value || "") === (status || "");
          const count =
            filter.value === ""
              ? total
              : trips.filter((trip) => trip.status === filter.value).length;
          const href = filter.value
            ? `/loader?date=${encodeURIComponent(date)}&status=${filter.value}`
            : `/loader?date=${encodeURIComponent(date)}`;
          return (
            <Link
              key={filter.value || "all"}
              href={href}
              aria-current={active ? "page" : undefined}
              className={`-mb-px inline-flex min-h-11 items-center gap-2 border-b-2 px-1 pb-3 text-sm font-semibold transition-colors ${
                active
                  ? "border-action text-ink"
                  : "border-transparent text-muted hover:text-ink"
              }`}
            >
              {filter.label}
              <span className={`tabular rounded-full px-2 text-xs ${active ? "bg-action/20 text-ink" : "bg-raised text-muted"}`}>
                {count}
              </span>
            </Link>
          );
        })}
      </section>

      {total === 0 ? (
        <EmptyBoard filtered={Boolean(status)} date={date} />
      ) : (
        <div className="mt-6 flex flex-col gap-8">
          {groups.map((group) => (
            <WaveSection key={group.wave} wave={group.wave} trips={group.trips} />
          ))}
        </div>
      )}
    </main>
  );
}

function SummaryIcon({ kind }: { kind: "truck" | "check" | "box" | "clock" }) {
  const common = "h-5 w-5";
  if (kind === "truck")
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className={common} aria-hidden>
        <path d="M3 7h11v9H3z" /><path d="M14 10h4l2 3v3h-6" /><circle cx="7" cy="18.5" r="1.5" /><circle cx="17" cy="18.5" r="1.5" />
      </svg>
    );
  if (kind === "check")
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={common} aria-hidden>
        <circle cx="12" cy="12" r="9" /><path d="M8 12l3 3 5-6" />
      </svg>
    );
  if (kind === "box")
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className={common} aria-hidden>
        <path d="M12 3l9 5v8l-9 5-9-5V8z" /><path d="M3 8l9 5 9-5M12 13v10" />
      </svg>
    );
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className={common} aria-hidden>
      <circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" />
    </svg>
  );
}

function SummaryCard({
  icon,
  label,
  value,
  detail,
  progress,
  accent = "default",
}: {
  icon: "truck" | "check" | "box" | "clock";
  label: string;
  value: number;
  detail: string;
  progress?: number;
  accent?: "default" | "success" | "info" | "muted";
}) {
  const iconBg =
    accent === "success"
      ? "bg-emerald-50 text-emerald-700"
      : accent === "info"
        ? "bg-blue-50 text-link"
        : accent === "muted"
          ? "bg-raised text-muted"
          : "bg-action/15 text-[color:var(--c-navy)]";

  return (
    <article className="rounded-[var(--radius-card)] border border-line bg-surface p-4">
      <div className="flex items-start gap-3">
        <span className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md ${iconBg}`}>
          <SummaryIcon kind={icon} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="tabular text-2xl font-semibold text-ink">{value}</p>
          <p className="text-sm text-muted">{label}</p>
        </div>
      </div>
      {typeof progress === "number" ? (
        <div className="mt-3">
          <div className="h-1 rounded-full bg-raised">
            <div className="h-full rounded-full bg-action" style={{ width: `${Math.min(progress, 100)}%` }} />
          </div>
          <p className="mt-2 text-xs text-muted">{detail}</p>
        </div>
      ) : (
        <p className="mt-3 text-xs text-muted">{detail}</p>
      )}
    </article>
  );
}

function WaveSection({ wave, trips }: { wave: "PREDAWN" | "DAYTIME"; trips: Trip[] }) {
  return (
    <section aria-labelledby={`wave-${wave}`}>
      <div className="flex flex-wrap items-baseline gap-3 pb-2">
        <h2 id={`wave-${wave}`} className="text-lg font-semibold text-ink">
          {WAVE_LABEL[wave]}
        </h2>
        <span className="text-sm text-muted">{WAVE_WINDOW[wave]}</span>
        <span className="ml-auto text-sm text-muted">
          {trips.length} {trips.length === 1 ? "trip" : "trips"}
        </span>
      </div>
      <div className="overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line bg-raised text-left text-xs font-semibold uppercase tracking-wide text-muted">
              <th scope="col" className="px-4 py-2.5 w-8">#</th>
              <th scope="col" className="px-4 py-2.5">Vehicle · Trip</th>
              <th scope="col" className="px-4 py-2.5">Route</th>
              <th scope="col" className="hidden px-4 py-2.5 lg:table-cell">Depart</th>
              <th scope="col" className="hidden px-4 py-2.5 xl:table-cell">Weight</th>
              <th scope="col" className="hidden px-4 py-2.5 xl:table-cell">Volume</th>
              <th scope="col" className="px-4 py-2.5">Status</th>
              <th scope="col" className="px-4 py-2.5 text-right"><span className="sr-only">Open</span></th>
            </tr>
          </thead>
          <tbody>
            {trips.map((trip, i) => (
              <TripRow key={trip.id} trip={trip} index={i + 1} />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function TripRow({ trip, index }: { trip: Trip; index: number }) {
  const href = `/loader/trips/${encodeURIComponent(trip.id)}`;
  return (
    <tr className="group border-b border-line last:border-0 transition-colors hover:bg-raised">
      <td className="tabular px-4 py-3 text-sm text-muted">{index}</td>
      <td className="px-4 py-3">
        <Link href={href} className="flex flex-col gap-0.5 group-hover:text-link">
          <span className="font-semibold text-ink group-hover:text-link">{trip.vehicleId}</span>
          <span className="text-xs text-muted">Trip {trip.tripNo} · {trip.brand}</span>
        </Link>
      </td>
      <td className="px-4 py-3">
        <span className="inline-flex items-center gap-1.5 text-sm text-ink">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5 text-[color:var(--c-ruby)]" aria-hidden>
            <path d="M12 2a7 7 0 0 1 7 7c0 5-7 13-7 13S5 14 5 9a7 7 0 0 1 7-7z" /><circle cx="12" cy="9" r="2.5" />
          </svg>
          {trip.districtName}
        </span>
      </td>
      <td className="hidden tabular px-4 py-3 text-sm text-ink lg:table-cell">
        {formatPlannedTime(trip.plannedDepartAt)}
      </td>
      <td className="hidden tabular px-4 py-3 text-sm text-muted xl:table-cell">
        {formatWeight(trip.sumWeightKg)}
      </td>
      <td className="hidden tabular px-4 py-3 text-sm text-muted xl:table-cell">
        {formatVolume(trip.sumVolumeM3)}
      </td>
      <td className="px-4 py-3">
        <StatusBadge status={trip.status} />
      </td>
      <td className="px-4 py-3 text-right">
        <Link
          href={href}
          aria-label={`Open ${trip.vehicleId} trip ${trip.tripNo}`}
          className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted hover:bg-raised hover:text-ink"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden>
            <path d="M9 6l6 6-6 6" />
          </svg>
        </Link>
      </td>
    </tr>
  );
}

function StatusBadge({ status }: { status: TripStatus }) {
  const style = STATUS_STYLE[status];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-semibold ${style.pill}`}
      aria-label={`Status: ${TRIP_STATUS_LABEL[status]}`}
    >
      <span aria-hidden className={`size-2 rounded-full ${style.dot}`} />
      {TRIP_STATUS_LABEL[status]}
    </span>
  );
}

const STATUS_STYLE: Record<TripStatus, { pill: string; dot: string }> = {
  PLANNED: { pill: "bg-raised text-ink border border-line", dot: "bg-[color:var(--c-navy)]" },
  LOADING: { pill: "bg-amber-50 text-amber-900 border border-amber-200", dot: "bg-action" },
  READY: { pill: "bg-emerald-50 text-emerald-800 border border-emerald-200", dot: "bg-emerald-600" },
  DEPARTED: { pill: "bg-blue-50 text-blue-800 border border-blue-200", dot: "bg-link" },
  COMPLETED: { pill: "bg-blue-50 text-blue-800 border border-blue-200", dot: "bg-link" },
  CANCELLED: { pill: "bg-red-50 text-critical border border-red-200", dot: "bg-critical" },
};

function BoardError({
  date,
  title,
  detail,
  expired,
}: {
  date: string;
  title: string;
  detail: string;
  expired: boolean;
}) {
  return (
    <main className="min-w-0 flex-1 p-4 sm:p-6">
      <section
        role={expired ? "status" : "alert"}
        aria-live="polite"
        className="rounded-[var(--radius-card)] border border-line bg-surface p-5 sm:p-6"
      >
        <p className="text-xs font-semibold uppercase tracking-wide text-muted">Dock board · {date}</p>
        <h1 className="mt-2 text-2xl font-semibold text-critical">{title}</h1>
        <p className="mt-2 max-w-xl text-sm text-muted">{detail}</p>
        <div className="mt-5 flex flex-wrap gap-3">
          <Link
            href="/loader"
            className="inline-flex min-h-11 min-w-28 items-center justify-center rounded-[var(--radius-control)] bg-action px-4 font-semibold text-ink hover:brightness-95"
          >
            Reload
          </Link>
        </div>
      </section>
    </main>
  );
}

function EmptyBoard({ date, filtered }: { date: string; filtered: boolean }) {
  return (
    <section className="mt-10 rounded-[var(--radius-card)] border border-dashed border-line bg-surface p-8 text-center">
      <h2 className="text-lg font-semibold text-ink">
        {filtered ? "No trips match this filter" : "No trips published yet"}
      </h2>
      <p className="mx-auto mt-2 max-w-xl text-sm text-muted">
        {filtered
          ? "Clear the status filter to see the full board for this date."
          : `The dispatcher has not published a plan for ${date}, or every trip has already completed.`}
      </p>
      {filtered && (
        <Link
          href={`/loader?date=${encodeURIComponent(date)}`}
          className="mt-4 inline-flex min-h-11 min-w-28 items-center justify-center rounded-[var(--radius-control)] bg-action px-4 font-semibold text-ink hover:brightness-95"
        >
          Clear filter
        </Link>
      )}
    </section>
  );
}
