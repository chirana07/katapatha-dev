"use client";

import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Consequences, Modal } from "@/components/ui/modal";
import { PendingButton } from "@/components/ui/pending-button";
import { PUBLISH_FINAL_NOTE, publishConsequences, type PublishFacts } from "../../plan-summary";
import { publishPlan } from "./actions";

/**
 * D-06 "Publish plan": the confirmation, with what publishing will really do.
 *
 * The page renders this only while `?publish=1` is in the URL, so a redirect
 * from the action (to `?notice=published`, or `?error=...&retry=...`) removes
 * it, and the dispatcher lands on the result rather than under a stale dialog.
 * The idempotency key rides in as `requestId`; after an unanswered request the
 * page hands the same key back through `?retry=`, so confirming again replays
 * the first attempt instead of racing it.
 *
 * It is only offered when nothing blocks publication, so the dialog does not
 * re-derive that. The server action re-reads the plan and its publication check
 * anyway, because the page this was opened from may be minutes old.
 */
export function PublishDialog({
  planId,
  requestId,
  closeHref,
  dayLabel,
  facts,
  warnings,
}: {
  planId: string;
  requestId: string;
  closeHref: string;
  /** "Thu 9 Apr 2026". */
  dayLabel: string;
  facts: PublishFacts;
  /** Warnings from the publication check: they do not block, but are read before confirming. */
  warnings: { title: string; message: string }[];
}) {
  const router = useRouter();
  const close = () => router.replace(closeHref, { scroll: false });

  return (
    <form action={publishPlan}>
      <input type="hidden" name="planId" value={planId} />
      <input type="hidden" name="requestId" value={requestId} />
      <Modal
        open
        onClose={close}
        eyebrow="Publish plan"
        title={`Publish the plan for ${dayLabel}?`}
        context="Check what it sets in motion. You cannot take a publication back."
        footer={
          <>
            <Button type="button" variant="secondary" onClick={close}>
              Back to plan
            </Button>
            <PendingButton variant="primary" pendingLabel="Publishing…">
              Publish plan
            </PendingButton>
          </>
        }
      >
        <div className="grid gap-3 sm:grid-cols-3">
          <Tile figure={facts.served} label="orders served" detail={`${facts.vehicles} vehicle${facts.vehicles === 1 ? "" : "s"} · ${facts.trips} trip${facts.trips === 1 ? "" : "s"}`} />
          <Tile figure={facts.deferred} label="deferred" detail={facts.deferred ? "every one has a reason" : "nothing is deferred"} />
          <Tile figure={warnings.length} label={warnings.length === 1 ? "warning" : "warnings"} detail="none block publishing" />
        </div>

        {warnings.length > 0 ? (
          <section className="mt-5">
            <h3 className="text-xs font-bold uppercase tracking-wider text-muted">Worth knowing</h3>
            <ul className="mt-2 flex flex-col gap-2">
              {warnings.map((warning, index) => (
                <li key={`${warning.title}-${index}`} className="rounded-control border border-warn/30 bg-warn-surface p-3 text-sm">
                  <p className="font-semibold text-warn-ink">{warning.title}</p>
                  <p className="mt-0.5 text-ink">{warning.message}</p>
                </li>
              ))}
            </ul>
          </section>
        ) : (
          <p className="mt-5 rounded-control border border-good/25 bg-good-surface p-3 text-sm text-good-ink">The plan passed the publication check with no issues.</p>
        )}

        <div className="mt-5">
          <Consequences items={publishConsequences(facts)} />
        </div>

        <p className="mt-5 text-sm text-muted">{PUBLISH_FINAL_NOTE}</p>
      </Modal>
    </form>
  );
}

function Tile({ figure, label, detail }: { figure: number; label: string; detail: string }) {
  return (
    <div className="rounded-control border border-line p-3">
      <p className="text-ink">
        <span className="tabular text-2xl font-bold">{figure}</span> <span className="text-sm font-semibold">{label}</span>
      </p>
      <p className="mt-0.5 text-xs text-muted">{detail}</p>
    </div>
  );
}
