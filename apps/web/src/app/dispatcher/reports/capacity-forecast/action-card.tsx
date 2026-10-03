"use client";

import { useActionState, useId } from "react";
import { Button } from "@/components/ui/button";
import { Advisory, ErrorPanel } from "@/components/ui/states";
import { StatusPill } from "@/components/ui/status-pill";
import { clockTime } from "@/lib/format";
import { decideCapacityAction, type CapacityState } from "./actions";
import {
  DECISION_LABEL,
  STATUS_LABEL,
  STATUS_TONE,
  applyCaption,
  reliefText,
  type CapacityAction,
  type CapacityDecision,
} from "./capacity-model";

const IDLE: CapacityState = { status: "idle" };

/**
 * One recommended action, with its decisions as buttons in a form.
 *
 * After a decision the card shows what the API says it DID, verbatim: for a
 * hire or a moved delivery day that is "recorded only", and the dispatcher
 * should read it. The page revalidates, so the status pill and the available
 * buttons update underneath; the result text stays because the card keeps its
 * own state.
 */
export function ActionCard({ action, index }: { action: CapacityAction; index: number }) {
  const [state, formAction, pending] = useActionState(decideCapacityAction, IDLE);
  const noteId = useId();
  const relief = reliefText(action);
  const decisions = action.availableDecisions as CapacityDecision[];

  return (
    <li className="rounded-card border border-line bg-surface p-3">
      <div className="flex items-start gap-3">
        <span aria-hidden className="tabular grid size-7 shrink-0 place-items-center rounded-full bg-rail text-sm font-bold text-white">
          {index + 1}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <p className="font-semibold text-ink">{action.title}</p>
            <StatusPill label={STATUS_LABEL[action.status]} tone={STATUS_TONE[action.status]} />
          </div>
          <p className="mt-0.5 text-sm text-muted">{action.detail}</p>
          {relief ? <p className="mt-1 text-sm text-ink">{relief}</p> : null}
          {action.stale ? <p className="mt-1 text-xs text-warn-ink">The forecast no longer calls for this: the week is covered now.</p> : null}
          {action.decidedBy && action.decidedAt ? (
            <p className="mt-1 text-xs text-muted">
              {STATUS_LABEL[action.status]} by {action.decidedBy} at {clockTime(action.decidedAt)}
              {action.note ? ` · “${action.note}”` : ""}
            </p>
          ) : null}
        </div>
      </div>

      {state.status === "done" ? (
        <div className="mt-3 flex flex-col gap-2">
          <Advisory>
            <strong>{state.decision === "APPLY" ? "Applied" : state.decision === "APPROVE" ? "Approved" : "Rejected"}.</strong>
          </Advisory>
          <ul className="flex flex-col gap-1 text-sm text-ink">
            {state.consequences.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {state.status === "failed" ? (
        <div className="mt-3">
          <ErrorPanel title={state.title} detail={state.detail} outcome={state.outcome} />
        </div>
      ) : null}

      {decisions.length > 0 ? (
        <form action={formAction} className="mt-3 flex flex-col gap-2 border-t border-line pt-3">
          <input type="hidden" name="id" value={action.id} />
          <label htmlFor={noteId} className="text-xs font-semibold text-muted">
            Note <span className="font-normal">(optional, kept in the decision log)</span>
          </label>
          <input
            id={noteId}
            name="note"
            maxLength={500}
            className="min-h-11 rounded-control border border-line bg-surface px-3 text-sm text-ink"
          />
          {decisions.includes("APPLY") ? <p className="text-xs text-muted">{applyCaption(action.kind)}</p> : null}
          <div className="flex flex-wrap gap-2">
            {decisions.map((decision) => (
              <Button
                key={decision}
                type="submit"
                name="decision"
                value={decision}
                variant={decision === "REJECT" ? "ghost" : decision === "APPLY" ? "primary" : "secondary"}
                disabled={pending}
              >
                {DECISION_LABEL[decision]}
              </Button>
            ))}
          </div>
        </form>
      ) : null}
    </li>
  );
}
