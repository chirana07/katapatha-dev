import type { Metadata } from "next";
import Link from "next/link";
import type { components } from "@katapatha/contracts/types";
import { shortDay } from "@katapatha/core/domain/deferral";
import { api } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { isDateOnly, longDate } from "@/lib/dates";
import { readFailure } from "@/lib/failures";
import { plural } from "@/lib/format";
import { hasItems } from "@/lib/order-items";
import { BrandPill, StatusPill } from "@/components/ui/status-pill";
import { Button, ButtonLink } from "@/components/ui/button";
import { DataTable, RowCard, Td, Th, Tr } from "@/components/ui/data-table";
import { DateControl } from "@/components/ui/date-control";
import { PageBody, PageHeader } from "@/components/ui/page-header";
import { StatCard, StatRow } from "@/components/ui/stat-card";
import { EmptyState, ErrorPanel } from "@/components/ui/states";
import { OrderItems } from "@/components/ui/order-items";
import { Tracker } from "@/components/ui/stepper";
import { markNotificationRead } from "./actions";
import { DEFAULT_REASONS, reasonOptions } from "./issue-view";
import { goodsLabel, receivingWindowLabel } from "./order-state";
import { ReceiptForm } from "./receipt-form";
import { OrderStatePill, OutletLine, StoreIcon, WeatherChip } from "./store-parts";
import { arrivalView, awaitingReceipt, isLamp, lastReportedLine, stopsAndCountdown, todayCards } from "./today-view";

export const metadata: Metadata = { title: "Today · Katapatha" };
export const dynamic = "force-dynamic";

type StoreOrder = components["schemas"]["StoreOrder"];
type Notification = components["schemas"]["Notification"];

const SHOWN_NOTIFICATIONS = 4;

/**
 * Today at the outlet (S-02, and S-04 when something has been delivered).
 *
 * One request carries the whole day, so the tracker, the stop count and the
 * counts above it cannot disagree. `?date=` exists so the screen can be read on
 * a day other than today (the demo's hero day is in April).
 *
 * Lamp Mode (S-03) is not drawn here: `/store/today` says nothing about when
 * the vehicle last reported, and a store cannot read `/fleet/positions`. Until
 * the API gives the outlet a report time there is nothing honest to show, so
 * the arrival stays what it is — a planned time, labelled as one.
 */
export default async function StoreTodayPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string | string[] }>;
}) {
  await requireRole("STORE_MANAGER", "/store");
  const query = await searchParams;
  const asked = Array.isArray(query.date) ? query.date[0] : query.date;
  const date = isDateOnly(asked) ? asked : undefined;

  const client = await api();
  const [result, vocabularies, notifications] = await Promise.all([
    client.GET("/store/today", { params: { query: date ? { date } : {} } }),
    client.GET("/reference/vocabularies").catch(() => null),
    client.GET("/notifications", { params: { query: { unread: "true" } } }).catch(() => null),
  ]);

  if (result.error || !result.data) {
    const failure = readFailure(result.response.status, "today's deliveries");
    return (
      <PageBody>
        <PageHeader title="Today at your outlet" />
        <ErrorPanel
          title={failure.title}
          detail={failure.detail}
          outcome={failure.outcome}
          action={<ButtonLink href="/store" variant="primary">Try again</ButtonLink>}
        />
      </PageBody>
    );
  }

  const today = result.data;
  const returnTo = date ? `/store?date=${date}` : "/store";
  const cards = todayCards(today);
  const waiting = awaitingReceipt(today.orders);
  const incoming = today.incoming ?? null;
  const reasons = reasonOptions(vocabularies?.data?.storeIssueReasons ?? DEFAULT_REASONS);
  const unread = notifications?.data?.items ?? [];

  return (
    <PageBody>
      <PageHeader
        title="Today at your outlet"
        aside={
          <>
            {today.weather ? <WeatherChip weather={today.weather} /> : null}
            <DateControl date={today.date} path="/store" />
          </>
        }
      />
      <OutletLine
        outletId={today.outletId}
        name={today.outletName}
        brand={today.brand}
        window={{ open: today.receivingWindowOpen, close: today.receivingWindowClose }}
      />

      <StatRow>
        <StatCard
          value={cards.expected.value}
          label="Expected today"
          foot={cards.expected.foot}
          footTone="info"
          tone="info"
          icon={<StoreIcon kind="truck" />}
        />
        <StatCard
          value={cards.confirmed.value}
          label="Confirmed"
          foot={cards.confirmed.foot}
          footTone={cards.confirmed.tone}
          tone={cards.confirmed.tone}
          icon={<StoreIcon kind="check" />}
        />
        <StatCard
          value={cards.pending.value}
          label="Pending"
          foot={cards.pending.foot}
          footTone={cards.pending.tone}
          tone={cards.pending.tone}
          icon={<StoreIcon kind="clock" />}
        />
        <StatCard
          value={cards.issues.value}
          label="Issues"
          foot={cards.issues.foot}
          footTone={cards.issues.tone}
          tone={cards.issues.tone === "good" ? "neutral" : cards.issues.tone}
          icon={<StoreIcon kind="alert" />}
        />
      </StatRow>

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex min-w-0 flex-col gap-5">
          {waiting.map((order) => (
            <section
              key={order.id}
              aria-label={`Confirm receipt of ${order.ref}`}
              className="rounded-card border border-line bg-surface p-4 sm:p-5"
            >
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-lg font-bold text-ink">{order.ref} delivered</h2>
                <StatusPill label="Delivered" tone="good" />
              </div>
              <p className="mt-1 text-sm text-muted">
                {order.vehicleId ? `${order.vehicleId} · ` : ""}
                {goodsLabel(order.tempRequirement)} · check the count and confirm what arrived.
              </p>
              <div className="mt-4">
                <ReceiptForm
                  orderId={order.id}
                  orderRef={order.ref}
                  orderedUnits={order.units}
                  recordedUnits={order.deliveredUnits ?? null}
                  returnTo={returnTo}
                  reasons={reasons}
                />
              </div>
            </section>
          ))}

          {incoming ? (
            <section aria-labelledby="incoming-heading" className="rounded-card border border-line bg-surface p-4 sm:p-5">
              <h2 id="incoming-heading" className="text-lg font-bold text-ink">Incoming delivery</h2>
              <div className="mt-3 rounded-card border border-line p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex min-w-0 items-start gap-3">
                    <span aria-hidden className="grid size-11 shrink-0 place-items-center rounded-control bg-info-surface text-info-ink">
                      <StoreIcon kind="truck" />
                    </span>
                    <div className="min-w-0">
                      <p className="flex flex-wrap items-center gap-2">
                        <Link href={`/store/orders/${incoming.orderId}`} className="text-xl font-bold text-ink hover:underline">
                          {incoming.ref}
                        </Link>
                        <BrandPill brand={incoming.brand} />
                      </p>
                      <p className="mt-0.5 text-sm text-muted">
                        {plural(incoming.units, "unit")} · {goodsLabel(incoming.tempRequirement)} · {incoming.vehicleId}
                      </p>
                    </div>
                  </div>
                  <IncomingArrival incoming={incoming} window={receivingWindowLabel({ windowOpen: today.receivingWindowOpen, windowClose: today.receivingWindowClose })} />
                </div>

                {hasItems(incoming.items) ? (
                  <div className="mt-4 rounded-control bg-raised p-3">
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">What is on its way</h3>
                    <OrderItems items={incoming.items} mode="responsive" className="mt-1" />
                  </div>
                ) : null}

                <div className="mt-5">
                  <Tracker
                    steps={incoming.steps.map((step) => ({
                      label: step.label,
                      detail: step.detail,
                      state: step.state,
                    }))}
                  />
                </div>

                {isLamp(incoming) ? (
                  <div role="status" className="mt-4 rounded-control border border-warn/30 bg-warn-surface px-3 py-2.5 text-sm text-ink">
                    <p className="flex flex-wrap items-center gap-2">
                      <StatusPill label="Lamp Mode" tone="warn" />
                      <span className="tabular font-bold">{lastReportedLine(incoming.report) ?? "No recent report from the vehicle"}</span>
                    </p>
                    <p className="mt-1.5 text-muted">
                      The driver&apos;s phone has not reported for a while, so the arrival is an estimate shown as a range. The driver keeps
                      working and recording; the steps above still show what has been recorded.
                    </p>
                  </div>
                ) : incoming.report ? (
                  <p className="tabular mt-4 text-sm font-semibold text-ink">{lastReportedLine(incoming.report)}</p>
                ) : null}

                <p className="mt-3 rounded-control bg-raised px-3 py-2 text-xs text-muted">
                  {stopsAndCountdown(incoming)}. {arrivalView(incoming).source} The planned leg from {incoming.depotCode} to {incoming.districtName} is
                  about {incoming.legMinutes} min in free-flow traffic. Katapatha shows the driver&apos;s last report and its age, not a map.
                </p>
              </div>
            </section>
          ) : waiting.length === 0 ? (
            <EmptyState
              title="No delivery on its way"
              detail={
                today.orders.length === 0
                  ? "Nothing is planned for this outlet on this day."
                  : "Everything planned for this day has been delivered or moved."
              }
              action={<ButtonLink href="/store/new" variant="primary">Place an order</ButtonLink>}
            />
          ) : null}

          <section aria-labelledby="deliveries-heading" className="rounded-card border border-line bg-surface p-4 sm:p-5">
            <h2 id="deliveries-heading" className="mb-3 text-lg font-bold text-ink">
              Today&apos;s deliveries ({today.orders.length})
            </h2>
            <DeliveriesTable orders={today.orders} incoming={incoming} window={receivingWindowLabel({ windowOpen: today.receivingWindowOpen, windowClose: today.receivingWindowClose })} />

            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-card bg-good-surface p-4">
              <div>
                <p className="font-bold text-ink">Need to place an order?</p>
                <p className="text-sm text-muted">Orders are for the next operating day.</p>
              </div>
              <ButtonLink href="/store/new">Place an order</ButtonLink>
            </div>
          </section>

          {unread.length > 0 ? (
            <section aria-label="Notifications" className="flex flex-col gap-2">
              {unread.slice(0, SHOWN_NOTIFICATIONS).map((note) => (
                <NotificationBanner key={note.id} note={note} returnTo={returnTo} />
              ))}
              {unread.length > SHOWN_NOTIFICATIONS ? (
                <p className="text-sm text-muted">
                  {plural(unread.length - SHOWN_NOTIFICATIONS, "more unread notification")} — dismiss these to see them.
                </p>
              ) : null}
            </section>
          ) : null}
        </div>

        <div className="flex min-w-0 flex-col gap-5">
          <section aria-labelledby="actions-heading" className="rounded-card border border-line bg-surface p-4 sm:p-5">
            <h2 id="actions-heading" className="text-lg font-bold text-ink">Quick actions</h2>
            <div className="mt-3 flex flex-col gap-2">
              <ButtonLink href="/store/new" variant="primary">
                <StoreIcon kind="plus" className="size-5" /> Place an order
              </ButtonLink>
              <ButtonLink href="/store/issues">
                <StoreIcon kind="alert" className="size-5" /> Report an issue
              </ButtonLink>
            </div>
          </section>

          <section aria-labelledby="window-heading" className="rounded-card border border-line bg-surface p-4 sm:p-5">
            <h2 id="window-heading" className="text-lg font-bold text-ink">Delivery window &amp; access</h2>
            <div className="mt-3 flex flex-col gap-3">
              <div className="rounded-control bg-raised p-3">
                <p className="text-sm text-muted">Receiving window</p>
                <p className="tabular text-xl font-bold text-ink">
                  {today.receivingWindowOpen} – {today.receivingWindowClose}
                </p>
                <p className="text-sm text-muted">{longDate(today.date)}</p>
              </div>
              <div className="rounded-control bg-raised p-3">
                <p className="text-sm text-muted">Access notes</p>
                <p className="text-sm font-semibold text-ink">{today.accessNote}</p>
              </div>
            </div>
          </section>

          <section aria-labelledby="outlet-heading" className="rounded-card border border-line bg-surface p-4 sm:p-5">
            <h2 id="outlet-heading" className="text-lg font-bold text-ink">Outlet information</h2>
            <dl className="mt-3 grid grid-cols-[auto_1fr] items-center gap-x-6 gap-y-2 text-sm">
              <dt className="text-muted">Outlet ID</dt>
              <dd className="font-semibold text-ink">{today.outletId}</dd>
              <dt className="text-muted">Name</dt>
              <dd className="font-semibold text-ink">{today.outletName}</dd>
              {today.brand ? (
                <>
                  <dt className="text-muted">Brand</dt>
                  <dd><BrandPill brand={today.brand} /></dd>
                </>
              ) : null}
            </dl>
          </section>
        </div>
      </div>
    </PageBody>
  );
}

/** The right-hand block of the incoming card: a plan, a report-based time or an estimate range. */
function IncomingArrival({
  incoming,
  window,
}: {
  incoming: components["schemas"]["IncomingDelivery"];
  window: string;
}) {
  const arrival = arrivalView(incoming);
  const lamp = isLamp(incoming);
  return (
    <div className="text-right">
      {lamp ? (
        <StatusPill label="Lamp Mode" tone="warn" />
      ) : (
        <StatusPill label={incoming.departed ? "On the way" : "Planned"} tone={incoming.departed ? "info" : "neutral"} />
      )}
      <p className="mt-2 text-xs text-muted">{arrival.label}</p>
      <p className={`tabular font-bold leading-tight text-ink ${arrival.basis === "estimate" ? "text-2xl" : "text-3xl"}`}>
        {arrival.basis === "estimate" ? <span className="text-sm font-semibold">about </span> : null}
        {arrival.headline}
      </p>
      <p className="tabular text-xs text-muted">Window {window}</p>
    </div>
  );
}

function arrivalCell(order: StoreOrder, incoming: components["schemas"]["IncomingDelivery"] | null) {
  if (order.state === "deferred") {
    return order.deferral?.rolledToDate ? shortDay(order.deferral.rolledToDate) : "No new date";
  }
  if (order.state === "delivered") return "Delivered";
  // The incoming order's row says what the incoming card says, so a range
  // under Lamp Mode is not contradicted by the plan's single time beside it.
  if (incoming && incoming.orderId === order.id) {
    const arrival = arrivalView(incoming);
    return arrival.basis === "estimate" ? `about ${arrival.headline}` : arrival.headline;
  }
  return order.etaAt ?? "Not planned yet";
}

function receiptNote(order: StoreOrder): string | null {
  if (order.state === "delivered") return order.receiptConfirmed ? "Receipt confirmed" : "Confirm receipt above";
  if (order.state === "deferred") {
    return order.deferral?.rolledToDate ? `Moves to ${shortDay(order.deferral.rolledToDate)}` : "Can't be delivered as ordered";
  }
  return null;
}

function DeliveriesTable({
  orders,
  incoming,
  window,
}: {
  orders: StoreOrder[];
  incoming: components["schemas"]["IncomingDelivery"] | null;
  window: string;
}) {
  return (
    <DataTable
      caption="Today's deliveries"
      empty={
        orders.length === 0 ? (
          <EmptyState title="No deliveries on this day" detail="Orders you place appear here once they are planned for this day." />
        ) : undefined
      }
      head={
        <tr>
          <Th>Order ref</Th>
          <Th>Brand</Th>
          <Th>Type</Th>
          <Th>Units</Th>
          <Th>Arrival</Th>
          <Th>Status</Th>
          <Th><span className="sr-only">Open</span></Th>
        </tr>
      }
      cards={orders.map((order) => (
        <RowCard key={order.id}>
          <Link href={`/store/orders/${order.id}`} className="block">
            <div className="flex items-start justify-between gap-3">
              <p className="font-mono font-bold text-ink">{order.ref}</p>
              <OrderStatePill state={order.state} />
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted">
              <BrandPill brand={order.brand} />
              <span>{goodsLabel(order.tempRequirement)}</span>
              <span className="tabular">{plural(order.units, "unit")}</span>
            </div>
            <p className="tabular mt-2 text-sm text-ink">
              {arrivalCell(order, incoming)} <span className="text-muted">· {window}</span>
            </p>
            {receiptNote(order) ? <p className="mt-1 text-xs font-semibold text-muted">{receiptNote(order)}</p> : null}
          </Link>
          <OrderItems items={order.items} mode="collapsible" />
        </RowCard>
      ))}
    >
      {orders.map((order) => (
        <Tr key={order.id}>
          <Td>
            <Link href={`/store/orders/${order.id}`} className="font-mono font-bold text-link hover:underline">
              {order.ref}
            </Link>
          </Td>
          <Td><BrandPill brand={order.brand} /></Td>
          <Td>{goodsLabel(order.tempRequirement)}</Td>
          <Td>
            <span className="tabular">{plural(order.units, "unit")}</span>
            <OrderItems items={order.items} mode="collapsible" />
          </Td>
          <Td>
            <span className="tabular font-semibold">{arrivalCell(order, incoming)}</span>
            <span className="tabular block text-xs text-muted">{window}</span>
          </Td>
          <Td>
            <OrderStatePill state={order.state} />
            {receiptNote(order) ? <span className="mt-1 block text-xs text-muted">{receiptNote(order)}</span> : null}
          </Td>
          <Td>
            <Link href={`/store/orders/${order.id}`} aria-label={`Open ${order.ref}`} className="inline-flex size-9 items-center justify-center rounded-control text-muted hover:bg-raised hover:text-ink">
              <StoreIcon kind="chevron" className="size-4" />
            </Link>
          </Td>
        </Tr>
      ))}
    </DataTable>
  );
}

function NotificationBanner({ note, returnTo }: { note: Notification; returnTo: string }) {
  return (
    <form
      action={markNotificationRead}
      className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-warn/30 bg-warn-surface p-4"
    >
      <input type="hidden" name="notificationId" value={note.id} />
      <input type="hidden" name="returnTo" value={returnTo} />
      <div className="flex min-w-0 items-start gap-3">
        <span aria-hidden className="mt-0.5 text-warn-ink"><StoreIcon kind="bell" /></span>
        <div className="min-w-0">
          <p className="font-bold text-ink">{note.title}</p>
          <p className="text-sm text-ink">{note.body}</p>
        </div>
      </div>
      <Button type="submit">Got it</Button>
    </form>
  );
}
