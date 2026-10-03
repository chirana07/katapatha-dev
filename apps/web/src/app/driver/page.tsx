import Link from "next/link";
import { api } from "@/lib/api";
import { readError } from "./api-errors";
import { colomboToday, formatClock, formatWindow, stopNumber } from "./format";
import { ReleaseButton } from "./release-button";
import {
  STOP_STATUS_LABEL,
  STOP_STATUS_STYLE,
  isTerminal,
  primaryAction,
  stopsProgress,
  type StopStatus,
} from "./stop-state";
import { VehicleClaimForm } from "./vehicle-form";

export const dynamic = "force-dynamic";

type Stop = {
  id: string;
  seq: number;
  outletId: string;
  outletName?: string;
  status: StopStatus;
  plannedArrivalAt?: string;
  windowOpen?: string;
  windowClose?: string;
  accessNote?: string | null;
  orders?: Array<{ orderId: string; orderRef: string; expectedUnits: number }>;
};

export default async function DriverRunPage({
  searchParams,
}: {
  searchParams?: Promise<{ date?: string }>;
}) {
  const query = searchParams ? await searchParams : {};
  const dateOverride = typeof query.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(query.date) ? query.date : null;
  const date = dateOverride ?? colomboToday();
  const client = await api();
  const result = await client.GET("/drivers/me/run", {
    params: { query: { date } },
  });

  if (result.response.status === 403) {
    // 403 on this endpoint means the driver has no claimed vehicle today.
    return (
      <main className="mx-auto w-full max-w-xl p-4">
        <section className="mt-2 flex flex-col gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-ink">Claim a vehicle to start</h1>
            <p className="mt-2 text-sm text-muted">
              The depot allocator published today&apos;s run against a vehicle, not a person. Enter the vehicle id from the
              dock card to see your stops.
            </p>
          </div>
          <VehicleClaimForm />
        </section>
      </main>
    );
  }

  if (result.error || !result.data) {
    const error = readError(result.response.status, "run");
    return (
      <RunError title={error.title} detail={error.detail} expired={error.expired} />
    );
  }

  const run = result.data;
  const allStops = run.trips.flatMap((trip) =>
    trip.stops.map((stop) => ({ trip, stop: stop as Stop })),
  );
  const progress = stopsProgress(allStops.map(({ stop }) => stop));

  return (
    <main className="mx-auto w-full max-w-xl p-4 pb-32">
      <header className="flex flex-col gap-1 border-b border-line pb-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold text-ink">Today&apos;s run</h1>
            <p className="mt-1 text-sm text-muted">
              Vehicle <span className="tabular font-semibold text-ink">{run.vehicleId}</span> · {date}
            </p>
          </div>
          <ReleaseButton />
        </div>
      </header>

      <section
        aria-label="Run progress"
        className="mt-4 rounded-[var(--radius-card)] border border-line bg-surface p-4"
      >
        <div className="flex items-baseline justify-between gap-3">
          <p className="tabular text-sm font-semibold text-ink">
            {progress.done} of {progress.total} stops completed
          </p>
          <p className="tabular text-sm font-semibold text-[color:var(--c-navy)]">
            {progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0}%
          </p>
        </div>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-raised">
          <div
            className="h-full rounded-full bg-action transition-[width]"
            style={{ width: `${progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0}%` }}
            aria-hidden
          />
        </div>
        <p className="mt-2 text-xs text-muted">
          {progress.remaining === 0
            ? "Every stop is closed. The vehicle can be released."
            : `${progress.remaining} ${progress.remaining === 1 ? "stop" : "stops"} to work through.`}
        </p>
      </section>

      {progress.nextIndex != null && allStops[progress.nextIndex] ? (
        <NextStopCallout stop={allStops[progress.nextIndex].stop} />
      ) : null}

      {allStops.length === 0 ? (
        <EmptyRun />
      ) : (
        <section aria-labelledby="stops-heading" className="mt-5">
          <h2 id="stops-heading" className="sr-only">
            Stops on today&apos;s run
          </h2>
          <ol className="flex flex-col gap-3">
            {allStops.map(({ trip, stop }, index) => {
              const isNext = index === progress.nextIndex;
              return (
                <li key={stop.id}>
                  <Link
                    href={`/driver/stops/${encodeURIComponent(stop.id)}`}
                    className={`flex flex-col gap-2 rounded-[var(--radius-card)] border bg-surface p-4 transition-colors hover:border-[color:var(--c-navy)] focus-visible:border-[color:var(--c-navy)] ${
                      isNext ? "border-[color:var(--c-navy)]" : "border-line"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted">
                          {isNext && (
                            <span className="inline-flex items-center rounded-md bg-[color:var(--c-navy)] px-1.5 py-0.5 text-[11px] font-semibold text-white">
                              Next stop
                            </span>
                          )}
                          <span>
                            Stop {stopNumber(stop.seq)} · Trip {trip.tripNo}
                          </span>
                        </p>
                        <p className="truncate text-base font-semibold text-ink">
                          {stop.outletName ?? stop.outletId}
                        </p>
                        <p className="tabular text-sm text-muted">
                          Window {formatWindow(stop.windowOpen, stop.windowClose)} · arrive {formatClock(stop.plannedArrivalAt)}
                        </p>
                      </div>
                      <StopStatusBadge status={stop.status} />
                    </div>
                    <p className="text-sm font-semibold text-link">
                      {isTerminal(stop.status) ? "View recorded delivery" : primaryAction(stop.status).label} →
                    </p>
                  </Link>
                </li>
              );
            })}
          </ol>
        </section>
      )}
    </main>
  );
}

function NextStopCallout({ stop }: { stop: Stop }) {
  return (
    <section
      aria-label="Next stop"
      className="mt-4 rounded-[var(--radius-card)] border border-[color:var(--c-navy)] bg-emerald-50/50 p-4"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-white text-[color:var(--c-navy)]">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5" aria-hidden>
              <circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" />
            </svg>
          </span>
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">Next stop</p>
            <p className="truncate text-base font-semibold text-ink">
              {stop.outletName ?? stop.outletId}
            </p>
            <p className="tabular mt-0.5 text-sm text-muted">
              Arrive {formatClock(stop.plannedArrivalAt)} · window {formatWindow(stop.windowOpen, stop.windowClose)}
            </p>
          </div>
        </div>
        <Link
          href={`/driver/stops/${encodeURIComponent(stop.id)}`}
          className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-[var(--radius-control)] bg-[color:var(--c-navy)] px-4 text-sm font-semibold text-white hover:brightness-110"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden>
            <path d="M21 3L4 11l7 2 2 7z" />
          </svg>
          Open
        </Link>
      </div>
    </section>
  );
}

function StopStatusBadge({ status }: { status: StopStatus }) {
  const style = STOP_STATUS_STYLE[status];
  return (
    <span
      aria-label={`Status: ${STOP_STATUS_LABEL[status]}`}
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-xs font-semibold ${style.pill}`}
    >
      <span aria-hidden className={`size-2 rounded-full ${style.dot}`} />
      {STOP_STATUS_LABEL[status]}
    </span>
  );
}

function EmptyRun() {
  return (
    <section className="mt-6 rounded-[var(--radius-card)] border border-dashed border-line bg-surface p-6 text-center">
      <h2 className="text-base font-semibold text-ink">No stops on today&apos;s run</h2>
      <p className="mx-auto mt-2 max-w-sm text-sm text-muted">
        The dispatcher may still be publishing the plan, or every order on this vehicle has been deferred to another day.
      </p>
    </section>
  );
}

function RunError({ title, detail, expired }: { title: string; detail: string; expired: boolean }) {
  return (
    <main className="mx-auto max-w-xl p-4">
      <section
        role={expired ? "status" : "alert"}
        aria-live="polite"
        className="rounded-[var(--radius-card)] border border-line bg-surface p-5"
      >
        <h1 className="text-2xl font-semibold text-critical">{title}</h1>
        <p className="mt-2 text-sm text-muted">{detail}</p>
        <div className="mt-4">
          <Link
            href="/driver"
            className="inline-flex min-h-11 min-w-32 items-center justify-center rounded-[var(--radius-control)] bg-action px-4 font-semibold text-ink hover:brightness-95"
          >
            Reload
          </Link>
        </div>
      </section>
    </main>
  );
}
