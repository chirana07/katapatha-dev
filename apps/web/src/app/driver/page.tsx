import Link from "next/link";
import { api } from "@/lib/api";
import { readError } from "./api-errors";
import { colomboToday, formatClock, formatWindow } from "./format";
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

export default async function DriverRunPage() {
  const date = colomboToday();
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
        className="mt-4 flex items-center justify-between gap-3 rounded-[var(--radius-card)] border border-line bg-surface p-4"
      >
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">Stops</p>
          <p className="tabular mt-1 text-2xl font-semibold text-ink">
            {progress.done} / {progress.total}
          </p>
        </div>
        <p className="max-w-[14rem] text-right text-sm text-muted">
          {progress.remaining === 0
            ? "Every stop is closed. The vehicle can be released."
            : `${progress.remaining} ${progress.remaining === 1 ? "stop" : "stops"} to work through.`}
        </p>
      </section>

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
                            Stop {stop.seq} · Trip {trip.tripNo}
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
