import Link from "next/link";
import type { components } from "@katapatha/contracts/types";
import { ButtonLink } from "@/components/ui/button";
import { ErrorPanel } from "@/components/ui/states";
import { StatusPill } from "@/components/ui/status-pill";
import { api } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { dateParam, isDateOnly, longDate, todayInColombo } from "@/lib/dates";
import { readFailure } from "@/lib/failures";
import { plural } from "@/lib/format";
import { ConnectivityBanner } from "./connectivity";
import { TripHeader } from "./driver-header";
import { CheckGlyph, ClipboardGlyph, ClockGlyph, PinGlyph, WarningGlyph } from "./glyphs";
import { driverHref, formatClock, formatWindow, stopNumber } from "./format";
import { PositionShareCard } from "./position-control";
import { ReleaseButton } from "./release-button";
import {
  STOP_STATUS_TONE,
  isTerminal,
  primaryAction,
  selectTrip,
  stopPillLabel,
  stopsProgress,
  type StopStatus,
} from "./stop-state";
import { ThumbBar } from "./thumb-bar";
import { VehicleClaimForm } from "./vehicle-form";

export const dynamic = "force-dynamic";

type Stop = components["schemas"]["Stop"];

export default async function DriverRunPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string | string[]; trip?: string | string[] }>;
}) {
  const query = await searchParams;
  await requireRole("DRIVER", "/driver");

  // An explicit ?date= is kept on every link; without one the page means today.
  const explicitDate = typeof query.date === "string" && isDateOnly(query.date) ? query.date : null;
  const date = dateParam(query.date, todayInColombo());
  const requestedTrip = typeof query.trip === "string" && /^\d+$/.test(query.trip) ? Number(query.trip) : null;

  const client = await api();
  const result = await client.GET("/drivers/me/run", { params: { query: { date } } });

  if (result.response.status === 403) {
    // 403 on this endpoint means "no vehicle claimed yet", not "not allowed".
    return (
      <main className="mx-auto w-full max-w-xl p-4">
        <ConnectivityBanner />
        <section className="mt-4 flex flex-col gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-ink">Claim a vehicle to start</h1>
            <p className="mt-2 text-sm text-muted">
              The depot allocator publishes a run against a vehicle, not a person. Enter the vehicle id from the dock
              card to see your stops.
            </p>
          </div>
          <VehicleClaimForm />
        </section>
      </main>
    );
  }

  if (result.error || !result.data) {
    const failure = readFailure(result.response.status, "your run");
    return (
      <main className="mx-auto w-full max-w-xl p-4">
        <ErrorPanel
          title={failure.title}
          detail={failure.detail}
          outcome="read"
          action={<ButtonLink href={driverHref("/driver", { date: explicitDate })} variant="primary">Reload</ButtonLink>}
        />
      </main>
    );
  }

  const run = result.data;
  const trip = selectTrip(run.trips, requestedTrip);
  const stops: Stop[] = trip?.stops ?? [];
  const progress = stopsProgress(stops);
  const next = progress.nextIndex === null ? null : stops[progress.nextIndex]!;
  const subtitle = `${longDate(date)} · ${plural(run.trips.length, "trip")}`;

  return (
    <>
      <TripHeader
        vehicleId={run.vehicleId}
        subtitle={subtitle}
        trips={run.trips.map((t) => ({
          tripNo: t.tripNo,
          href: driverHref("/driver", { date: explicitDate, trip: t.tripNo }),
          current: t.tripNo === trip?.tripNo,
        }))}
        done={progress.done}
        total={progress.total}
      />

      <main className="mx-auto flex w-full max-w-xl flex-col gap-4 p-4 pb-44">
        <ConnectivityBanner />

        {next ? <NextStopCallout stop={next} /> : null}

        <PositionShareCard />

        {stops.length === 0 ? (
          <section className="rounded-card border border-dashed border-line bg-surface p-6 text-center">
            <h2 className="font-semibold text-ink">No stops on this trip</h2>
            <p className="mx-auto mt-2 max-w-sm text-sm text-muted">
              The dispatcher may still be publishing the plan, or every order on this vehicle has been deferred to
              another day.
            </p>
          </section>
        ) : (
          <section aria-labelledby="stops-heading">
            <h2 id="stops-heading" className="text-lg font-bold text-ink">
              Stops on this trip ({stops.length})
            </h2>
            <ol className="mt-3 flex flex-col gap-3">
              {stops.map((stop, index) => (
                <li key={stop.id}>
                  <StopCard stop={stop} isNext={index === progress.nextIndex} date={explicitDate} />
                </li>
              ))}
            </ol>
          </section>
        )}

        {next ? (
          <section aria-label="Vehicle" className="flex flex-col gap-2 border-t border-line pt-4">
            <p className="text-sm text-muted">Handing {run.vehicleId} to another driver? Change the vehicle first.</p>
            <ReleaseButton />
          </section>
        ) : null}
      </main>

      <ThumbBar>
        {next ? (
          <>
            <ButtonLink
              href={driverHref(`/driver/stops/${encodeURIComponent(next.id)}`, { date: explicitDate })}
              variant="primary"
              className="min-h-12 min-w-0 flex-1 text-base"
            >
              <span className="truncate">
                {primaryAction(next.status).label} · {next.outletId}
              </span>
              <span aria-hidden>→</span>
            </ButtonLink>
          </>
        ) : (
          <div className="flex w-full flex-col gap-2">
            <p className="text-sm text-muted">
              {stops.length === 0 ? "Nothing to do on this trip." : "Every stop on this trip is closed."}
            </p>
            <ReleaseButton prominent />
          </div>
        )}
      </ThumbBar>
    </>
  );
}

function NextStopCallout({ stop }: { stop: Stop }) {
  return (
    <section aria-label="Next stop" className="flex items-center gap-3 rounded-card border border-info/25 bg-info-surface p-4">
      <span className="grid size-11 shrink-0 place-items-center rounded-full bg-surface text-info-ink">
        <ClockGlyph className="h-6 w-6" />
      </span>
      <div className="min-w-0">
        <p className="text-xs text-muted">Next stop</p>
        <p className="truncate text-lg font-bold text-ink">{stop.outletName ?? stop.outletId}</p>
        <p className="tabular text-sm text-muted">
          Planned arrival {formatClock(stop.plannedArrivalAt)} · window {formatWindow(stop.windowOpen, stop.windowClose)}
        </p>
      </div>
    </section>
  );
}

function StopMarker({ status, isNext, seq }: { status: StopStatus; isNext: boolean; seq: number }) {
  if (status === "DONE") {
    return (
      <span className="grid size-10 shrink-0 place-items-center rounded-full bg-good text-white">
        <CheckGlyph className="h-5 w-5" />
        <span className="sr-only">Delivered</span>
      </span>
    );
  }
  if (status === "FAILED") {
    return (
      <span className="grid size-10 shrink-0 place-items-center rounded-full bg-bad text-white">
        <WarningGlyph className="h-5 w-5" />
        <span className="sr-only">Failed</span>
      </span>
    );
  }
  return (
    <span
      className={`tabular grid size-10 shrink-0 place-items-center rounded-full text-base font-bold ${
        isNext || status === "ARRIVED" || status === "UNLOADING" ? "bg-action text-navy" : "bg-raised text-muted"
      }`}
    >
      {stopNumber(seq)}
    </span>
  );
}

function StopCard({ stop, isNext, date }: { stop: Stop; isNext: boolean; date: string | null }) {
  const href = driverHref(`/driver/stops/${encodeURIComponent(stop.id)}`, { date });
  const orders = stop.orders ?? [];
  const tone = STOP_STATUS_TONE[stop.status];
  const open = !isTerminal(stop.status);
  const summary = (
    <div className="flex items-start gap-3">
      <StopMarker status={stop.status} isNext={isNext} seq={stop.seq} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-lg font-bold text-ink">{stop.outletName ?? stop.outletId}</p>
        <p className="tabular flex flex-wrap items-center gap-x-3 text-sm text-muted">
          <span className="inline-flex items-center gap-1">
            <ClockGlyph /> {formatClock(stop.plannedArrivalAt)}
          </span>
          {stop.accessNote ? (
            <span className="inline-flex min-w-0 items-center gap-1">
              <PinGlyph className="h-4 w-4 shrink-0" />
              <span className="truncate">{stop.accessNote}</span>
            </span>
          ) : null}
        </p>
        <p className="tabular text-sm text-muted">
          Window {formatWindow(stop.windowOpen, stop.windowClose)} · {plural(orders.length, "order")}
        </p>
      </div>
      <StatusPill label={stopPillLabel(stop.status, isNext)} tone={isNext && stop.status === "PENDING" ? "warn" : tone} />
    </div>
  );

  if (!isNext) {
    return (
      <Link
        href={href}
        className="block rounded-card border border-line bg-surface p-4 hover:border-navy focus-visible:border-navy"
      >
        {summary}
      </Link>
    );
  }

  return (
    <div className="overflow-hidden rounded-card border-2 border-action bg-surface">
      <Link href={href} className="block bg-warn-surface p-4">
        {summary}
      </Link>
      <div className="flex flex-col gap-3 p-3">
        {orders.map((order) => (
          <Link
            key={order.orderId}
            href={href}
            className="flex min-h-11 items-center gap-3 rounded-control border border-line px-3 py-2 hover:bg-raised"
          >
            <ClipboardGlyph className="h-5 w-5 text-muted" />
            <span className="min-w-0 flex-1">
              <span className="block font-bold text-ink">{order.orderRef}</span>
              <span className="tabular block text-sm text-muted">{order.expectedUnits} units on the vehicle</span>
            </span>
            <span aria-hidden className="text-muted">›</span>
          </Link>
        ))}
        {open ? (
          <ButtonLink href={driverHref(`/driver/stops/${encodeURIComponent(stop.id)}/problem`, { date })} variant="secondary" className="w-full">
            <WarningGlyph /> Report issue
          </ButtonLink>
        ) : null}
      </div>
    </div>
  );
}
