import Link from "next/link";
import { api } from "@/lib/api";
import { readError } from "../api-errors";
import { colomboToday, formatPlannedTime } from "../format";
import { HeaderClock } from "../header-clock";
import { TRIP_STATUS_LABEL, type Trip, type TripStatus } from "../wave";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function LoaderReportsPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const dateParam = typeof params.date === "string" ? params.date : "";
  const date = /^\d{4}-\d{2}-\d{2}$/.test(dateParam) ? dateParam : colomboToday();

  const client = await api();
  const result = await client.GET("/trips", { params: { query: { date } } });

  if (result.error || !result.data) {
    const err = readError(result.response.status, "trips");
    return (
      <main className="min-w-0 flex-1 p-4 sm:p-6 lg:p-8">
        <section role="alert" className="rounded-[var(--radius-card)] border border-line bg-surface p-6">
          <h1 className="text-2xl font-semibold text-critical">{err.title}</h1>
          <p className="mt-2 text-sm text-muted">{err.detail}</p>
          <Link href="/loader" className="mt-5 inline-flex min-h-11 items-center rounded-[var(--radius-control)] bg-action px-4 font-semibold text-ink hover:brightness-95">
            Dock board
          </Link>
        </section>
      </main>
    );
  }

  const trips = result.data;
  const total = trips.length;
  const byStatus = trips.reduce<Record<TripStatus, Trip[]>>((map, trip) => {
    (map[trip.status] = map[trip.status] ?? []).push(trip);
    return map;
  }, {} as Record<TripStatus, Trip[]>);
  const departed = (byStatus.DEPARTED ?? []).length + (byStatus.COMPLETED ?? []).length;
  const ready = (byStatus.READY ?? []).length;
  const loading = (byStatus.LOADING ?? []).length;
  const planned = (byStatus.PLANNED ?? []).length;
  const cancelled = (byStatus.CANCELLED ?? []).length;
  const totalWeight = trips.reduce((s, t) => s + (t.sumWeightKg ?? 0), 0);
  const totalVolume = trips.reduce((s, t) => s + (t.sumVolumeM3 ?? 0), 0);

  const departedTrips = [...(byStatus.DEPARTED ?? []), ...(byStatus.COMPLETED ?? [])].sort(
    (a, b) => (a.plannedDepartAt ?? "").localeCompare(b.plannedDepartAt ?? ""),
  );

  return (
    <main className="min-w-0 flex-1 p-4 sm:p-6 lg:p-8">
      <header className="flex flex-col gap-4 border-b border-line pb-5 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-ink sm:text-3xl">Reports</h1>
          <p className="mt-2 max-w-xl text-sm text-muted">
            A snapshot of the dock day: how many vehicles are through the gate, how many are still being loaded, and the weight &amp; volume moved.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <form method="get" className="flex items-center gap-2">
            <label htmlFor="date" className="sr-only">Report date</label>
            <input
              id="date"
              name="date"
              type="date"
              defaultValue={date}
              className="min-h-10 rounded-[var(--radius-control)] border border-line bg-surface px-3 text-sm text-ink"
            />
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

      {total === 0 ? (
        <section className="mt-10 rounded-[var(--radius-card)] border border-dashed border-line bg-surface p-8 text-center">
          <h2 className="text-lg font-semibold text-ink">No trips published for {date}</h2>
          <p className="mx-auto mt-2 max-w-xl text-sm text-muted">
            The dispatcher may not have published a plan for this date, or it was superseded. Pick a different date to see its dock totals.
          </p>
        </section>
      ) : (
        <>
          <section aria-label="Day totals" className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Vehicles today" value={total} detail={`${departed} already departed`} />
            <Stat label="On the dock" value={loading + ready} detail={`${loading} loading · ${ready} ready`} accent="info" />
            <Stat label="Still to load" value={planned} detail={planned === 0 ? "Queue is clear." : "Awaiting a loader to pick them up."} accent="muted" />
            <Stat label="Weight &amp; volume" value={`${(totalWeight / 1000).toFixed(1)} t`} detail={`${totalVolume.toFixed(1)} m³ across every trip`} />
          </section>

          <section aria-labelledby="status-breakdown" className="mt-8">
            <h2 id="status-breakdown" className="text-lg font-semibold text-ink">Status breakdown</h2>
            <div className="mt-3 overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-line bg-raised text-left text-xs font-semibold uppercase tracking-wide text-muted">
                    <th scope="col" className="px-4 py-2.5">Status</th>
                    <th scope="col" className="px-4 py-2.5 text-right">Vehicles</th>
                    <th scope="col" className="px-4 py-2.5">Share of day</th>
                  </tr>
                </thead>
                <tbody>
                  <StatusRow label="Departed" count={departed} total={total} tone="info" />
                  <StatusRow label="Ready" count={ready} total={total} tone="success" />
                  <StatusRow label="Loading" count={loading} total={total} tone="warning" />
                  <StatusRow label="Planned" count={planned} total={total} tone="muted" />
                  {cancelled > 0 && <StatusRow label="Cancelled" count={cancelled} total={total} tone="critical" />}
                </tbody>
              </table>
            </div>
          </section>

          <section aria-labelledby="departures" className="mt-8">
            <div className="flex items-baseline justify-between gap-3">
              <h2 id="departures" className="text-lg font-semibold text-ink">Departures today</h2>
              <span className="text-sm text-muted">{departedTrips.length} vehicles</span>
            </div>
            {departedTrips.length === 0 ? (
              <p className="mt-3 rounded-[var(--radius-card)] border border-dashed border-line bg-surface p-6 text-sm text-muted">
                Nothing has departed yet. Loaders release trips to driver claim once every line is checked.
              </p>
            ) : (
              <div className="mt-3 overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-line bg-raised text-left text-xs font-semibold uppercase tracking-wide text-muted">
                      <th scope="col" className="px-4 py-2.5">Vehicle · Trip</th>
                      <th scope="col" className="px-4 py-2.5">Route</th>
                      <th scope="col" className="px-4 py-2.5">Depart</th>
                      <th scope="col" className="px-4 py-2.5">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {departedTrips.map((trip) => (
                      <tr key={trip.id} className="border-b border-line last:border-0">
                        <td className="px-4 py-3">
                          <p className="font-semibold text-ink">{trip.vehicleId}</p>
                          <p className="text-xs text-muted">Trip {trip.tripNo} · {trip.brand}</p>
                        </td>
                        <td className="px-4 py-3 text-ink">{trip.districtName}</td>
                        <td className="tabular px-4 py-3 text-ink">{formatPlannedTime(trip.plannedDepartAt)}</td>
                        <td className="px-4 py-3 text-xs font-semibold text-muted">{TRIP_STATUS_LABEL[trip.status]}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </main>
  );
}

function Stat({
  label,
  value,
  detail,
  accent = "default",
}: {
  label: string;
  value: number | string;
  detail: string;
  accent?: "default" | "info" | "muted";
}) {
  const bg =
    accent === "info"
      ? "bg-blue-50 border-blue-100"
      : accent === "muted"
        ? "bg-raised border-line"
        : "bg-surface border-line";
  return (
    <article className={`rounded-[var(--radius-card)] border p-4 ${bg}`}>
      <p className="tabular text-2xl font-semibold text-ink">{value}</p>
      <p className="text-sm text-muted">{label}</p>
      <p className="mt-2 text-xs text-muted">{detail}</p>
    </article>
  );
}

function StatusRow({
  label,
  count,
  total,
  tone,
}: {
  label: string;
  count: number;
  total: number;
  tone: "success" | "warning" | "muted" | "info" | "critical";
}) {
  const share = total > 0 ? Math.round((count / total) * 100) : 0;
  const bar =
    tone === "success"
      ? "bg-emerald-500"
      : tone === "warning"
        ? "bg-action"
        : tone === "critical"
          ? "bg-[color:var(--c-ruby)]"
          : tone === "info"
            ? "bg-link"
            : "bg-muted";
  return (
    <tr className="border-b border-line last:border-0">
      <td className="px-4 py-3 font-semibold text-ink">{label}</td>
      <td className="tabular px-4 py-3 text-right text-ink">{count}</td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="h-1.5 flex-1 max-w-xs rounded-full bg-raised">
            <div className={`h-full rounded-full ${bar}`} style={{ width: `${Math.min(share, 100)}%` }} />
          </div>
          <span className="tabular text-xs text-muted w-10 text-right">{share}%</span>
        </div>
      </td>
    </tr>
  );
}
