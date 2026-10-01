import Link from "next/link";
import { api } from "@/lib/api";
import { readError } from "./api-errors";
import { colomboToday, formatPlannedTime, formatVolume, formatWeight } from "./format";
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
  { value: "PLANNED", label: "Planned" },
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
  const checkedReady = trips.filter((trip) => trip.status === "READY" || trip.status === "DEPARTED").length;

  return (
    <main className="mx-auto w-full max-w-7xl p-4 sm:p-6">
      <header className="flex flex-col gap-3 border-b border-line pb-5 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">Dock board</p>
          <h1 className="mt-1 text-2xl font-semibold text-ink sm:text-3xl">Load trips for {date}</h1>
          <p className="mt-1 max-w-xl text-sm text-muted">
            Group by wave, open a trip, and check every line before marking the vehicle ready.
          </p>
        </div>
        <div className="flex flex-col gap-2 text-sm text-muted">
          <label htmlFor="date" className="font-semibold text-ink">
            Dock date
          </label>
          <form method="get" className="flex items-center gap-2">
            <input
              id="date"
              name="date"
              type="date"
              defaultValue={date}
              className="min-h-11 rounded-[var(--radius-control)] border border-line bg-surface px-3 text-ink"
            />
            {status && <input type="hidden" name="status" value={status} />}
            <button
              type="submit"
              className="min-h-11 rounded-[var(--radius-control)] bg-action px-4 font-semibold text-ink hover:brightness-95"
            >
              Reload
            </button>
          </form>
        </div>
      </header>

      <section
        aria-label="Dock summary"
        className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
      >
        <SummaryCard label="Trips today" value={total} detail="Across every wave at this depot." />
        <SummaryCard label="Ready or departed" value={checkedReady} detail="Vehicles the loader has released." />
        <SummaryCard
          label="Still to check"
          value={Math.max(total - checkedReady, 0)}
          detail="Trips the dock has to work through."
        />
        <SummaryCard
          label="Open waves"
          value={groups.length}
          detail={groups.length === 0 ? "No waves scheduled yet." : groups.map((g) => WAVE_LABEL[g.wave].replace(" wave", "")).join(" · ")}
        />
      </section>

      <section aria-label="Status filter" className="mt-6 flex flex-wrap gap-2">
        {STATUS_FILTERS.map((filter) => {
          const active = (filter.value || "") === (status || "");
          const href = filter.value
            ? `/loader?date=${encodeURIComponent(date)}&status=${filter.value}`
            : `/loader?date=${encodeURIComponent(date)}`;
          return (
            <Link
              key={filter.value || "all"}
              href={href}
              aria-current={active ? "page" : undefined}
              className={`inline-flex min-h-11 items-center rounded-[var(--radius-control)] border px-4 text-sm font-semibold ${
                active
                  ? "border-[color:var(--c-navy)] bg-[color:var(--c-navy)] text-white"
                  : "border-line bg-surface text-ink hover:border-[color:var(--c-navy)]"
              }`}
            >
              {filter.label}
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

function SummaryCard({ label, value, detail }: { label: string; value: number; detail: string }) {
  return (
    <article className="rounded-[var(--radius-card)] border border-line bg-surface p-4">
      <p className="text-sm text-muted">{label}</p>
      <p className="tabular mt-1 text-3xl font-semibold text-ink">{value}</p>
      <p className="mt-2 text-sm text-muted">{detail}</p>
    </article>
  );
}

function WaveSection({ wave, trips }: { wave: "PREDAWN" | "DAYTIME"; trips: Trip[] }) {
  return (
    <section aria-labelledby={`wave-${wave}`}>
      <div className="flex flex-wrap items-baseline gap-3 border-b border-line pb-2">
        <h2 id={`wave-${wave}`} className="text-lg font-semibold text-ink">
          {WAVE_LABEL[wave]}
        </h2>
        <span className="text-sm text-muted">{WAVE_WINDOW[wave]}</span>
        <span className="ml-auto text-sm text-muted">
          {trips.length} {trips.length === 1 ? "trip" : "trips"}
        </span>
      </div>
      <ul className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {trips.map((trip) => (
          <TripCard key={trip.id} trip={trip} />
        ))}
      </ul>
    </section>
  );
}

function TripCard({ trip }: { trip: Trip }) {
  const href = `/loader/trips/${encodeURIComponent(trip.id)}`;
  return (
    <li>
      <Link
        href={href}
        className="group flex min-h-[44px] flex-col gap-3 rounded-[var(--radius-card)] border border-line bg-surface p-4 transition-colors hover:border-[color:var(--c-navy)] focus-visible:border-[color:var(--c-navy)]"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">
              Trip {trip.tripNo} · {trip.brand}
            </p>
            <p className="truncate text-lg font-semibold text-ink">{trip.vehicleId}</p>
            <p className="truncate text-sm text-muted">{trip.districtName}</p>
          </div>
          <StatusBadge status={trip.status} />
        </div>
        <dl className="grid grid-cols-3 gap-2 text-sm">
          <Metric label="Depart" value={formatPlannedTime(trip.plannedDepartAt)} />
          <Metric label="Weight" value={formatWeight(trip.sumWeightKg)} />
          <Metric label="Volume" value={formatVolume(trip.sumVolumeM3)} />
        </dl>
        <p className="text-sm font-semibold text-link group-hover:underline">Open load list →</p>
      </Link>
    </li>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-muted">{label}</dt>
      <dd className="tabular text-sm font-semibold text-ink">{value}</dd>
    </div>
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
    <main className="mx-auto max-w-3xl p-4 sm:p-6">
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
