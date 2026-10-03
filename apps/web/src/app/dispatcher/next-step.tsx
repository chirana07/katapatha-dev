import type { components } from "@katapatha/contracts/types";
import { ButtonLink } from "@/components/ui/button";
import { PendingButton } from "@/components/ui/pending-button";
import { Stepper } from "@/components/ui/stepper";
import { plural } from "@/lib/format";
import { closeQueue, createPlan } from "./actions";
import { DESK_STEPS, deskStep } from "./plan-summary";

type PlanningDay = components["schemas"]["PlanningDay"];
type PlanSummary = components["schemas"]["PlanSummary"];

/**
 * "What do I do next?" for a planning day: the four steps the day walks through
 * and the one action that moves it on.
 *
 * Shared by the dashboard and the planning desk. The same actions run from both
 * (`from` tells them where to come back to), so there is one place to change
 * what a step says and the two screens cannot describe the day differently.
 * Only one primary action is ever drawn, because only one is ever valid: the
 * queue closes before a plan builds, and a published day cannot be re-planned.
 */
export function NextStep({
  day,
  plan,
  orderCount,
  pendingDeferrals,
  from,
  requestId,
}: {
  day: PlanningDay;
  plan: PlanSummary | undefined;
  orderCount: number;
  /** Deferrals on the draft that still lack a reason. */
  pendingDeferrals: number;
  from: "dashboard" | "planning";
  /** Idempotency key for "Build plan", kept across a retry of the same click. */
  requestId: string;
}) {
  const planHref = plan ? `/dispatcher/plans/${encodeURIComponent(plan.planId)}` : null;

  return (
    <section aria-labelledby="next-step" className="rounded-card border border-line bg-surface p-4 sm:p-5">
      {/* Four labelled steps do not fit a phone: the labels truncate to "Q." and
          "Pla…", so below sm the position is said in words instead. */}
      <div className="hidden sm:block">
        <Stepper steps={[...DESK_STEPS]} current={deskStep(day.status)} />
      </div>
      <p className="text-sm font-semibold text-ink sm:hidden">
        Step {Math.min(deskStep(day.status) + 1, DESK_STEPS.length)} of {DESK_STEPS.length}:{" "}
        {DESK_STEPS[Math.min(deskStep(day.status), DESK_STEPS.length - 1)]}
      </p>

      <div className="mt-5 flex flex-wrap items-center justify-between gap-4">
        {day.status === "OPEN" ? (
          <>
            <Copy
              eyebrow="Next step"
              title="Close the order queue"
              detail={`${plural(orderCount, "order")} in the queue; the cutoff is ${day.cutoffAt}. Closing fixes the set of orders the plan is built from.`}
            />
            <form action={closeQueue}>
              <input type="hidden" name="planningDayId" value={day.id} />
              <input type="hidden" name="date" value={day.date} />
              <input type="hidden" name="from" value={from} />
              <PendingButton variant="primary" pendingLabel="Closing…">
                Close order queue
              </PendingButton>
            </form>
          </>
        ) : day.status === "CLOSED" ? (
          <>
            <Copy
              eyebrow="Next step"
              title="Build the delivery plan"
              detail="The allocator gives each order a vehicle that can carry it, or defers it and says why. Nothing is published until you review it."
            />
            <BuildForm day={day} from={from} requestId={requestId} variant="primary" label="Generate plan" />
          </>
        ) : day.status === "PLANNING" ? (
          <>
            <Copy
              eyebrow="Draft plan"
              title="Review the draft"
              detail={`${planLine(plan)}${pendingDeferrals > 0 ? ` ${plural(pendingDeferrals, "deferral")} still ${pendingDeferrals === 1 ? "needs" : "need"} a reason before it can be published.` : ""} Building again replaces this draft.`}
            />
            <div className="flex flex-wrap gap-2">
              <BuildForm day={day} from={from} requestId={requestId} variant="secondary" label="Build again" />
              {planHref ? (
                <ButtonLink href={planHref} variant="primary">
                  Review draft plan
                </ButtonLink>
              ) : null}
            </div>
          </>
        ) : (
          <>
            <Copy eyebrow="Published" title="The plan is with the docks and drivers" detail={planLine(plan)} />
            {planHref ? (
              <ButtonLink href={planHref} variant="secondary">
                Open plan
              </ButtonLink>
            ) : null}
          </>
        )}
      </div>
    </section>
  );
}

function planLine(plan: PlanSummary | undefined) {
  if (!plan) return "No plan could be found for this day.";
  const { stats } = plan;
  return `${plural(stats.tripsBuilt, "trip")} serve ${stats.served} of ${plural(stats.orders, "order")}; ${stats.deferred} deferred.`;
}

function Copy({ eyebrow, title, detail }: { eyebrow: string; title: string; detail: string }) {
  return (
    <div className="min-w-0 max-w-2xl">
      <p className="text-xs font-bold uppercase tracking-wider text-muted">{eyebrow}</p>
      <h2 id="next-step" className="mt-1 text-lg font-bold text-ink">
        {title}
      </h2>
      <p className="mt-1 text-sm text-muted">{detail}</p>
    </div>
  );
}

function BuildForm({
  day,
  from,
  requestId,
  variant,
  label,
}: {
  day: PlanningDay;
  from: string;
  requestId: string;
  variant: "primary" | "secondary";
  label: string;
}) {
  return (
    <form action={createPlan}>
      <input type="hidden" name="date" value={day.date} />
      <input type="hidden" name="depotCode" value={day.depotCode} />
      <input type="hidden" name="requestId" value={requestId} />
      <input type="hidden" name="from" value={from} />
      <PendingButton variant={variant} pendingLabel="Building…">
        {label}
      </PendingButton>
    </form>
  );
}
