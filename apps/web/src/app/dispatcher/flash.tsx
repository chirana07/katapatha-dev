import { ErrorPanel } from "@/components/ui/states";

/**
 * What the dispatcher's server actions say when they send the browser back.
 *
 * Actions redirect with `?notice=` or `?error=` so the result survives a reload
 * and the back button, which means the page has to turn a code into words. This
 * is the one table for all three dispatcher screens (dashboard, planning desk,
 * plan board).
 *
 * `outcome` is the honesty rule from lib/failures.ts: a code whose request may
 * have landed says "unknown", never "failed". Those are the `*_outcome_unknown`
 * codes, and each carries the same idempotency key on retry.
 */
type Outcome = "failed" | "unknown";

const ERRORS: Record<string, { title: string; detail: string; outcome: Outcome }> = {
  unreachable: {
    title: "Katapatha could not be reached",
    detail: "Nothing was sent. Reload the page and try again.",
    outcome: "failed",
  },
  depot: {
    title: "No depot on this account",
    detail: "Your dispatcher account is not assigned to a depot, so it cannot plan.",
    outcome: "failed",
  },
  invalid_request: {
    title: "That request was incomplete",
    detail: "Reload the page and try again.",
    outcome: "failed",
  },
  forbidden: {
    title: "Outside your depot",
    detail: "This planning day or plan belongs to another depot.",
    outcome: "failed",
  },
  stale: {
    title: "That has changed",
    detail: "The planning day or plan moved on. The latest state is shown here.",
    outcome: "failed",
  },
  close_outcome_unknown: {
    title: "We could not confirm the queue closed",
    detail: "The latest state is shown below. Closing again is safe if it still says open.",
    outcome: "unknown",
  },
  queue_open: {
    title: "The queue is still open",
    detail: "Close the order queue before building a plan.",
    outcome: "failed",
  },
  plan_invalid: {
    title: "The queue could not make a valid plan",
    detail: "The allocator refused the input. Check the day's orders and fleet.",
    outcome: "failed",
  },
  plan_outcome_unknown: {
    title: "We could not confirm the plan was built",
    detail: "The latest state is shown below. If no draft appears, try again: the retry uses the same request key, so it cannot build two.",
    outcome: "unknown",
  },
  fleet_locked: {
    title: "The plan is already published",
    detail: "Vehicle status can no longer change from the planning desk.",
    outcome: "failed",
  },
  fleet_outcome_unknown: {
    title: "We could not confirm the vehicle change",
    detail: "Check the fleet list below before changing it again.",
    outcome: "unknown",
  },
  already_published: {
    title: "That plan is no longer a draft",
    detail: "It was published or replaced. The current state is shown below.",
    outcome: "failed",
  },
  validation_blocked: {
    title: "Publication is blocked",
    detail: "Resolve every blocking issue in the publication check, then publish again.",
    outcome: "failed",
  },
  deferrals_unconfirmed: {
    title: "Some deferrals still need a reason",
    detail: "Choose a reason for every deferred order, then publish again.",
    outcome: "failed",
  },
  publish_outcome_unknown: {
    title: "We could not confirm the plan was published",
    detail: "The latest state is shown below. If it is still a draft, publish again: the retry cannot publish it twice.",
    outcome: "unknown",
  },
  deferrals_empty: {
    title: "Pick a reason first",
    detail: "Choose a reason for the deferral before saving.",
    outcome: "failed",
  },
  deferrals_rejected: {
    title: "The server refused that reason",
    detail: "Reload the plan and choose again.",
    outcome: "failed",
  },
  deferrals_outcome_unknown: {
    title: "We could not confirm the reason was saved",
    detail: "Reopen the deferral to see what is recorded. Saving again is safe.",
    outcome: "unknown",
  },
};

const NOTICES: Record<string, { title: string; detail: (context: FlashContext) => string }> = {
  queue_closed: {
    title: "Order queue closed",
    detail: () => "The plan can now be built from the orders in the queue.",
  },
  plan_created: {
    title: "Draft plan built",
    detail: () => "Review its trips and deferrals, then publish when the publication check is clear.",
  },
  fleet_updated: {
    title: "Vehicle status saved",
    detail: () => "The next plan run uses the updated fleet.",
  },
  fleet_updated_draft: {
    title: "Vehicle status saved",
    detail: () => "Build the plan again so the draft uses the updated fleet. A draft that still uses a vehicle in the workshop cannot be published.",
  },
  published: {
    title: "Plan published",
    detail: ({ deferred }) =>
      deferred
        ? "The trips are now on the loaders' and drivers' screens, and the outlets with deferred orders have been notified."
        : "The trips are now on the loaders' and drivers' screens.",
  },
  deferrals_saved: {
    title: "Deferral reason saved",
    detail: ({ pendingDeferrals }) =>
      pendingDeferrals === 0
        ? "Every deferral now has a reason."
        : `${pendingDeferrals ?? "Some"} deferral${pendingDeferrals === 1 ? "" : "s"} still need a reason before the plan can be published.`,
  },
};

export interface FlashContext {
  pendingDeferrals?: number;
  /** Deferred orders on the plan, so a publication notice does not mention notices that were not sent. */
  deferred?: number;
}

export function Flash({
  notice,
  error,
  context = {},
}: {
  notice?: string;
  error?: string;
  context?: FlashContext;
}) {
  const failure = error ? (ERRORS[error] ?? { title: "That did not complete", detail: "Reload the page and try again.", outcome: "failed" as Outcome }) : null;
  const done = notice ? NOTICES[notice] : undefined;
  if (!failure && !done) return null;

  return (
    <div className="flex flex-col gap-3">
      {failure ? <ErrorPanel title={failure.title} detail={failure.detail} outcome={failure.outcome} /> : null}
      {done ? (
        <div role="status" className="rounded-card border border-good/25 bg-good-surface px-4 py-3">
          <p className="font-semibold text-good-ink">{done.title}</p>
          <p className="mt-0.5 text-sm text-ink">{done.detail(context)}</p>
        </div>
      ) : null}
    </div>
  );
}
