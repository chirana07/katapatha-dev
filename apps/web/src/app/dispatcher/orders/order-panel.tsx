import Link from "next/link";
import type { components } from "@katapatha/contracts/types";
import { deferralReasonLabel, shortDay } from "@katapatha/core/domain/deferral";
import { DetailPanel, Facts, PanelSection } from "@/components/ui/detail-panel";
import { BrandPill, StatusPill } from "@/components/ui/status-pill";
import { Timeline } from "@/components/ui/stepper";
import { ButtonLink } from "@/components/ui/button";
import { ErrorPanel } from "@/components/ui/states";
import { api } from "@/lib/api";
import { longDate } from "@/lib/dates";
import { readFailure } from "@/lib/failures";
import { historyReason, historyStamp, historyTitle } from "../history";
import { ORDER_STATUS } from "../order-status";

type Order = components["schemas"]["Order"];
type Outlet = components["schemas"]["Outlet"];

const DOCK: Record<Outlet["dockType"], string> = {
  rear_dock: "Rear dock",
  street: "Street delivery",
  mall_bay: "Mall bay",
};

const PARKING: Record<NonNullable<Outlet["parkingConstraint"]>, string> = {
  normal: "Standard access",
  van_only: "Vans only",
  mall_dock: "Mall dock, timed access",
};

/**
 * The selected order, beside the list. A server component that reads the
 * outlet's reference data and, on the History tab, the order's decision log
 * (`GET /history/Order/{id}`) — so what is shown is what was recorded, in
 * the order it was recorded, with who decided and why.
 */
export async function OrderPanel({
  order,
  date,
  tab,
  planId,
  closeHref,
  overviewHref,
  historyHref,
}: {
  order: Order;
  date: string;
  tab: "overview" | "history";
  planId: string | undefined;
  closeHref: string;
  overviewHref: string;
  historyHref: string;
}) {
  const client = await api();
  const [outlets, history] = await Promise.all([
    client.GET("/reference/outlets").catch(() => null),
    tab === "history"
      ? client.GET("/history/{entityType}/{entityId}", { params: { path: { entityType: "Order", entityId: order.id } } }).catch(() => null)
      : Promise.resolve(null),
  ]);
  const outlet = outlets?.data?.find((o) => o.id === order.outletId);
  const status = ORDER_STATUS[order.status];

  return (
    <DetailPanel
      footer={
        <>
          {order.status === "DEFERRED" && planId ? (
            <ButtonLink href={`/dispatcher/plans/${encodeURIComponent(planId)}`} variant="secondary">
              Open the plan
            </ButtonLink>
          ) : null}
          <ButtonLink href={`/dispatcher/planning?date=${date}`} variant="secondary">
            Planning desk
          </ButtonLink>
        </>
      }
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-mono text-xl font-bold text-ink">{order.ref}</h2>
          <p className="mt-0.5 text-sm text-muted">
            {order.outletId} · {order.districtName ?? "District not set"}
          </p>
        </div>
        <Link
          href={closeHref}
          scroll={false}
          aria-label="Close order details"
          className="-mr-1 -mt-1 grid size-11 shrink-0 place-items-center rounded-control text-muted hover:bg-raised hover:text-ink"
        >
          <span aria-hidden>&times;</span>
        </Link>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <StatusPill {...status} />
        <BrandPill brand={order.brand} />
        <span className="rounded-control border border-line px-2 py-0.5 text-xs font-semibold capitalize text-muted">{order.tempRequirement}</span>
      </div>

      <nav aria-label="Order details" className="mt-4 flex gap-1 border-b border-line">
        {(
          [
            ["overview", "Overview", overviewHref],
            ["history", "History", historyHref],
          ] as const
        ).map(([key, label, to]) => (
          <Link
            key={key}
            href={to}
            scroll={false}
            aria-current={tab === key ? "page" : undefined}
            className={`-mb-px flex min-h-11 items-center border-b-2 px-3 text-sm font-semibold ${
              tab === key ? "border-action text-ink" : "border-transparent text-muted hover:text-ink"
            }`}
          >
            {label}
          </Link>
        ))}
      </nav>

      <div className="mt-4">
        {tab === "history" ? (
          <HistoryTab history={history} />
        ) : (
          <>
            {order.deferral ? (
              <div role="status" className="mb-4 rounded-control border border-bad/25 bg-bad-surface p-3 text-sm">
                <p className="font-semibold text-bad-ink">Deferred: {deferralReasonLabel(order.deferral.reasonCode)}</p>
                <p className="mt-0.5 text-ink">
                  {order.deferral.rolledToDate
                    ? `Moves to ${shortDay(order.deferral.rolledToDate)}, planned first on that run.`
                    : "No next run is promised: no vehicle in the fleet can carry it as it stands."}
                </p>
              </div>
            ) : null}

            <Facts
              items={[
                { label: "Items", value: `${order.units} units` },
                { label: "Volume", value: order.volumeM3 != null ? `${order.volumeM3.toFixed(1)} m³` : "—" },
                { label: "Weight", value: order.weightKg != null ? `${Math.round(order.weightKg)} kg` : "—" },
              ]}
            />

            <PanelSection title="Delivery window">
              <p className="tabular font-bold text-ink">
                {order.windowOpen && order.windowClose ? `${order.windowOpen} – ${order.windowClose}` : "No window recorded"}
              </p>
              <p className="text-sm text-muted">For {longDate(order.requestedDate)}</p>
            </PanelSection>

            <PanelSection title="Outlet">
              {outlet ? (
                <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
                  <dt className="text-muted">Outlet</dt>
                  <dd className="font-semibold text-ink">{outlet.displayName ?? outlet.id}</dd>
                  <dt className="text-muted">District</dt>
                  <dd className="text-ink">{outlet.districtName}</dd>
                  <dt className="text-muted">Dock</dt>
                  <dd className="text-ink">{DOCK[outlet.dockType]}</dd>
                  <dt className="text-muted">Access</dt>
                  <dd className="text-ink">{PARKING[outlet.parkingConstraint ?? "normal"]}</dd>
                  {outlet.mallWindowOpen && outlet.mallWindowClose ? (
                    <>
                      <dt className="text-muted">Mall window</dt>
                      <dd className="tabular text-ink">
                        {outlet.mallWindowOpen} – {outlet.mallWindowClose}
                      </dd>
                    </>
                  ) : null}
                </dl>
              ) : (
                <p className="text-sm text-muted">Outlet details could not be loaded.</p>
              )}
            </PanelSection>
          </>
        )}
      </div>
    </DetailPanel>
  );
}

function HistoryTab({
  history,
}: {
  history: { data?: components["schemas"]["History"]; response: Response } | null;
}) {
  if (!history || !history.data) {
    const failure = readFailure(history?.response.status ?? 0, "this order's history");
    return <ErrorPanel {...failure} />;
  }
  if (history.data.events.length === 0) {
    return <p className="text-sm text-muted">No decisions have been recorded for this order yet.</p>;
  }
  return (
    <Timeline
      entries={history.data.events.map((event) => {
        const { title, tone } = historyTitle(event.action);
        return {
          at: historyStamp(event.at),
          title,
          tone,
          actor: event.actorName ? `${event.actorName}${event.actorRole ? ` · ${event.actorRole.toLowerCase().replace("_", " ")}` : ""}` : undefined,
          reason: historyReason(event),
        };
      })}
    />
  );
}
