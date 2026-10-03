import type { Metadata } from "next";
import Link from "next/link";
import { deferralMessage } from "@katapatha/core/domain/deferral";
import { api } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { longDate } from "@/lib/dates";
import { readFailure } from "@/lib/failures";
import { plural } from "@/lib/format";
import { BrandPill, StatusPill } from "@/components/ui/status-pill";
import { ButtonLink } from "@/components/ui/button";
import { Facts } from "@/components/ui/detail-panel";
import { PageBody } from "@/components/ui/page-header";
import { ErrorPanel } from "@/components/ui/states";
import { Tracker } from "@/components/ui/stepper";
import { DEFAULT_REASONS, describeIssue, issueStatusLabel, issueStatusTone, reasonOptions } from "../../issue-view";
import { goodsLabel, progressSteps, receivingWindowLabel, storeState } from "../../order-state";
import { ReceiptForm } from "../../receipt-form";
import { OrderStatePill } from "../../store-parts";

export const metadata: Metadata = { title: "Order · Katapatha" };
export const dynamic = "force-dynamic";

export default async function StoreOrderPage({ params }: { params: Promise<{ orderId: string }> }) {
  await requireRole("STORE_MANAGER", "/store/orders");
  const { orderId } = await params;
  const client = await api();
  const result = await client.GET("/orders/{orderId}", { params: { path: { orderId } } });

  if (result.error || !result.data) {
    const failure = readFailure(result.response.status, "this order");
    return (
      <PageBody>
        <ErrorPanel
          title={failure.title}
          detail={failure.detail}
          outcome={failure.outcome}
          action={<ButtonLink href="/store/orders">Back to my orders</ButtonLink>}
        />
      </PageBody>
    );
  }

  const order = result.data;
  const state = storeState(order);

  // The order itself carries no receipt, driver count or planned arrival; the
  // outlet's day for the order's date does. One extra read, scoped to the day.
  const [day, issueList, vocabularies] = await Promise.all([
    client.GET("/store/today", { params: { query: { date: order.requestedDate } } }).catch(() => null),
    client.GET("/issues").catch(() => null),
    client.GET("/reference/vocabularies").catch(() => null),
  ]);
  const detail = day?.data?.orders.find((o) => o.id === order.id) ?? null;
  const issues = (issueList?.data ?? []).filter((issue) => issue.orderId === order.id);
  const reasons = reasonOptions(vocabularies?.data?.storeIssueReasons ?? DEFAULT_REASONS);
  const steps = progressSteps(state);
  const returnTo = `/store/orders/${order.id}`;
  const canConfirm = state === "delivered" && detail != null && !detail.receiptConfirmed;
  const reportable = state === "delivered" || state === "on_the_way";

  return (
    <PageBody>
      <Link href="/store/orders" className="inline-flex min-h-11 w-fit items-center text-sm font-semibold text-link underline-offset-4 hover:underline">
        ← My orders
      </Link>

      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-mono text-2xl font-bold tracking-tight text-ink sm:text-3xl">{order.ref}</h1>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted">
            <BrandPill brand={order.brand} />
            Requested for {longDate(order.requestedDate)}
          </p>
        </div>
        <OrderStatePill state={state} />
      </header>

      {order.deferral ? (
        <section className="rounded-card border border-warn/30 bg-warn-surface p-4">
          <p className="font-bold text-ink">
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
      ) : state === "cancelled" || state === "failed" ? (
        <section className="rounded-card border border-bad/25 bg-bad-surface p-4">
          <p className="font-bold text-bad-ink">{state === "cancelled" ? "This order was cancelled" : "This delivery failed"}</p>
          <p className="mt-1 text-sm text-ink">Dispatch decides what happens next. Report an issue if you need to reach them about it.</p>
        </section>
      ) : null}

      <Facts
        items={[
          { label: "Goods", value: goodsLabel(order.tempRequirement) },
          { label: "Ordered", value: plural(order.units, "unit") },
          { label: "Receiving window", value: receivingWindowLabel(order) },
          ...(detail?.etaAt && state !== "delivered" ? [{ label: "Planned arrival", value: detail.etaAt }] : []),
          ...(detail?.vehicleId ? [{ label: "Vehicle", value: detail.vehicleId }] : []),
          ...(detail?.deliveredUnits != null ? [{ label: "Driver recorded", value: plural(detail.deliveredUnits, "unit"), tone: detail.deliveredUnits < order.units ? ("bad" as const) : undefined }] : []),
        ]}
      />

      {steps ? (
        <section aria-labelledby="progress-heading" className="rounded-card border border-line bg-surface p-4 sm:p-5">
          <h2 id="progress-heading" className="text-lg font-bold text-ink">Delivery progress</h2>
          <div className="mt-4">
            <Tracker steps={steps} />
          </div>
          {detail?.stopsBefore != null && state === "on_the_way" ? (
            <p className="mt-4 text-sm text-muted">
              {detail.stopsBefore === 0 ? "Yours is the next stop." : `${plural(detail.stopsBefore, "stop")} before yours.`} Katapatha shows
              the plan and what the driver has recorded, not where the vehicle is now.
            </p>
          ) : null}
        </section>
      ) : null}

      <section aria-labelledby="outcome-heading" className="rounded-card border border-line bg-surface p-4 sm:p-5">
        <h2 id="outcome-heading" className="text-lg font-bold text-ink">Delivery outcome</h2>
        {canConfirm && detail ? (
          <div className="mt-3">
            <ReceiptForm
              orderId={order.id}
              orderRef={order.ref}
              orderedUnits={order.units}
              recordedUnits={detail.deliveredUnits ?? null}
              returnTo={returnTo}
              reasons={reasons}
            />
          </div>
        ) : state === "delivered" && detail?.receiptConfirmed ? (
          <p className="mt-2 flex flex-wrap items-center gap-2 text-sm text-ink">
            <StatusPill label="Receipt confirmed" tone="good" />
            You confirmed this delivery; your receipt is recorded.
          </p>
        ) : state === "delivered" ? (
          <p className="mt-2 text-sm text-muted">The receipt for this order could not be read. Reload to try again.</p>
        ) : (
          <p className="mt-2 text-sm text-muted">Receipt confirmation opens once the driver has recorded the delivery.</p>
        )}
      </section>

      <section aria-labelledby="issues-heading" className="rounded-card border border-line bg-surface p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="issues-heading" className="text-lg font-bold text-ink">Issues on this order</h2>
          {reportable ? (
            <ButtonLink href={`/store/issues?order=${order.id}`}>Report an issue</ButtonLink>
          ) : null}
        </div>
        {issues.length === 0 ? (
          <p className="mt-2 text-sm text-muted">
            {reportable ? "Nothing reported for this order." : "You can report an issue once the order is on the way or delivered."}
          </p>
        ) : (
          <ul className="mt-3 flex flex-col gap-2">
            {issues.map((issue) => (
              <li key={issue.id} className="flex flex-wrap items-center justify-between gap-2 rounded-control border border-line p-3 text-sm">
                <span className="font-semibold text-ink">
                  {describeIssue(issue)}
                  {issue.units ? <span className="font-normal text-muted"> · {plural(issue.units, "unit")}</span> : null}
                </span>
                <StatusPill label={issueStatusLabel(issue.status)} tone={issueStatusTone(issue.status)} />
                {issue.resolution ? <span className="w-full text-muted">Dispatch: {issue.resolution}</span> : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </PageBody>
  );
}
