import Link from "next/link";
import { api } from "@/lib/api";
import { readError } from "../api-errors";
import { colomboToday, formatPlannedTime } from "../format";
import { HeaderClock } from "../header-clock";
import { TRIP_STATUS_LABEL, type Trip, type TripStatus } from "../wave";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

type LineLite = {
  orderId: string;
  outletId: string;
  expectedUnits: number;
  loadedUnits?: number | null;
  condition?: "OK" | "SHORT" | "DAMAGED" | "MISSING" | null;
};

type ProgressRow = {
  trip: Trip;
  total: number;
  checked: number;
  loadedUnits: number;
  expectedUnits: number;
  discrepancies: number;
  error?: string;
};

export default async function LoadingProgressPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const dateParam = typeof params.date === "string" ? params.date : "";
  const date = /^\d{4}-\d{2}-\d{2}$/.test(dateParam) ? dateParam : colomboToday();

  const client = await api();
  const tripsResult = await client.GET("/trips", { params: { query: { date } } });

  if (tripsResult.error || !tripsResult.data) {
    const err = readError(tripsResult.response.status, "trips");
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

  const activeTrips = tripsResult.data.filter(
    (trip) => trip.status === "LOADING" || trip.status === "PLANNED",
  );

  const rows: ProgressRow[] = await Promise.all(
    activeTrips.map(async (trip): Promise<ProgressRow> => {
      try {
        const loadList = await client.GET("/trips/{tripId}/load-list", {
          params: { path: { tripId: trip.id } },
        });
        if (loadList.error || !loadList.data) {
          return {
            trip,
            total: 0,
            checked: 0,
            loadedUnits: 0,
            expectedUnits: 0,
            discrepancies: 0,
            error: "Could not read load list.",
          };
        }
        const lines = loadList.data.lines as LineLite[];
        const total = lines.length;
        const checked = lines.filter((l) => l.loadedUnits != null && l.condition != null).length;
        const loadedUnits = lines.reduce((sum, l) => sum + (l.loadedUnits ?? 0), 0);
        const expectedUnits = lines.reduce((sum, l) => sum + l.expectedUnits, 0);
        const discrepancies = lines.filter((l) => l.condition && l.condition !== "OK").length;
        return { trip, total, checked, loadedUnits, expectedUnits, discrepancies };
      } catch {
        return {
          trip,
          total: 0,
          checked: 0,
          loadedUnits: 0,
          expectedUnits: 0,
          discrepancies: 0,
          error: "Load list unreachable.",
        };
      }
    }),
  );

  rows.sort((a, b) => {
    const aPct = pct(a.loadedUnits, a.expectedUnits);
    const bPct = pct(b.loadedUnits, b.expectedUnits);
    if (aPct !== bPct) return bPct - aPct;
    return (a.trip.plannedDepartAt ?? "99:99").localeCompare(b.trip.plannedDepartAt ?? "99:99");
  });

  const totalUnits = rows.reduce((s, r) => s + r.expectedUnits, 0);
  const loadedUnits = rows.reduce((s, r) => s + r.loadedUnits, 0);
  const overallPct = pct(loadedUnits, totalUnits);
  const totalDiscrepancies = rows.reduce((s, r) => s + r.discrepancies, 0);

  return (
    <main className="min-w-0 flex-1 p-4 sm:p-6 lg:p-8">
      <header className="flex flex-col gap-4 border-b border-line pb-5 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-ink sm:text-3xl">Loading progress</h1>
          <p className="mt-2 max-w-xl text-sm text-muted">
            Live view of every vehicle still being loaded. Rows are ranked by completion so the dock can spot a trip that is falling behind.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <form method="get" className="flex items-center gap-2">
            <label htmlFor="date" className="sr-only">Date</label>
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

      <section aria-label="Overall progress" className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Summary label="Active trips" value={`${rows.length}`} detail={rows.length === 0 ? "Nothing to load right now." : "Still being loaded or awaiting start."} />
        <Summary label="Units loaded" value={`${loadedUnits.toLocaleString()}`} detail={`of ${totalUnits.toLocaleString()} planned`} />
        <Summary label="Progress" value={`${overallPct}%`} detail="Across every active trip." progress={overallPct} />
        <Summary label="Discrepancies" value={`${totalDiscrepancies}`} detail={totalDiscrepancies === 0 ? "No lines flagged." : "Lines awaiting resolution."} accent={totalDiscrepancies === 0 ? "default" : "warning"} />
      </section>

      {rows.length === 0 ? (
        <section className="mt-10 rounded-[var(--radius-card)] border border-dashed border-line bg-surface p-8 text-center">
          <h2 className="text-lg font-semibold text-ink">No active loads</h2>
          <p className="mx-auto mt-2 max-w-xl text-sm text-muted">
            Nothing on this date is in LOADING or PLANNED. Open the dock board to see completed or departed trips.
          </p>
          <Link href={`/loader?date=${encodeURIComponent(date)}`} className="mt-4 inline-flex min-h-11 items-center rounded-[var(--radius-control)] bg-action px-4 font-semibold text-ink hover:brightness-95">
            Dock board
          </Link>
        </section>
      ) : (
        <ul className="mt-6 flex flex-col gap-3">
          {rows.map((row) => (
            <ProgressBar key={row.trip.id} row={row} />
          ))}
        </ul>
      )}
    </main>
  );
}

function Summary({
  label,
  value,
  detail,
  progress,
  accent = "default",
}: {
  label: string;
  value: string;
  detail: string;
  progress?: number;
  accent?: "default" | "warning";
}) {
  const valueColor = accent === "warning" ? "text-[color:var(--c-ruby)]" : "text-ink";
  return (
    <article className="rounded-[var(--radius-card)] border border-line bg-surface p-4">
      <p className={`tabular text-2xl font-semibold ${valueColor}`}>{value}</p>
      <p className="text-sm text-muted">{label}</p>
      {typeof progress === "number" ? (
        <div className="mt-3 h-1 rounded-full bg-raised">
          <div className="h-full rounded-full bg-action" style={{ width: `${Math.min(progress, 100)}%` }} />
        </div>
      ) : null}
      <p className="mt-2 text-xs text-muted">{detail}</p>
    </article>
  );
}

function ProgressBar({ row }: { row: ProgressRow }) {
  const barPct = pct(row.loadedUnits, row.expectedUnits);
  const href = `/loader/trips/${encodeURIComponent(row.trip.id)}`;
  return (
    <li>
      <Link href={href} className="group flex flex-col gap-3 rounded-[var(--radius-card)] border border-line bg-surface p-4 transition-colors hover:border-[color:var(--c-navy)]">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="font-semibold text-ink group-hover:text-link">{row.trip.vehicleId}</p>
            <p className="text-xs text-muted">
              Trip {row.trip.tripNo} · {row.trip.brand} · {row.trip.districtName} · departs {formatPlannedTime(row.trip.plannedDepartAt)}
            </p>
          </div>
          <StatusChip status={row.trip.status} />
        </div>
        <div>
          <div className="h-2 rounded-full bg-raised">
            <div className="h-full rounded-full bg-action transition-[width]" style={{ width: `${Math.min(barPct, 100)}%` }} />
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-muted">
            <span className="tabular font-semibold text-ink">{barPct}%</span>
            <span className="tabular">{row.loadedUnits.toLocaleString()} / {row.expectedUnits.toLocaleString()} units</span>
            <span>·</span>
            <span>Lines checked {row.checked} / {row.total}</span>
            {row.discrepancies > 0 && (
              <span className="rounded-md border border-amber-200 bg-amber-50 px-2 py-0.5 font-semibold text-amber-900">
                {row.discrepancies} discrepanc{row.discrepancies === 1 ? "y" : "ies"}
              </span>
            )}
            {row.error && <span className="text-critical">{row.error}</span>}
          </div>
        </div>
      </Link>
    </li>
  );
}

function StatusChip({ status }: { status: TripStatus }) {
  const map: Record<TripStatus, string> = {
    PLANNED: "bg-raised text-ink border border-line",
    LOADING: "bg-amber-50 text-amber-900 border border-amber-200",
    READY: "bg-emerald-50 text-emerald-800 border border-emerald-200",
    DEPARTED: "bg-blue-50 text-blue-800 border border-blue-200",
    COMPLETED: "bg-blue-50 text-blue-800 border border-blue-200",
    CANCELLED: "bg-red-50 text-critical border border-red-200",
  };
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-semibold ${map[status]}`}>
      {TRIP_STATUS_LABEL[status]}
    </span>
  );
}

function pct(num: number, den: number) {
  if (den <= 0) return 0;
  return Math.round((num / den) * 100);
}
