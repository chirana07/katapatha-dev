"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { ErrorPanel } from "@/components/ui/states";
import { confirmReceipt, type ReceiptState } from "./actions";

const INITIAL_STATE: ReceiptState = {};

const FIELD =
  "min-h-11 w-full rounded-control border border-line bg-surface px-3 text-base text-ink focus:border-link focus:outline-2 focus:outline-link";

/**
 * Receipt confirmation: what the driver recorded against what was ordered, and
 * the one decision that is the manager's — did it arrive?
 *
 * Katapatha keeps unit counts, not a line per product, so "what you received"
 * is a number. When the driver already recorded fewer units than were ordered
 * the form opens on the difference rather than offering a one-tap "everything
 * arrived" that would contradict the record beside it.
 */
export function ReceiptForm({
  orderId,
  orderRef,
  orderedUnits,
  recordedUnits,
  returnTo,
  reasons,
}: {
  orderId: string;
  orderRef: string;
  orderedUnits: number;
  /** The driver's count. Null when none was recorded. */
  recordedUnits: number | null;
  returnTo: string;
  reasons: { code: string; label: string }[];
}) {
  const [state, formAction, pending] = useActionState(confirmReceipt, INITIAL_STATE);
  const driverShort = recordedUnits != null && recordedUnits < orderedUnits;
  const [wrong, setWrong] = useState(driverShort);
  const headingId = `receipt-${orderId}`;

  return (
    <form action={formAction} aria-labelledby={headingId} className="flex flex-col gap-4">
      <input type="hidden" name="orderId" value={orderId} />
      <input type="hidden" name="returnTo" value={returnTo} />
      <p id={headingId} className="sr-only">Confirm receipt of {orderRef}</p>

      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Count label="Ordered" value={`${orderedUnits} units`} />
        <Count
          label="Driver recorded"
          value={recordedUnits == null ? "Not recorded" : `${recordedUnits} units`}
          bad={driverShort}
        />
        {wrong ? (
          <div className="col-span-2 sm:col-span-1">
            <label htmlFor={`${headingId}-units`} className="text-xs text-muted">
              You received (units)
            </label>
            <input
              id={`${headingId}-units`}
              name="unitsReceived"
              type="number"
              inputMode="numeric"
              min={0}
              step={1}
              required
              defaultValue={recordedUnits ?? orderedUnits}
              className={`${FIELD} tabular mt-0.5 font-bold`}
            />
          </div>
        ) : (
          <Count label="You received" value={`${orderedUnits} units`} />
        )}
      </dl>

      {wrong ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <input type="hidden" name="matches" value="no" />
          <div>
            <label htmlFor={`${headingId}-kind`} className="text-sm font-semibold text-ink">What was wrong?</label>
            <select id={`${headingId}-kind`} name="issueKind" required defaultValue="" className={`${FIELD} mt-1`}>
              <option value="" disabled>Select what was wrong</option>
              {reasons.map((reason) => (
                <option key={reason.code} value={reason.code}>{reason.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor={`${headingId}-note`} className="text-sm font-semibold text-ink">
              Note <span className="font-normal text-muted">(optional)</span>
            </label>
            <textarea id={`${headingId}-note`} name="note" rows={2} maxLength={500} className={`${FIELD} mt-1 py-2`} />
          </div>
        </div>
      ) : (
        <>
          <input type="hidden" name="matches" value="yes" />
          <input type="hidden" name="unitsReceived" value={orderedUnits} />
        </>
      )}

      {state.error ? (
        <ErrorPanel title={state.error.title} detail={state.error.detail} outcome={state.error.outcome} />
      ) : null}

      <div className="flex flex-wrap gap-2">
        {wrong ? (
          <>
            <Button type="submit" variant="primary" disabled={pending}>
              {pending ? "Confirming…" : "Confirm receipt with a difference"}
            </Button>
            {!driverShort ? (
              <Button type="button" onClick={() => setWrong(false)} disabled={pending}>
                Everything arrived
              </Button>
            ) : null}
          </>
        ) : (
          <>
            <Button type="submit" variant="primary" disabled={pending}>
              {pending ? "Confirming…" : "Everything arrived · confirm receipt"}
            </Button>
            <Button type="button" onClick={() => setWrong(true)} disabled={pending}>
              Something&apos;s wrong
            </Button>
          </>
        )}
      </div>
    </form>
  );
}

function Count({ label, value, bad }: { label: string; value: string; bad?: boolean }) {
  return (
    <div className="rounded-control border border-line p-3">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className={`tabular mt-0.5 font-bold ${bad ? "text-bad-ink" : "text-ink"}`}>{value}</dd>
    </div>
  );
}
