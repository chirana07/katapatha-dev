import Link from "next/link";
import { api } from "@/lib/api";
import { readError } from "../api-errors";
import { receivingWindowLabel, storeState, storeStateLabel } from "../order-state";

export const dynamic = "force-dynamic";

const STATUS_STYLE: Record<string, string> = {
  delivered: "bg-emerald-50 text-emerald-700",
  deferred: "bg-red-50 text-critical",
  cancelled: "bg-red-50 text-critical",
  failed: "bg-red-50 text-critical",
};

export default async function DeliveryHistoryPage() {
  const client = await api();
  const result = await client.GET("/orders");

  if (result.error || !result.data) {
    const message = readError(result.response.status, "orders");
    return (
      <main className="min-w-0 flex-1 p-4 sm:p-6">
        <section role="alert" className="rounded-[var(--radius-card)] border border-red-200 bg-red-50 p-5">
          <h1 className="text-xl font-semibold text-critical">{message.title}</h1>
          <p className="mt-2 text-sm text-muted">{message.detail}</p>
          <Link href="/store" className="mt-4 inline-flex min-h-11 items-center rounded-[var(--radius-control)] bg-action px-4 font-semibold text-ink">
            Back to my orders
          </Link>
        </section>
      </main>
    );
  }

  const closed = result.data.filter((order) =>
    ["delivered", "deferred", "cancelled", "failed"].includes(storeState(order)),
  );
  const sorted = [...closed].sort((a, b) => (b.requestedDate ?? "").localeCompare(a.requestedDate ?? ""));
  const delivered = closed.filter((order) => storeState(order) === "delivered").length;
  const notDelivered = closed.length - delivered;

  return (
    <main className="min-w-0 flex-1 p-4 sm:p-6 lg:p-8">
      <header className="flex flex-col gap-4 border-b border-line pb-5 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-ink sm:text-3xl">Delivery history</h1>
          <p className="mt-2 max-w-xl text-sm text-muted">
            Every order on this outlet that has finished its path through the operation, newest first.
          </p>
        </div>
        <Link href="/store" className="inline-flex min-h-10 items-center rounded-[var(--radius-control)] border border-line bg-surface px-3 text-sm font-semibold text-ink hover:bg-raised">
          Back to my orders
        </Link>
      </header>

      <section aria-label="History totals" className="mt-5 grid gap-3 sm:grid-cols-3">
        <Stat label="Closed orders" value={closed.length} detail="Delivered, deferred, cancelled or failed" />
        <Stat label="Delivered" value={delivered} detail="Confirmed on arrival" accent="success" />
        <Stat label="Did not deliver" value={notDelivered} detail={notDelivered === 0 ? "No gaps" : "Reasons attached to each row"} accent={notDelivered === 0 ? "muted" : "danger"} />
      </section>

      {sorted.length === 0 ? (
        <section className="mt-10 rounded-[var(--radius-card)] border border-dashed border-line bg-surface p-8 text-center">
          <h2 className="text-lg font-semibold text-ink">No history yet</h2>
          <p className="mx-auto mt-2 max-w-xl text-sm text-muted">
            Nothing has been delivered or closed on this outlet. Open My orders to see what is still in progress.
          </p>
        </section>
      ) : (
        <div className="mt-6 overflow-x-auto rounded-[var(--radius-card)] border border-line bg-surface">
          <table className="w-full min-w-[820px] text-left text-sm">
            <caption className="sr-only">Delivery history for this outlet</caption>
            <thead className="border-b border-line bg-raised text-xs uppercase tracking-wide text-muted">
              <tr>
                <th className="px-4 py-2.5">Order</th>
                <th className="px-4 py-2.5">Brand</th>
                <th className="px-4 py-2.5">Type</th>
                <th className="px-4 py-2.5 text-right">Items</th>
                <th className="px-4 py-2.5">Requested</th>
                <th className="px-4 py-2.5">Window</th>
                <th className="px-4 py-2.5">Outcome</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((order) => {
                const state = storeState(order);
                return (
                  <tr key={order.id} className="border-b border-line last:border-0 hover:bg-raised">
                    <td className="px-4 py-3 font-mono font-semibold">
                      <Link href={`/store/orders/${order.id}`} className="text-link hover:underline">{order.ref}</Link>
                    </td>
                    <td className="px-4 py-3">{order.brand}</td>
                    <td className="px-4 py-3 text-muted">{order.tempRequirement === "chilled" ? "Chilled" : "Ambient"}</td>
                    <td className="tabular px-4 py-3 text-right font-semibold">{order.units}</td>
                    <td className="tabular px-4 py-3 text-muted">{order.requestedDate}</td>
                    <td className="tabular px-4 py-3 text-muted">{receivingWindowLabel(order)}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex rounded-md px-2 py-1 text-xs font-semibold ${STATUS_STYLE[state] ?? "bg-raised text-muted"}`}>
                        {storeStateLabel(state)}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}

function Stat({
  label,
  value,
  detail,
  accent = "default",
}: {
  label: string;
  value: number;
  detail: string;
  accent?: "default" | "success" | "danger" | "muted";
}) {
  const valueColor =
    accent === "success"
      ? "text-emerald-700"
      : accent === "danger"
        ? "text-critical"
        : "text-ink";
  return (
    <article className="rounded-[var(--radius-card)] border border-line bg-surface p-4">
      <p className={`tabular text-2xl font-semibold ${valueColor}`}>{value}</p>
      <p className="text-sm text-muted">{label}</p>
      <p className="mt-2 text-xs text-muted">{detail}</p>
    </article>
  );
}
