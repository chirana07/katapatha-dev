import type { components } from "@katapatha/contracts/types";
import { shortDay } from "@katapatha/core/domain/deferral";
import { ButtonLink } from "@/components/ui/button";
import { PendingButton } from "@/components/ui/pending-button";
import { SideDrawer } from "@/components/ui/side-drawer";
import { StatusPill, type Tone } from "@/components/ui/status-pill";
import { confirmDeferrals } from "./actions";
import { ReasonPicker } from "./reason-picker";

type DeferralRow = components["schemas"]["DeferralRow"];
type LaneAlternatives = components["schemas"]["LaneAlternatives"];

const IMPACT: Record<string, { label: string; tone: Tone }> = {
  lowest: { label: "Lowest impact", tone: "info" },
  protected: { label: "Protected", tone: "good" },
  skipped_twice: { label: "Skipped twice", tone: "bad" },
  high: { label: "High impact", tone: "bad" },
};

function titleCase(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
}

/**
 * D-05 "Defer order": a right-hand drawer over the plan board, opened by
 * `?defer=<assignmentId>`. Server rendered, so it reads the allocator's own
 * finding and the lane comparison directly; the drawer chrome (focus, Esc,
 * close) is the shared SideDrawer.
 *
 * What it saves is the reason, not the deferral: the order was deferred by the
 * allocator, and the store is told when the plan is published. The button says
 * "Save reason" for that reason — "notify store" here would promise a message
 * that has not been sent.
 */
export function DeferDrawer({
  planId,
  deferral,
  alternatives,
  alternativesFailed,
  error,
  allReasons,
  closeHref,
  readOnly,
  sent,
}: {
  planId: string;
  deferral: DeferralRow;
  alternatives: LaneAlternatives | null;
  alternativesFailed: boolean;
  /** A save error, shown here because the page banner sits behind the overlay. */
  error: string | null;
  allReasons: string[];
  closeHref: string;
  readOnly: boolean;
  /** The plan is published, so the store message has already gone out. */
  sent: boolean;
}) {
  const order = deferral.order;
  const cause = deferral.cause ?? null;
  const movesTo = deferral.movesTo ?? null;
  const permanent = Boolean(cause?.permanent);
  const place = order ? (order.outletName ?? order.districtName) : null;
  const recipient = deferral.notifyRecipient
    ? `${deferral.notifyRecipient.name} (${deferral.notifyRecipient.outletId})`
    : `The store at ${order?.outletId ?? "this outlet"}`;

  return (
    <form action={confirmDeferrals}>
      <input type="hidden" name="planId" value={planId} />
      <input type="hidden" name="defer" value={deferral.assignmentId} />
      <SideDrawer
        closeHref={closeHref}
        eyebrow="Defer order"
        title={`${deferral.orderRef}${order?.tempRequirement ? ` · ${titleCase(order.tempRequirement)} goods` : ""}`}
        context={
          order
            ? [order.outletId, place, order.brand, `${order.units} units`, `${order.volumeM3} m³`, `window ${order.windowOpen} – ${order.windowClose}`].join(" · ")
            : undefined
        }
        footer={
          <>
            <ButtonLink href={closeHref} scroll={false} variant="secondary">
              {readOnly ? "Close" : "Cancel"}
            </ButtonLink>
            {!readOnly ? (
              <PendingButton variant="primary" className="flex-1" pendingLabel="Saving…">
                Save reason
              </PendingButton>
            ) : null}
          </>
        }
      >
        {error ? (
          <div role="alert" className="mb-4 rounded-control border border-bad/25 bg-bad-surface p-3 text-sm font-semibold text-bad-ink">
            {error}
          </div>
        ) : null}

        {cause ? (
          <div className="rounded-control border border-bad/25 bg-bad-surface p-4 text-sm">
            <p className="font-semibold text-bad-ink">{permanent ? "Why it can't go on any day as it stands" : "Why it can't go today"}</p>
            {cause.suggestion ? <p className="mt-1 text-ink">{cause.suggestion}</p> : null}
            {cause.nearMiss ? (
              <p className="mt-2 text-muted">
                Closest fit: {cause.nearMiss.vehicleId}, short by {cause.nearMiss.short} {cause.nearMiss.unit} of {cause.nearMiss.metric}.
              </p>
            ) : null}
          </div>
        ) : null}

        <h3 className="mt-6 text-xs font-bold uppercase tracking-wider text-muted">Why this order and not another</h3>
        {permanent ? (
          <p className="mt-2 rounded-control border border-line p-3 text-sm text-muted">
            This was not a choice between orders. No vehicle in the fleet can carry it, so deferring another order would not make room.
          </p>
        ) : alternatives && alternatives.items.length <= 1 ? (
          <p className="mt-2 rounded-control border border-line p-3 text-sm text-muted">
            No order was served on a {alternatives.lane.resource ?? "vehicle"} that could have taken this one, so deferring another order wouldn&apos;t have made room.
          </p>
        ) : alternatives ? (
          <ul className="mt-2 divide-y divide-line overflow-hidden rounded-control border border-line">
            {alternatives.items.map((item) => {
              const impact = IMPACT[item.impact] ?? IMPACT.high!;
              return (
                <li key={item.orderRef} className={`flex items-center justify-between gap-3 p-3 ${item.isThisOrder ? "bg-warn-surface" : "bg-surface"}`}>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-ink">
                      {item.outletId} · {item.orderRef}
                      {item.outletName ? ` · ${item.outletName}` : ""}
                      {item.isThisOrder ? " (this order)" : ""}
                    </p>
                    <p className="text-xs text-muted">
                      Priority #{item.rank} of {alternatives.lane.competing ?? alternatives.items.length} · {item.why}
                      {item.isThisOrder ? "" : " · served"}
                    </p>
                  </div>
                  <StatusPill label={impact.label} tone={impact.tone} dot={false} />
                </li>
              );
            })}
          </ul>
        ) : alternativesFailed ? (
          <p className="mt-2 text-sm text-muted">The lane comparison could not be loaded. Reload to try again.</p>
        ) : (
          <p className="mt-2 text-sm text-muted">No other orders share this lane.</p>
        )}

        <div className="mt-6">
          <ReasonPicker
            assignmentId={deferral.assignmentId}
            orderRef={deferral.orderRef}
            windowOpen={order?.windowOpen ?? ""}
            windowClose={order?.windowClose ?? ""}
            movesTo={movesTo?.date ?? ""}
            permanent={permanent}
            suggested={deferral.suggestedReasonCode ?? null}
            initialReason={deferral.reasonCode ?? null}
            initialNote={deferral.note ?? null}
            allReasons={allReasons}
            recipient={recipient}
            readOnly={readOnly}
            sent={sent}
          >
            {movesTo ? (
              <>
                <h3 className="mt-6 text-xs font-bold uppercase tracking-wider text-muted">Moves to</h3>
                <div className="mt-2 flex items-center justify-between gap-3 rounded-control border border-line p-4">
                  {movesTo.firstOnRun ? (
                    <>
                      <div>
                        <p className="tabular font-semibold text-ink">
                          {shortDay(movesTo.date)} · {movesTo.windowOpen} – {movesTo.windowClose}
                        </p>
                        <p className="text-sm text-muted">Deferred orders are planned first on the next run.</p>
                      </div>
                      <StatusPill label="First on the run" tone="warn" dot={false} />
                    </>
                  ) : (
                    <div>
                      <p className="font-semibold text-ink">No run will fit it as it stands</p>
                      <p className="text-sm text-muted">The order needs to be split or changed before it can be planned.</p>
                    </div>
                  )}
                </div>
              </>
            ) : null}
          </ReasonPicker>
        </div>
      </SideDrawer>
    </form>
  );
}
