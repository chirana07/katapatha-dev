import Link from "next/link";
import { deferralReasonLabel } from "@katapatha/core/domain/deferral";
import { PageBody, PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";
import { BrandPill, StatusPill } from "@/components/ui/status-pill";
import { Button, BlockedAction, ButtonLink } from "@/components/ui/button";
import { EmptyState, ErrorPanel } from "@/components/ui/states";
import { api } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { longDate } from "@/lib/dates";
import { readFailure } from "@/lib/failures";
import { percent, plural } from "@/lib/format";
import { Flash } from "../../flash";
import { Glyph } from "../../icons";
import { PlanStatusPill, TripsTable, UtilisationList, ViolationList } from "../../plan-parts";
import { countErrors, publishBlocker, publishFacts, violationTitle } from "../../plan-summary";
import { DeferDrawer } from "./defer-drawer";
import { PublishDialog } from "./publish-dialog";

export const dynamic = "force-dynamic";

const DEFERRAL_FALLBACK = [
  "REEFER_FULL",
  "NO_VAN",
  "WINDOW_UNREACHABLE",
  "TIME_BUDGET",
  "FUEL_QUOTA",
  "VEHICLE_IN_WORKSHOP",
  "ORDER_TOO_LARGE",
  "AFTER_CUTOFF",
] as const;

function validUuid(value: string | undefined) {
  return value && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value) ? value : null;
}

/**
 * The plan board: review one plan, decide each deferral, and publish.
 *
 * Reached from the planning desk. D-05 (the defer drawer) and D-06 (the publish
 * confirmation) are both URL-driven (`?defer=` and `?publish=1`), so either can
 * be linked to, reloaded, and reopened by a server action with its error in
 * place.
 */
export default async function PlanBoard({
  params,
  searchParams,
}: {
  params: Promise<{ planId: string }>;
  searchParams: Promise<{ error?: string; notice?: string; retry?: string; defer?: string; publish?: string }>;
}) {
  const { planId } = await params;
  const query = await searchParams;
  const home = `/dispatcher/plans/${encodeURIComponent(planId)}`;
  await requireRole("DISPATCHER", home);

  const client = await api();
  let plan;
  let validation;
  let vocab;
  try {
    [plan, validation, vocab] = await Promise.all([
      client.GET("/plans/{planId}", { params: { path: { planId } } }),
      client.GET("/plans/{planId}/validation", { params: { path: { planId }, query: { stage: "publish" } } }),
      client.GET("/reference/vocabularies", {}),
    ]);
  } catch {
    return <Unavailable {...readFailure(0, "the plan")} />;
  }
  if (plan.response.status === 401) return <Unavailable {...readFailure(401, "the plan")} />;
  if (plan.error || !plan.data) return <Unavailable {...readFailure(plan.response.status, "this plan")} />;

  const data = plan.data;
  const check = validation.error || !validation.data ? null : validation.data;
  const violations = check?.violations ?? [];
  const errors = countErrors(violations);
  const deferrals = Array.isArray(data.deferrals) ? data.deferrals : [];
  const pending = deferrals.filter((d) => !d.reasonCode).length;
  const isDraft = data.status === "DRAFT";
  const desk = data.date ? `/dispatcher/planning?date=${data.date}` : "/dispatcher/planning";
  const requestId = validUuid(query.retry) ?? crypto.randomUUID();
  const deferralReasons: string[] = (vocab.data?.deferralReasons as string[] | undefined) ?? [...DEFERRAL_FALLBACK];

  const blocker = publishBlocker({ status: data.status, pendingDeferrals: pending, validationAvailable: Boolean(check), blockingErrors: errors });
  const facts = publishFacts({ stats: data.stats, trips: data.trips, deferrals });
  const dayLabel = data.date ? longDate(data.date) : "this day";
  // Carry the retry key into the dialog link: after an unanswered publish the
  // page is reloaded with `?retry=`, and the next confirm must reuse it.
  const publishHref = `${home}?publish=1${query.retry && validUuid(query.retry) ? `&retry=${query.retry}` : ""}`;

  // ?defer=<assignmentId> opens D-05 for that deferral.
  const openDeferral = query.defer ? deferrals.find((d) => d.assignmentId === query.defer) : undefined;
  let alternatives = null;
  let alternativesFailed = false;
  if (openDeferral && !openDeferral.cause?.permanent) {
    try {
      const alt = await client.GET("/plans/{planId}/deferrals/{assignmentId}/alternatives", {
        params: { path: { planId, assignmentId: openDeferral.assignmentId } },
      });
      alternatives = alt.data ?? null;
      alternativesFailed = !alt.data;
    } catch {
      alternativesFailed = true;
    }
  }

  const totalWeight = data.trips.reduce((s, t) => s + (t.sumWeightKg ?? 0), 0);
  const totalVolume = data.trips.reduce((s, t) => s + (t.sumVolumeM3 ?? 0), 0);

  return (
    <PageBody>
      <Link href={desk} className="inline-flex min-h-11 w-fit items-center gap-1 text-sm font-semibold text-muted hover:text-ink">
        <span aria-hidden>←</span> Planning desk
      </Link>

      <PageHeader
        title="Plan review"
        subtitle={`${dayLabel} · plan ${data.planId.slice(-6)}`}
        aside={<PlanStatusPill status={data.status} />}
        action={
          isDraft ? (
            blocker ? (
              <BlockedAction reason={blocker}>
                <Button type="button" variant="primary" disabled>
                  Publish plan
                </Button>
              </BlockedAction>
            ) : (
              <ButtonLink href={publishHref} scroll={false} variant="primary">
                Publish plan
              </ButtonLink>
            )
          ) : undefined
        }
      />

      <Flash notice={query.notice} error={query.error} context={{ pendingDeferrals: pending, deferred: deferrals.length }} />

      <section aria-label="Plan summary" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard icon={<Glyph kind="orders" />} value={data.stats.orders} label="Total orders" foot="In the planning snapshot" />
        <StatCard
          icon={<Glyph kind="check" />}
          value={data.stats.served}
          label="Served"
          foot={`${percent(data.stats.served, data.stats.orders)}% of the queue allocated`}
          footTone="good"
        />
        <StatCard
          icon={<Glyph kind="alert" />}
          value={data.stats.deferred}
          label="Deferred"
          foot={data.stats.deferred ? (pending ? `${pending} need a reason` : "Each has a reason") : "None"}
          footTone={data.stats.deferred ? (pending ? "warn" : "bad") : "neutral"}
        />
        <StatCard
          icon={<Glyph kind="route" />}
          value={data.stats.tripsBuilt}
          label="Planned trips"
          foot={`${(totalWeight / 1000).toFixed(1)} t · ${totalVolume.toFixed(1)} m³`}
        />
      </section>

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="flex min-w-0 flex-col gap-6">
          {deferrals.length > 0 ? (
            <section aria-labelledby="deferrals-heading" className="flex flex-col gap-3">
              <div>
                <h2 id="deferrals-heading" className="text-lg font-bold text-ink">
                  Deferral decisions
                </h2>
                <p className="text-sm text-muted">
                  {pending === 0
                    ? isDraft
                      ? "Every deferral has a reason. Publication can go ahead once the publication check is clear."
                      : "Every deferral had a reason when the plan was published."
                    : `${plural(pending, "deferral")} of ${deferrals.length} still ${pending === 1 ? "needs" : "need"} a reason before the plan can be published.`}
                </p>
              </div>
              <ul className="flex flex-col gap-2">
                {deferrals.map((row) => {
                  const order = row.order;
                  return (
                    <li key={row.assignmentId} className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-line bg-surface p-3">
                      <div className="min-w-0">
                        <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-ink">
                          <span className="font-mono">{row.orderRef}</span>
                          {order ? <BrandPill brand={order.brand as "Fresh" | "Style" | "Tech"} /> : null}
                          {row.cause?.permanent ? <StatusPill label="No vehicle fits" tone="bad" dot={false} /> : null}
                        </p>
                        <p className="tabular mt-0.5 text-xs text-muted">
                          {order
                            ? [order.outletId, order.outletName ?? order.districtName, `${order.units} units`, `${order.volumeM3} m³`].join(" · ")
                            : row.orderId}
                        </p>
                      </div>
                      <div className="flex items-center gap-3">
                        <StatusPill label={row.reasonCode ? deferralReasonLabel(row.reasonCode) : "Needs a reason"} tone={row.reasonCode ? "good" : "warn"} />
                        <ButtonLink href={`${home}?defer=${encodeURIComponent(row.assignmentId)}`} scroll={false} variant="secondary">
                          {isDraft ? (row.reasonCode ? "Review" : "Choose reason") : "View"}
                        </ButtonLink>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          ) : null}

          <section aria-labelledby="trips-heading" className="flex flex-col gap-3">
            <h2 id="trips-heading" className="text-lg font-bold text-ink">
              Trips
            </h2>
            <TripsTable trips={data.trips} />
          </section>

          <section aria-labelledby="util-heading" className="flex flex-col gap-3">
            <div>
              <h2 id="util-heading" className="text-lg font-bold text-ink">
                Vehicle utilisation
              </h2>
              <p className="text-sm text-muted">Each vehicle&apos;s day against its limits, as the allocator measured it when the plan was built.</p>
            </div>
            <UtilisationList meters={data.meters} />
          </section>
        </div>

        <aside aria-labelledby="check-heading" className="flex flex-col gap-3 xl:sticky xl:top-4">
          <section className="rounded-card border border-line bg-surface p-4">
            <h2 id="check-heading" className="font-bold text-ink">
              Publication check
            </h2>
            {!check ? (
              <div className="mt-3">
                <ErrorPanel title="The check could not be loaded" detail="Reload the plan before publishing." outcome="read" />
              </div>
            ) : (
              <>
                <p className={`mt-2 text-sm font-semibold ${errors ? "text-bad-ink" : "text-good-ink"}`}>
                  {errors ? (isDraft ? plural(errors, "blocking issue") : plural(errors, "error")) : isDraft ? "Nothing blocks publishing" : "No errors"}
                </p>
                <p className="mt-0.5 text-sm text-muted">
                  {violations.length ? `${plural(violations.length, "item")} to read.` : "No validation issues were found."}
                </p>
                {violations.length ? (
                  <div className="mt-4 border-t border-line pt-4">
                    <ViolationList violations={violations} blocks={isDraft} />
                  </div>
                ) : null}
              </>
            )}
            {isDraft && blocker ? <p className="mt-4 border-t border-line pt-3 text-sm text-muted">{blocker}</p> : null}
            {!isDraft ? (
              <p className="mt-4 border-t border-line pt-3 text-sm font-semibold text-ink">
                {data.status === "PUBLISHED" ? "This plan has been published." : "A newer draft has replaced this plan."}
              </p>
            ) : null}
          </section>
          {data.trips.length === 0 ? <EmptyState title="No trips were built" detail="Every order was deferred. Check the fleet on the planning desk." /> : null}
        </aside>
      </div>

      {openDeferral ? (
        <DeferDrawer
          planId={data.planId}
          deferral={openDeferral}
          alternatives={alternatives}
          alternativesFailed={alternativesFailed}
          error={query.error ? (errorLine(query.error)) : null}
          allReasons={deferralReasons}
          closeHref={home}
          readOnly={!isDraft}
          sent={data.status === "PUBLISHED"}
        />
      ) : null}

      {query.publish === "1" && isDraft && !blocker ? (
        <PublishDialog
          planId={data.planId}
          requestId={requestId}
          closeHref={home}
          dayLabel={dayLabel}
          facts={facts}
          warnings={violations.filter((v) => v.severity === "warning").map((v) => ({ title: violationTitle(v.code), message: v.message }))}
        />
      ) : null}
    </PageBody>
  );
}

/** The drawer's own copy for a save that failed: the page-level banner is behind the overlay. */
function errorLine(code: string): string | null {
  switch (code) {
    case "deferrals_empty":
      return "Pick a reason before saving.";
    case "deferrals_rejected":
      return "The server refused that reason. Reload the plan and choose again.";
    case "deferrals_outcome_unknown":
      return "We could not confirm the reason was saved. Close this and reopen it to see what is recorded; saving again is safe.";
    case "unreachable":
      return "Katapatha could not be reached. Nothing was sent.";
    default:
      return null;
  }
}

function Unavailable({ title, detail }: { title: string; detail: string }) {
  return (
    <PageBody>
      <ErrorPanel
        title={title}
        detail={detail}
        outcome="read"
        action={
          <ButtonLink href="/dispatcher/planning" variant="secondary">
            Return to the planning desk
          </ButtonLink>
        }
      />
    </PageBody>
  );
}
