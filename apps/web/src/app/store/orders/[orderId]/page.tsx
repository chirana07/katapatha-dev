import Link from "next/link";
import { cookies } from "next/headers";
import { api } from "@/lib/api";
import { readError } from "../../api-errors";
import { deferralMessage } from "@katapatha/core/domain/deferral";
import { receivingWindowLabel, storeState, storeStateLabel } from "../../order-state";
import { OrderProgress } from "./order-progress";
import { ReceiptForm } from "./receipt-form";

export const dynamic = "force-dynamic";

export default async function StoreOrderPage({
  params,
}: {
  params: Promise<{ orderId: string }>;
}) {
  const { orderId } = await params;
  const receiptConfirmed =
    (await cookies()).get("katapatha_receipt_confirmed")?.value === orderId;
  const client = await api();
  const result = await client.GET("/orders/{orderId}", { params: { path: { orderId } } });

  if (result.error || !result.data) {
    const message = readError(result.response.status, "order");
    return (
      <main className="mx-auto max-w-3xl p-4 sm:p-6">
        <Link href="/store" className="inline-flex min-h-11 items-center text-sm font-semibold text-link underline-offset-4 hover:underline">Back to orders</Link>
        <section className="mt-6 rounded-[var(--radius-card)] bg-red-50 p-5">
          <h1 className="text-xl font-semibold text-critical">{message.title}</h1>
          <p className="mt-2 text-sm text-muted">{message.detail}</p>
        </section>
      </main>
    );
  }

  const order = result.data;
  const canConfirm = order.status === "DELIVERED" || order.status === "PART_DELIVERED";
  const state = storeState(order);
  const statusStyle =
    state === "delivered"
      ? "bg-emerald-50 text-emerald-800"
      : state === "deferred" || state === "failed" || state === "cancelled"
        ? "bg-red-50 text-critical"
        : state === "on_the_way"
          ? "bg-amber-50 text-amber-800"
          : state === "planned"
            ? "bg-blue-50 text-blue-700"
            : "bg-raised text-muted";

  return (
    <main className="mx-auto w-full max-w-5xl p-4 sm:p-6">
      <Link href="/store" className="inline-flex min-h-11 items-center text-sm font-semibold text-link underline-offset-4 hover:underline">Back to orders</Link>
      <header className="mt-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-mono text-2xl font-semibold tracking-tight sm:text-3xl">{order.ref}</h1>
          <p className="mt-2 text-muted">Requested for {order.requestedDate}</p>
        </div>
        <span className={`rounded-md px-3 py-2 text-sm font-semibold ${statusStyle}`}>
          {storeStateLabel(state)}
        </span>
      </header>

      {order.deferral ? (
        <section className="mt-6 rounded-[var(--radius-card)] border border-red-200 bg-red-50 p-4">
          <p className="font-semibold text-critical">
            {order.deferral.rolledToDate ? "This order moves to the next run" : "This order could not be delivered"}
          </p>
          <p className="mt-1 text-sm text-ink">
            {deferralMessage(
              { ref: order.ref, windowOpen: order.windowOpen ?? "", windowClose: order.windowClose ?? "" },
              order.deferral.reasonCode,
              order.deferral.rolledToDate ?? "",
              !order.deferral.rolledToDate,
            )}
          </p>
        </section>
      ) : null}

      {receiptConfirmed ? (
        <section aria-live="polite" className="mt-6 rounded-[var(--radius-card)] bg-emerald-50 p-4 text-emerald-800">
          <p className="font-semibold">Receipt confirmed</p>
          <p className="mt-1 text-sm">The delivery outcome has been added to this order.</p>
        </section>
      ) : null}

      <dl aria-label="Order information" className="mt-6 grid gap-px overflow-hidden rounded-[var(--radius-card)] bg-line sm:grid-cols-2 lg:grid-cols-4">
        <OrderFact label="Brand" value={order.brand} />
        <OrderFact label="Goods" value={order.tempRequirement === "chilled" ? "Chilled" : "Ambient"} />
        <OrderFact label="Expected units" value={`${order.units} units`} />
        <OrderFact label="Receiving window" value={receivingWindowLabel(order)} />
      </dl>

      <OrderProgress state={state} />

      <section className="mt-6 rounded-[var(--radius-card)] bg-surface p-5 sm:p-6">
        <h2 className="text-xl font-semibold">Delivery outcome</h2>
        <p className="mt-1 max-w-2xl text-sm text-muted">
          Confirm what arrived so dispatch and the outlet share the same final record.
        </p>
        {canConfirm && !receiptConfirmed ? (
          <ReceiptForm orderId={order.id} expectedUnits={order.units} />
        ) : receiptConfirmed ? (
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
