"use client";

import { recordArrival, startUnload } from "./actions";
import { EventForm } from "./event-form";

export function ArrivalForm({ stopId, secondary }: { stopId: string; secondary?: React.ReactNode }) {
  return (
    <EventForm
      stopId={stopId}
      action={recordArrival}
      buttonLabel="Record arrival"
      pendingLabel="Recording…"
      secondary={secondary}
    />
  );
}

export function UnloadForm({ stopId, secondary }: { stopId: string; secondary?: React.ReactNode }) {
  return (
    <EventForm
      stopId={stopId}
      action={startUnload}
      buttonLabel="Start unload"
      pendingLabel="Starting…"
      secondary={secondary}
    />
  );
}
