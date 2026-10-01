"use client";

import { useActionState, useState } from "react";
import { confirmReceipt, type ReceiptState } from "./actions";

const INITIAL_STATE: ReceiptState = {};

export function ReceiptForm({ orderId, expectedUnits }: { orderId: string; expectedUnits: number }) {
  const [state, formAction, pending] = useActionState(confirmReceipt, INITIAL_STATE);
  const [matches, setMatches] = useState(true);

  return (
    <form action={formAction} className="mt-5 space-y-5">
      <input name="orderId" type="hidden" value={orderId} />

      <fieldset>
        <legend className="font-semibold">Did everything arrive as expected?</legend>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <ReceiptChoice
            checked={matches}
            description="The quantity and condition are correct."
            label="Yes, everything matches"
            value="yes"
            onChange={() => setMatches(true)}
          />
          <ReceiptChoice
            checked={!matches}
            description="Something is missing, damaged, warm, or incorrect."
            label="No, report a difference"
            value="no"
            onChange={() => setMatches(false)}
          />
        </div>
      </fieldset>

      <label className="block max-w-xs" htmlFor="unitsReceived">
        <span className="font-semibold">Units received</span>
        <input
          id="unitsReceived"
          name="unitsReceived"
          type="number"
          min="0"
          step="1"
          required
          defaultValue={expectedUnits}
          className="tabular mt-2 min-h-12 w-full rounded-[var(--radius-control)] border border-line bg-surface px-3 text-base font-semibold outline-none focus:border-link focus:ring-2 focus:ring-blue-100"
        />
      </label>

      {!matches ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block" htmlFor="issueKind">
            <span className="font-semibold">What was wrong?</span>
            <select
              id="issueKind"
              name="issueKind"
              required
              defaultValue=""
              className="mt-2 min-h-12 w-full rounded-[var(--radius-control)] border border-line bg-surface px-3 text-base outline-none focus:border-link focus:ring-2 focus:ring-blue-100"
            >
              <option value="" disabled>Select an issue</option>
              <option value="ITEMS_MISSING">Items missing</option>
              <option value="ITEMS_DAMAGED">Items damaged</option>
              <option value="ARRIVED_WARM">Chilled items arrived warm</option>
              <option value="WRONG_ITEMS">Wrong items delivered</option>
            </select>
          </label>
          <label className="block" htmlFor="note">
            <span className="font-semibold">Note <span className="font-normal text-muted">(optional)</span></span>
            <textarea
              id="note"
              name="note"
              rows={3}
              className="mt-2 w-full rounded-[var(--radius-control)] border border-line bg-surface px-3 py-2 text-base outline-none focus:border-link focus:ring-2 focus:ring-blue-100"
            />
          </label>
        </div>
      ) : null}

      {state.error ? (
        <div role="alert" className="rounded-lg bg-red-50 p-4 text-sm text-critical">
          <p className="font-semibold">Receipt not confirmed</p>
          <p className="mt-1">{state.error}</p>
        </div>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="min-h-12 w-full rounded-[var(--radius-control)] bg-action px-5 font-semibold text-ink transition-[filter] hover:brightness-95 disabled:cursor-wait disabled:opacity-60 sm:w-auto"
      >
        {pending ? "Confirming…" : "Confirm receipt"}
      </button>
    </form>
  );
}

function ReceiptChoice({
  checked,
  description,
  label,
  value,
  onChange,
}: {
  checked: boolean;
  description: string;
  label: string;
  value: string;
  onChange: () => void;
}) {
  return (
    <label className={`flex min-h-20 cursor-pointer gap-3 rounded-[var(--radius-control)] border p-4 ${checked ? "border-link bg-blue-50" : "border-line bg-surface"}`}>
      <input name="matches" type="radio" value={value} checked={checked} onChange={onChange} className="mt-1 size-4 accent-blue-600" />
      <span>
        <span className="block font-semibold">{label}</span>
        <span className="mt-1 block text-sm text-muted">{description}</span>
      </span>
    </label>
  );
}
