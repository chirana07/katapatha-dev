"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { releaseVehicle, type ReleaseState } from "./vehicle-actions";

export function ReleaseButton() {
  const [state, formAction] = useActionState<ReleaseState, FormData>(releaseVehicle, {});
  return (
    <form action={formAction}>
      <ReleaseInner />
      {state.error && (
        <p
          role="alert"
          className="mt-2 rounded-[var(--radius-control)] border border-red-200 bg-red-50 p-2 text-sm text-critical"
        >
          {state.error}
        </p>
      )}
    </form>
  );
}

function ReleaseInner() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      aria-disabled={pending}
      className="min-h-11 rounded-[var(--radius-control)] border border-line bg-surface px-3 text-sm font-semibold text-ink hover:bg-raised disabled:cursor-not-allowed disabled:text-muted"
    >
      {pending ? "Releasing…" : "Release vehicle"}
    </button>
  );
}
