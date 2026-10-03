"use client";

import { useActionState, useId, useState } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { useConnectivity } from "./connectivity";
import { OFFLINE_SUBMIT_REASON, canSubmit } from "./connectivity-state";
import { claimVehicle, type ClaimState } from "./vehicle-actions";

export function VehicleClaimForm() {
  const [state, formAction] = useActionState<ClaimState, FormData>(claimVehicle, {});
  const [vehicleId, setVehicleId] = useState("");
  const inputId = useId();

  return (
    <form action={formAction} className="rounded-card border border-line bg-surface p-5" noValidate>
      <label htmlFor={inputId} className="block font-semibold text-ink">
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
        className="tabular mt-2 min-h-12 w-full rounded-control border border-line bg-raised px-3 text-lg text-ink"
      />
      <p className="mt-2 text-sm text-muted">
        Read the id from the dock card on the vehicle windscreen. Claiming binds today&apos;s run to this account, so
        change the vehicle before handing it to another driver.
      </p>
      <ClaimButton />
      {state.error ? (
        <p role="alert" className="mt-3 rounded-control border border-bad/25 bg-bad-surface p-3 text-sm text-bad-ink">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}

function ClaimButton() {
  const { pending } = useFormStatus();
  const { status } = useConnectivity();
  const online = canSubmit(status);
  return (
    <div className="mt-4">
      <Button type="submit" variant="primary" disabled={pending || !online} className="min-h-12 w-full text-base">
        {pending ? "Claiming…" : "Claim vehicle for today"}
      </Button>
      {!online ? <p className="mt-2 text-sm text-muted">{OFFLINE_SUBMIT_REASON}</p> : null}
    </div>
  );
}
