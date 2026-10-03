import Link from "next/link";
import { api } from "@/lib/api";
import { readError } from "../../api-errors";
import { colomboToday, formatClock, formatWindow, stopNumber } from "../../format";
import { fetchProblemReasons } from "../../reasons.server";
import {
  STOP_STATUS_HINT,
  STOP_STATUS_LABEL,
  STOP_STATUS_STYLE,
  isTerminal,
  primaryAction,
  type StopStatus,
} from "../../stop-state";
import { DeliveryForm } from "./delivery-form";
import { ProblemForm } from "./problem-form";
import { ArrivalForm, UnloadForm } from "./transition-forms";

export const dynamic = "force-dynamic";

type Params = Promise<{ stopId: string }>;

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

export default async function StopDetailPage({ params }: { params: Params }) {
  const { stopId } = await params;
  const date = colomboToday();

  const client = await api();
  const result = await client.GET("/drivers/me/run", { params: { query: { date } } });
  if (result.response.status === 403) {
    return (
      <StopError
        title="Claim a vehicle first"
        detail="This stop belongs to a run that only shows up once you claim its vehicle on the depot phone."
        expired={false}
      />
    );
  }
  if (result.error || !result.data) {
    const error = readError(result.response.status, "run");
    return <StopError title={error.title} detail={error.detail} expired={error.expired} />;
  }

  const allStops: Array<{ tripNo: number; stop: Stop; index: number }> = [];
  for (const trip of result.data.trips) {
    for (const stop of trip.stops as Stop[]) {
      allStops.push({ tripNo: trip.tripNo, stop, index: allStops.length });
    }
  }
  const current = allStops.find((entry) => entry.stop.id === stopId);
  if (!current) {
    const error = readError(404, "stop");
    return <StopError title={error.title} detail={error.detail} expired={false} />;
  }

  const { stop, tripNo, index } = current;
  const next = allStops[index + 1];
  const previous = allStops[index - 1];
  const action = primaryAction(stop.status);
  const { reasons, fallback: reasonsFromFallback } = await fetchProblemReasons();
  const canReportProblem = !isTerminal(stop.status);
  const totalExpectedUnits = (stop.orders ?? []).reduce((sum, order) => sum + order.expectedUnits, 0);

  return (
    <main className="mx-auto w-full max-w-xl p-4 pb-24">
      <nav aria-label="Breadcrumb" className="text-sm text-muted">
        <Link href="/driver" className="hover:underline">
          Today&apos;s run
        </Link>
        <span aria-hidden> › </span>
        <span className="text-ink">Stop {stopNumber(stop.seq)}</span>
      </nav>

      <header className="mt-3 border-b border-line pb-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">
              Stop {stopNumber(stop.seq)} · Trip {tripNo}
            </p>
            <h1 className="mt-1 truncate text-2xl font-semibold text-ink">
              {stop.outletName ?? stop.outletId}
            </h1>
            <p className="tabular text-sm text-muted">
              Window {formatWindow(stop.windowOpen, stop.windowClose)} · plan arrive {formatClock(stop.plannedArrivalAt)}
            </p>
          </div>
          <StatusBadge status={stop.status} />
        </div>
        <p className="mt-3 text-sm text-muted">{STOP_STATUS_HINT[stop.status]}</p>
      </header>

      {stop.accessNote && (
        <section
          aria-label="Access note"
          className="mt-4 rounded-[var(--radius-card)] border border-line bg-raised p-4 text-sm text-ink"
        >
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">Access note</p>
          <p className="mt-1">{stop.accessNote}</p>
        </section>
      )}

      {stop.orders && stop.orders.length > 0 && (
        <section aria-label="Orders on this stop" className="mt-4">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">Orders ({stop.orders.length})</h2>
          <ul className="mt-2 flex flex-col gap-2">
            {stop.orders.map((order) => (
              <li
                key={order.orderId}
                className="flex items-center justify-between rounded-[var(--radius-card)] border border-line bg-surface p-3"
              >
                <span className="font-semibold text-ink">{order.orderRef}</span>
                <span className="tabular text-sm text-muted">
                  <span className="font-semibold text-ink">{order.expectedUnits}</span> units
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-muted">
            Total expected on this stop: <span className="tabular font-semibold text-ink">{totalExpectedUnits}</span> units.
          </p>
        </section>
      )}

      {reasonsFromFallback && (
        <p
          role="status"
          className="mt-4 rounded-[var(--radius-control)] border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900"
        >
          Reason list is temporarily unreachable; this phone is using a local fallback. Reload once the signal returns to
          pick up any updates.
        </p>
      )}

      <section
        aria-labelledby="action-heading"
        className="mt-6 rounded-[var(--radius-card)] border border-line bg-surface p-5"
      >
        <h2 id="action-heading" className="text-xs font-semibold uppercase tracking-wide text-muted">
          Next action
        </h2>
        <p className="mt-1 text-lg font-semibold text-ink">{action.label}</p>
        <div className="mt-4">
          {action.kind === "arrive" && <ArrivalForm stopId={stop.id} disabled={false} />}
          {action.kind === "unload" && <UnloadForm stopId={stop.id} disabled={false} />}
          {action.kind === "complete" && (
            <DeliveryForm stopId={stop.id} orders={stop.orders ?? []} disabled={false} />
          )}
          {action.kind === "none" && (
            <p className="text-sm text-muted">This stop is closed. The record above shows the outcome.</p>
          )}
        </div>
      </section>

      {canReportProblem && (
        <section
          aria-labelledby="problem-heading"
          className="mt-4 rounded-[var(--radius-card)] border border-red-200 bg-red-50/50 p-5"
        >
          <h2 id="problem-heading" className="text-xs font-semibold uppercase tracking-wide text-critical">
            Something wrong?
          </h2>
          <p className="mt-1 text-sm text-ink">
            Report a problem to close this stop as failed. Pick the closest reason — the dispatcher takes the follow-up
            from there.
          </p>
          <div className="mt-3">
            <ProblemForm stopId={stop.id} reasons={reasons} disabled={false} />
          </div>
        </section>
      )}

      <nav
        aria-label="Stop navigation"
        className="mt-6 flex flex-wrap gap-3 border-t border-line pt-4 text-sm"
      >
        {previous ? (
          <Link
            href={`/driver/stops/${encodeURIComponent(previous.stop.id)}`}
            className="inline-flex min-h-11 items-center rounded-[var(--radius-control)] border border-line bg-surface px-4 font-semibold text-ink hover:bg-raised"
          >
            ← Stop {stopNumber(previous.stop.seq)}
          </Link>
        ) : (
          <span />
        )}
        {next ? (
          <Link
            href={`/driver/stops/${encodeURIComponent(next.stop.id)}`}
            className="ml-auto inline-flex min-h-11 items-center rounded-[var(--radius-control)] border border-line bg-surface px-4 font-semibold text-ink hover:bg-raised"
          >
            Stop {stopNumber(next.stop.seq)} →
          </Link>
        ) : (
          <span className="ml-auto" />
        )}
      </nav>
    </main>
  );
}

function StatusBadge({ status }: { status: StopStatus }) {
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

function StopError({ title, detail, expired }: { title: string; detail: string; expired: boolean }) {
  return (
    <main className="mx-auto max-w-xl p-4">
      <nav aria-label="Breadcrumb" className="text-sm text-muted">
        <Link href="/driver" className="hover:underline">
          Today&apos;s run
        </Link>
        <span aria-hidden> › </span>
        <span className="text-ink">Stop</span>
      </nav>
      <section
        role={expired ? "status" : "alert"}
        aria-live="polite"
        className="mt-4 rounded-[var(--radius-card)] border border-line bg-surface p-5"
      >
        <h1 className="text-2xl font-semibold text-critical">{title}</h1>
        <p className="mt-2 text-sm text-muted">{detail}</p>
        <div className="mt-4">
          <Link
            href="/driver"
            className="inline-flex min-h-11 min-w-32 items-center justify-center rounded-[var(--radius-control)] bg-action px-4 font-semibold text-ink hover:brightness-95"
          >
            Today&apos;s run
          </Link>
        </div>
      </section>
    </main>
  );
}
