import Link from "next/link";
import { ButtonLink } from "@/components/ui/button";
import { OrderItems } from "@/components/ui/order-items";
import { Advisory, ErrorPanel } from "@/components/ui/states";
import { api } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { dateParam, isDateOnly, todayInColombo } from "@/lib/dates";
import { readFailure } from "@/lib/failures";
import { plural } from "@/lib/format";
import { ConnectivityBanner } from "../../connectivity";
import { StopHeader } from "../../driver-header";
import { CheckGlyph, WarningGlyph } from "../../glyphs";
import { driverHref, formatClock, formatWindow, stopNumber } from "../../format";
import {
  STOP_STATUS_HINT,
  STOP_STATUS_LABEL,
  isTerminal,
  primaryAction,
} from "../../stop-state";
import { ThumbBar } from "../../thumb-bar";
import { DeliveryFlow } from "./delivery-flow";
import { ArrivalForm, UnloadForm } from "./transition-forms";

export const dynamic = "force-dynamic";

type Params = Promise<{ stopId: string }>;
type Search = Promise<{ date?: string | string[]; view?: string | string[] }>;

/**
 * One stop. Which screen it is follows the stop's status, never a client flag:
 * not arrived and on site (R-02's next action), unloading (the three-step
 * delivery, R-07 and R-04), closed (R-09), and the failed-delivery screen
 * (R-11) at /problem.
 */
export default async function StopDetailPage({ params, searchParams }: { params: Params; searchParams: Search }) {
  const { stopId } = await params;
  const query = await searchParams;
  await requireRole("DRIVER", `/driver/stops/${stopId}`);

  const explicitDate = typeof query.date === "string" && isDateOnly(query.date) ? query.date : null;
  const date = dateParam(query.date, todayInColombo());

  const found = await loadStop(stopId, date);
  if (found.kind === "error") return <StopProblem title={found.title} detail={found.detail} runHref={driverHref("/driver", { date: explicitDate })} />;

  const { stop, tripNo, next, runHref, orders } = found;
  const href = (id: string) => driverHref(`/driver/stops/${encodeURIComponent(id)}`, { date: explicitDate });
  const total = orders.reduce((sum, order) => sum + order.expectedUnits, 0);
  const refs = orders.map((order) => order.orderRef).join(", ");
  const name = stop.outletName ?? stop.outletId;
  const title = `Stop ${stopNumber(stop.seq)} · ${name}`;
  const subtitle = [stop.accessNote, refs, `${total} units`].filter(Boolean).join(" · ");
  const action = primaryAction(stop.status);
  const reportHref = driverHref(`/driver/stops/${encodeURIComponent(stop.id)}/problem`, { date: explicitDate });
  const nextLink = next ? { href: href(next.id), label: `${next.outletName ?? next.outletId} · ${formatClock(next.plannedArrivalAt)}` } : null;

  if (action.kind === "complete") {
    return (
      <DeliveryFlow
        stopId={stop.id}
        orders={orders}
        title={title}
        subtitle={subtitle}
        detail={`Arrived · window ${formatWindow(stop.windowOpen, stop.windowClose)}`}
        runHref={runHref}
        reportHref={reportHref}
        next={nextLink}
      />
    );
  }

  const open = !isTerminal(stop.status);
  const reportLink = open ? (
    <ButtonLink href={reportHref} variant="secondary" className="min-h-12 shrink-0 whitespace-nowrap">
      <WarningGlyph /> Report issue
    </ButtonLink>
  ) : null;

  return (
    <>
      <StopHeader
        backHref={runHref}
        title={title}
        subtitle={subtitle}
        chip={{ label: STOP_STATUS_LABEL[stop.status], tone: stop.status === "DONE" ? "good" : stop.status === "FAILED" ? "bad" : "default" }}
        detail={`Trip ${tripNo} · window ${formatWindow(stop.windowOpen, stop.windowClose)} · planned arrival ${formatClock(stop.plannedArrivalAt)}`}
      />

      <main className="mx-auto flex w-full max-w-xl flex-col gap-4 p-4 pb-44">
        <ConnectivityBanner />

        {isTerminal(stop.status) ? (
          <div className="flex flex-col items-center gap-3 pt-2 text-center">
            <span
              className={`grid size-20 place-items-center rounded-full text-white ${stop.status === "DONE" ? "bg-good" : stop.status === "FAILED" ? "bg-bad" : "bg-muted"}`}
            >
              {stop.status === "DONE" ? <CheckGlyph className="h-10 w-10" /> : <WarningGlyph className="h-10 w-10" />}
            </span>
            <h2 className="text-2xl font-bold text-ink">
              {stop.status === "DONE" ? "Delivery recorded" : stop.status === "FAILED" ? "Delivery failed" : "Stop skipped"}
            </h2>
            <p className="text-sm text-muted">
              {stop.status === "DONE" ? "This stop is closed." : STOP_STATUS_HINT[stop.status]}
            </p>
          </div>
        ) : (
          <section aria-label="Where this stop is" className="rounded-card border border-line bg-surface p-4">
            <p className="font-bold text-ink">{action.label}</p>
            <p className="mt-1 text-sm text-muted">{STOP_STATUS_HINT[stop.status]}</p>
          </section>
        )}

        {stop.accessNote ? (
          <section aria-label="Access note" className="rounded-card border border-line bg-raised p-4 text-sm text-ink">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">Access note</p>
            <p className="mt-1">{stop.accessNote}</p>
          </section>
        ) : null}

        {orders.length > 0 ? (
          <section aria-label="Orders on this stop">
            <h2 className="text-lg font-bold text-ink">{plural(orders.length, "order")} on this stop</h2>
            <ul className="mt-2 flex flex-col gap-2">
              {orders.map((order) => (
                <li key={order.orderId} className="rounded-card border border-line bg-surface p-3">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-ink">{order.orderRef}</span>
                    <span className="tabular text-sm text-muted">
                      <span className="font-bold text-ink">{order.expectedUnits}</span> units
                    </span>
                  </div>
                  <OrderItems items={order.items} className="mt-2 border-t border-line pt-2" />
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {stop.status === "FAILED" || stop.status === "SKIPPED" ? (
          <Advisory>The reason is attached to this stop. The dispatcher decides the follow-up.</Advisory>
        ) : null}

        {next && isTerminal(stop.status) ? (
          <Link href={href(next.id)} className="flex items-center gap-3 rounded-card border border-line bg-surface p-4 hover:bg-raised">
            <span className="min-w-0 flex-1">
              <span className="block text-sm text-muted">Next stop</span>
              <span className="block truncate font-bold text-ink">{next.outletName ?? next.outletId}</span>
              <span className="tabular block text-sm text-muted">Planned {formatClock(next.plannedArrivalAt)}</span>
            </span>
            <span aria-hidden className="text-muted">›</span>
          </Link>
        ) : null}
      </main>

      {action.kind === "arrive" ? <ArrivalForm stopId={stop.id} secondary={reportLink} /> : null}
      {action.kind === "unload" ? <UnloadForm stopId={stop.id} secondary={reportLink} /> : null}
      {action.kind === "none" ? (
        <ThumbBar>
          <ButtonLink href={runHref} variant={next ? "secondary" : "primary"} className="min-h-12 flex-1 text-base">
            Back to the run
          </ButtonLink>
          {next ? (
            <ButtonLink href={href(next.id)} variant="primary" className="min-h-12 flex-[2] text-base">
              Go to next stop <span aria-hidden>→</span>
            </ButtonLink>
          ) : null}
        </ThumbBar>
      ) : null}
    </>
  );
}

async function loadStop(stopId: string, date: string) {
  const client = await api();
  const result = await client.GET("/drivers/me/run", { params: { query: { date } } });
  if (result.response.status === 403) {
    return {
      kind: "error" as const,
      title: "Claim a vehicle first",
      detail: "This stop belongs to a run that only shows up once you claim its vehicle.",
    };
  }
  if (result.error || !result.data) {
    const failure = readFailure(result.response.status, "this stop");
    return { kind: "error" as const, title: failure.title, detail: failure.detail };
  }

  const flat = result.data.trips.flatMap((trip) => trip.stops.map((stop) => ({ trip, stop })));
  const index = flat.findIndex((entry) => entry.stop.id === stopId);
  if (index === -1) {
    return {
      kind: "error" as const,
      title: "Stop not on this run",
      detail: "The stop may belong to a different vehicle or date, or has been removed from the plan.",
    };
  }
  const { trip, stop } = flat[index]!;
  // "Next" is the next open stop on the same trip, so a delivered stop does not point back at itself.
  const next = trip.stops.find((candidate) => candidate.seq > stop.seq && !isTerminal(candidate.status)) ?? null;
  return {
    kind: "ok" as const,
    stop,
    tripNo: trip.tripNo,
    next,
    orders: stop.orders ?? [],
    runHref: driverHref("/driver", { date: date === todayInColombo() ? null : date, trip: trip.tripNo }),
  };
}

function StopProblem({ title, detail, runHref }: { title: string; detail: string; runHref: string }) {
  return (
    <main className="mx-auto w-full max-w-xl p-4">
      <ErrorPanel
        title={title}
        detail={detail}
        outcome="read"
        action={<ButtonLink href={runHref} variant="primary">Back to the run</ButtonLink>}
      />
    </main>
  );
}
