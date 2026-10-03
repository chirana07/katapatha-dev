import Link from "next/link";
import type { components } from "@katapatha/contracts/types";
import { PageBody, PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";
import { BrandPill, StatusPill, type Tone } from "@/components/ui/status-pill";
import { DataTable, RowCard, Td, Th, Tr } from "@/components/ui/data-table";
import { DateControl } from "@/components/ui/date-control";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState, ErrorPanel } from "@/components/ui/states";
import { api } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { dateParam, longDate } from "@/lib/dates";
import { clockTime, percent, plural } from "@/lib/format";
import { readFailure } from "@/lib/failures";
import { loadDay } from "./desk-data";
import { Flash } from "./flash";
import { Glyph } from "./icons";
import { NextStep } from "./next-step";
import { ORDER_STATUS, groupCounts, inGroup, sumVolume, sumWeight } from "./order-status";

export const dynamic = "force-dynamic";

type Order = components["schemas"]["Order"];

const SHOWN = 8;

/**
 * D-02 — the dashboard: what the day looks like and what to do next.
 *
 * Everything here is a count or a list from an endpoint (/planning-days,
 * /orders, /plans, /exceptions, /vehicles, /plans/{id}); there is no figure the
 * API does not stand behind. Where the design drew a weather chip, a "+12% from
 * yesterday" delta and a route map, this screen has none: no endpoint backs the
 * first two, and the schematic map is its own page.
 */
export default async function DispatcherDashboard({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; error?: string; notice?: string; retry?: string }>;
}) {
  const user = await requireRole("DISPATCHER", "/dispatcher");
  const query = await searchParams;
  const date = dateParam(query.date);
  const withDate = (path: string) => `${path}?date=${date}`;

  const loaded = await loadDay(date, "/dispatcher");
  if (!loaded.ok) {
    return (
      <PageBody>
        <PageHeader title="Delivery operations" subtitle={`${user.depotCode ?? "Depot"} · ${longDate(date)}`} aside={<DateControl date={date} path="/dispatcher" />} />
        <ErrorPanel
          {...loaded.failure}
          action={
            <ButtonLink href={withDate("/dispatcher")} variant="secondary">
              Try again
            </ButtonLink>
          }
        />
      </PageBody>
    );
  }

  const { day, orders, plan } = loaded.data;
  const client = await api();
  // Each of these is a side panel: if one cannot load, the dashboard says so in
  // that panel and the rest still works.
  const [exceptions, vehicles, planDetail] = await Promise.all([
    client.GET("/exceptions", { params: { query: { date, status: "open" } } }).catch(() => null),
    client.GET("/vehicles", { params: { query: { date } } }).catch(() => null),
    plan ? client.GET("/plans/{planId}", { params: { path: { planId: plan.planId } } }).catch(() => null) : Promise.resolve(null),
  ]);
  const exceptionList = exceptions?.data ?? null;
  const fleet = vehicles?.data ?? null;
  const detail = planDetail?.data ?? null;

  const counts = groupCounts(orders);
  const chilled = orders.filter((o) => o.tempRequirement === "chilled").length;
  const served = plan?.stats.served;
  const deferred = plan?.stats.deferred ?? counts.deferred;
  const pendingDeferrals = detail ? detail.deferrals.filter((d) => !d.reasonCode).length : 0;
  const attentionFirst = [...orders].sort((a, b) => Number(inGroup(b.status, "attention")) - Number(inGroup(a.status, "attention")));
  const shown = attentionFirst.slice(0, SHOWN);
  const requestId = validRetry(query.retry) ?? crypto.randomUUID();

  const attentionBits = [
    counts.deferred ? plural(counts.deferred, "deferred order") : null,
    orders.filter((o) => o.status === "FAILED").length ? plural(orders.filter((o) => o.status === "FAILED").length, "failed delivery", "failed deliveries") : null,
    orders.filter((o) => o.status === "PART_DELIVERED").length ? `${orders.filter((o) => o.status === "PART_DELIVERED").length} part delivered` : null,
  ].filter(Boolean);
  const openExceptions = exceptionList?.summary.open ?? 0;

  return (
    <PageBody>
      <PageHeader
        title="Delivery operations"
        subtitle={`${user.depotCode ?? "Depot"} depot · ${longDate(date)}`}
        aside={
          <>
            <span className="tabular text-xs text-muted">Page loaded {clockTime(new Date().toISOString())}</span>
            <DateControl date={date} path="/dispatcher" />
          </>
        }
      />

      <Flash notice={query.notice} error={query.error} context={{ pendingDeferrals }} />

      {attentionBits.length > 0 || openExceptions > 0 ? (
        <section aria-label="Needs your attention" className="rounded-card border border-warn/30 bg-warn-surface p-4">
          <p className="font-semibold text-warn-ink">Needs your attention</p>
          <ul className="mt-2 flex flex-col gap-1 text-sm">
            {attentionBits.length > 0 ? (
              <li>
                <Link href={`/dispatcher/orders?date=${date}&status=attention`} className="font-semibold text-link underline-offset-2 hover:underline">
                  {plural(counts.attention, "order")} to look at
                </Link>
                <span className="text-muted"> · {attentionBits.join(" · ")}</span>
              </li>
            ) : null}
            {openExceptions > 0 ? (
              <li>
                <Link href={withDate("/dispatcher/exceptions")} className="font-semibold text-link underline-offset-2 hover:underline">
                  {plural(openExceptions, "open exception")}
                </Link>
                <span className="text-muted">
                  {exceptionList && exceptionList.summary.critical > 0 ? ` · ${exceptionList.summary.critical} critical` : ""}
                </span>
              </li>
            ) : null}
          </ul>
        </section>
      ) : null}

      <section aria-label="Today at a glance" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <StatCard
          icon={<Glyph kind="orders" />}
          value={orders.length}
          label="Total orders"
          foot={orders.length ? `${chilled} chilled · ${orders.length - chilled} ambient` : "None in the queue"}
        />
        <StatCard
          icon={<Glyph kind="check" />}
          value={served ?? "—"}
          label="Allocated"
          foot={plan ? `${percent(plan.stats.served, plan.stats.orders)}% of ${plural(plan.stats.orders, "order")} in the plan` : "No plan built yet"}
          footTone={plan ? "good" : "neutral"}
        />
        <StatCard
          icon={<Glyph kind="alert" />}
          value={deferred}
          label="Deferred"
          foot={deferred ? (pendingDeferrals ? `${pendingDeferrals} need a reason` : "Each has a reason") : "None"}
          footTone={deferred ? "bad" : "neutral"}
        />
        <StatCard
          icon={<Glyph kind="alert" />}
          value={exceptionList ? exceptionList.summary.open : "—"}
          label="Open exceptions"
          foot={exceptionList ? (exceptionList.summary.critical ? `${exceptionList.summary.critical} critical` : "None critical") : "Could not be loaded"}
          footTone={exceptionList && exceptionList.summary.critical ? "bad" : "neutral"}
        />
        <StatCard
          icon={<Glyph kind="truck" />}
          value={fleet ? `${fleet.summary.available} of ${fleet.summary.total}` : "—"}
          label="Vehicles available"
          foot={fleet ? `${fleet.summary.refrigerated} refrigerated${fleet.summary.inWorkshop ? ` · ${fleet.summary.inWorkshop} in workshop` : ""}` : "Could not be loaded"}
          footTone={fleet && fleet.summary.inWorkshop ? "warn" : "neutral"}
        />
      </section>

      {day ? (
        <NextStep day={day} plan={plan} orderCount={orders.length} pendingDeferrals={pendingDeferrals} from="dashboard" requestId={requestId} />
      ) : (
        <EmptyState
          title={`No planning day for ${longDate(date)}`}
          detail="There is no operating day for this depot on that date. Pick another date to plan."
        />
      )}

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <section aria-labelledby="orders-heading" className="flex min-w-0 flex-col gap-3">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div>
              <h2 id="orders-heading" className="text-lg font-bold text-ink">
                Orders
              </h2>
              <p className="text-sm text-muted">
                {orders.length > shown.length ? `Showing ${shown.length} of ${orders.length}; ones that need attention come first.` : `${plural(orders.length, "order")} for the day.`}
              </p>
            </div>
            <Link href={withDate("/dispatcher/orders")} className="text-sm font-semibold text-link underline-offset-2 hover:underline">
              All orders
            </Link>
          </div>
          <OrdersGlance orders={shown} date={date} />
          {orders.length > 0 ? (
            <p className="tabular text-xs text-muted">
              {sumVolume(orders).toFixed(1)} m³ · {(sumWeight(orders) / 1000).toFixed(1)} t across all {orders.length} orders
            </p>
          ) : null}
        </section>

        <div className="flex min-w-0 flex-col gap-4">
          <ExceptionsPanel list={exceptionList} date={date} />
          <VehiclesPanel fleet={fleet} date={date} />
          <TripsPanel detail={detail} />
        </div>
      </div>
    </PageBody>
  );
}

function validRetry(value: string | undefined) {
  return value && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value) ? value : null;
}

function OrdersGlance({ orders, date }: { orders: Order[]; date: string }) {
  const href = (order: Order) => `/dispatcher/orders?date=${date}&order=${encodeURIComponent(order.id)}`;
  return (
    <DataTable
      caption="Orders for the day"
      empty={orders.length === 0 ? <EmptyState title="No orders for this day" detail="Orders appear here as outlets place them." /> : undefined}
      head={
        <tr>
          <Th>Order</Th>
          <Th>Outlet</Th>
          <Th>Brand</Th>
          <Th numeric>Items</Th>
          <Th numeric>Volume</Th>
          <Th>Window</Th>
          <Th>Status</Th>
        </tr>
      }
      cards={orders.map((order) => (
        <RowCard key={order.id}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <Link href={href(order)} className="font-mono font-semibold text-link underline-offset-2 hover:underline">
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
            <span className="tabular">{order.units} items</span>
            <span className="tabular">{order.volumeM3 != null ? `${order.volumeM3.toFixed(1)} m³` : "—"}</span>
            <span className="tabular">{order.windowOpen && order.windowClose ? `${order.windowOpen}–${order.windowClose}` : "No window"}</span>
          </div>
        </RowCard>
      ))}
    >
      {orders.map((order) => (
        <Tr key={order.id}>
          <Td>
            <Link href={href(order)} className="font-mono font-semibold text-link underline-offset-2 hover:underline">
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
          <Td numeric>{order.units}</Td>
          <Td numeric>{order.volumeM3 != null ? `${order.volumeM3.toFixed(1)} m³` : "—"}</Td>
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

const SEVERITY: Record<string, Tone> = { critical: "bad", warning: "warn", info: "info" };

function Panel({ title, href, linkLabel, children }: { title: string; href?: string; linkLabel?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-card border border-line bg-surface p-4">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="font-bold text-ink">{title}</h2>
        {href ? (
          <Link href={href} className="text-sm font-semibold text-link underline-offset-2 hover:underline">
            {linkLabel}
          </Link>
        ) : null}
      </div>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function ExceptionsPanel({ list, date }: { list: components["schemas"]["ExceptionList"] | null; date: string }) {
  const failure = readFailure(0, "the exceptions");
  return (
    <Panel title="Exceptions" href={`/dispatcher/exceptions?date=${date}`} linkLabel="Open exceptions">
      {!list ? (
        <p className="text-sm text-muted">{failure.title}. {failure.detail}</p>
      ) : list.exceptions.length === 0 ? (
        <p className="text-sm text-muted">Nothing open. Loading, the road and the stores are all quiet.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-line">
          {list.exceptions.slice(0, 3).map((item) => (
            <li key={item.id} className="flex items-start gap-3 py-2 first:pt-0 last:pb-0">
              <span className="mt-0.5 shrink-0">
                <StatusPill label={item.severity === "critical" ? "Critical" : item.severity === "warning" ? "Warning" : "Info"} tone={SEVERITY[item.severity] ?? "neutral"} dot={false} />
              </span>
              <div className="min-w-0 text-sm">
                <p className="font-semibold text-ink">{item.title}</p>
                <p className="truncate text-xs text-muted">{item.subtitle}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
      {list && list.exceptions.length > 3 ? <p className="mt-2 text-xs text-muted">and {list.exceptions.length - 3} more</p> : null}
    </Panel>
  );
}

function VehiclesPanel({ fleet, date }: { fleet: components["schemas"]["VehicleList"] | null; date: string }) {
  const rows = fleet
    ? [
        ["On route", fleet.summary.onRoute],
        ["Loading", fleet.summary.loading],
        ["Idle", fleet.summary.idle],
        ["Back at the depot", fleet.summary.returned],
        ["In the workshop", fleet.summary.inWorkshop],
      ]
    : [];
  return (
    <Panel title="Vehicles" href={`/dispatcher/vehicles?date=${date}`} linkLabel="All vehicles">
      {!fleet ? (
        <p className="text-sm text-muted">The vehicle list could not be loaded. Check the connection and reload.</p>
      ) : (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          {rows.map(([label, value]) => (
            <div key={label} className="flex items-baseline justify-between gap-2 border-b border-line pb-1.5">
              <dt className="text-muted">{label}</dt>
              <dd className="tabular font-bold text-ink">{value}</dd>
            </div>
          ))}
        </dl>
      )}
    </Panel>
  );
}

const TRIP_ORDER = ["PLANNED", "LOADING", "READY", "DEPARTED", "COMPLETED", "CANCELLED"] as const;
const TRIP_LABEL: Record<(typeof TRIP_ORDER)[number], string> = {
  PLANNED: "Planned",
  LOADING: "Loading",
  READY: "Ready",
  DEPARTED: "On the road",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
};

function TripsPanel({ detail }: { detail: { planId: string; status: string; trips: { status: (typeof TRIP_ORDER)[number] }[] } | null }) {
  if (!detail) return null;
  const counts = TRIP_ORDER.map((status) => [status, detail.trips.filter((t) => t.status === status).length] as const).filter(([, n]) => n > 0);
  return (
    <Panel title="Trips" href={`/dispatcher/plans/${encodeURIComponent(detail.planId)}`} linkLabel={detail.status === "DRAFT" ? "Review draft" : "Open plan"}>
      {detail.trips.length === 0 ? (
        <p className="text-sm text-muted">The plan has no trips.</p>
      ) : (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          {counts.map(([status, n]) => (
            <div key={status} className="flex items-baseline justify-between gap-2 border-b border-line pb-1.5">
              <dt className="text-muted">{TRIP_LABEL[status]}</dt>
              <dd className="tabular font-bold text-ink">{n}</dd>
            </div>
          ))}
        </dl>
      )}
    </Panel>
  );
}
