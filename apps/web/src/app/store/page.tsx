import Link from "next/link";
import { cookies } from "next/headers";
import { api } from "@/lib/api";
import { readError } from "./api-errors";
import { needsAttention, storeState, storeStateLabel } from "./order-state";

export const dynamic = "force-dynamic";

const FILTERS = [
  { value: "all", label: "All orders" },
  { value: "queued", label: "Queued" },
  { value: "planned", label: "Planned" },
  { value: "on_the_way", label: "On the way" },
  { value: "delivered", label: "Delivered" },
  { value: "deferred", label: "Deferred" },
  { value: "failed", label: "Failed" },
] as const;

const STATUS_STYLE: Record<string, string> = {
  queued: "bg-raised text-muted",
  planned: "bg-blue-50 text-blue-700",
  on_the_way: "bg-amber-50 text-amber-800",
  delivered: "bg-emerald-50 text-emerald-700",
  deferred: "bg-red-50 text-critical",
  failed: "bg-red-50 text-critical",
  cancelled: "bg-red-50 text-critical",
};


function SummaryCard({
  label,
  value,
  detail,
  tone = "neutral",
}: {
  label: string;
  value: number;
  detail: string;
  tone?: "neutral" | "good" | "warn" | "bad";
}) {
  const toneClass = {
    neutral: "text-ink",
    good: "text-emerald-700",
    warn: "text-amber-800",
    bad: "text-critical",
  }[tone];

  return (
    <article className="rounded-[var(--radius-card)] border border-line bg-surface p-4">
      <p className="text-sm text-muted">{label}</p>
      <p className={`tabular mt-1 text-3xl font-semibold ${toneClass}`}>{value}</p>
      <p className="mt-2 text-sm text-muted">{detail}</p>
    </article>
  );
}

function StatusPill({ state }: { state: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-semibold ${STATUS_STYLE[state] ?? STATUS_STYLE.queued}`}
    >
      <span aria-hidden className="size-1.5 rounded-full bg-current" />
      {storeStateLabel(state)}
    </span>
  );
}

function BrandPill({ brand }: { brand: string }) {
  const style = {
    Fresh: "bg-emerald-50 text-emerald-700",
    Style: "bg-red-50 text-critical",
    Tech: "bg-blue-50 text-blue-700",
  }[brand] ?? "bg-raised text-muted";

  return <span className={`rounded px-2 py-1 text-xs font-semibold ${style}`}>{brand}</span>;
}

export default async function StoreOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const query = await searchParams;
  const requestedStatus = query.status ?? "all";
  const selected = FILTERS.some((filter) => filter.value === requestedStatus)
    ? requestedStatus
    : "all";
  const client = await api();
  const result = await client.GET("/orders");
  const placed = (await cookies()).get("katapatha_order_placed")?.value;
  const placedReferences =
    placed && placed !== "confirmed" ? placed.split(",").filter(Boolean) : [];

  if (result.error || !result.data) {
    const message = readError(result.response.status, "orders");
    return (
      <main className="mx-auto max-w-6xl p-4 sm:p-6">
        <section className="rounded-[var(--radius-card)] border border-red-200 bg-red-50 p-5">
          <h1 className="text-xl font-semibold text-critical">{message.title}</h1>
          <p className="mt-2 max-w-xl text-sm text-muted">
            {message.detail} No order data was changed.
          </p>
          <Link
            href="/store"
            className="mt-4 inline-flex min-h-11 items-center rounded-[var(--radius-control)] bg-action px-4 font-semibold text-ink"
          >
            Try again
          </Link>
        </section>
      </main>
    );
  }

  const orders = result.data;
  const visible =
    selected === "all" ? orders : orders.filter((order) => storeState(order) === selected);
  const awaiting = orders.filter((order) =>
    ["queued", "planned", "on_the_way"].includes(storeState(order)),
  ).length;
  const delivered = orders.filter((order) => storeState(order) === "delivered").length;
  const attention = orders.filter((order) => needsAttention(storeState(order))).length;

  return (
    <main className="mx-auto w-full max-w-7xl p-4 sm:p-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">My orders</h1>
          <p className="mt-1 text-muted">Status and expected outcome for this outlet.</p>
        </div>
        <Link
          href="/store/new"
          className="inline-flex min-h-11 items-center rounded-[var(--radius-control)] bg-action px-4 font-semibold text-ink transition-[filter] hover:brightness-95"
        >
          Place order
        </Link>
      </header>

      {placed ? (
        <section aria-live="polite" className="mt-6 rounded-[var(--radius-card)] bg-emerald-50 p-4 text-emerald-800">
          <p className="font-semibold">Order placed</p>
          <p className="mt-1 text-sm">
            {placed === "confirmed"
              ? "Your earlier order request was accepted. Check the order list for its current status."
              : placedReferences.length > 1
                ? `References ${placedReferences.join(", ")} were accepted and are now in the order list.`
                : `Reference ${placedReferences[0]} was accepted and is now in the order list.`}
          </p>
        </section>
      ) : null}

      <section aria-label="Order summary" className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryCard label="Total orders" value={orders.length} detail="Visible to this outlet" />
        <SummaryCard label="In progress" value={awaiting} detail="Queued through delivery" tone="warn" />
        <SummaryCard label="Delivered" value={delivered} detail="Completed orders" tone="good" />
        <SummaryCard label="Needs attention" value={attention} detail="Deferred, failed, or cancelled" tone="bad" />
      </section>

      <nav aria-label="Filter orders" className="mt-6 flex gap-2 overflow-x-auto pb-2">
        {FILTERS.map((filter) => {
          const active = filter.value === selected;
          return (
            <Link
              key={filter.value}
              href={filter.value === "all" ? "/store" : `/store?status=${filter.value}`}
              aria-current={active ? "page" : undefined}
              className={`min-h-11 shrink-0 rounded-[var(--radius-control)] border px-4 py-2.5 text-sm font-semibold ${
                active
                  ? "border-action bg-action text-ink"
                  : "border-line bg-surface text-muted hover:text-ink"
              }`}
            >
              {filter.label}
            </Link>
          );
        })}
      </nav>

      <section className="mt-2">
        <div className="mb-3 flex items-baseline justify-between gap-3">
          <h2 className="text-lg font-semibold">{FILTERS.find((f) => f.value === selected)?.label ?? "Orders"}</h2>
          <span className="tabular text-sm text-muted">{visible.length} shown</span>
        </div>

        {visible.length === 0 ? (
          <div className="rounded-[var(--radius-card)] border border-dashed border-line bg-surface p-8 text-center">
            <p className="font-semibold">No orders in this status</p>
            <p className="mt-1 text-sm text-muted">Choose another filter to see the outlet&apos;s orders.</p>
          </div>
        ) : (
          <>
            <div className="grid gap-3 md:hidden">
              {visible.map((order) => {
                const state = storeState(order);
                return (
                  <article key={order.id} className="rounded-[var(--radius-card)] border border-line bg-surface p-4">
                    <Link href={`/store/orders/${order.id}`} className="block rounded-sm focus-visible:outline-offset-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-mono font-semibold">{order.ref}</p>
                        <p className="mt-1 text-sm text-muted">Requested {order.requestedDate}</p>
                      </div>
                      <StatusPill state={state} />
                    </div>
                    <div className="mt-4 flex flex-wrap items-center gap-2">
                      <BrandPill brand={order.brand} />
                      <span className="text-sm text-muted">{order.tempRequirement === "chilled" ? "Chilled" : "Ambient"}</span>
                    </div>
                    <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-line pt-4 text-sm">
                      <div>
                        <dt className="text-muted">Items</dt>
                        <dd className="tabular mt-1 font-semibold">{order.units} units</dd>
                      </div>
                      <div>
                        <dt className="text-muted">Receiving window</dt>
                        <dd className="tabular mt-1 font-semibold">
                          {order.windowOpen && order.windowClose
                            ? `${order.windowOpen}–${order.windowClose}`
                            : "Not assigned"}
                        </dd>
                      </div>
                    </dl>
                    </Link>
                  </article>
                );
              })}
            </div>

            <div className="hidden overflow-x-auto rounded-[var(--radius-card)] border border-line bg-surface md:block">
              <table className="w-full min-w-[820px] text-left text-sm">
                <caption className="sr-only">Orders visible to this store manager</caption>
                <thead className="bg-raised text-xs uppercase tracking-wide text-muted">
                  <tr>
                    <th className="px-4 py-3 font-semibold" scope="col">Order</th>
                    <th className="px-4 py-3 font-semibold" scope="col">Brand</th>
                    <th className="px-4 py-3 font-semibold" scope="col">Type</th>
                    <th className="px-4 py-3 text-right font-semibold" scope="col">Items</th>
                    <th className="px-4 py-3 font-semibold" scope="col">Requested</th>
                    <th className="px-4 py-3 font-semibold" scope="col">Window</th>
                    <th className="px-4 py-3 font-semibold" scope="col">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {visible.map((order) => {
                    const state = storeState(order);
                    return (
                      <tr key={order.id} className="hover:bg-raised">
                        <td className="px-4 py-3 font-mono font-semibold">
                          <Link href={`/store/orders/${order.id}`} className="inline-flex min-h-6 items-center text-link underline-offset-4 hover:underline">{order.ref}</Link>
                        </td>
                        <td className="px-4 py-3"><BrandPill brand={order.brand} /></td>
                        <td className="px-4 py-3 text-muted">{order.tempRequirement === "chilled" ? "Chilled" : "Ambient"}</td>
                        <td className="tabular px-4 py-3 text-right font-semibold">{order.units}</td>
                        <td className="tabular px-4 py-3 text-muted">{order.requestedDate}</td>
                        <td className="tabular px-4 py-3 text-muted">
                          {order.windowOpen && order.windowClose
                            ? `${order.windowOpen}–${order.windowClose}`
                            : "—"}
                        </td>
                        <td className="px-4 py-3"><StatusPill state={state} /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>
    </main>
  );
}
