import Link from "next/link";
import { redirect } from "next/navigation";
import { HOME_FOR_ROLE } from "@katapatha/core/domain/authPaths";
import { api } from "@/lib/api";
import { publishPlan } from "./actions";

export const dynamic = "force-dynamic";

const ERRORS: Record<string, string> = {
  session: "Your session could not be verified. Try again.",
  unreachable: "The plan could not be reached. Reload before taking action.",
  stale: "This plan changed or is no longer available. Return to the planning desk for the latest draft.",
  already_published: "This draft has already been published or replaced. The current state is shown below.",
  validation_blocked: "Publication is blocked. Resolve every error below and validate the plan again.",
  publish_outcome_unknown: "The publish result could not be confirmed. The latest plan state is shown below. Retrying will not publish the plan twice.",
};

function validUuid(value: string | undefined) {
  return Boolean(value && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value));
}

function minutes(value?: number) {
  if (value === undefined) return "Not set";
  const hours = Math.floor(value / 60);
  const rest = value % 60;
  return hours ? `${hours}h ${rest}m` : `${rest}m`;
}

export default async function PlanPage({
  params,
  searchParams,
}: {
  params: Promise<{ planId: string }>;
  searchParams: Promise<{ error?: string; notice?: string; retry?: string }>;
}) {
  const { planId } = await params;
  const query = await searchParams;
  const home = `/dispatcher/plans/${encodeURIComponent(planId)}`;
  let client;
  let me;
  try {
    client = await api();
    me = await client.GET("/auth/me");
  } catch {
    return <ReadFailure />;
  }
  if (me.response.status === 401) redirect(`/sign-in?next=${encodeURIComponent(home)}`);
  if (me.error || !me.data) return <ReadFailure />;
  if (me.data.role !== "DISPATCHER") redirect(HOME_FOR_ROLE[me.data.role]);

  let plan;
  let validation;
  try {
    [plan, validation] = await Promise.all([
      client.GET("/plans/{planId}", { params: { path: { planId } } }),
      client.GET("/plans/{planId}/validation", { params: { path: { planId }, query: { stage: "publish" } } }),
    ]);
  } catch {
    return <ReadFailure />;
  }
  if (plan.response.status === 401 || validation.response.status === 401) redirect(`/sign-in?next=${encodeURIComponent(home)}`);
  if (plan.response.status === 403 || validation.response.status === 403) redirect("/dispatcher?error=forbidden");
  if (plan.response.status === 404) return <ReadFailure title="Plan not found" detail="This plan is no longer available. Return to the planning desk for the current plan." />;
  if (plan.error || !plan.data) return <ReadFailure />;

  const check = validation.error || !validation.data ? null : validation.data;
  const requestId = validUuid(query.retry) ? query.retry! : crypto.randomUUID();
  const canPublish = plan.data.status === "DRAFT" && Boolean(check && !check.blocking);

  return (
    <main className="mx-auto w-full max-w-7xl p-4 sm:p-6 lg:p-8">
      <Link href="/dispatcher" className="inline-flex min-h-11 items-center text-sm font-semibold text-muted hover:text-ink">← Planning desk</Link>
      <header className="mt-3 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.12em] text-muted">Plan review</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">Delivery plan</h1>
          <p className="mt-2 font-mono text-sm text-muted">{plan.data.planId}</p>
        </div>
        <PlanStatus status={plan.data.status} />
      </header>

      {query.notice === "published" ? <Banner title="Plan published" detail="The final trips are now available to dock and driver teams." tone="success" /> : null}
      {query.error ? <Banner title="Plan needs attention" detail={ERRORS[query.error] ?? "The request could not be completed. Reload and try again."} tone="error" /> : null}

      <section aria-label="Plan summary" className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="Orders" value={plan.data.stats.orders} detail="In the planning snapshot" />
        <Metric label="Served" value={plan.data.stats.served} detail="Assigned to delivery trips" />
        <Metric label="Deferred" value={plan.data.stats.deferred} detail="Require an operational reason" />
        <Metric label="Trips" value={plan.data.stats.tripsBuilt} detail="Built for dispatch" />
      </section>

      <section className="mt-6 grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div>
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="text-lg font-semibold">Trip board</h2>
            <span className="text-sm text-muted">{plan.data.trips.length} trips</span>
          </div>
          {plan.data.trips.length ? (
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              {plan.data.trips.map((trip) => (
                <article key={trip.id} className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div><p className="text-sm font-semibold text-muted">Trip {trip.tripNo}</p><h3 className="mt-1 text-lg font-semibold">{trip.vehicleId}</h3></div>
                    <span className="rounded-md bg-raised px-2 py-1 text-xs font-semibold capitalize">{trip.status.toLowerCase().replaceAll("_", " ")}</span>
                  </div>
                  <p className="mt-3 text-sm font-semibold">{trip.brand} · {trip.districtName}</p>
                  <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 border-t border-line pt-4 text-sm">
                    <Data label="Wave" value={trip.wave.toLowerCase()} />
                    <Data label="Departure" value={trip.plannedDepartAt ?? "Not set"} />
                    <Data label="Duration" value={minutes(trip.plannedMinutes)} />
                    <Data label="Weight" value={trip.sumWeightKg === undefined ? "Not set" : `${trip.sumWeightKg.toFixed(1)} kg`} />
                    <Data label="Volume" value={trip.sumVolumeM3 === undefined ? "Not set" : `${trip.sumVolumeM3.toFixed(1)} m³`} />
                  </dl>
                </article>
              ))}
            </div>
          ) : <div className="mt-3 rounded-[var(--radius-card)] border border-line bg-surface p-5 text-muted">No delivery trips were built for this plan.</div>}
        </div>

        <aside>
          <h2 className="text-lg font-semibold">Publication check</h2>
          <div className="mt-3 rounded-[var(--radius-card)] border border-line bg-surface p-5">
            {!check ? (
              <><p className="font-semibold text-critical">Validation unavailable</p><p className="mt-2 text-sm text-muted">Reload the plan before publishing. The current result cannot be verified.</p></>
            ) : (
              <>
                <p className={`font-semibold ${check.blocking ? "text-critical" : "text-emerald-700"}`}>{check.blocking ? "Blocked from publication" : "Ready to publish"}</p>
                <p className="mt-2 text-sm text-muted">{check.violations.length ? `${check.violations.length} validation item${check.violations.length === 1 ? "" : "s"} require review.` : "No validation issues were found."}</p>
                {check.violations.length ? <ul className="mt-4 space-y-3 border-t border-line pt-4">{check.violations.map((item, index) => (
                  <li key={`${item.code}-${index}`} className="text-sm">
                    <p className={`font-semibold ${item.severity === "error" ? "text-critical" : "text-amber-800"}`}>{item.severity === "error" ? "Error" : "Warning"}: {item.code.replaceAll("_", " ").toLowerCase()}</p>
                    <p className="mt-1 text-muted">{item.message}</p>
                    {item.orderRef || item.tripId ? <p className="mt-1 font-mono text-xs text-muted">{[item.orderRef, item.tripId].filter(Boolean).join(" · ")}</p> : null}
                  </li>
                ))}</ul> : null}
              </>
            )}

            {plan.data.status === "DRAFT" ? (
              <form action={publishPlan} className="mt-5 border-t border-line pt-5">
                <input type="hidden" name="planId" value={plan.data.planId} />
                <input type="hidden" name="requestId" value={requestId} />
                <button type="submit" disabled={!canPublish} className="min-h-12 w-full rounded-[var(--radius-control)] bg-action px-5 font-semibold text-ink hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-45">Publish plan</button>
                <p className="mt-3 text-xs text-muted">Publishing commits this plan for dock and delivery operations.</p>
              </form>
            ) : <p className={`mt-5 border-t border-line pt-5 text-sm font-semibold ${plan.data.status === "PUBLISHED" ? "text-emerald-700" : "text-muted"}`}>{plan.data.status === "PUBLISHED" ? "This plan has been published." : "This plan has been replaced by a newer draft."}</p>}
          </div>
        </aside>
      </section>
    </main>
  );
}

function Metric({ label, value, detail }: { label: string; value: number; detail: string }) {
  return <article className="rounded-[var(--radius-card)] border border-line bg-surface p-4"><p className="text-sm text-muted">{label}</p><p className="tabular mt-1 text-3xl font-semibold">{value}</p><p className="mt-2 text-sm text-muted">{detail}</p></article>;
}

function Data({ label, value }: { label: string; value: string }) {
  return <div><dt className="text-muted">{label}</dt><dd className="mt-1 font-semibold capitalize">{value}</dd></div>;
}

function PlanStatus({ status }: { status: string }) {
  const style = status === "PUBLISHED" ? "bg-emerald-50 text-emerald-700" : status === "DRAFT" ? "bg-amber-50 text-amber-800" : "bg-raised text-muted";
  return <span className={`inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-semibold ${style}`}><span aria-hidden className="size-2 rounded-full bg-current" />{status.toLowerCase()}</span>;
}

function Banner({ title, detail, tone }: { title: string; detail: string; tone: "success" | "error" }) {
  const style = tone === "success" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-red-200 bg-red-50 text-critical";
  return <div role={tone === "error" ? "alert" : "status"} className={`mt-6 rounded-[var(--radius-card)] border p-4 ${style}`}><p className="font-semibold">{title}</p><p className="mt-1 text-sm text-muted">{detail}</p></div>;
}

function ReadFailure({ title = "Plan unavailable", detail = "The plan could not be loaded. No planning state was changed." }: { title?: string; detail?: string }) {
  return <main className="mx-auto max-w-3xl p-4 sm:p-6"><section className="rounded-[var(--radius-card)] border border-red-200 bg-red-50 p-5"><h1 className="text-xl font-semibold text-critical">{title}</h1><p className="mt-2 text-muted">{detail}</p><Link href="/dispatcher" className="mt-4 inline-flex min-h-11 items-center rounded-[var(--radius-control)] bg-action px-4 font-semibold text-ink">Return to planning desk</Link></section></main>;
}
