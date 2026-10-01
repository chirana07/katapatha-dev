"use client";

import { useState } from "react";
import { generateUlid } from "../../format";
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
  const [units, setUnits] = useState<Record<string, string>>(() =>
    Object.fromEntries(orders.map((order) => [order.orderId, String(order.expectedUnits)])),
  );
  const [eventIds] = useState<Record<string, string>>(() =>
    Object.fromEntries(orders.map((order) => [order.orderId, generateUlid()])),
  );
  const [podEventId] = useState(() => generateUlid());
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
      <input type="hidden" name="podEventId" value={podEventId} />
      <fieldset className="flex flex-col gap-3">
        <legend className="text-xs font-semibold uppercase tracking-wide text-muted">Units handed over</legend>
        {orders.map((order) => (
          <label key={order.orderId} className="flex flex-col gap-1 rounded-[var(--radius-control)] border border-line p-3">
            <input type="hidden" name="orderId" value={order.orderId} />
            <input type="hidden" name={`expectedUnits:${order.orderId}`} value={order.expectedUnits} />
            <input type="hidden" name={`eventId:${order.orderId}`} value={eventIds[order.orderId]} />
            <span className="flex items-center justify-between gap-3 text-sm">
              <span className="font-semibold text-ink">{order.orderRef}</span>
              <span className="tabular text-muted">Expected {order.expectedUnits}</span>
            </span>
            <input
              name={`deliveredUnits:${order.orderId}`}
              type="number"
              inputMode="numeric"
              min={0}
              max={order.expectedUnits}
              step={1}
              required
              value={units[order.orderId] ?? ""}
              onChange={(event) =>
                setUnits((current) => ({ ...current, [order.orderId]: event.target.value }))
              }
              className="tabular min-h-12 rounded-[var(--radius-control)] border border-line bg-surface px-3 text-lg text-ink"
              aria-label={`Delivered units for ${order.orderRef}`}
            />
            <span className="text-xs text-muted">A lower number records this order as a part delivery.</span>
          </label>
        ))}
      </fieldset>
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
          Required. This name is stored with the proof-of-delivery record for every order at this stop.
        </span>
      </label>
    </EventForm>
  );
}
