import type { Metadata } from "next";
import { api } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { longDate } from "@/lib/dates";
import { plural } from "@/lib/format";
import { ButtonLink } from "@/components/ui/button";
import { PageBody, PageHeader } from "@/components/ui/page-header";
import { Stepper } from "@/components/ui/stepper";
import { goodsLabel, receivingWindowLabel, storeState } from "../../order-state";
import { OrderStatePill } from "../../store-parts";

export const metadata: Metadata = { title: "Order received · Katapatha" };
export const dynamic = "force-dynamic";

const STEPS = ["Choose quantities", "Review order", "Confirmed"];
const ID = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * The third step. It reads the placed orders back from the API by id, so what
 * it shows is what exists, a reload only reads, and a hand-typed URL cannot
 * announce an order that was never placed (the API scopes by outlet).
 */
export default async function OrderConfirmedPage({
  searchParams,
}: {
  searchParams: Promise<{ ids?: string; replayed?: string }>;
}) {
  await requireRole("STORE_MANAGER", "/store/new");
  const query = await searchParams;
  const ids = (query.ids ?? "").split(",").filter((id) => ID.test(id)).slice(0, 10);

  const client = await api();
  const found = (
    await Promise.all(ids.map((orderId) => client.GET("/orders/{orderId}", { params: { path: { orderId } } }).catch(() => null)))
  ).flatMap((result) => (result?.data ? [result.data] : []));

  return (
    <PageBody>
      <PageHeader title="Place a new order" />
      <div className="max-w-2xl">
        <Stepper steps={STEPS} current={3} />
      </div>

      <section aria-labelledby="confirmed-heading" className="mx-auto w-full max-w-2xl rounded-card border border-line bg-surface p-5 sm:p-6">
        {found.length > 0 ? (
          <>
            <h2 id="confirmed-heading" className="text-xl font-bold text-ink">
              {found.length === 1 ? `Order ${found[0]!.ref} received` : `${found.length} orders received`}
            </h2>
            <p className="mt-1 text-sm text-muted">
              For {longDate(found[0]!.requestedDate)}. They are in the queue until dispatch plans the run.
            </p>
            <ul className="mt-4 flex flex-col gap-2">
              {found.map((order) => (
                <li key={order.id} className="flex flex-wrap items-center justify-between gap-2 rounded-control border border-line p-3 text-sm">
                  <span>
                    <span className="font-mono font-bold text-ink">{order.ref}</span>
                    <span className="text-muted"> · {goodsLabel(order.tempRequirement)} · {plural(order.units, "unit")} · {receivingWindowLabel(order)}</span>
                  </span>
                  <OrderStatePill state={storeState(order)} />
                </li>
              ))}
            </ul>
          </>
        ) : (
          <>
            <h2 id="confirmed-heading" className="text-xl font-bold text-ink">
              {query.replayed ? "That order was already placed" : "We could not show this order"}
            </h2>
            <p className="mt-1 text-sm text-muted">
              {query.replayed
                ? "Your earlier request went through, and nothing new was created. My orders has it."
                : "Check My orders to see whether it was placed."}
            </p>
          </>
        )}

        <h3 className="mt-6 text-xs font-semibold uppercase tracking-wide text-muted">What happens next</h3>
        <ol className="mt-2 flex flex-col gap-3 text-sm">
          <li><span className="font-semibold text-ink">Dispatch plans the run.</span> <span className="text-muted">Once planned, your order shows a vehicle and a planned arrival.</span></li>
          <li><span className="font-semibold text-ink">If an order has to move,</span> <span className="text-muted">you will see why, with the new date, in My orders and on Today.</span></li>
          <li><span className="font-semibold text-ink">On the day,</span> <span className="text-muted">Today shows the planned arrival and how many stops come before yours.</span></li>
        </ol>

        <div className="mt-6 flex flex-wrap gap-2">
          <ButtonLink href="/store/orders">View in My orders</ButtonLink>
          <ButtonLink href="/store/new" variant="primary">Place another order</ButtonLink>
        </div>
      </section>
    </PageBody>
  );
}
