"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { markTripReady, type ReadinessState } from "./actions";

type Props = {
  tripId: string;
  canMarkReady: boolean;
  disabledReason: string;
  initial: ReadinessState;
};

export function ReadinessForm({ tripId, canMarkReady, disabledReason, initial }: Props) {
  const [state, formAction] = useActionState<ReadinessState, FormData>(markTripReady, initial);

  if (state.status && state.releasedAt) {
    return (
      <section
        role="status"
        aria-live="polite"
        className="mt-6 rounded-[var(--radius-card)] border border-emerald-200 bg-emerald-50 p-5"
      >
        <h2 className="text-lg font-semibold text-emerald-900">Trip released</h2>
        <p className="mt-1 text-sm text-emerald-900">
          Status is now <span className="font-semibold">{state.status}</span>. Driver may claim and depart.
        </p>
        <p className="mt-1 text-xs tabular text-emerald-900/80">
          Released at {new Date(state.releasedAt).toLocaleString()}
        </p>
      </section>
    );
  }

  return (
    <form action={formAction} className="mt-6 rounded-[var(--radius-card)] border border-line bg-surface p-5">
      <input type="hidden" name="tripId" value={tripId} />
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="max-w-xl">
          <h2 className="text-lg font-semibold text-ink">Mark the vehicle ready</h2>
          <p className="mt-1 text-sm text-muted">
            Every line must be checked and no open shortfall may block departure. The server has the authoritative gate —
            this button only asks for the release.
          </p>
          {!canMarkReady && (
            <p className="mt-2 text-sm text-amber-900">
              <span className="font-semibold">Not yet ready:</span> {disabledReason}
            </p>
          )}
        </div>
        <ReadyButton disabled={!canMarkReady} />
      </div>

      {state.blocking && (
        <div
          role="alert"
          aria-live="polite"
          className="mt-4 rounded-[var(--radius-control)] border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900"
        >
          <p className="font-semibold">Server rejected the release: {state.blocking.code}</p>
          <p className="mt-1">{state.blocking.message}</p>
          {state.blocking.details && Object.keys(state.blocking.details).length > 0 && (
            <ul className="mt-1 list-disc pl-5">
              {Object.entries(state.blocking.details).map(([key, value]) => (
                <li key={key}>
                  <span className="font-semibold">{key}:</span> {String(value)}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {state.error && (
        <p
          role="alert"
          className="mt-4 rounded-[var(--radius-control)] border border-red-200 bg-red-50 p-3 text-sm text-critical"
        >
          {state.error}
        </p>
      )}
    </form>
  );
}

function ReadyButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  const isDisabled = disabled || pending;
  return (
    <button
      type="submit"
      disabled={isDisabled}
      aria-disabled={isDisabled}
      className="min-h-11 min-w-40 self-start rounded-[var(--radius-control)] bg-action px-5 font-semibold text-ink transition-[filter] hover:brightness-95 disabled:cursor-not-allowed disabled:bg-raised disabled:text-muted"
    >
      {pending ? "Releasing…" : "Mark trip ready"}
    </button>
  );
}
