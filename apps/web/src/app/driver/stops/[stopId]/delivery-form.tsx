"use client";

import { useState } from "react";
import { completeDelivery } from "./actions";
import { EventForm } from "./event-form";

type Order = { orderId: string; orderRef: string; expectedUnits: number };

export function DeliveryForm({
  stopId,
  orders,
  disabled,
}: {
  stopId: string;
  orders: Order[];
  disabled: boolean;
}) {
  const first = orders[0];
  const expected = first?.expectedUnits ?? 0;
  const [units, setUnits] = useState<string>(String(expected));
  const [recipient, setRecipient] = useState<string>("");

  return (
    <EventForm
      stopId={stopId}
      action={completeDelivery}
      buttonLabel="Complete delivery"
      pendingLabel="Saving…"
      disabled={disabled}
      savedCopy={() => "Delivery saved. The next stop is ready in the run."}
    >
      <input type="hidden" name="orderId" value={first?.orderId ?? ""} />
      <input type="hidden" name="expectedUnits" value={expected} />
      <label className="flex flex-col gap-1">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted">Delivered units</span>
        <input
          name="deliveredUnits"
          type="number"
          inputMode="numeric"
          min={0}
          step={1}
          required
          value={units}
          onChange={(event) => setUnits(event.target.value)}
          className="tabular min-h-12 rounded-[var(--radius-control)] border border-line bg-surface px-3 text-lg text-ink"
          aria-describedby={`${stopId}-units-hint`}
        />
        <span id={`${stopId}-units-hint`} className="text-xs text-muted">
          Expected {expected}
          {orders.length > 1 ? " on the first order" : ""}. Lower numbers are recorded as a part delivery.
        </span>
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted">Received by</span>
        <input
          name="recipientName"
          type="text"
          required
          minLength={2}
          autoComplete="off"
          value={recipient}
          onChange={(event) => setRecipient(event.target.value)}
          placeholder="Name of the person signing for the delivery"
          className="min-h-12 rounded-[var(--radius-control)] border border-line bg-surface px-3 text-base text-ink"
        />
        <span className="text-xs text-muted">
          Required. Signature and photo capture ship in the next driver slice.
        </span>
      </label>
    </EventForm>
  );
}
