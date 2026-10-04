import Link from "next/link";
import type { components } from "@katapatha/contracts/types";
import { PageBody, PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";
import { BrandPill, StatusPill } from "@/components/ui/status-pill";
import { DataTable, RowCard, Td, Th, Tr } from "@/components/ui/data-table";
import { DateControl } from "@/components/ui/date-control";
import { SplitLayout } from "@/components/ui/detail-panel";
import { Tabs, type TabItem } from "@/components/ui/tabs";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState, ErrorPanel } from "@/components/ui/states";
import { requireRole } from "@/lib/auth";
import { longDate } from "@/lib/dates";
import { deskDate } from "../desk-date";
import { percent, plural } from "@/lib/format";
import { loadDay } from "../desk-data";
import { Glyph } from "../icons";
import {
  ORDER_STATUS,
  filterOrders,
  groupCounts,
  isBrand,
  isOrderGroup,
  isTemp,
  sumVolume,
  sumWeight,
  type OrderGroup,
} from "../order-status";
import { OrderPanel } from "./order-panel";
import { FilterBar } from "./filter-bar";

export const dynamic = "force-dynamic";

type Order = components["schemas"]["Order"];

const PER_PAGE = 20;

const TABS: { group: OrderGroup | null; label: string }[] = [
  { group: null, label: "All orders" },
  { group: "waiting", label: "Waiting" },
  { group: "allocated", label: "Allocated" },
  { group: "deferred", label: "Deferred" },
  { group: "attention", label: "Needs attention" },
  { group: "completed", label: "Completed" },
];

type Params = {
  date?: string;
  status?: string;
  brand?: string;
  temp?: string;
  q?: string;
  order?: string;
  tab?: string;
  page?: string;
};

/**
 * D-03 — every order for a day, with the selected one beside it.
 *
 * All of the state is in the URL: the tab is `status`, the filters are `brand`,
 * `temp` and `q`, the open record is `order`, its tab is `tab`. A dispatcher can
 * therefore send someone a link to "the deferred orders for the 9th", and the
 * back button undoes a filter. The list is filtered on the server over the day's
 * orders (the API returns the whole day, not pages).
 *
 * The design's "Vehicle / Trip" column is not here: /orders does not say which
 * trip an order rides, and inventing it from the plan would be a guess.
 */
export default async function DispatcherOrders({ searchParams }: { searchParams: Promise<Params> }) {
  await requireRole("DISPATCHER", "/dispatcher/orders");
  const query = await searchParams;
  const date = await deskDate(query.date);
  const group = isOrderGroup(query.status) ? query.status : undefined;
  const brand = isBrand(query.brand) ? query.brand : undefined;
  const temp = isTemp(query.temp) ? query.temp : undefined;
  const q = (query.q ?? "").trim().slice(0, 60);
  const tab = query.tab === "history" ? "history" : "overview";

  const loaded = await loadDay(date, "/dispatcher/orders", { fleet: false });
  const header = (
    <PageHeader
      title="Orders"
      subtitle="Every order for the day across Fresh, Style and Tech."
      aside={<DateControl date={date} path="/dispatcher/orders" keep={{ status: group, brand, temp, q: q || undefined }} />}
    />
  );
  if (!loaded.ok) {
    return (
      <PageBody>
        {header}
        <ErrorPanel
          {...loaded.failure}
          action={
            <ButtonLink href={`/dispatcher/orders?date=${date}`} variant="secondary">
              Try again
            </ButtonLink>
          }
        />
      </PageBody>
    );
  }

  const { orders, plan } = loaded.data;
  const counts = groupCounts(orders);
  const filtered = filterOrders(orders, { group, brand, temp, q });
  const pages = Math.max(1, Math.ceil(filtered.length / PER_PAGE));
  const page = Math.min(pages, Math.max(1, Number.parseInt(query.page ?? "1", 10) || 1));
  const visible = filtered.slice((page - 1) * PER_PAGE, page * PER_PAGE);
  const selected = orders.find((order) => order.id === query.order);

  // One builder for every link on the page, so a tab, a row and a page link all
  // keep the filters the dispatcher set and drop only what they change.
  const href = (changes: Partial<Record<keyof Params, string | null>>) => {
    const base: Params = { date, status: group, brand, temp, q: q || undefined, order: selected?.id, tab: selected ? tab : undefined };
    const next = { ...base, ...Object.fromEntries(Object.entries(changes).map(([k, v]) => [k, v ?? undefined])) } as Params;
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(next)) if (value) params.set(key, value);
    return `/dispatcher/orders?${params.toString()}`;
  };

  const tabs: TabItem[] = TABS.map(({ group: g, label }) => ({
    label,
    href: href({ status: g, page: null, order: null, tab: null }),
    current: (g ?? undefined) === group,
    count: g ? counts[g] : orders.length,
    alert: g === "deferred" || g === "attention",
  }));

  const filtering = Boolean(group || brand || temp || q);

  return (
    <PageBody>
      {header}

      <section aria-label="Orders at a glance" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <StatCard
          icon={<Glyph kind="orders" />}
          value={orders.length}
          label="Total orders"
          foot={`${sumVolume(orders).toFixed(1)} m³ · ${(sumWeight(orders) / 1000).toFixed(1)} t`}
        />
        <StatCard
          icon={<Glyph kind="truck" />}
          value={counts.allocated}
          label="Allocated"
          foot={`${percent(counts.allocated, orders.length)}% of the day`}
          footTone="good"
        />
        <StatCard
          icon={<Glyph kind="alert" />}
          value={counts.deferred}
          label="Deferred"
          foot={`${percent(counts.deferred, orders.length)}% of the day`}
          footTone={counts.deferred ? "bad" : "neutral"}
        />
        <StatCard
          icon={<Glyph kind="alert" />}
          value={counts.attention}
          label="Needs attention"
          foot="Deferred, failed or part delivered"
          footTone={counts.attention ? "warn" : "neutral"}
        />
        <StatCard
          icon={<Glyph kind="check" />}
          value={counts.completed}
          label="Completed"
          foot={`${percent(counts.completed, orders.length)}% of the day`}
        />
      </section>

      <div className="flex flex-col gap-4">
        <Tabs items={tabs} label="Order groups" />
        <FilterBar date={date} group={group} brand={brand} temp={temp} q={q} clearHref={href({ brand: null, temp: null, q: null, status: null, page: null, order: null, tab: null })} filtering={filtering} />
      </div>

      <SplitLayout
        list={
          <div className="flex flex-col gap-3">
            <OrdersTable orders={visible} href={href} selectedId={selected?.id} filtering={filtering} />
            {filtered.length > 0 ? (
              <nav aria-label="Pages" className="flex flex-wrap items-center justify-between gap-3 text-sm">
                <p className="tabular text-muted">
                  {(page - 1) * PER_PAGE + 1}–{Math.min(page * PER_PAGE, filtered.length)} of {plural(filtered.length, "order")}
                </p>
                {pages > 1 ? (
                  <div className="flex items-center gap-2">
                    <PageLink disabled={page <= 1} href={href({ page: String(page - 1) })}>
                      Previous
                    </PageLink>
                    <span className="tabular text-muted">
                      Page {page} of {pages}
                    </span>
                    <PageLink disabled={page >= pages} href={href({ page: String(page + 1) })}>
                      Next
                    </PageLink>
                  </div>
                ) : null}
              </nav>
            ) : null}
          </div>
        }
        panel={
          selected ? (
            <div id="order-details" className="scroll-mt-4">
              <OrderPanel
                order={selected}
                date={date}
                tab={tab}
                planId={plan?.planId}
                closeHref={href({ order: null, tab: null })}
                overviewHref={href({ tab: null })}
                historyHref={href({ tab: "history" })}
              />
            </div>
          ) : (
            <aside className="rounded-card border border-dashed border-line bg-surface p-6 text-sm text-muted lg:sticky lg:top-4">
              <p className="font-semibold text-ink">No order selected</p>
              <p className="mt-1">Pick an order to see its outlet, its window and its history for {longDate(date)}.</p>
            </aside>
          )
        }
      />
    </PageBody>
  );
}

function PageLink({ href, disabled, children }: { href: string; disabled: boolean; children: React.ReactNode }) {
  const cls = "inline-flex min-h-11 items-center rounded-control border border-line bg-surface px-3 font-semibold";
  return disabled ? (
    <span aria-disabled="true" className={`${cls} cursor-not-allowed opacity-50`}>
      {children}
    </span>
  ) : (
    <Link href={href} className={`${cls} hover:bg-raised`}>
      {children}
    </Link>
  );
}

function OrdersTable({
  orders,
  href,
  selectedId,
  filtering,
}: {
  orders: Order[];
  href: (changes: Partial<Record<keyof Params, string | null>>) => string;
  selectedId: string | undefined;
  filtering: boolean;
}) {
  // The hash matters on a phone, where the panel sits below the list.
  const open = (order: Order) => `${href({ order: order.id, tab: null })}#order-details`;
  return (
    <DataTable
      caption="Orders"
      empty={
        orders.length === 0 ? (
          <EmptyState
            title={filtering ? "No orders match these filters" : "No orders for this day"}
            detail={filtering ? "Clear a filter or pick another tab." : "Orders appear here as outlets place them."}
          />
        ) : undefined
      }
      head={
        <tr>
          <Th>Order</Th>
          <Th>Outlet</Th>
          <Th>Brand</Th>
          <Th>Load</Th>
          <Th numeric>Units</Th>
          <Th numeric>Volume</Th>
          <Th numeric>Weight</Th>
          <Th>Window</Th>
          <Th>Status</Th>
        </tr>
      }
      cards={orders.map((order) => (
        <RowCard key={order.id}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <Link
                href={open(order)}
                aria-current={order.id === selectedId ? "true" : undefined}
                className="font-mono font-semibold text-link underline-offset-2 hover:underline"
              >
                {order.ref}
              </Link>
              <p className="mt-0.5 text-sm text-muted">
                {order.outletId} · {order.districtName ?? "District not set"}
              </p>
            </div>
            <StatusPill {...ORDER_STATUS[order.status]} />
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted">
            <BrandPill brand={order.brand} />
            <span className="capitalize">{order.tempRequirement}</span>
            <span className="tabular">{order.units} units</span>
            <span className="tabular">{order.volumeM3 != null ? `${order.volumeM3.toFixed(1)} m³` : "—"}</span>
            <span className="tabular">{order.windowOpen && order.windowClose ? `${order.windowOpen}–${order.windowClose}` : "No window"}</span>
          </div>
        </RowCard>
      ))}
    >
      {orders.map((order) => (
        <Tr key={order.id} selected={order.id === selectedId}>
          <Td>
            <Link
              href={open(order)}
              aria-current={order.id === selectedId ? "true" : undefined}
              className="whitespace-nowrap font-mono font-semibold text-link underline-offset-2 hover:underline"
            >
              {order.ref}
            </Link>
          </Td>
          <Td>
            <span className="font-semibold text-ink">{order.outletId}</span>
            <span className="block text-xs text-muted">{order.districtName ?? "District not set"}</span>
          </Td>
          <Td>
            <BrandPill brand={order.brand} />
          </Td>
          <Td>
            <span className="capitalize">{order.tempRequirement}</span>
          </Td>
          <Td numeric>{order.units}</Td>
          <Td numeric>{order.volumeM3 != null ? `${order.volumeM3.toFixed(1)} m³` : "—"}</Td>
          <Td numeric>
            <span className="whitespace-nowrap">{order.weightKg != null ? `${Math.round(order.weightKg)} kg` : "—"}</span>
          </Td>
          <Td>
            <span className="whitespace-nowrap">{order.windowOpen && order.windowClose ? `${order.windowOpen}–${order.windowClose}` : "—"}</span>
          </Td>
          <Td>
            <StatusPill {...ORDER_STATUS[order.status]} />
          </Td>
        </Tr>
      ))}
    </DataTable>
  );
}
