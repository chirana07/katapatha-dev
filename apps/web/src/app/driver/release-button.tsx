"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { useConnectivity } from "./connectivity";
import { canSubmit } from "./connectivity-state";
import { releaseVehicle, type ReleaseState } from "./vehicle-actions";

/**
 * "Change vehicle": releases today's claim so the claim form comes back. It is
 * the quieter of the two actions on the run's thumb bar.
 */
export function ReleaseButton({ className = "", prominent = false }: { className?: string; prominent?: boolean }) {
  const [state, formAction] = useActionState<ReleaseState, FormData>(releaseVehicle, {});
  return (
    <form action={formAction} className={className}>
      <ReleaseInner prominent={prominent} />
      {state.error ? (
        <p role="alert" className="mt-2 rounded-control border border-bad/25 bg-bad-surface p-2 text-sm text-bad-ink">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}

function ReleaseInner({ prominent }: { prominent: boolean }) {
  const { pending } = useFormStatus();
  const { status } = useConnectivity();
  return (
    <Button type="submit" variant={prominent ? "primary" : "secondary"} disabled={pending || !canSubmit(status)} className="w-full">
      {pending ? "Releasing…" : "Change vehicle"}
    </Button>
  );
}
