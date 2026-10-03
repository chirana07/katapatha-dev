import Link from "next/link";
import { redirect } from "next/navigation";
import { HOME_FOR_ROLE } from "@katapatha/core/domain/authPaths";
import { api } from "@/lib/api";
import { deferralReasonLabel } from "@katapatha/core/domain/deferral";
import { publishPlan } from "./actions";
import { DeferDrawer } from "./defer-drawer";

export const dynamic = "force-dynamic";

const ERRORS: Record<string, string> = {
  session: "Your session could not be verified. Try again.",
  unreachable: "The plan could not be reached. Reload before taking action.",
  stale: "This plan changed or is no longer available. Return to the planning desk for the latest draft.",
  already_published: "This draft has already been published or replaced. The current state is shown below.",
  validation_blocked: "Publication is blocked. Resolve every error below and validate the plan again.",
  publish_outcome_unknown: "The publish result could not be confirmed. The latest plan state is shown below. Retrying will not publish the plan twice.",
  deferrals_empty: "Pick a reason for every deferral before saving.",
  deferrals_rejected: "The server rejected one or more deferral reasons. Reload and try again.",
};

const DEFERRAL_FALLBACK = [
  "REEFER_FULL",
  "NO_VAN",
  "WINDOW_UNREACHABLE",
  "TIME_BUDGET",
  "FUEL_QUOTA",
  "VEHICLE_IN_WORKSHOP",
  "ORDER_TOO_LARGE",
  "AFTER_CUTOFF",
] as const;

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
  searchParams: Promise<{ error?: string; notice?: string; retry?: string; defer?: string }>;
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
  let vocab;
  try {
    [plan, validation, vocab] = await Promise.all([
      client.GET("/plans/{planId}", { params: { path: { planId } } }),
      client.GET("/plans/{planId}/validation", { params: { path: { planId }, query: { stage: "publish" } } }),
      client.GET("/reference/vocabularies", {}),
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

  const deferrals = Array.isArray(plan.data.deferrals) ? plan.data.deferrals : [];
  const pendingDeferralCount = deferrals.filter((d) => !d.reasonCode).length;
  const deferralReasons: string[] =
    (vocab.data?.deferralReasons as string[] | undefined) ?? [...DEFERRAL_FALLBACK];

  // ?defer=<assignmentId> opens the D-05 drawer for that deferral.
  const openDeferral = query.defer ? deferrals.find((d) => d.assignmentId === query.defer) : undefined;
  let alternatives = null;
  let alternativesFailed = false;
  if (openDeferral && !openDeferral.cause?.permanent) {
    try {
      const alt = await client.GET("/plans/{planId}/deferrals/{assignmentId}/alternatives", {
        params: { path: { planId, assignmentId: openDeferral.assignmentId } },
      });
      alternatives = alt.data ?? null;
      alternativesFailed = !alt.data;
    } catch {
      alternativesFailed = true;
    }
  }

  const totalWeight = plan.data.trips.reduce((s, t) => s + (t.sumWeightKg ?? 0), 0);
  const totalVolume = plan.data.trips.reduce((s, t) => s + (t.sumVolumeM3 ?? 0), 0);
  const servedPct = plan.data.stats.orders > 0 ? Math.round((plan.data.stats.served / plan.data.stats.orders) * 100) : 0;

  return (
    <main className="mx-auto w-full max-w-7xl p-4 sm:p-6 lg:p-8">
      <Link href={plan.data.date ? `/dispatcher?date=${plan.data.date}` : "/dispatcher"} className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-muted hover:text-ink">
        <span aria-hidden>←</span> Planning desk
      </Link>
      <header className="mt-3 flex flex-wrap items-end justify-between gap-4 border-b border-line pb-5">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">Plan review</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">Planning</h1>
          <p className="mt-2 max-w-xl text-sm text-muted">
            Build and optimize vehicle routes based on orders, constraints and delivery windows.
          </p>
          <p className="mt-2 font-mono text-xs text-muted">{plan.data.planId}</p>
        </div>
        <PlanStatus status={plan.data.status} />
      </header>

      {query.notice === "published" ? <Banner title="Plan published" detail="The final trips are now available to dock and driver teams." tone="success" /> : null}
      {query.notice === "deferrals_saved" ? <Banner title="Deferral reasons saved" detail={pendingDeferralCount === 0 ? "Every deferral now carries a reason. The publication gate is open." : `${pendingDeferralCount} deferral${pendingDeferralCount === 1 ? "" : "s"} still need a reason.`} tone="success" /> : null}
      {query.error ? <Banner title="Plan needs attention" detail={ERRORS[query.error] ?? "The request could not be completed. Reload and try again."} tone="error" /> : null}

      <section aria-label="Plan summary" className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard icon="orders" value={plan.data.stats.orders} label="Total orders" detail="In the planning snapshot" accent="brand" />
        <KpiCard icon="check" value={plan.data.stats.served} label="Served" detail={`${servedPct}% of the queue allocated`} accent="success" />
        <KpiCard icon="alert" value={plan.data.stats.deferred} label="Deferred" detail={plan.data.stats.deferred ? "Need an operational reason" : "None today"} accent={plan.data.stats.deferred ? "danger" : "muted"} />
        <KpiCard icon="truck" value={plan.data.stats.tripsBuilt} label="Planned routes" detail={`${(totalWeight / 1000).toFixed(1)} t · ${totalVolume.toFixed(1)} m³`} accent="info" />
      </section>

      {deferrals.length > 0 ? (
        <section aria-labelledby="deferrals-heading" className="mt-6 rounded-[var(--radius-card)] border border-line bg-surface p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-3 border-b border-line pb-3">
            <div>
              <h2 id="deferrals-heading" className="text-lg font-semibold">Deferral decisions</h2>
              <p className="mt-1 text-sm text-muted">
                {pendingDeferralCount === 0
                  ? "Every deferral carries a reason. Publication can proceed when validation is clear."
                  : `${pendingDeferralCount} of ${deferrals.length} deferral${deferrals.length === 1 ? "" : "s"} still need a reason before the plan can be published.`}
              </p>
            </div>
            <span className={`inline-flex items-center gap-2 rounded-md px-3 py-1 text-sm font-semibold ${pendingDeferralCount === 0 ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-800"}`}>
              <span aria-hidden className="size-2 rounded-full bg-current" />
              {pendingDeferralCount === 0 ? "all confirmed" : "pending"}
            </span>
          </div>
          <ul className="mt-4 flex flex-col gap-2">
            {deferrals.map((row) => {
              const order = row.order;
              const isDraft = plan.data.status === "DRAFT";
              return (
                <li key={row.assignmentId} className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-control)] border border-line p-3">
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-ink">
                      {row.orderRef}
                      {order ? <BrandChip brand={order.brand} /> : null}
                      {row.cause?.permanent ? (
                        <span className="rounded-md bg-red-50 px-2 py-0.5 text-xs font-semibold text-[color:var(--c-ruby)]">No vehicle fits</span>
                      ) : null}
                    </p>
                    <p className="mt-0.5 text-xs text-muted">
                      {order
                        ? [order.outletId, order.outletName ?? order.districtName, `${order.units} units`, `${order.volumeM3} m³`].join(" · ")
                        : row.orderId}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-md px-2 py-1 text-xs font-semibold ${row.reasonCode ? "border border-emerald-200 bg-emerald-50 text-emerald-700" : "border border-amber-200 bg-amber-50 text-amber-900"}`}>
                      <span aria-hidden className="size-1.5 rounded-full bg-current" />
                      {row.reasonCode ? deferralReasonLabel(row.reasonCode) : "Needs reason"}
                    </span>
                    <Link
                      href={`${home}?defer=${encodeURIComponent(row.assignmentId)}`}
                      scroll={false}
                      className="inline-flex min-h-11 items-center rounded-[var(--radius-control)] border border-line px-3 text-sm font-semibold text-ink hover:bg-raised"
                    >
                      {isDraft ? (row.reasonCode ? "Review" : "Choose reason") : "View"}
                    </Link>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

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
                  <div className="flex items-start gap-3">
                    <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-action/15 text-[color:var(--c-navy)]">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5" aria-hidden>
                        <path d="M3 7h11v9H3z" /><path d="M14 10h4l2 3v3h-6" /><circle cx="7" cy="18.5" r="1.5" /><circle cx="17" cy="18.5" r="1.5" />
                      </svg>
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-lg font-semibold text-ink">{trip.vehicleId}</h3>
                        <span className="inline-flex rounded-md bg-blue-50 px-2 py-0.5 text-xs font-semibold text-link">Trip {trip.tripNo}</span>
                        <BrandChip brand={trip.brand} />
                      </div>
                      <p className="mt-1 flex items-center gap-1.5 text-sm text-muted">
                        <span>Peliyagoda DC</span>
                        <span aria-hidden>→</span>
                        <span className="font-semibold text-ink">{trip.districtName}</span>
                      </p>
                    </div>
                    <TripStatusChip status={trip.status} />
                  </div>
                  <dl className="mt-4 grid grid-cols-3 gap-3 border-t border-line pt-4 text-xs">
                    <IconStat icon="clock" label="Depart" value={trip.plannedDepartAt ?? "—"} />
                    <IconStat icon="duration" label="Duration" value={minutes(trip.plannedMinutes)} />
                    <IconStat icon="wave" label="Wave" value={trip.wave.charAt(0) + trip.wave.slice(1).toLowerCase()} />
                    <IconStat icon="weight" label="Weight" value={trip.sumWeightKg != null ? `${trip.sumWeightKg.toFixed(0)} kg` : "—"} />
                    <IconStat icon="volume" label="Volume" value={trip.sumVolumeM3 != null ? `${trip.sumVolumeM3.toFixed(1)} m³` : "—"} />
                    <IconStat icon="route" label="Status" value={trip.status.charAt(0) + trip.status.slice(1).toLowerCase()} />
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
                <p className="mt-2 text-sm text-muted">{check.violations.length ? `${check.violations.length} validation item${check.violations.length === 1 ? "" : "s"} require${check.violations.length === 1 ? "s" : ""} review.` : "No validation issues were found."}</p>
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

      {openDeferral ? (
        <DeferDrawer
          planId={plan.data.planId}
          deferral={openDeferral}
          alternatives={alternatives}
          alternativesFailed={alternativesFailed}
          error={query.error ? (ERRORS[query.error] ?? "The request could not be completed. Reload and try again.") : null}
          allReasons={deferralReasons}
          closeHref={home}
          readOnly={plan.data.status !== "DRAFT"}
        />
      ) : null}
    </main>
  );
}

function KpiIcon({ kind }: { kind: "orders" | "check" | "alert" | "truck" }) {
  const common = "h-5 w-5";
  if (kind === "orders")
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className={common} aria-hidden>
        <rect x="4" y="3" width="16" height="18" rx="2" /><path d="M8 7h8M8 11h8M8 15h5" />
      </svg>
    );
  if (kind === "check")
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={common} aria-hidden>
        <circle cx="12" cy="12" r="9" /><path d="M8 12l3 3 5-6" />
      </svg>
    );
  if (kind === "alert")
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className={common} aria-hidden>
        <circle cx="12" cy="12" r="9" /><path d="M12 7v6M12 16v.01" />
      </svg>
    );
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className={common} aria-hidden>
      <path d="M3 7h11v9H3z" /><path d="M14 10h4l2 3v3h-6" /><circle cx="7" cy="18.5" r="1.5" /><circle cx="17" cy="18.5" r="1.5" />
    </svg>
  );
}

function KpiCard({
  icon,
  value,
  label,
  detail,
  accent = "brand",
}: {
  icon: "orders" | "check" | "alert" | "truck";
  value: number | string;
  label: string;
  detail: string;
  accent?: "brand" | "success" | "danger" | "info" | "muted";
}) {
  const iconBg =
    accent === "success"
      ? "bg-emerald-50 text-emerald-700"
      : accent === "danger"
        ? "bg-red-50 text-[color:var(--c-ruby)]"
        : accent === "info"
          ? "bg-blue-50 text-link"
          : accent === "muted"
            ? "bg-raised text-muted"
            : "bg-action/15 text-[color:var(--c-navy)]";
  return (
    <article className="rounded-[var(--radius-card)] border border-line bg-surface p-4">
      <div className="flex items-start gap-3">
        <span className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md ${iconBg}`}>
          <KpiIcon kind={icon} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="tabular text-2xl font-semibold text-ink">{value}</p>
          <p className="text-sm text-muted">{label}</p>
        </div>
      </div>
      <p className="mt-3 text-xs text-muted">{detail}</p>
    </article>
  );
}

function BrandChip({ brand }: { brand: string }) {
  const label = brand.charAt(0).toUpperCase() + brand.slice(1).toLowerCase();
  const style =
    brand.toLowerCase() === "fresh"
      ? "bg-emerald-50 text-emerald-700 border-emerald-200"
      : brand.toLowerCase() === "style"
        ? "bg-red-50 text-[color:var(--c-ruby)] border-red-200"
        : brand.toLowerCase() === "tech"
          ? "bg-blue-50 text-link border-blue-200"
          : "bg-raised text-muted border-line";
  return (
    <span className={`inline-flex rounded-md border px-2 py-0.5 text-xs font-semibold ${style}`}>{label}</span>
  );
}

function TripStatusChip({ status }: { status: string }) {
  const map: Record<string, string> = {
    PLANNED: "bg-raised text-ink border border-line",
    LOADING: "bg-amber-50 text-amber-900 border border-amber-200",
    READY: "bg-emerald-50 text-emerald-800 border border-emerald-200",
    DEPARTED: "bg-blue-50 text-blue-800 border border-blue-200",
    COMPLETED: "bg-blue-50 text-blue-800 border border-blue-200",
    CANCELLED: "bg-red-50 text-critical border border-red-200",
  };
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-md px-2 py-1 text-xs font-semibold ${map[status] ?? "bg-raised text-muted border border-line"}`}>
      {status.charAt(0) + status.slice(1).toLowerCase()}
    </span>
  );
}

function StatIcon({ kind }: { kind: "clock" | "route" | "duration" | "weight" | "volume" | "wave" }) {
  const common = "h-3.5 w-3.5 text-muted";
  if (kind === "clock" || kind === "duration")
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className={common} aria-hidden>
        <circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" />
      </svg>
    );
  if (kind === "route")
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className={common} aria-hidden>
        <circle cx="6" cy="19" r="2" /><circle cx="18" cy="5" r="2" /><path d="M8 19h8a4 4 0 0 0 0-8H8a4 4 0 0 1 0-8h8" />
      </svg>
    );
  if (kind === "weight")
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className={common} aria-hidden>
        <path d="M6 7h12l2 13H4z" /><path d="M10 7a2 2 0 1 1 4 0" />
      </svg>
    );
  if (kind === "volume")
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className={common} aria-hidden>
        <path d="M12 3l9 5v8l-9 5-9-5V8z" /><path d="M3 8l9 5 9-5" />
      </svg>
    );
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className={common} aria-hidden>
      <path d="M3 12c3 0 3-4 6-4s3 4 6 4 3-4 6-4" /><path d="M3 18c3 0 3-4 6-4s3 4 6 4 3-4 6-4" />
    </svg>
  );
}

function IconStat({ icon, label, value }: { icon: "clock" | "route" | "duration" | "weight" | "volume" | "wave"; label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-muted">
        <StatIcon kind={icon} />
        {label}
      </dt>
      <dd className="tabular font-semibold text-ink">{value}</dd>
    </div>
  );
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
