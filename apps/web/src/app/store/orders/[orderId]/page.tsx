import Link from "next/link";
import { api } from "@/lib/api";
import { OrderProgress } from "./order-progress";
import { ReceiptForm } from "./receipt-form";

export const dynamic = "force-dynamic";

export default async function StoreOrderPage({
  params,
  searchParams,
}: {
  params: Promise<{ orderId: string }>;
  searchParams: Promise<{ received?: string }>;
}) {
  const { orderId } = await params;
  const { received } = await searchParams;
  const client = await api();
  const result = await client.GET("/orders/{orderId}", { params: { path: { orderId } } });

  if (result.error || !result.data) {
    return (
      <main className="mx-auto max-w-3xl p-4 sm:p-6">
        <Link href="/store" className="text-sm font-semibold text-link underline-offset-4 hover:underline">Back to orders</Link>
        <section className="mt-6 rounded-[var(--radius-card)] bg-red-50 p-5">
          <h1 className="text-xl font-semibold text-critical">Order unavailable</h1>
          <p className="mt-2 text-sm text-muted">This order could not be loaded. Return to the order list and try again.</p>
        </section>
      </main>
    );
  }

  const order = result.data;
  const canConfirm = order.status === "DELIVERED" || order.status === "PART_DELIVERED";
  const state = order.storeState ?? storeStateFromStatus(order.status);
  const statusStyle =
    state === "delivered"
      ? "bg-emerald-50 text-emerald-800"
      : state === "deferred" || state === "cancelled"
        ? "bg-red-50 text-critical"
        : state === "on_the_way"
          ? "bg-amber-50 text-amber-800"
          : state === "planned"
            ? "bg-blue-50 text-blue-700"
            : "bg-raised text-muted";

  return (
    <main className="mx-auto w-full max-w-5xl p-4 sm:p-6">
      <Link href="/store" className="text-sm font-semibold text-link underline-offset-4 hover:underline">Back to orders</Link>
      <header className="mt-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-mono text-2xl font-semibold tracking-tight sm:text-3xl">{order.ref}</h1>
          <p className="mt-2 text-muted">Requested for {order.requestedDate}</p>
        </div>
        <span className={`rounded-md px-3 py-2 text-sm font-semibold ${statusStyle}`}>
          {order.storeState === "delivered" ? "Delivered" : order.status.replaceAll("_", " ")}
        </span>
      </header>

      {received ? (
        <section aria-live="polite" className="mt-6 rounded-[var(--radius-card)] bg-emerald-50 p-4 text-emerald-800">
          <p className="font-semibold">Receipt confirmed</p>
          <p className="mt-1 text-sm">The delivery outcome has been added to this order.</p>
        </section>
      ) : null}

      <dl aria-label="Order information" className="mt-6 grid gap-px overflow-hidden rounded-[var(--radius-card)] bg-line sm:grid-cols-2 lg:grid-cols-4">
        <OrderFact label="Brand" value={order.brand} />
        <OrderFact label="Goods" value={order.tempRequirement === "chilled" ? "Chilled" : "Ambient"} />
        <OrderFact label="Expected units" value={`${order.units} units`} />
        <OrderFact label="Receiving window" value={order.windowOpen && order.windowClose ? `${order.windowOpen}–${order.windowClose}` : "Not assigned"} />
      </dl>

      <OrderProgress state={state} />

      <section className="mt-6 rounded-[var(--radius-card)] bg-surface p-5 sm:p-6">
        <h2 className="text-xl font-semibold">Delivery outcome</h2>
        <p className="mt-1 max-w-2xl text-sm text-muted">
          Confirm what arrived so dispatch and the outlet share the same final record.
        </p>
        {canConfirm && !received ? (
          <ReceiptForm orderId={order.id} expectedUnits={order.units} />
        ) : received ? (
          <div className="mt-5 rounded-lg bg-raised p-4 text-sm text-muted">
            Receipt is recorded. Return to the order list to continue.
          </div>
        ) : (
          <div className="mt-5 rounded-lg bg-raised p-4 text-sm text-muted">
            Receipt confirmation becomes available after the driver records delivery.
          </div>
        )}
      </section>
    </main>
  );
}

function OrderFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-surface p-4">
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="tabular mt-1 font-semibold">{value}</dd>
    </div>
  );
}

function storeStateFromStatus(status: string): string {
  if (["DRAFT", "PLACED", "QUEUED"].includes(status)) return "queued";
  if (["PLANNED", "LOADED"].includes(status)) return "planned";
  if (status === "IN_TRANSIT") return "on_the_way";
  if (["DELIVERED", "PART_DELIVERED"].includes(status)) return "delivered";
  return status.toLowerCase();
}
