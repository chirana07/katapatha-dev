"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import type { components } from "@katapatha/contracts/types";
import { Button } from "@/components/ui/button";
import { Advisory, ErrorPanel } from "@/components/ui/states";
import { Stepper } from "@/components/ui/stepper";
import { longDate } from "@/lib/dates";
import { plural } from "@/lib/format";
import { placeOrder, type PlaceOrderState } from "./actions";
import { planOrder, splitSummary, type PlanLine } from "./order-plan";

type OrderLimits = components["schemas"]["OrderLimits"];

const INITIAL: PlaceOrderState = {};
const MAX_UNITS = 10_000;
const STEPS = ["Choose quantities", "Review order", "Confirmed"];

const ROWS = [
  { id: "ambient", label: "Ambient goods", hint: "Shelf-stable goods, carried at normal temperature." },
  { id: "chilled", label: "Chilled goods", hint: "Cold-chain goods, carried on a refrigerated vehicle." },
] as const;

/**
 * Steps one and two of placing an order, as one client form: quantities, then
 * review. The third step is its own page (`/store/new/confirmed`), reached by
 * redirect after the API accepts the order, so reloading it can never place a
 * second one. Edit-and-resubmit under the same `requestId` is also safe — the
 * API treats it as the same request.
 */
export function OrderWizard({
  forDate,
  requestId,
  limits,
  window,
  accessNote,
}: {
  forDate: string;
  requestId: string;
  limits: OrderLimits | null;
  window: { open: string; close: string } | null;
  accessNote: string | null;
}) {
  const [state, formAction, pending] = useActionState(placeOrder, INITIAL);
  const [step, setStep] = useState<0 | 1>(0);
  const [quantities, setQuantities] = useState({ ambient: 0, chilled: 0 });
  const plan = planOrder(quantities, limits);
  const canReview = plan.totalUnits > 0 && !plan.blocked;

  const set = (id: "ambient" | "chilled", value: number) =>
    setQuantities((current) => ({ ...current, [id]: Math.min(MAX_UNITS, Math.max(0, Math.trunc(value) || 0)) }));

  return (
    <form action={formAction} className="flex flex-col gap-5">
      <input type="hidden" name="requestId" value={requestId} />
      <input type="hidden" name="forDate" value={forDate} />
      {step === 1 ? (
        <>
          <input type="hidden" name="ambient" value={quantities.ambient} />
          <input type="hidden" name="chilled" value={quantities.chilled} />
        </>
      ) : null}

      <div className="max-w-2xl">
        <Stepper steps={STEPS} current={step} />
      </div>

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        {step === 0 ? (
          <section aria-labelledby="quantities-heading" className="rounded-card border border-line bg-surface p-4 sm:p-5">
            <h2 id="quantities-heading" className="text-lg font-bold text-ink">How many units do you need?</h2>
            <p className="mt-1 text-sm text-muted">
              Katapatha plans by units. Weight and volume are estimated from your outlet&apos;s earlier orders.
            </p>
            <div className="mt-2 divide-y divide-line">
              {ROWS.map((row) => (
                <div key={row.id} className="grid gap-3 py-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                  <label htmlFor={`qty-${row.id}`}>
                    <span className="font-semibold text-ink">{row.label}</span>
                    <span className="mt-0.5 block text-sm text-muted">{row.hint}</span>
                  </label>
                  <div className="flex items-center gap-1">
                    <Button type="button" aria-label={`One fewer ${row.id} unit`} onClick={() => set(row.id, quantities[row.id] - 1)} disabled={quantities[row.id] <= 0}>−</Button>
                    <input
                      id={`qty-${row.id}`}
                      type="number"
                      inputMode="numeric"
                      min={0}
                      max={MAX_UNITS}
                      step={1}
                      value={quantities[row.id]}
                      onChange={(event) => set(row.id, Number(event.target.value))}
                      className="tabular min-h-11 w-24 rounded-control border border-line bg-surface px-2 text-center text-base font-bold text-ink focus:border-link focus:outline-2 focus:outline-link"
                    />
                    <Button type="button" aria-label={`One more ${row.id} unit`} onClick={() => set(row.id, quantities[row.id] + 1)}>+</Button>
                  </div>
                </div>
              ))}
            </div>
            <div className="flex flex-col gap-3">
              {plan.lines.map((line) => (
                <SizeNotice key={line.temp} line={line} />
              ))}
            </div>
          </section>
        ) : (
          <section aria-labelledby="review-heading" className="rounded-card border border-line bg-surface p-4 sm:p-5">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <div>
                <h2 id="review-heading" className="text-lg font-bold text-ink">Check your order</h2>
                <p className="mt-0.5 text-sm text-muted">
                  {plural(plan.lines.length, "line")} · {plural(plan.totalUnits, "unit")}
                  {plan.weightKg != null ? ` · about ${Math.round(plan.weightKg)} kg` : ""}
                </p>
              </div>
              <Button type="button" variant="ghost" onClick={() => setStep(0)} disabled={pending}>Edit quantities</Button>
            </div>
            <div className="mt-3 overflow-hidden rounded-control border border-line">
              <table className="w-full text-sm">
                <caption className="sr-only">Order lines</caption>
                <thead className="bg-raised text-left text-xs font-semibold uppercase tracking-wide text-muted">
                  <tr>
                    <th scope="col" className="px-3 py-2">Goods</th>
                    <th scope="col" className="px-3 py-2 text-right">Units</th>
                  </tr>
                </thead>
                <tbody>
                  {plan.lines.map((line) => (
                    <tr key={line.temp} className="border-t border-line align-top">
                      <td className="px-3 py-2.5">
                        <span className="font-semibold text-ink">{line.temp === "chilled" ? "Chilled goods" : "Ambient goods"}</span>
                        {splitSummary(line) ? <span className="mt-0.5 block text-xs text-muted">Placed as {splitSummary(line)}</span> : null}
                      </td>
                      <td className="tabular px-3 py-2.5 text-right font-bold text-ink">{line.units}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {state.error ? (
              <div className="mt-4">
                <ErrorPanel title={state.error.title} detail={state.error.detail} outcome={state.error.outcome} />
              </div>
            ) : null}
          </section>
        )}

        <aside className="flex flex-col gap-4">
          <section aria-labelledby="summary-heading" className="rounded-card border border-line bg-surface p-4 sm:p-5">
            <h2 id="summary-heading" className="text-lg font-bold text-ink">Order summary</h2>
            <dl className="mt-3 flex flex-col gap-2 text-sm">
              {ROWS.map((row) => (
                <div key={row.id} className="flex justify-between gap-3">
                  <dt className="text-muted">{row.id === "chilled" ? "Chilled" : "Ambient"}</dt>
                  <dd className="tabular font-semibold text-ink">{plural(quantities[row.id], "unit")}</dd>
                </div>
              ))}
              <div className="flex justify-between gap-3 border-t border-line pt-2">
                <dt className="font-semibold text-ink">Total</dt>
                <dd className="tabular font-bold text-ink">{plural(plan.totalUnits, "unit")}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted">Estimated volume</dt>
                <dd className="tabular font-semibold text-ink">{plan.volumeM3 == null ? "—" : `${plan.volumeM3.toFixed(2)} m³`}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted">Estimated weight</dt>
                <dd className="tabular font-semibold text-ink">{plan.weightKg == null ? "—" : `${Math.round(plan.weightKg)} kg`}</dd>
              </div>
            </dl>
            <p className="mt-3 rounded-control bg-info-surface p-3 text-sm text-info-ink">
              Ambient and chilled quantities are each placed as their own order.
            </p>
          </section>

          <section aria-labelledby="schedule-heading" className="rounded-card border border-line bg-surface p-4 sm:p-5">
            <h2 id="schedule-heading" className="text-sm font-semibold uppercase tracking-wide text-muted">Delivers</h2>
            <p className="mt-1 text-xl font-bold text-ink">{longDate(forDate)}</p>
            <p className="tabular mt-0.5 text-sm text-muted">
              {window ? `${window.open}–${window.close} receiving window` : "Receiving window set when the run is planned"}
              {accessNote ? ` · ${accessNote}` : ""}
            </p>
            <p className="mt-2 text-xs text-muted">The earliest day the depot operates. The exact time is set when dispatch plans the run.</p>
          </section>

          {step === 0 ? (
            <div className="flex flex-wrap gap-2">
              <Button type="button" onClick={() => setQuantities({ ambient: 0, chilled: 0 })} disabled={plan.totalUnits === 0}>Clear all</Button>
              <Button type="button" variant="primary" className="flex-1" disabled={!canReview} onClick={() => setStep(1)}>
                Review order →
              </Button>
              {!canReview ? (
                <p role="status" className="w-full text-xs text-muted">
                  {plan.blocked ? "Remove the goods no vehicle can carry here to continue." : "Add at least one unit to continue."}
                </p>
              ) : null}
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              <Button type="button" onClick={() => setStep(0)} disabled={pending}>Back</Button>
              <Button type="submit" variant="primary" className="flex-1" disabled={pending}>
                {pending ? "Placing order…" : "Submit order"}
              </Button>
            </div>
          )}
          {state.error?.outcome === "unknown" ? (
            <Advisory>
              Check <Link href="/store/orders" className="font-semibold underline">My orders</Link> before submitting again — the order may already be there.
            </Advisory>
          ) : null}
        </aside>
      </div>
    </form>
  );
}

/**
 * Rule 5 preview: an order travels whole on one vehicle. When the quantity is
 * bigger than any vehicle that can reach this outlet carries, say how it will
 * be placed — the server action splits it the same way.
 */
function SizeNotice({ line }: { line: PlanLine }) {
  const label = line.temp === "chilled" ? "Chilled" : "Ambient";
  if (line.blocked) {
    return (
      <div role="status" className="rounded-control border border-bad/25 bg-bad-surface p-3 text-sm text-bad-ink">
        <p className="font-semibold">{label} goods can&apos;t be delivered to this outlet</p>
        <p className="mt-0.5 text-ink">No vehicle at your depot can carry them here. Contact your dispatcher.</p>
      </div>
    );
  }
  const summary = splitSummary(line);
  if (!summary) return null;
  return (
    <div role="status" className="rounded-control border border-warn/30 bg-warn-surface p-3 text-sm text-ink">
      <p className="font-semibold">{label}: more than one vehicle can carry</p>
      <p className="mt-0.5">
        An order travels whole on one vehicle, so it will be placed as <span className="font-semibold">{summary}</span>.
      </p>
    </div>
  );
}
