import Link from "next/link";
import type { components } from "@katapatha/contracts/types";
import { shortDay } from "@katapatha/core/domain/deferral";
import { confirmDeferrals } from "./actions";
import { DrawerControls } from "./drawer-controls";
import { ReasonPicker } from "./reason-picker";

type DeferralRow = components["schemas"]["DeferralRow"];
type LaneAlternatives = components["schemas"]["LaneAlternatives"];

const IMPACT: Record<string, { label: string; style: string }> = {
  lowest: { label: "Lowest impact", style: "bg-blue-50 text-link" },
  protected: { label: "Protected", style: "bg-emerald-50 text-emerald-700" },
  skipped_twice: { label: "Skipped twice", style: "bg-red-50 text-[color:var(--c-ruby)]" },
  high: { label: "High impact", style: "bg-red-50 text-[color:var(--c-ruby)]" },
};

function titleCase(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
}

/**
 * Figma D-05 "Defer order" — a right-hand drawer over the plan page, opened by
 * `?defer=<assignmentId>`. Server rendered so it reads the allocator's own
 * finding and the lane comparison directly; closing is a plain link back.
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
  const titleId = `defer-title-${deferral.assignmentId}`;
  const place = order ? order.outletName ?? order.districtName : null;
  const recipient = deferral.notifyRecipient
    ? `${deferral.notifyRecipient.name} (${deferral.notifyRecipient.outletId})`
    : `The store at ${order?.outletId ?? "this outlet"}`;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <DrawerControls closeHref={closeHref} labelledBy={titleId} />
      <Link
        href={closeHref}
        scroll={false}
        aria-label="Close"
        tabIndex={-1}
        className="absolute inset-0 bg-[color:var(--c-ink)]/40"
      />
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative flex h-full w-full max-w-[540px] flex-col bg-surface shadow-2xl"
      >
        <form action={confirmDeferrals} className="flex h-full flex-col">
          <input type="hidden" name="planId" value={planId} />
          <input type="hidden" name="defer" value={deferral.assignmentId} />

          <div className="flex-1 overflow-y-auto px-6 pb-6 pt-6">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-wide text-[color:var(--c-flame)]">Defer order</p>
                <h2 id={titleId} tabIndex={-1} className="mt-1 text-2xl font-semibold text-ink outline-none">
                  {deferral.orderRef}
                  {order?.tempRequirement ? ` · ${titleCase(order.tempRequirement)} goods` : null}
                </h2>
                {order ? (
                  <p className="mt-1 text-sm text-muted">
                    {[
                      order.outletId,
                      place,
                      order.brand,
                      `${order.units} units`,
                      `${order.volumeM3} m³`,
                      `window ${order.windowOpen} – ${order.windowClose}`,
                    ].join(" · ")}
                  </p>
                ) : null}
              </div>
              <Link
                href={closeHref}
                scroll={false}
                aria-label="Close"
                className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-muted hover:bg-raised hover:text-ink"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="h-5 w-5" aria-hidden>
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </Link>
            </div>

            {error ? (
              <div role="alert" className="mt-5 rounded-[var(--radius-control)] border border-red-200 bg-red-50 p-3 text-sm font-semibold text-critical">
                {error}
              </div>
            ) : null}

            {cause ? (
              <div className="mt-5 rounded-[var(--radius-control)] bg-red-50 p-4 text-sm">
                <p className="font-semibold text-[color:var(--c-ruby)]">
                  {permanent ? "Why it can't go on any day as it stands" : "Why it can't go today"}
                </p>
                {cause.suggestion ? <p className="mt-1 text-ink">{cause.suggestion}</p> : null}
                {cause.nearMiss ? (
                  <p className="mt-2 text-muted">
                    Closest fit: {cause.nearMiss.vehicleId}, short by {cause.nearMiss.short} {cause.nearMiss.unit} of {cause.nearMiss.metric}.
                  </p>
                ) : null}
              </div>
            ) : null}

            <h3 className="mt-6 text-xs font-semibold uppercase tracking-wide text-muted">Why this order and not another</h3>
            {permanent ? (
              <p className="mt-2 rounded-[var(--radius-control)] border border-line p-3 text-sm text-muted">
                This was not a choice between orders. No vehicle in the fleet can carry it, so deferring another order would not make room.
              </p>
            ) : alternatives && alternatives.items.length <= 1 ? (
              <p className="mt-2 rounded-[var(--radius-control)] border border-line p-3 text-sm text-muted">
                No order was served on a {alternatives.lane.resource ?? "vehicle"} that could have taken this one, so deferring another order wouldn&apos;t have made room.
              </p>
            ) : alternatives ? (
              <ul className="mt-2 divide-y divide-line overflow-hidden rounded-[var(--radius-control)] border border-line">
                {alternatives.items.map((item) => {
                  const impact = IMPACT[item.impact] ?? IMPACT.high!;
                  return (
                    <li key={item.orderRef} className={`flex items-center justify-between gap-3 p-3 ${item.isThisOrder ? "bg-amber-50" : "bg-surface"}`}>
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
                      <span className={`shrink-0 rounded-md px-2 py-0.5 text-xs font-semibold ${impact.style}`}>{impact.label}</span>
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
                    <h3 className="mt-6 text-xs font-semibold uppercase tracking-wide text-muted">Moves to</h3>
                    <div className="mt-2 flex items-center justify-between gap-3 rounded-[var(--radius-control)] border border-line p-4">
                      {movesTo.firstOnRun ? (
                        <>
                          <div>
                            <p className="font-semibold text-ink">
                              {shortDay(movesTo.date)} · {movesTo.windowOpen} – {movesTo.windowClose}
                            </p>
                            <p className="text-sm text-muted">Deferred orders are planned first on the next run.</p>
                          </div>
                          <span className="shrink-0 rounded-md bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-800">First on the run</span>
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

          </div>

          <div className="flex gap-3 border-t border-line bg-surface px-6 py-4">
            <Link
              href={closeHref}
              scroll={false}
              className="inline-flex min-h-12 items-center justify-center rounded-[var(--radius-control)] border border-line px-5 font-semibold text-ink hover:bg-raised"
            >
              {readOnly ? "Close" : "Cancel"}
            </Link>
            {!readOnly ? (
              <button
                type="submit"
                className="min-h-12 flex-1 rounded-[var(--radius-control)] bg-action px-5 font-semibold text-ink hover:brightness-95"
              >
                Defer and notify store
              </button>
            ) : null}
          </div>
        </form>
      </section>
    </div>
  );
}
