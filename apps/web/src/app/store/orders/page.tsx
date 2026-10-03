import type { Metadata } from "next";
import Link from "next/link";
import type { components } from "@katapatha/contracts/types";
import { shortDay } from "@katapatha/core/domain/deferral";
import { api } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { readFailure } from "@/lib/failures";
import { plural } from "@/lib/format";
import { BrandPill } from "@/components/ui/status-pill";
import { ButtonLink } from "@/components/ui/button";
import { DataTable, RowCard, Td, Th, Tr } from "@/components/ui/data-table";
import { PageBody, PageHeader } from "@/components/ui/page-header";
import { StatCard, StatRow } from "@/components/ui/stat-card";
import { EmptyState, ErrorPanel } from "@/components/ui/states";
import { OrderItems } from "@/components/ui/order-items";
import { Tabs } from "@/components/ui/tabs";
import { matchesQuery, matchesTab, newestFirst, paginate, parseTab, tabCounts, ORDER_TABS } from "../order-list";
import { goodsLabel, receivingWindowLabel, storeState } from "../order-state";
import { OrderStatePill, StoreIcon } from "../store-parts";
import { describeIssue } from "../issue-view";

export const metadata: Metadata = { title: "My orders · Katapatha" };
export const dynamic = "force-dynamic";

type Order = components["schemas"]["Order"];

const PAGE_SIZE = 10;

/**
 * My orders (S-05): every order the outlet has placed, filtered by where it is.
 *
 * The design's side panel (items by product, a timestamped timeline, the
 * driver's name) is carried by the order's own page instead; the list shows
 * each order's products as a disclosure under its units, and has no placed-at
 * time to build a timeline from.
 */
export default async function StoreOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string; page?: string }>;
}) {
  await requireRole("STORE_MANAGER", "/store/orders");
  const query = await searchParams;
  const tab = parseTab(query.status);
  const search = (Array.isArray(query.q) ? query.q[0] : query.q) ?? "";

  const client = await api();
  const [orders, issues] = await Promise.all([client.GET("/orders"), client.GET("/issues").catch(() => null)]);

  if (orders.error || !orders.data) {
    const failure = readFailure(orders.response.status, "your orders");
    return (
      <PageBody>
        <PageHeader title="My orders" />
        <ErrorPanel
          title={failure.title}
          detail={failure.detail}
          outcome={failure.outcome}
          action={<ButtonLink href="/store/orders" variant="primary">Try again</ButtonLink>}
        />
      </PageBody>
    );
  }

  const all = newestFirst(orders.data);
  const counts = tabCounts(all);
  const filtered = all.filter((order) => matchesTab(storeState(order), tab) && matchesQuery(order.ref, search));
  const page = paginate(filtered, query.page, PAGE_SIZE);

  const queued = all.filter((order) => storeState(order) === "queued").length;
  const delivered = counts.delivered;
  const openIssues = (issues?.data ?? []).filter((issue) => issue.status !== "RESOLVED");
  const latestOpen = openIssues[0];

  const hrefFor = (overrides: { status?: string; page?: number }) => {
    const params = new URLSearchParams();
    const status = overrides.status ?? tab;
    if (status !== "all") params.set("status", status);
    if (search) params.set("q", search);
    if (overrides.page && overrides.page > 1) params.set("page", String(overrides.page));
    const qs = params.toString();
    return qs ? `/store/orders?${qs}` : "/store/orders";
  };

  return (
    <PageBody>
      <PageHeader
        title="My orders"
        subtitle="Where each order is, and how it ended."
        action={<ButtonLink href="/store/new" variant="primary">Place an order</ButtonLink>}
      />

      <StatRow>
        <StatCard value={counts.open} label="Open orders" foot={counts.open === 0 ? "Nothing on its way" : "Queued, planned or on the way"} footTone="info" tone={counts.open === 0 ? "neutral" : "info"} icon={<StoreIcon kind="truck" />} />
        <StatCard value={queued} label="Not yet planned" foot={queued === 0 ? "Everything is planned" : "Waiting for dispatch to plan the run"} footTone={queued === 0 ? "neutral" : "warn"} tone={queued === 0 ? "neutral" : "warn"} icon={<StoreIcon kind="clock" />} />
        <StatCard value={delivered} label="Delivered" foot="All time" footTone="good" tone="good" icon={<StoreIcon kind="check" />} />
        <StatCard
          value={openIssues.length}
          label="Open issues"
          foot={latestOpen ? `${latestOpen.orderRef} · ${describeIssue(latestOpen)}` : "No open issues"}
          footTone={latestOpen ? "bad" : "good"}
          tone={latestOpen ? "bad" : "neutral"}
          icon={<StoreIcon kind="alert" />}
        />
      </StatRow>

      <section aria-label="Orders" className="rounded-card border border-line bg-surface p-4 sm:p-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <Tabs
            label="Filter orders"
            items={ORDER_TABS.map((t) => ({
              label: t.label,
              href: hrefFor({ status: t.value }),
              current: t.value === tab,
              count: counts[t.value],
              alert: t.value === "deferred",
            }))}
          />
          <form method="get" action="/store/orders" role="search" className="flex items-center gap-2">
            {tab !== "all" ? <input type="hidden" name="status" value={tab} /> : null}
            <label className="sr-only" htmlFor="order-search">Search by order reference</label>
            <input
              id="order-search"
              name="q"
              type="search"
              defaultValue={search}
              placeholder="Search order ref…"
              className="min-h-11 w-full min-w-0 rounded-control border border-line bg-surface px-3 text-sm lg:w-56"
            />
            <button type="submit" className="min-h-11 rounded-control border border-line px-3 text-sm font-semibold text-ink hover:bg-raised">
              Search
            </button>
          </form>
        </div>

        <div className="mt-4">
          <OrdersTable orders={page.items} filtered={filtered.length === 0} hasAny={all.length > 0} />
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm text-muted">
          <p className="tabular">
            {page.total === 0 ? "No orders" : `${page.from}–${page.to} of ${plural(page.total, "order")}`}
          </p>
          {page.pages > 1 ? (
            <nav aria-label="Pages" className="flex items-center gap-1">
              {page.page > 1 ? (
                <Link href={hrefFor({ page: page.page - 1 })} className="inline-flex min-h-11 items-center rounded-control border border-line px-3 font-semibold text-ink hover:bg-raised">
                  Previous
                </Link>
              ) : null}
              <span className="tabular px-2">Page {page.page} of {page.pages}</span>
              {page.page < page.pages ? (
                <Link href={hrefFor({ page: page.page + 1 })} className="inline-flex min-h-11 items-center rounded-control border border-line px-3 font-semibold text-ink hover:bg-raised">
                  Next
                </Link>
              ) : null}
            </nav>
          ) : null}
        </div>
      </section>
    </PageBody>
  );
}

function deliveryCell(order: Order, state: string) {
  if (state === "deferred") {
    return order.deferral?.rolledToDate ? `Moves to ${shortDay(order.deferral.rolledToDate)}` : "Not rescheduled";
  }
  if (state === "cancelled") return "—";
  return `${shortDay(order.requestedDate)} · ${receivingWindowLabel(order)}`;
}

function OrdersTable({ orders, filtered, hasAny }: { orders: Order[]; filtered: boolean; hasAny: boolean }) {
  return (
    <DataTable
      caption="Orders for this outlet"
      empty={
        orders.length === 0 ? (
          <EmptyState
            title={hasAny && filtered ? "No orders match" : "No orders yet"}
            detail={hasAny && filtered ? "Try another filter or search." : "Orders you place show up here with their status."}
            action={hasAny && filtered ? undefined : <ButtonLink href="/store/new" variant="primary">Place an order</ButtonLink>}
          />
        ) : undefined
      }
      head={
        <tr>
          <Th>Order ref</Th>
          <Th>Brand</Th>
          <Th>Type</Th>
          <Th>Units</Th>
          <Th>Delivery</Th>
          <Th>Status</Th>
          <Th><span className="sr-only">Open</span></Th>
        </tr>
      }
      cards={orders.map((order) => {
        const state = storeState(order);
        return (
          <RowCard key={order.id}>
            <Link href={`/store/orders/${order.id}`} className="block">
              <div className="flex items-start justify-between gap-3">
                <p className="font-mono font-bold text-ink">{order.ref}</p>
                <OrderStatePill state={state} />
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted">
                <BrandPill brand={order.brand} />
                <span>{goodsLabel(order.tempRequirement)}</span>
                <span className="tabular">{plural(order.units, "unit")}</span>
              </div>
              <p className="tabular mt-2 text-sm text-ink">{deliveryCell(order, state)}</p>
            </Link>
            {/* Outside the link: opening the list must not open the order. */}
            <OrderItems items={order.items} mode="collapsible" />
          </RowCard>
        );
      })}
    >
      {orders.map((order) => {
        const state = storeState(order);
        return (
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
            <Td><span className="tabular">{deliveryCell(order, state)}</span></Td>
            <Td><OrderStatePill state={state} /></Td>
            <Td>
              <Link href={`/store/orders/${order.id}`} aria-label={`Open ${order.ref}`} className="inline-flex size-9 items-center justify-center rounded-control text-muted hover:bg-raised hover:text-ink">
                <StoreIcon kind="chevron" className="size-4" />
              </Link>
            </Td>
          </Tr>
        );
      })}
    </DataTable>
  );
}
