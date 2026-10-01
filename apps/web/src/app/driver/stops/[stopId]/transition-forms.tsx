"use client";

import { recordArrival, startUnload } from "./actions";
import { EventForm } from "./event-form";

export function ArrivalForm({ stopId, disabled }: { stopId: string; disabled: boolean }) {
  return (
    <EventForm
      stopId={stopId}
      action={recordArrival}
      buttonLabel="Record arrival"
      pendingLabel="Recording…"
      disabled={disabled}
      savedCopy={() => "Arrival recorded. The dock is expecting you — start unload when the hand-off begins."}
    />
  );
}

export function UnloadForm({ stopId, disabled }: { stopId: string; disabled: boolean }) {
  return (
    <EventForm
      stopId={stopId}
      action={startUnload}
      buttonLabel="Start unload"
      pendingLabel="Starting…"
      disabled={disabled}
      savedCopy={() => "Unload started. Complete the delivery once every line is off the vehicle."}
    />
  );
}
