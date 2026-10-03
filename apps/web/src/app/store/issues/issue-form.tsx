"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { ErrorPanel } from "@/components/ui/states";
import { plural } from "@/lib/format";
import { ISSUE_NOTE_LIMIT } from "../validation";
import type { IssueChoice } from "../issue-view";
import { raiseIssue, type RaiseIssueState } from "./actions";

const INITIAL: RaiseIssueState = {};

const FIELD =
  "min-h-11 w-full rounded-control border border-line bg-surface px-3 text-base text-ink focus:border-link focus:outline-2 focus:outline-link";

export interface PickableOrder {
  id: string;
  ref: string;
  units: number;
  summary: string;
}

/**
 * The report form: what happened, which delivery, how many units, details.
 *
 * Photos and "save draft" from the design are not here — Katapatha stores
 * neither. The order list is only deliveries that can have a problem
 * (delivered or on the way), chosen by the server.
 */
export function IssueForm({
  choices,
  orders,
  clientRequestId,
  initialOrderId,
}: {
  choices: IssueChoice[];
  orders: PickableOrder[];
  clientRequestId: string;
  initialOrderId: string | null;
}) {
  const [state, formAction, pending] = useActionState(raiseIssue, INITIAL);
  const [choice, setChoice] = useState("");
  const [orderId, setOrderId] = useState(orders.some((o) => o.id === initialOrderId) ? (initialOrderId ?? "") : (orders[0]?.id ?? ""));
  const [note, setNote] = useState("");
  const order = orders.find((o) => o.id === orderId);

  return (
    <form action={formAction} className="flex flex-col gap-6">
      <input type="hidden" name="clientRequestId" value={clientRequestId} />

      <fieldset>
        <legend className="flex items-center gap-2 text-base font-bold text-ink">
          <StepDot n={1} /> What happened?
        </legend>
        <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {choices.map((option) => (
            <label
              key={option.key}
              className={`flex min-h-16 cursor-pointer items-start gap-3 rounded-control border p-3 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-link ${
                choice === option.key ? "border-action bg-warn-surface" : "border-line bg-surface hover:bg-raised"
              }`}
            >
              <input
                type="radio"
                name="choice"
                value={option.key}
                checked={choice === option.key}
                onChange={() => setChoice(option.key)}
                className="mt-1 size-5 shrink-0 accent-rail"
                required
              />
              <span>
                <span className="block font-semibold text-ink">{option.label}</span>
                {option.hint ? <span className="block text-sm text-muted">{option.hint}</span> : null}
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <div>
        <label htmlFor="issue-order" className="flex items-center gap-2 text-base font-bold text-ink">
          <StepDot n={2} /> Which delivery?
        </label>
        <select
          id="issue-order"
          name="orderId"
          value={orderId}
          onChange={(event) => setOrderId(event.target.value)}
          required
          className={`${FIELD} mt-3`}
        >
          {orders.map((o) => (
            <option key={o.id} value={o.id}>{o.ref} · {o.summary}</option>
          ))}
        </select>
        <p className="mt-1 text-sm text-muted">Only deliveries that are on the way or delivered are listed.</p>
      </div>

      <div>
        <label htmlFor="issue-units" className="flex items-center gap-2 text-base font-bold text-ink">
          <StepDot n={3} /> Units affected <span className="text-sm font-normal text-muted">Optional</span>
        </label>
        <input
          id="issue-units"
          name="units"
          type="number"
          inputMode="numeric"
          min={1}
          max={order?.units}
          step={1}
          className={`${FIELD} tabular mt-3 max-w-40`}
        />
        {order ? <p className="mt-1 text-sm text-muted">{order.ref} was for {plural(order.units, "unit")}.</p> : null}
      </div>

      <div>
        <label htmlFor="issue-note" className="flex items-center gap-2 text-base font-bold text-ink">
          <StepDot n={4} /> Details <span className="text-sm font-normal text-muted">Optional</span>
        </label>
        <textarea
          id="issue-note"
          name="note"
          rows={4}
          maxLength={ISSUE_NOTE_LIMIT}
          value={note}
          onChange={(event) => setNote(event.target.value)}
          className={`${FIELD} mt-3 py-2`}
        />
        <p className="tabular mt-1 text-right text-xs text-muted">{note.length} / {ISSUE_NOTE_LIMIT}</p>
      </div>

      {state.error ? <ErrorPanel title={state.error.title} detail={state.error.detail} outcome={state.error.outcome} /> : null}

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
        <p className="text-sm text-muted">Dispatch is notified when you send this.</p>
        <Button type="submit" variant="primary" disabled={pending || choice === "" || orderId === ""}>
          {pending ? "Sending…" : "Submit report"}
        </Button>
      </div>
    </form>
  );
}

function StepDot({ n }: { n: number }) {
  return (
    <span aria-hidden className="tabular grid size-6 place-items-center rounded-full bg-rail text-xs font-bold text-white">
      {n}
    </span>
  );
}
