import { ButtonLink } from "@/components/ui/button";
import { ErrorPanel } from "@/components/ui/states";
import { api } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { dateParam, isDateOnly, todayInColombo } from "@/lib/dates";
import { readFailure } from "@/lib/failures";
import { ConnectivityBanner } from "../../../connectivity";
import { StopHeader } from "../../../driver-header";
import { driverHref, formatClock, formatWindow, stopNumber } from "../../../format";
import { fetchProblemReasons } from "../../../reasons.server";
import { STOP_STATUS_LABEL, isTerminal } from "../../../stop-state";
import { ProblemForm } from "../problem-form";

export const dynamic = "force-dynamic";

/**
 * R-11, Failed delivery: what stopped it, and one red action. The API has no
 * call or wait log, so the design's "Called OUT075 / Waited at outlet" block is
 * not here, and "What happens next" says only what the system actually does:
 * the stop closes as failed with the reason, and the dispatcher decides the
 * follow-up. It does not promise a re-run or a return trip.
 */
export default async function FailedDeliveryPage({
  params,
  searchParams,
}: {
  params: Promise<{ stopId: string }>;
  searchParams: Promise<{ date?: string | string[] }>;
}) {
  const { stopId } = await params;
  const query = await searchParams;
  await requireRole("DRIVER", `/driver/stops/${stopId}/problem`);

  const explicitDate = typeof query.date === "string" && isDateOnly(query.date) ? query.date : null;
  const date = dateParam(query.date, todayInColombo());
  const stopHref = driverHref(`/driver/stops/${encodeURIComponent(stopId)}`, { date: explicitDate });
  const runHref = driverHref("/driver", { date: explicitDate });

  const client = await api();
  const result = await client.GET("/drivers/me/run", { params: { query: { date } } });
  if (result.error || !result.data) {
    const failure = readFailure(result.response.status, "this stop");
    return (
      <main className="mx-auto w-full max-w-xl p-4">
        <ErrorPanel
          title={result.response.status === 403 ? "Claim a vehicle first" : failure.title}
          detail={failure.detail}
          outcome="read"
          action={<ButtonLink href={runHref} variant="primary">Back to the run</ButtonLink>}
        />
      </main>
    );
  }

  const entry = result.data.trips.flatMap((trip) => trip.stops).find((stop) => stop.id === stopId);
  if (!entry) {
    return (
      <main className="mx-auto w-full max-w-xl p-4">
        <ErrorPanel
          title="Stop not on this run"
          detail="The stop may belong to a different vehicle or date, or has been removed from the plan."
          outcome="read"
          action={<ButtonLink href={runHref} variant="primary">Back to the run</ButtonLink>}
        />
      </main>
    );
  }

  const { reasons, fallback } = await fetchProblemReasons();
  const units = (entry.orders ?? []).reduce((sum, order) => sum + order.expectedUnits, 0);
  const name = entry.outletName ?? entry.outletId;

  if (isTerminal(entry.status)) {
    return (
      <>
        <StopHeader backHref={stopHref} title={`Stop ${stopNumber(entry.seq)} · ${name}`} subtitle={`${units} units`} chip={{ label: STOP_STATUS_LABEL[entry.status] }} />
        <main className="mx-auto w-full max-w-xl p-4">
          {/* Landing here right after reporting is the normal case: the action re-renders this page. */}
          {entry.status === "FAILED" ? (
            <div role="status" className="rounded-card border border-bad/25 bg-bad-surface p-5">
              <p className="font-semibold text-bad-ink">Failed delivery recorded</p>
              <p className="mt-1 text-sm text-ink">The stop is closed as failed. The dispatcher sees the reason and decides the follow-up.</p>
              <div className="mt-4">
                <ButtonLink href={runHref} variant="primary">Back to the run</ButtonLink>
              </div>
            </div>
          ) : (
            <ErrorPanel
              title="This stop is already closed"
              detail="A closed stop cannot be reported as failed."
              outcome="read"
              action={<ButtonLink href={stopHref} variant="primary">Back to the stop</ButtonLink>}
            />
          )}
        </main>
      </>
    );
  }

  return (
    <>
      <StopHeader
        backHref={stopHref}
        title={`Stop ${stopNumber(entry.seq)} · ${name}`}
        subtitle={[entry.accessNote, `${units} units`].filter(Boolean).join(" · ")}
        chip={{ label: "Can't deliver", tone: "bad" }}
        detail={`Window ${formatWindow(entry.windowOpen, entry.windowClose)} · planned arrival ${formatClock(entry.plannedArrivalAt)}`}
      />
      <main className="mx-auto flex w-full max-w-xl flex-col gap-4 p-4 pb-44">
        <ConnectivityBanner />
        {fallback ? (
          <p role="status" className="rounded-card border border-warn/30 bg-warn-surface px-4 py-3 text-sm text-ink">
            The reason list could not be loaded, so this page is using a built-in list. Reload once you have a connection
            to pick up any change.
          </p>
        ) : null}
        <ProblemForm
          stopId={entry.id}
          reasons={reasons}
          secondary={
            <ButtonLink href={stopHref} variant="secondary" className="min-h-12 w-28 shrink-0">
              Back
            </ButtonLink>
          }
        />
        <section className="rounded-card border border-info/25 bg-info-surface p-4">
          <h2 className="font-bold text-info-ink">What happens next</h2>
          <p className="mt-1 text-sm text-ink">
            This closes the stop as failed, with the reason you pick. The dispatcher sees it and decides what happens to
            the {units} units.
          </p>
        </section>
      </main>
    </>
  );
}
