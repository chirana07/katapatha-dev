import Link from "next/link";
import { PageBody, PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";
import { BrandPill, StatusPill } from "@/components/ui/status-pill";
import { DateControl } from "@/components/ui/date-control";
import { Tabs, type TabItem } from "@/components/ui/tabs";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState, ErrorPanel } from "@/components/ui/states";
import { api } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { longDate } from "@/lib/dates";
import { deskDate } from "../desk-date";
import { plural } from "@/lib/format";
import { countTemps, tempBreakdown } from "@/lib/temperature";
import { deferralReasonLabel } from "@katapatha/core/domain/deferral";
import { loadDay } from "../desk-data";
import { FleetPanel } from "../fleet-panel";
import { Flash } from "../flash";
import { Glyph } from "../icons";
import { NextStep } from "../next-step";
import { PlanStatusPill, TripsTable, UtilisationList, ViolationList } from "../plan-parts";
import { countErrors } from "../plan-summary";
import { QueueBreakdown } from "./queue-breakdown";

export const dynamic = "force-dynamic";

type View = "plan" | "unallocated" | "constraints" | "fleet" | "queue";

const VIEWS: View[] = ["plan", "unallocated", "constraints", "fleet", "queue"];

/**
 * D-04 — the planning desk for one day: close the queue, build the plan, see
 * what it did, and the fleet it was built from.
 *
 * Where the design drew a map of routes and a stop list per vehicle, this
 * screen has trips and per-vehicle utilisation bars: the plan the API holds is
 * trip-level (vehicle, brand, district, wave, load), and drawing stops or road
 * routes would invent geometry it does not have. Publishing, deferral reasons
 * and the publication check live on the plan board, one click on from here.
 */
export default async function PlanningDesk({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; view?: string; error?: string; notice?: string; retry?: string }>;
}) {
  const user = await requireRole("DISPATCHER", "/dispatcher/planning");
  const query = await searchParams;
  const date = await deskDate(query.date);

  const header = (
    <PageHeader
      title="Planning"
      subtitle={`Build and publish the day's delivery plan for ${user.depotCode ?? "your depot"}.`}
      aside={<DateControl date={date} path="/dispatcher/planning" />}
    />
  );
  const loaded = await loadDay(date, "/dispatcher/planning");
  if (!loaded.ok) {
    return (
      <PageBody>
        {header}
        <ErrorPanel
          {...loaded.failure}
          action={
            <ButtonLink href={`/dispatcher/planning?date=${date}`} variant="secondary">
              Try again
            </ButtonLink>
          }
        />
      </PageBody>
    );
  }

  const { day, orders, plan, fleet } = loaded.data;
  const client = await api();
  // The plan and its publication check are read together; either failing leaves
  // the rest of the desk usable, and says so where the data would have been.
  const [detail, validation] = plan
    ? await Promise.all([
        client.GET("/plans/{planId}", { params: { path: { planId: plan.planId } } }).catch(() => null),
        client.GET("/plans/{planId}/validation", { params: { path: { planId: plan.planId }, query: { stage: "publish" } } }).catch(() => null),
      ])
    : [null, null];
  const planData = detail?.data ?? null;
  const check = validation?.data ?? null;

  const deferrals = planData?.deferrals ?? [];
  const pending = deferrals.filter((d) => !d.reasonCode).length;
  const violations = check?.violations ?? [];
  const errors = countErrors(violations);
  const available = fleet?.vehicles.filter((v) => v.status === "AVAILABLE") ?? [];
  const mix = tempBreakdown(countTemps(orders));
  const vehiclesUsed = planData ? new Set(planData.trips.map((t) => t.vehicleId)).size : 0;
  const requestId = validRetry(query.retry) ?? crypto.randomUUID();

  const hasPlan = Boolean(planData);
  const requested = VIEWS.includes(query.view as View) ? (query.view as View) : undefined;
  const available_views: View[] = hasPlan ? VIEWS : ["fleet", "queue"];
  const view = requested && available_views.includes(requested) ? requested : available_views[0]!;
  const link = (v: View) => `/dispatcher/planning?date=${date}&view=${v}`;
  const tabs: TabItem[] = [
    ...(hasPlan
      ? [
          { label: "Trips", href: link("plan"), current: view === "plan", count: planData!.trips.length },
          { label: "Unallocated orders", href: link("unallocated"), current: view === "unallocated", count: deferrals.length, alert: pending > 0 },
          { label: "Publication check", href: link("constraints"), current: view === "constraints", count: violations.length, alert: errors > 0 },
        ]
      : []),
    { label: "Fleet", href: link("fleet"), current: view === "fleet" },
    { label: "Order queue", href: link("queue"), current: view === "queue", count: orders.length },
  ];

  return (
    <PageBody>
      {header}

      <Flash notice={query.notice} error={query.error} context={{ pendingDeferrals: pending }} />

      <section aria-label="The day in numbers" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          icon={<Glyph kind="orders" />}
          value={orders.length}
          label="Total orders"
          foot={plan ? `${plan.stats.served} allocated · ${plan.stats.deferred} deferred` : mix}
        />
        <StatCard
          icon={<Glyph kind="truck" />}
          value={fleet ? available.length : "—"}
          label="Available vehicles"
          foot={fleet ? `${available.filter((v) => v.temp === "reefer").length} refrigerated${fleet.vehicles.length - available.length ? ` · ${fleet.vehicles.length - available.length} in workshop` : ""}` : "Fleet could not be loaded"}
          footTone={fleet && fleet.vehicles.length - available.length ? "warn" : "neutral"}
        />
        <StatCard
          icon={<Glyph kind="route" />}
          value={plan ? plan.stats.tripsBuilt : "—"}
          label="Planned trips"
          foot={plan ? `On ${plural(vehiclesUsed, "vehicle")}` : "No plan built yet"}
        />
        <StatCard
          icon={<Glyph kind="alert" />}
          value={check ? violations.length : "—"}
          label="Constraint issues"
          foot={check ? (violations.length ? `${errors} block publishing · ${violations.length - errors} warning${violations.length - errors === 1 ? "" : "s"}` : "None found") : plan ? "Check could not be loaded" : "Appears once a plan is built"}
          footTone={errors ? "bad" : violations.length ? "warn" : "neutral"}
        />
      </section>

      {day ? (
        <NextStep day={day} plan={plan} orderCount={orders.length} pendingDeferrals={pending} from="planning" requestId={requestId} />
      ) : (
        <EmptyState
          title={`No planning day for ${longDate(date)}`}
          detail="There is no operating day for this depot on that date. Pick another date to plan."
        />
      )}

      {day ? (
        <>
          <Tabs items={tabs} label="Planning views" />

          {view === "plan" && planData ? (
            <div className="flex flex-col gap-6">
              <section aria-labelledby="trips-heading" className="flex flex-col gap-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 id="trips-heading" className="text-lg font-bold text-ink">
                    Trips
                  </h2>
                  <div className="flex items-center gap-3">
                    <PlanStatusPill status={planData.status} />
                    <Link href={`/dispatcher/plans/${encodeURIComponent(planData.planId)}`} className="text-sm font-semibold text-link underline-offset-2 hover:underline">
                      Open the plan board
                    </Link>
                  </div>
                </div>
                <TripsTable trips={planData.trips} />
              </section>
              <section aria-labelledby="util-heading" className="flex flex-col gap-3">
                <div>
                  <h2 id="util-heading" className="text-lg font-bold text-ink">
                    Vehicle utilisation
                  </h2>
                  <p className="text-sm text-muted">Each vehicle&apos;s day against its limits, as the allocator measured it when the plan was built.</p>
                </div>
                <UtilisationList meters={planData.meters} />
              </section>
            </div>
          ) : null}

          {view === "unallocated" && planData ? (
            <section aria-labelledby="unalloc-heading" className="flex flex-col gap-3">
              <div>
                <h2 id="unalloc-heading" className="text-lg font-bold text-ink">
                  Unallocated orders
                </h2>
                <p className="text-sm text-muted">
                  {deferrals.length === 0
                    ? "Every order in the queue has a vehicle."
                    : planData.status === "DRAFT"
                      ? pending > 0
                        ? `${plural(pending, "deferral")} of ${deferrals.length} still ${pending === 1 ? "needs" : "need"} a reason before the plan can be published.`
                        : "Every deferral has a reason. Publication can go ahead once the publication check is clear."
                      : "These orders were deferred when the plan was published."}
                </p>
              </div>
              {deferrals.length > 0 ? (
                <ul className="flex flex-col gap-2">
                  {deferrals.map((row) => (
                    <li key={row.assignmentId} className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-line bg-surface p-3">
                      <div className="min-w-0">
                        <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-ink">
                          <span className="font-mono">{row.orderRef}</span>
                          {row.order ? <BrandPill brand={row.order.brand as "Fresh" | "Style" | "Tech"} /> : null}
                          {row.cause?.permanent ? <StatusPill label="No vehicle fits" tone="bad" dot={false} /> : null}
                        </p>
                        <p className="tabular mt-0.5 text-xs text-muted">
                          {row.order
                            ? [row.order.outletId, row.order.outletName ?? row.order.districtName, `${row.order.units} units`, `${row.order.volumeM3} m³`].join(" · ")
                            : row.orderId}
                        </p>
                        {row.cause?.suggestion ? <p className="mt-1 text-xs text-muted">{row.cause.suggestion}</p> : null}
                      </div>
                      <div className="flex items-center gap-3">
                        <StatusPill label={row.reasonCode ? deferralReasonLabel(row.reasonCode) : "Needs a reason"} tone={row.reasonCode ? "good" : "warn"} />
                        <ButtonLink
                          href={`/dispatcher/plans/${encodeURIComponent(planData.planId)}?defer=${encodeURIComponent(row.assignmentId)}`}
                          variant="secondary"
                        >
                          {planData.status === "DRAFT" ? (row.reasonCode ? "Review" : "Choose reason") : "View"}
                        </ButtonLink>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyState title="Nothing is unallocated" />
              )}
            </section>
          ) : null}

          {view === "constraints" && planData ? (
            <section aria-labelledby="check-heading" className="flex flex-col gap-3">
              <div>
                <h2 id="check-heading" className="text-lg font-bold text-ink">
                  Publication check
                </h2>
                <p className="text-sm text-muted">The rules the plan is checked against before it can be published. Errors block publishing; warnings do not.</p>
              </div>
              {!check ? (
                <ErrorPanel title="The publication check could not be loaded" detail="Reload before publishing." outcome="read" />
              ) : violations.length === 0 ? (
                <div role="status" className="rounded-card border border-good/25 bg-good-surface px-4 py-3 text-sm text-good-ink">
                  The plan passed the publication check with no issues.
                </div>
              ) : (
                <div className="rounded-card border border-line bg-surface p-4">
                  <ViolationList violations={violations} blocks={planData.status === "DRAFT"} />
                </div>
              )}
            </section>
          ) : null}

          {view === "fleet" ? (
            fleet ? <FleetPanel fleet={fleet} /> : <ErrorPanel title="The fleet could not be loaded" detail="Check the connection and reload." outcome="read" />
          ) : null}

          {view === "queue" ? <QueueBreakdown orders={orders} /> : null}
        </>
      ) : null}
    </PageBody>
  );
}

function validRetry(value: string | undefined) {
  return value && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value) ? value : null;
}
