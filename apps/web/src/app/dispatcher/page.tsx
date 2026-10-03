import Link from "next/link";
import { redirect } from "next/navigation";
import { HOME_FOR_ROLE } from "@katapatha/core/domain/authPaths";
import { api } from "@/lib/api";
import { closeQueue, createPlan } from "./actions";

export const dynamic = "force-dynamic";

const STATUS_STYLE: Record<string, string> = {
  OPEN: "bg-blue-50 text-blue-700",
  CLOSED: "bg-amber-50 text-amber-800",
  PLANNING: "bg-amber-50 text-amber-800",
  PUBLISHED: "bg-emerald-50 text-emerald-700",
};

const ERRORS: Record<string, string> = {
  session: "Your session could not be verified. Try again.",
  depot: "Your dispatcher account is not assigned to a depot.",
  invalid_request: "The planning request was incomplete. Reload and try again.",
  forbidden: "This planning day is outside your depot access.",
  stale: "This planning day changed. The latest state is shown below.",
  unreachable: "Katapatha is temporarily unreachable. No planning state was changed.",
  close_outcome_unknown: "The close request could not be confirmed. The latest queue state is shown below; retrying close is safe.",
  queue_open: "Close the order queue before building a plan.",
  plan_invalid: "The queue could not produce a valid draft plan.",
  plan_outcome_unknown: "The plan request could not be confirmed. The latest state is shown below; retry uses the same request key.",
};

function todayInColombo() {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: "Asia/Colombo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function longDate(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function validUuid(value: string | undefined) {
  return Boolean(value && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value));
}

export default async function DispatcherPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; notice?: string; retry?: string; date?: string }>;
}) {
  let client;
  let me;
  try {
    client = await api();
    me = await client.GET("/auth/me");
  } catch {
    return <ReadFailure />;
  }
  if (me.response.status === 401) redirect("/sign-in?next=/dispatcher");
  if (me.error || !me.data) return <ReadFailure />;
  if (me.data.role !== "DISPATCHER") redirect(HOME_FOR_ROLE[me.data.role]);
  if (!me.data.depotCode) return <ReadFailure detail="This dispatcher account is not assigned to a depot." />;

  const query = await searchParams;
  const dateOverride = typeof query.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(query.date) ? query.date : null;
  const date = dateOverride ?? todayInColombo();
  const depotCode = me.data.depotCode;
  let days;
  let orders;
  let plans;
  try {
    [days, orders, plans] = await Promise.all([
      // Server derives depot from the signed-in dispatcher (see
      // apps/api/src/routes/planning.ts); the contract names a `depot` query
      // but the server rejects it as an additional property. Omit it until
      // the two agree.
      client.GET("/planning-days", { params: { query: { date } } }),
      client.GET("/orders", { params: { query: { date } } }),
      client.GET("/plans", { params: { query: { date } } }),
    ]);
  } catch {
    return <ReadFailure />;
  }
  if ([days, orders, plans].some((result) => result.response.status === 401)) {
    redirect("/sign-in?next=/dispatcher");
  }
  if (days.error || orders.error || plans.error || !days.data || !orders.data || !plans.data) {
    return <ReadFailure />;
  }

  const planRequestId = validUuid(query.retry) ? query.retry! : crypto.randomUUID();
  const day = days.data[0];
  const plan = day?.status === "PUBLISHED"
    ? plans.data.find((item) => item.status === "PUBLISHED") ?? plans.data[0]
    : plans.data.find((item) => item.status === "DRAFT") ?? plans.data[0];
  const chilled = orders.data.filter((order) => order.tempRequirement === "chilled").length;
  const waiting = orders.data.filter((order) => order.status === "QUEUED" || order.status === "PLACED").length;
  const totalVolume = orders.data.reduce((sum, order) => sum + (order.volumeM3 ?? 0), 0);
  const totalWeight = orders.data.reduce((sum, order) => sum + (order.weightKg ?? 0), 0);
  const deferredCount = orders.data.filter((order) => order.status === "DEFERRED").length;
  const cancelledCount = orders.data.filter((order) => order.status === "CANCELLED").length;
  const attentionCount = deferredCount + cancelledCount;
  const allocated = plan?.stats.served ?? 0;
  const allocatedPct = orders.data.length > 0 ? Math.round((allocated / orders.data.length) * 100) : 0;

  return (
    <main className="mx-auto w-full max-w-7xl p-4 sm:p-6 lg:p-8">
      <header className="flex flex-wrap items-end justify-between gap-4 border-b border-line pb-5">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">{depotCode} depot</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">Delivery operations</h1>
          <p className="mt-2 flex items-center gap-2 text-sm text-muted">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden>
              <rect x="3" y="4" width="18" height="17" rx="2" /><path d="M8 2v4M16 2v4M3 10h18" />
            </svg>
            {longDate(date)}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {day ? <StatusPill status={day.status} /> : null}
          {day?.status === "CLOSED" ? (
            <form action={createPlan}>
              <input type="hidden" name="date" value={day.date} />
              <input type="hidden" name="depotCode" value={day.depotCode} />
              <input type="hidden" name="requestId" value={planRequestId} />
              <button type="submit" className="inline-flex min-h-11 items-center gap-2 rounded-[var(--radius-control)] bg-action px-4 font-semibold text-ink hover:brightness-95">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden>
                  <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
                </svg>
                Generate plan
              </button>
            </form>
          ) : null}
        </div>
      </header>

      {query.notice ? <Notice kind={query.notice} /> : null}
      {query.error ? <ErrorBanner code={query.error} /> : null}

      {attentionCount > 0 && (
        <section className="mt-5 flex items-start gap-3 rounded-[var(--radius-card)] border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="mt-0.5 h-5 w-5 shrink-0 text-action" aria-hidden>
            <path d="M12 9v4M12 17v.01" /><path d="M10.3 3.7L2.6 17a2 2 0 0 0 1.7 3h15.4a2 2 0 0 0 1.7-3L13.7 3.7a2 2 0 0 0-3.4 0z" />
          </svg>
          <div>
            <p className="font-semibold">
              {attentionCount} order{attentionCount === 1 ? "" : "s"} need{attentionCount === 1 ? "s" : ""} your attention
            </p>
            <p className="mt-0.5 text-amber-900/80">
              {[deferredCount && `${deferredCount} deferred`, cancelledCount && `${cancelledCount} cancelled`]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </div>
        </section>
      )}

      <section aria-label="Queue summary" className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <KpiCard
          icon="orders"
          value={orders.data.length}
          label="Total orders"
          detail={`${waiting} waiting · ${orders.data.length - waiting} progressed`}
          accent="brand"
        />
        <KpiCard
          icon="check"
          value={allocated}
          label="Allocated"
          detail={plan ? `${allocatedPct}% of today's queue` : "Build a plan to allocate"}
          accent="success"
        />
        <KpiCard
          icon="alert"
          value={plan?.stats.deferred ?? deferredCount}
          label="Deferred"
          detail={plan?.stats.deferred ? "Need a reason before publish" : deferredCount ? "Returned to the queue" : "None today"}
          accent="danger"
        />
        <KpiCard
          icon="snow"
          value={chilled}
          label="Chilled"
          detail="Require refrigerated capacity"
          accent="info"
        />
        <KpiCard
          icon="box"
          value={`${totalVolume.toFixed(1)} m³`}
          label="Volume"
          detail={`${(totalWeight / 1000).toFixed(1)} t total weight`}
          accent="muted"
        />
      </section>

      <section className="mt-6 rounded-[var(--radius-card)] border border-line bg-surface p-5 sm:p-6">
        {!day ? (
          <div>
            <h2 className="text-xl font-semibold">No planning day found</h2>
            <p className="mt-2 text-muted">There is no operating day for this depot on {date}.</p>
          </div>
        ) : day.status === "OPEN" ? (
          <div className="flex flex-wrap items-center justify-between gap-5">
            <div>
              <p className="text-sm font-semibold text-muted">Next step</p>
              <h2 className="mt-1 text-xl font-semibold">Close today&apos;s order queue</h2>
              <p className="mt-2 max-w-2xl text-muted">Review the orders below. Closing at {day.cutoffAt} fixes the input used to build the plan.</p>
            </div>
            <form action={closeQueue}>
              <input type="hidden" name="planningDayId" value={day.id} />
              <button type="submit" className="min-h-12 rounded-[var(--radius-control)] bg-action px-5 font-semibold text-ink hover:brightness-95">Close order queue</button>
            </form>
          </div>
        ) : day.status === "CLOSED" ? (
          <div className="flex flex-wrap items-center justify-between gap-5">
            <div>
              <p className="text-sm font-semibold text-muted">Next step</p>
              <h2 className="mt-1 text-xl font-semibold">Build the delivery plan</h2>
              <p className="mt-2 max-w-2xl text-muted">The allocator will assign compatible vehicles, delivery windows, and depot capacity.</p>
            </div>
            <form action={createPlan}>
              <input type="hidden" name="date" value={day.date} />
              <input type="hidden" name="depotCode" value={day.depotCode} />
              <input type="hidden" name="requestId" value={planRequestId} />
              <button type="submit" className="min-h-12 rounded-[var(--radius-control)] bg-action px-5 font-semibold text-ink hover:brightness-95">Run auto-plan</button>
            </form>
          </div>
        ) : day.status === "PLANNING" ? (
          <div className="flex flex-wrap items-center justify-between gap-5">
            <div>
              <p className="text-sm font-semibold text-muted">Draft plan</p>
              <h2 className="mt-1 text-xl font-semibold">Review allocation results</h2>
              <p className="mt-2 max-w-2xl text-muted">{plan ? `${plan.stats.tripsBuilt} trips serve ${plan.stats.served} of ${plan.stats.orders} orders; ${plan.stats.deferred} require deferral decisions.` : "The draft is still being prepared."}</p>
              <p className="mt-2 text-sm text-muted">Running auto-plan again replaces the current draft.</p>
            </div>
            <div className="flex flex-wrap gap-3">
              {plan ? <Link href={`/dispatcher/plans/${encodeURIComponent(plan.planId)}`} className="inline-flex min-h-12 items-center rounded-[var(--radius-control)] bg-action px-5 font-semibold text-ink hover:brightness-95">Review draft plan</Link> : null}
              <form action={createPlan}>
                <input type="hidden" name="date" value={day.date} />
                <input type="hidden" name="depotCode" value={day.depotCode} />
                <input type="hidden" name="requestId" value={planRequestId} />
                <button type="submit" className="min-h-12 rounded-[var(--radius-control)] border border-line bg-surface px-5 font-semibold text-ink hover:bg-raised">Re-run auto-plan</button>
              </form>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-5">
            <div>
              <p className="text-sm font-semibold text-muted">Current plan</p>
              <h2 className="mt-1 text-xl font-semibold">{day.status === "PUBLISHED" ? "Plan published to the dock" : "Draft plan ready for review"}</h2>
              <p className="mt-2 text-muted">{plan ? `${plan.stats.tripsBuilt} trips serve ${plan.stats.served} of ${plan.stats.orders} orders; ${plan.stats.deferred} require deferral decisions.` : "Refresh when the plan has finished building."}</p>
            </div>
            {plan ? <Link href={`/dispatcher/plans/${encodeURIComponent(plan.planId)}`} className="inline-flex min-h-12 items-center rounded-[var(--radius-control)] border border-line bg-surface px-5 font-semibold text-ink hover:bg-raised">Open published plan</Link> : null}
          </div>
        )}
      </section>

      <section className="mt-6">
        <div className="flex flex-wrap items-end justify-between gap-3 pb-2">
          <div>
            <h2 id="daily-orders" className="text-lg font-semibold">Today&apos;s orders</h2>
            <p className="mt-0.5 text-sm text-muted">{orders.data.length} orders across every brand</p>
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-raised px-3 py-1 text-xs font-semibold text-muted">
            <span aria-hidden className="size-2 rounded-full bg-link" />
            Live from /orders
          </span>
        </div>
        <div className="mt-3 grid gap-3 md:hidden">
          {orders.data.map((order) => (
            <article key={order.id} className="rounded-[var(--radius-card)] border border-line bg-surface p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-mono font-semibold">{order.ref}</p>
                  <p className="mt-1 text-sm text-muted">{order.outletId} · {order.districtName ?? "District pending"}</p>
                </div>
                <OrderStatus status={order.status} />
              </div>
              <dl className="mt-4 grid grid-cols-3 gap-3 border-t border-line pt-4 text-sm">
                <div><dt className="text-muted">Brand</dt><dd className="mt-1"><BrandChip brand={order.brand} /></dd></div>
                <div><dt className="text-muted">Load</dt><dd className="mt-1 font-semibold capitalize">{order.tempRequirement}</dd></div>
                <div className="border-l border-line pl-3"><dt className="text-muted">Units</dt><dd className="tabular mt-1 font-semibold">{order.units}</dd></div>
              </dl>
            </article>
          ))}
        </div>
        <div aria-labelledby="daily-orders" className="mt-3 hidden overflow-x-auto rounded-[var(--radius-card)] border border-line bg-surface md:block">
          <table className="w-full min-w-[900px] text-left text-sm">
            <caption className="sr-only">Orders for {depotCode} on {date}</caption>
            <thead className="border-b border-line bg-raised text-xs uppercase tracking-wide text-muted">
              <tr>
                <th className="px-4 py-2.5">Order ref</th>
                <th className="px-4 py-2.5">Outlet</th>
                <th className="px-4 py-2.5">Brand</th>
                <th className="px-4 py-2.5 text-right">Items</th>
                <th className="px-4 py-2.5 text-right">Volume</th>
                <th className="px-4 py-2.5 text-right">Weight</th>
                <th className="px-4 py-2.5">Window</th>
                <th className="px-4 py-2.5">Status</th>
              </tr>
            </thead>
            <tbody>
              {orders.data.map((order) => (
                <tr key={order.id} className="border-b border-line last:border-0 transition-colors hover:bg-raised">
                  <td className="px-4 py-3 font-mono font-semibold">{order.ref}</td>
                  <td className="px-4 py-3">
                    <span className="font-semibold text-ink">{order.outletId}</span>
                    <span className="mt-0.5 block text-xs text-muted">{order.districtName ?? "District pending"}</span>
                  </td>
                  <td className="px-4 py-3"><BrandChip brand={order.brand} /></td>
                  <td className="tabular px-4 py-3 text-right font-semibold">{order.units}</td>
                  <td className="tabular px-4 py-3 text-right text-muted">
                    {order.volumeM3 != null ? `${order.volumeM3.toFixed(1)} m³` : "—"}
                  </td>
                  <td className="tabular px-4 py-3 text-right text-muted">
                    {order.weightKg != null ? `${order.weightKg.toFixed(0)} kg` : "—"}
                  </td>
                  <td className="tabular px-4 py-3">
                    {order.windowOpen && order.windowClose ? `${order.windowOpen}–${order.windowClose}` : <span className="text-muted">Unassigned</span>}
                  </td>
                  <td className="px-4 py-3"><OrderStatus status={order.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}

function KpiIcon({ kind }: { kind: "orders" | "check" | "alert" | "snow" | "box" }) {
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
  if (kind === "snow")
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className={common} aria-hidden>
        <path d="M12 2v20M4 6l16 12M20 6L4 18M2 12h20" />
      </svg>
    );
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className={common} aria-hidden>
      <path d="M12 3l9 5v8l-9 5-9-5V8z" /><path d="M3 8l9 5 9-5M12 13v10" />
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
  icon: "orders" | "check" | "alert" | "snow" | "box";
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

function StatusPill({ status }: { status: string }) {
  return <span className={`inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-semibold ${STATUS_STYLE[status] ?? "bg-raised text-muted"}`}><span aria-hidden className="size-2 rounded-full bg-current" />Queue {status.toLowerCase()}</span>;
}

function OrderStatus({ status }: { status: string }) {
  const style = status === "QUEUED" || status === "PLACED" ? "bg-blue-50 text-blue-700" : status === "DEFERRED" || status === "CANCELLED" ? "bg-red-50 text-critical" : status === "DELIVERED" ? "bg-emerald-50 text-emerald-700" : "bg-raised text-muted";
  return <span className={`inline-flex rounded-md px-2 py-1 text-xs font-semibold ${style}`}>{status.toLowerCase().replaceAll("_", " ")}</span>;
}

function Notice({ kind }: { kind: string }) {
  const message = kind === "queue_closed" ? "Order queue closed. The delivery plan can now be built." : "Draft plan built. Review its trips, deferrals, and validation before publishing.";
  return <div role="status" className="mt-5 rounded-[var(--radius-card)] border border-emerald-200 bg-emerald-50 p-4 text-emerald-800"><p className="font-semibold">Planning updated</p><p className="mt-1 text-sm">{message}</p></div>;
}

function ErrorBanner({ code }: { code: string }) {
  return <div role="alert" className="mt-5 rounded-[var(--radius-card)] border border-red-200 bg-red-50 p-4 text-critical"><p className="font-semibold">Planning needs attention</p><p className="mt-1 text-sm text-muted">{ERRORS[code] ?? "The request could not be completed. Reload and try again."}</p></div>;
}

function ReadFailure({ detail = "Today’s planning data could not be loaded. No planning state was changed." }: { detail?: string }) {
  return <main className="mx-auto max-w-3xl p-4 sm:p-6"><section className="rounded-[var(--radius-card)] border border-red-200 bg-red-50 p-5"><h1 className="text-xl font-semibold text-critical">Planning desk unavailable</h1><p className="mt-2 text-muted">{detail}</p><a href="/dispatcher" className="mt-4 inline-flex min-h-11 items-center rounded-[var(--radius-control)] bg-action px-4 font-semibold text-ink">Try again</a></section></main>;
}
