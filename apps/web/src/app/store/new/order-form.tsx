"use client";

import { useActionState, useState } from "react";
import type { components } from "@katapatha/contracts/types";
import { splitUnits } from "@katapatha/core/domain/orderSize";
import { placeOrder, type PlaceOrderState } from "./actions";

type OrderLimits = components["schemas"]["OrderLimits"];

const INITIAL_STATE: PlaceOrderState = {};

export function OrderForm({
  forDate,
  requestId,
  limits,
}: {
  forDate: string;
  requestId: string;
  limits: OrderLimits | null;
}) {
  const [state, formAction, pending] = useActionState(placeOrder, INITIAL_STATE);
  const [ambient, setAmbient] = useState(0);
  const [chilled, setChilled] = useState(0);
  const total = ambient + chilled;

  return (
    <form action={formAction} className="mt-6 grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
      <input name="requestId" type="hidden" value={requestId} />
      <input name="forDate" type="hidden" value={forDate} />

      <section aria-labelledby="quantity-heading" className="rounded-[var(--radius-card)] bg-surface p-5 sm:p-6">
        <div className="border-b border-line pb-5">
          <h2 id="quantity-heading" className="text-lg font-semibold">Order quantities</h2>
          <p className="mt-1 max-w-2xl text-sm text-muted">
            Add the units your outlet needs. Katapatha estimates weight and volume from previous orders.
          </p>
        </div>

        <div className="divide-y divide-line">
          <QuantityField
            description="Shelf-stable goods transported at normal temperature."
            id="ambient"
            label="Ambient goods"
            value={ambient}
            onChange={setAmbient}
          />
          <QuantityField
            description="Cold-chain goods that require a refrigerated vehicle."
            id="chilled"
            label="Chilled goods"
            value={chilled}
            onChange={setChilled}
          />
        </div>

        {limits ? (
          <>
            <SizeNotice label="Ambient" units={ambient} limit={limits.ambient} />
            <SizeNotice label="Chilled" units={chilled} limit={limits.chilled} />
          </>
        ) : null}

        {state.error ? (
          <div role="alert" className="mt-4 rounded-lg bg-red-50 p-4 text-sm text-critical">
            <p className="font-semibold">Order not placed</p>
            <p className="mt-1">{state.error}</p>
          </div>
        ) : null}
      </section>

      <aside className="rounded-[var(--radius-card)] bg-rail p-5 text-white lg:sticky lg:top-6">
        <h2 className="text-lg font-semibold">Order summary</h2>
        <dl className="mt-5 space-y-4 text-sm">
          <div className="flex items-start justify-between gap-4">
            <dt className="text-white/70">Delivery date</dt>
            <dd className="text-right font-semibold">{displayDate(forDate)}</dd>
          </div>
          <div className="flex items-center justify-between gap-4">
            <dt className="text-white/70">Ambient</dt>
            <dd className="tabular font-semibold">{ambient} units</dd>
          </div>
          <div className="flex items-center justify-between gap-4">
            <dt className="text-white/70">Chilled</dt>
            <dd className="tabular font-semibold">{chilled} units</dd>
          </div>
          <div className="flex items-center justify-between gap-4 border-t border-white/20 pt-4">
            <dt className="font-semibold">Total</dt>
            <dd className="tabular text-xl font-semibold">{total} units</dd>
          </div>
        </dl>

        <button
          type="submit"
          disabled={pending || total === 0}
          className="mt-6 min-h-12 w-full rounded-[var(--radius-control)] bg-action px-4 font-semibold text-ink transition-[filter] hover:brightness-95 disabled:cursor-not-allowed disabled:bg-white/20 disabled:text-white/60 disabled:brightness-100"
        >
          {pending ? "Placing order…" : "Place order"}
        </button>
        {total === 0 ? (
          <p className="mt-2 text-sm text-white/70">Add at least one unit to continue.</p>
        ) : (
          <p className="mt-2 text-sm text-white/70">Your outlet details are added securely from your account.</p>
        )}
      </aside>
    </form>
  );
}

/**
 * Rule 5 preview: an order travels whole on one vehicle. When the quantity is
 * bigger than any vehicle that can reach this outlet carries, say so and show
 * how it will be placed — the server action splits it the same way.
 */
function SizeNotice({
  label,
  units,
  limit,
}: {
  label: string;
  units: number;
  limit: OrderLimits["ambient"];
}) {
  if (units <= 0 || units <= limit.maxUnitsPerOrder) return null;
  const volume = (units * limit.m3PerUnit).toFixed(1);
  if (limit.maxUnitsPerOrder <= 0) {
    return (
      <div role="status" className="mt-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-critical">
        <p className="font-semibold">{label} goods can&apos;t be delivered to this outlet</p>
        <p className="mt-1">No vehicle at your depot can carry them here. Contact your dispatcher.</p>
      </div>
    );
  }
  const parts = splitUnits(units, limit.maxUnitsPerOrder);
  return (
    <div role="status" className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
      <p className="font-semibold">
        {label}: about {volume} m³ is more than one vehicle can carry
      </p>
      <p className="mt-1">
        An order travels whole on one vehicle, and the largest that can reach you takes {limit.maxUnitsPerOrder} units. It will be placed as{" "}
        <span className="font-semibold">
          {parts.length} orders of {parts.join(" + ")} units
        </span>
        .
      </p>
    </div>
  );
}

function QuantityField({
  id,
  label,
  description,
  value,
  onChange,
}: {
  id: string;
  label: string;
  description: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <div className="grid gap-4 py-5 sm:grid-cols-[minmax(0,1fr)_140px] sm:items-center">
      <label htmlFor={id}>
        <span className="font-semibold">{label}</span>
        <span className="mt-1 block text-sm text-muted">{description}</span>
      </label>
      <div>
        <span className="sr-only" id={`${id}-units`}>Quantity in units</span>
        <input
          id={id}
          name={id}
          type="number"
          inputMode="numeric"
          min="0"
          max="10000"
          step="1"
          value={value}
          aria-describedby={`${id}-units`}
          onChange={(event) => onChange(Math.max(0, Number(event.target.value) || 0))}
          className="tabular min-h-12 w-full rounded-[var(--radius-control)] border border-line bg-surface px-3 text-right text-base font-semibold outline-none focus:border-link focus:ring-2 focus:ring-blue-100"
        />
      </div>
    </div>
  );
}

function displayDate(date: string): string {
  return new Intl.DateTimeFormat("en-LK", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${date}T00:00:00Z`));
}
