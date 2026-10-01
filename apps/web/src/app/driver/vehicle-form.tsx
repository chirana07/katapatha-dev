"use client";

import { useActionState, useId, useState } from "react";
import { useFormStatus } from "react-dom";
import { claimVehicle, type ClaimState } from "./vehicle-actions";

export function VehicleClaimForm() {
  const [state, formAction] = useActionState<ClaimState, FormData>(claimVehicle, {});
  const [vehicleId, setVehicleId] = useState("");
  const inputId = useId();

  return (
    <form
      action={formAction}
      className="rounded-[var(--radius-card)] border border-line bg-surface p-5"
      noValidate
    >
      <label htmlFor={inputId} className="block text-sm font-semibold text-ink">
        Vehicle id
      </label>
      <input
        id={inputId}
        name="vehicleId"
        type="text"
        inputMode="text"
        autoCapitalize="characters"
        autoComplete="off"
        required
        placeholder="e.g. VEH043"
        value={vehicleId}
        onChange={(event) => setVehicleId(event.target.value)}
        className="tabular mt-2 min-h-12 w-full rounded-[var(--radius-control)] border border-line bg-raised px-3 text-lg text-ink"
      />
      <p className="mt-2 text-sm text-muted">
        Read the id from the dock card on the vehicle windscreen. Claiming binds today&apos;s run to this phone — release
        before handing the vehicle to another driver.
      </p>
      <ClaimButton />
      {state.error && (
        <p
          role="alert"
          className="mt-3 rounded-[var(--radius-control)] border border-red-200 bg-red-50 p-3 text-sm text-critical"
        >
          {state.error}
        </p>
      )}
    </form>
  );
}

function ClaimButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      aria-disabled={pending}
      className="mt-4 min-h-12 w-full rounded-[var(--radius-control)] bg-action px-4 text-base font-semibold text-ink transition-[filter] hover:brightness-95 disabled:cursor-not-allowed disabled:bg-raised disabled:text-muted"
    >
      {pending ? "Claiming…" : "Claim vehicle for today"}
    </button>
  );
}
