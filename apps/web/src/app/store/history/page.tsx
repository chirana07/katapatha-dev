import type { Metadata } from "next";
import Link from "next/link";
import type { components } from "@katapatha/contracts/types";
import { api } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { shortDate, todayInColombo } from "@/lib/dates";
import { readFailure } from "@/lib/failures";
import { plural } from "@/lib/format";
import { BrandPill, StatusPill } from "@/components/ui/status-pill";
import { ButtonLink } from "@/components/ui/button";
import { DataTable, RowCard, Td, Th, Tr } from "@/components/ui/data-table";
import { PageBody, PageHeader } from "@/components/ui/page-header";
import { StatCard, StatRow } from "@/components/ui/stat-card";
import { EmptyState, ErrorPanel } from "@/components/ui/states";
import { OrderItems } from "@/components/ui/order-items";
import {
  HISTORY_RANGES,
  RESULT_FILTERS,
  historyOutcome,
  matchesResult,
  parseRange,
  parseResult,
  rangeStart,
  recordedAgainstOrdered,
  type Outcome,
} from "../history-view";
import { newestFirst, paginate } from "../order-list";
import { goodsLabel, receivingWindowLabel, storeState } from "../order-state";
import { StoreIcon } from "../store-parts";

export const metadata: Metadata = { title: "Delivery history · Katapatha" };
export const dynamic = "force-dynamic";

type Order = components["schemas"]["Order"];
type StoreOrder = components["schemas"]["StoreOrder"];

const PAGE_SIZE = 10;
const CLOSED = new Set(["delivered", "deferred", "cancelled", "failed"]);

/**
 * Delivery history (S-09): orders that have reached an outcome, with how each
 * one ended.
 *
 * What the design shows beyond this — arrival times, on-time rate, vehicle and
 * driver per delivery, a proof-of-delivery image — is not recorded for the
 * outlet, so the outcome here is built from what is: the units the driver
 * recorded against the units ordered, whether the receipt was confirmed, and
 * the issues raised. Receipt state is read per day, for the rows on screen.
 */
export default async function DeliveryHistoryPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string; result?: string; page?: string }>;
}) {
  await requireRole("STORE_MANAGER", "/store/history");
  const query = await searchParams;
  const range = parseRange(query.range);
  const resultFilter = parseResult(query.result);

  const client = await api();
  const [orders, issues] = await Promise.all([client.GET("/orders"), client.GET("/issues").catch(() => null)]);

  if (orders.error || !orders.data) {
    const failure = readFailure(orders.response.status, "your delivery history");
    return (
      <PageBody>
        <PageHeader title="Delivery history" />
        <ErrorPanel
          title={failure.title}
          detail={failure.detail}
          outcome={failure.outcome}
          action={<ButtonLink href="/store/history" variant="primary">Try again</ButtonLink>}
        />
      </PageBody>
    );
  }

  const start = rangeStart(range, todayInColombo());
  const closed = newestFirst(
    orders.data.filter((order) => CLOSED.has(storeState(order)) && (start == null || order.requestedDate >= start)),
  );
  const issuesByOrder = new Map<string, components["schemas"]["Issue"][]>();
  for (const issue of issues?.data ?? []) {
    issuesByOrder.set(issue.orderId, [...(issuesByOrder.get(issue.orderId) ?? []), issue]);
  }

  // Receipt state is per day. Look up only the days whose delivered orders
  // can be seen, so the cost is bounded by the filter, not the history.
  const deliveredDates = [...new Set(closed.filter((o) => storeState(o) === "delivered").map((o) => o.requestedDate))];
  const days = await Promise.all(
    deliveredDates.slice(0, 40).map(async (date) => {
      const day = await client.GET("/store/today", { params: { query: { date } } }).catch(() => null);
      return [date, day?.data?.orders ?? []] as const;
    }),
  );
  const detail = new Map<string, StoreOrder>();
  for (const [, dayOrders] of days) for (const o of dayOrders) detail.set(o.id, o);

  const rows = closed.map((order) => {
    const d = detail.get(order.id);
    const outcome = historyOutcome({
      state: storeState(order),
      units: order.units,
      deliveredUnits: d?.deliveredUnits,
      receiptConfirmed: d?.receiptConfirmed,
      deferral: order.deferral,
      issues: issuesByOrder.get(order.id),
    });
    return { order, outcome, deliveredUnits: d?.deliveredUnits };
  });
  const visible = rows.filter((row) => matchesResult(row.outcome, resultFilter));
  const page = paginate(visible, query.page, PAGE_SIZE);

  const received = rows.filter((row) => storeState(row.order) === "delivered").length;
  const notDelivered = rows.length - received;
  const allIssues = issues?.data ?? [];
  const openIssues = allIssues.filter((issue) => issue.status !== "RESOLVED").length;

  const hrefFor = (next: { range?: string; result?: string; page?: number }) => {
    const params = new URLSearchParams();
    const r = next.range ?? range;
    const f = next.result ?? resultFilter;
    if (r !== "all") params.set("range", r);
    if (f !== "all") params.set("result", f);
    if (next.page && next.page > 1) params.set("page", String(next.page));
    const qs = params.toString();
    return qs ? `/store/history?${qs}` : "/store/history";
  };

  return (
    <PageBody>
      <PageHeader title="Delivery history" subtitle="How each order ended: what the driver recorded, and what you confirmed." />

      <StatRow>
        <StatCard value={received} label="Delivered" foot={HISTORY_RANGES.find((r) => r.value === range)?.label} footTone="good" tone="good" icon={<StoreIcon kind="check" />} />
        <StatCard value={notDelivered} label="Not delivered" foot={notDelivered === 0 ? "No gaps" : "Deferred or cancelled"} footTone={notDelivered === 0 ? "neutral" : "warn"} tone={notDelivered === 0 ? "neutral" : "warn"} icon={<StoreIcon kind="clock" />} />
        <StatCard value={openIssues} label="Open issues" foot={openIssues === 0 ? "None open" : "Waiting on dispatch"} footTone={openIssues === 0 ? "good" : "bad"} tone={openIssues === 0 ? "neutral" : "bad"} icon={<StoreIcon kind="alert" />} />
        <StatCard value={allIssues.length - openIssues} label="Resolved issues" foot="All time" footTone="neutral" icon={<StoreIcon kind="bell" />} />
      </StatRow>

      <section aria-label="Delivered orders" className="rounded-card border border-line bg-surface p-4 sm:p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
          <FilterLinks label="Period" current={range} items={HISTORY_RANGES.map((r) => ({ value: r.value, label: r.label, href: hrefFor({ range: r.value }) }))} />
          <FilterLinks label="Result" current={resultFilter} items={RESULT_FILTERS.map((f) => ({ value: f.value, label: f.label, href: hrefFor({ result: f.value }) }))} />
        </div>

        <div className="mt-4">
          <HistoryTable rows={page.items} />
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm text-muted">
          <p className="tabular">{page.total === 0 ? "No deliveries" : `${page.from}–${page.to} of ${plural(page.total, "order")}`}</p>
          {page.pages > 1 ? (
            <nav aria-label="Pages" className="flex items-center gap-1">
              {page.page > 1 ? (
                <Link href={hrefFor({ page: page.page - 1 })} className="inline-flex min-h-11 items-center rounded-control border border-line px-3 font-semibold text-ink hover:bg-raised">Previous</Link>
              ) : null}
              <span className="tabular px-2">Page {page.page} of {page.pages}</span>
              {page.page < page.pages ? (
                <Link href={hrefFor({ page: page.page + 1 })} className="inline-flex min-h-11 items-center rounded-control border border-line px-3 font-semibold text-ink hover:bg-raised">Next</Link>
              ) : null}
            </nav>
          ) : null}
        </div>
      </section>
    </PageBody>
  );
}

function FilterLinks({
  label,
  current,
  items,
}: {
  label: string;
  current: string;
  items: { value: string; label: string; href: string }[];
}) {
  return (
    <nav aria-label={label} className="flex flex-wrap gap-1">
      {items.map((item) => (
        <Link
          key={item.value}
          href={item.href}
          aria-current={item.value === current ? "page" : undefined}
          className={`inline-flex min-h-11 items-center rounded-control border px-3 text-sm font-semibold ${
            item.value === current ? "border-action bg-warn-surface text-ink" : "border-line text-muted hover:bg-raised hover:text-ink"
          }`}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}

function OutcomeCell({ outcome }: { outcome: Outcome }) {
  return (
    <>
      <StatusPill label={outcome.label} tone={outcome.tone} />
      {outcome.notes.map((note) => (
        <span key={note} className="mt-1 block text-xs text-muted">{note}</span>
      ))}
    </>
  );
}

function HistoryTable({ rows }: { rows: { order: Order; outcome: Outcome; deliveredUnits: number | null | undefined }[] }) {
  return (
    <DataTable
      caption="Delivery history"
      empty={
        rows.length === 0 ? (
          <EmptyState title="Nothing in this view" detail="Orders appear here once they are delivered, deferred or cancelled. Try another period or result." />
        ) : undefined
      }
      head={
        <tr>
          <Th>Date</Th>
          <Th>Order</Th>
          <Th>Type</Th>
          <Th>Window</Th>
          <Th numeric>Driver recorded</Th>
          <Th>Result</Th>
        </tr>
      }
      cards={rows.map(({ order, outcome, deliveredUnits }) => (
        <RowCard key={order.id}>
          <Link href={`/store/orders/${order.id}`} className="block">
            <div className="flex items-start justify-between gap-3">
              <p className="font-mono font-bold text-ink">{order.ref}</p>
              <div className="text-right"><OutcomeCell outcome={outcome} /></div>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted">
              <BrandPill brand={order.brand} />
              <span>{goodsLabel(order.tempRequirement)}</span>
              <span className="tabular">{shortDate(order.requestedDate)} · {receivingWindowLabel(order)}</span>
            </div>
            {storeState(order) === "delivered" ? (
              <p className="tabular mt-2 text-sm text-ink">
                Driver recorded <span className="font-semibold">{recordedAgainstOrdered(deliveredUnits, order.units)}</span> units
              </p>
            ) : null}
          </Link>
          <OrderItems items={order.items} mode="collapsible" />
        </RowCard>
      ))}
    >
      {rows.map(({ order, outcome, deliveredUnits }) => (
        <Tr key={order.id}>
          <Td><span className="tabular">{shortDate(order.requestedDate)}</span></Td>
          <Td>
            <Link href={`/store/orders/${order.id}`} className="font-mono font-bold text-link hover:underline">{order.ref}</Link>
            <OrderItems items={order.items} mode="collapsible" />
          </Td>
          <Td>{goodsLabel(order.tempRequirement)}</Td>
          <Td><span className="tabular">{receivingWindowLabel(order)}</span></Td>
          <Td numeric>{storeState(order) === "delivered" ? recordedAgainstOrdered(deliveredUnits, order.units) : "—"}</Td>
          <Td><OutcomeCell outcome={outcome} /></Td>
        </Tr>
      ))}
    </DataTable>
  );
}
