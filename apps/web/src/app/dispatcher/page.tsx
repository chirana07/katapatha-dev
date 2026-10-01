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

function validUuid(value: string | undefined) {
  return Boolean(value && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value));
}

export default async function DispatcherPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; notice?: string; retry?: string }>;
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

  const date = todayInColombo();
  const depotCode = me.data.depotCode;
  let days;
  let orders;
  let plans;
  try {
    [days, orders, plans] = await Promise.all([
      client.GET("/planning-days", { params: { query: { date, depot: depotCode } } }),
      client.GET("/orders", { params: { query: { date } } }),
      client.GET("/plans", { params: { query: { date, depot: depotCode } } }),
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

  const query = await searchParams;
  const planRequestId = validUuid(query.retry) ? query.retry! : crypto.randomUUID();
  const day = days.data[0];
  const plan = plans.data.find((item) => item.status === "DRAFT") ?? plans.data[0];
  const chilled = orders.data.filter((order) => order.tempRequirement === "chilled").length;
  const waiting = orders.data.filter((order) => order.status === "QUEUED" || order.status === "PLACED").length;
  const volume = orders.data.reduce((sum, order) => sum + (order.volumeM3 ?? 0), 0);

  return (
    <main className="mx-auto w-full max-w-7xl p-4 sm:p-6 lg:p-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.12em] text-muted">{depotCode} depot · {date}</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">Planning desk</h1>
          <p className="mt-2 max-w-2xl text-muted">Close the order queue, build a plan, resolve deferrals, and publish the run.</p>
        </div>
        {day ? <StatusPill status={day.status} /> : null}
      </header>

      {query.notice ? <Notice kind={query.notice} /> : null}
      {query.error ? <ErrorBanner code={query.error} /> : null}

      <section aria-label="Queue summary" className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="Daily orders" value={orders.data.length} detail={`${waiting} waiting in the queue`} />
        <Metric label="Chilled" value={chilled} detail="Require refrigerated capacity" />
        <Metric label="Volume" value={`${volume.toFixed(1)} m³`} detail="Across today’s orders" />
        <Metric label="Draft trips" value={plan?.stats.tripsBuilt ?? 0} detail={plan ? `${plan.stats.served} orders served` : "Build a plan after closure"} />
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
            <form action={createPlan}>
              <input type="hidden" name="date" value={day.date} />
              <input type="hidden" name="depotCode" value={day.depotCode} />
              <input type="hidden" name="requestId" value={planRequestId} />
              <button type="submit" className="min-h-12 rounded-[var(--radius-control)] border border-line bg-surface px-5 font-semibold text-ink hover:bg-raised">Re-run auto-plan</button>
            </form>
          </div>
        ) : (
          <div>
            <p className="text-sm font-semibold text-muted">Current plan</p>
            <h2 className="mt-1 text-xl font-semibold">{day.status === "PUBLISHED" ? "Plan published to the dock" : "Draft plan ready for review"}</h2>
            <p className="mt-2 text-muted">{plan ? `${plan.stats.tripsBuilt} trips serve ${plan.stats.served} of ${plan.stats.orders} orders; ${plan.stats.deferred} require deferral decisions.` : "Refresh when the plan has finished building."}</p>
          </div>
        )}
      </section>

      <section className="mt-6">
        <div className="flex items-baseline justify-between gap-3">
          <h2 id="daily-orders" className="text-lg font-semibold">Today&apos;s orders</h2>
          <span className="tabular text-sm text-muted">{orders.data.length} orders</span>
        </div>
        <div className="mt-3 grid gap-3 md:hidden">
          {orders.data.map((order) => (
            <article key={order.id} className="rounded-[var(--radius-card)] border border-line bg-surface p-4">
              <div className="flex items-start justify-between gap-3">
                <div><p className="font-mono font-semibold">{order.ref}</p><p className="mt-1 text-sm text-muted">{order.outletId} · {order.districtName ?? "District pending"}</p></div>
                <OrderStatus status={order.status} />
              </div>
              <dl className="mt-4 grid grid-cols-3 gap-3 border-t border-line pt-4 text-sm">
                <div><dt className="text-muted">Brand</dt><dd className="mt-1 font-semibold">{order.brand}</dd></div>
                <div><dt className="text-muted">Load</dt><dd className="mt-1 font-semibold capitalize">{order.tempRequirement}</dd></div>
                <div className="border-l border-line pl-3"><dt className="text-muted">Units</dt><dd className="tabular mt-1 font-semibold">{order.units}</dd></div>
              </dl>
            </article>
          ))}
        </div>
        <div aria-labelledby="daily-orders" className="mt-3 hidden overflow-x-auto rounded-[var(--radius-card)] border border-line bg-surface md:block">
          <table className="w-full min-w-[720px] text-left">
            <caption className="sr-only">Orders for {depotCode} on {date}</caption>
            <thead className="bg-raised text-xs uppercase tracking-wide text-muted">
              <tr><th className="px-4 py-3">Order</th><th className="px-4 py-3">Outlet</th><th className="px-4 py-3">Brand</th><th className="px-4 py-3">Temperature</th><th className="px-4 py-3 text-right">Units</th><th className="px-4 py-3">Window</th><th className="px-4 py-3">Status</th></tr>
            </thead>
            <tbody className="divide-y divide-line">
              {orders.data.map((order) => (
                <tr key={order.id}>
                  <td className="px-4 py-3 font-mono font-semibold">{order.ref}</td>
                  <td className="px-4 py-3"><span className="font-semibold">{order.outletId}</span><span className="mt-0.5 block text-xs text-muted">{order.districtName ?? "District pending"}</span></td>
                  <td className="px-4 py-3">{order.brand}</td>
                  <td className="px-4 py-3 capitalize">{order.tempRequirement}</td>
                  <td className="tabular px-4 py-3 text-right font-semibold">{order.units}</td>
                  <td className="tabular px-4 py-3">{order.windowOpen && order.windowClose ? `${order.windowOpen}–${order.windowClose}` : "Unassigned"}</td>
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

function Metric({ label, value, detail }: { label: string; value: string | number; detail: string }) {
  return <article className="rounded-[var(--radius-card)] border border-line bg-surface p-4"><p className="text-sm text-muted">{label}</p><p className="tabular mt-1 text-3xl font-semibold">{value}</p><p className="mt-2 text-sm text-muted">{detail}</p></article>;
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
  return <div role="status" className="mt-6 rounded-[var(--radius-card)] border border-emerald-200 bg-emerald-50 p-4 text-emerald-800"><p className="font-semibold">Planning updated</p><p className="mt-1 text-sm">{message}</p></div>;
}

function ErrorBanner({ code }: { code: string }) {
  return <div role="alert" className="mt-6 rounded-[var(--radius-card)] border border-red-200 bg-red-50 p-4 text-critical"><p className="font-semibold">Planning needs attention</p><p className="mt-1 text-sm text-muted">{ERRORS[code] ?? "The request could not be completed. Reload and try again."}</p></div>;
}

function ReadFailure({ detail = "Today’s planning data could not be loaded. No planning state was changed." }: { detail?: string }) {
  return <main className="mx-auto max-w-3xl p-4 sm:p-6"><section className="rounded-[var(--radius-card)] border border-red-200 bg-red-50 p-5"><h1 className="text-xl font-semibold text-critical">Planning desk unavailable</h1><p className="mt-2 text-muted">{detail}</p><a href="/dispatcher" className="mt-4 inline-flex min-h-11 items-center rounded-[var(--radius-control)] bg-action px-4 font-semibold text-ink">Try again</a></section></main>;
}
