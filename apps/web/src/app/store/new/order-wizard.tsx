"use client";

import Link from "next/link";
import { useActionState, useMemo, useState, useSyncExternalStore } from "react";
import type { components } from "@katapatha/contracts/types";
import { Button } from "@/components/ui/button";
import { Advisory, ErrorPanel } from "@/components/ui/states";
import { Stepper } from "@/components/ui/stepper";
import { TempCue } from "@/components/ui/temp-cue";
import { longDate } from "@/lib/dates";
import { plural } from "@/lib/format";
import { quantityLabel } from "@/lib/order-items";
import { formatKg, formatM3, perUnitSize } from "@/lib/product-format";
import { placeOrder, type PlaceOrderState } from "./actions";
import {
  MAX_QUANTITY,
  basketItems,
  clampQuantity,
  countByTemp,
  filterProducts,
  parseSavedBasket,
  reconcileBasket,
  withQuantity,
  type Basket,
  type Product,
  type Temp,
  type TempChoice,
} from "./basket";
import { readSaved, subscribeSaved, writeSaved } from "./basket-storage";
import { tempLabel } from "@/lib/temperature";
import { planBasket, type PlanGroup } from "./order-plan";

type OrderLimits = components["schemas"]["OrderLimits"];

const INITIAL: PlaceOrderState = {};
const STEPS = ["Choose products", "Review order", "Confirmed"];

const TEMPS: { id: Temp; label: string; hint: string }[] = [
  { id: "ambient", label: "Ambient", hint: "Shelf-stable goods, carried at normal temperature." },
  { id: "chilled", label: "Chilled", hint: "Cold-chain goods, carried on a refrigerated vehicle." },
  { id: "frozen", label: "Frozen", hint: "Deep-frozen goods, carried on a refrigerated vehicle." },
];

/**
 * Steps one and two of placing an order, as one client form: products, then
 * review. The third step is its own page (`/store/new/confirmed`), reached by
 * redirect after the API accepts the order, so reloading it can never place a
 * second one. Edit-and-resubmit under the same `requestId` is also safe — the
 * API treats it as the same request.
 *
 * The basket lives in state and is mirrored to `sessionStorage` on every
 * change, so a reload keeps what was chosen (the step restarts at the picker).
 * The storage is read through `useSyncExternalStore`, which renders the empty
 * basket on the server and the saved one right after hydration without a
 * mismatch; until the manager changes something the saved basket IS the
 * basket, and after that the in-memory one takes over.
 */
export function OrderWizard({
  products,
  forDate,
  requestId,
  limits,
  window,
  accessNote,
}: {
  products: Product[];
  forDate: string;
  requestId: string;
  limits: OrderLimits | null;
  window: { open: string; close: string } | null;
  accessNote: string | null;
}) {
  const [state, formAction, pending] = useActionState(placeOrder, INITIAL);
  const [step, setStep] = useState<0 | 1>(0);
  const [temp, setTemp] = useState<TempChoice>("all");
  const [query, setQuery] = useState("");
  const [chosen, setChosen] = useState<Basket | null>(null);

  const saved = useSyncExternalStore(subscribeSaved, readSaved, () => null);
  const restored = useMemo(() => reconcileBasket(parseSavedBasket(saved), products), [saved, products]);
  const basket = chosen ?? restored.basket;
  const dropped = chosen ? 0 : restored.dropped;

  const plan = useMemo(() => planBasket(products, basket, limits), [products, basket, limits]);
  const canReview = plan.totalUnits > 0 && !plan.blocked;
  const items = useMemo(() => basketItems(basket, products), [basket, products]);

  const update = (next: Basket) => {
    setChosen(next);
    writeSaved(next);
  };
  const setQuantity = (productId: string, quantity: number) => update(withQuantity(basket, productId, quantity));

  return (
    <form action={formAction} className="flex flex-col gap-5">
      <input type="hidden" name="requestId" value={requestId} />
      <input type="hidden" name="forDate" value={forDate} />
      <input type="hidden" name="items" value={JSON.stringify(items)} />

      <div className="max-w-2xl">
        <Stepper steps={STEPS} current={step} />
      </div>

      {dropped > 0 && step === 0 ? (
        <Advisory>
          {plural(dropped, "product")} you chose earlier {dropped === 1 ? "is" : "are"} no longer offered and {dropped === 1 ? "was" : "were"} taken off.
        </Advisory>
      ) : null}

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        {step === 0 ? (
          <ProductPicker
            products={products}
            basket={basket}
            temp={temp}
            query={query}
            onTemp={setTemp}
            onQuery={setQuery}
            onQuantity={setQuantity}
            plan={plan.groups}
          />
        ) : (
          <section aria-labelledby="review-heading" className="rounded-card border border-line bg-surface p-4 sm:p-5">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <div>
                <h2 id="review-heading" className="text-lg font-bold text-ink">Check your order</h2>
                <p className="mt-0.5 text-sm text-muted">
                  {plural(plan.groups.length, "order")} · {plural(plan.lines.length, "product")} · {plural(plan.totalUnits, "unit")}
                </p>
              </div>
              <Button type="button" variant="ghost" onClick={() => setStep(0)} disabled={pending}>Edit products</Button>
            </div>
            <div className="mt-4 flex flex-col gap-4">
              {plan.groups.map((group) => (
                <ReviewSection key={group.temp} group={group} />
              ))}
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
              {TEMPS.map((row) => {
                const group = plan.groups.find((g) => g.temp === row.id);
                return (
                  <div key={row.id} className="flex items-baseline justify-between gap-3">
                    <dt className="text-muted">
                      {row.label}
                      <span className="block text-xs">{plural(group?.lines.length ?? 0, "product")}</span>
                    </dt>
                    <dd className="tabular font-semibold text-ink">{plural(group?.units ?? 0, "unit")}</dd>
                  </div>
                );
              })}
              <div className="flex justify-between gap-3 border-t border-line pt-2">
                <dt className="font-semibold text-ink">Total</dt>
                <dd className="tabular font-bold text-ink">{plural(plan.totalUnits, "unit")}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted">Weight</dt>
                <dd className="tabular font-semibold text-ink">{plan.totalUnits === 0 ? "—" : formatKg(plan.weightKg)}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted">Volume</dt>
                <dd className="tabular font-semibold text-ink">{plan.totalUnits === 0 ? "—" : formatM3(plan.volumeM3)}</dd>
              </div>
            </dl>
            <p className="mt-2 text-xs text-muted">Weight and volume add up each product&apos;s size from the catalogue.</p>

            {step === 0 && plan.lines.length > 0 ? (
              <div className="mt-4 border-t border-line pt-3">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">You chose</h3>
                <ul className="mt-2 flex flex-col gap-1.5 text-sm">
                  {plan.lines.map((line) => (
                    <li key={line.product.id} className="flex items-baseline justify-between gap-3">
                      <span className="min-w-0 text-ink">{line.product.name}</span>
                      <span className="tabular shrink-0 font-semibold text-ink">{quantityLabel(line.quantity, line.product.unitLabel)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            <p className="mt-3 rounded-control bg-info-surface p-3 text-sm text-info-ink">
              Ambient, chilled and frozen goods are each placed as their own order.
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
              <Button type="button" onClick={() => update({})} disabled={plan.totalUnits === 0}>Clear all</Button>
              {/* A wrapper, because Button's own inline-flex would beat `hidden`. */}
              <div className="hidden flex-1 lg:flex">
                <Button type="button" variant="primary" className="flex-1" disabled={!canReview} onClick={() => setStep(1)}>
                  Review order →
                </Button>
              </div>
              {!canReview ? (
                <p role="status" className="hidden w-full text-xs text-muted lg:block">
                  {plan.blocked ? "Take off the goods no vehicle can carry here to continue." : "Choose at least one product to continue."}
                </p>
              ) : null}
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              <Button type="button" onClick={() => setStep(0)} disabled={pending}>Back</Button>
              <Button type="submit" variant="primary" className="flex-1" disabled={pending}>
                {pending ? "Placing order…" : "Place order"}
              </Button>
            </div>
          )}
          {state.error?.outcome === "unknown" ? (
            <Advisory>
              Check <Link href="/store/orders" className="font-semibold underline">My orders</Link> before placing it again — the order may already be there.
            </Advisory>
          ) : null}
        </aside>
      </div>

      {step === 0 ? (
        // The summary and its button sit below a long list on a phone, so the
        // way forward stays in reach here instead. From lg up the aside has it.
        <div className="sticky bottom-0 z-10 -mx-4 flex items-center justify-between gap-3 border-t border-line bg-surface px-4 py-3 sm:-mx-6 sm:px-6 lg:hidden">
          <p role="status" className="min-w-0 text-sm">
            {plan.totalUnits === 0 ? (
              <span className="text-muted">{plan.blocked ? "Take off goods no vehicle can carry here." : "Choose at least one product."}</span>
            ) : (
              <>
                <span className="tabular block font-bold text-ink">{plural(plan.totalUnits, "unit")}</span>
                <span className="block text-xs text-muted">{plural(plan.lines.length, "product")}{plan.blocked ? " · some can't be delivered here" : ""}</span>
              </>
            )}
          </p>
          <Button type="button" variant="primary" disabled={!canReview} onClick={() => setStep(1)} className="shrink-0">
            Review order →
          </Button>
        </div>
      ) : null}
    </form>
  );
}

function ProductPicker({
  products,
  basket,
  temp,
  query,
  onTemp,
  onQuery,
  onQuantity,
  plan,
}: {
  products: Product[];
  basket: Basket;
  temp: TempChoice;
  query: string;
  onTemp: (temp: TempChoice) => void;
  onQuery: (query: string) => void;
  onQuantity: (productId: string, quantity: number) => void;
  plan: PlanGroup[];
}) {
  const counts = countByTemp(products, query);
  const shown = filterProducts(products, { temp, query });
  const blocked = new Set(plan.filter((group) => group.blocked).map((group) => group.temp));

  return (
    <section aria-labelledby="products-heading" className="rounded-card border border-line bg-surface p-4 sm:p-5">
      <h2 id="products-heading" className="text-lg font-bold text-ink">What do you need?</h2>
      <p className="mt-1 text-sm text-muted">
        Choose products and how many of each. Ambient, chilled and frozen goods travel separately, so they are placed as separate orders.
      </p>

      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <label className="min-w-0 flex-1">
          <span className="sr-only">Search products by name or SKU</span>
          <input
            type="search"
            value={query}
            onChange={(event) => onQuery(event.target.value)}
            // The picker sits inside the order form: Enter must not submit it.
            onKeyDown={(event) => {
              if (event.key === "Enter") event.preventDefault();
            }}
            placeholder="Search by name or SKU"
            autoComplete="off"
            maxLength={80}
            className="min-h-11 w-full rounded-control border border-line bg-surface px-3 text-sm text-ink"
          />
        </label>
        <div role="group" aria-label="Show products by temperature" className="flex gap-1.5">
          {(
            [
              { id: "all", label: "All" },
              { id: "ambient", label: "Ambient" },
              { id: "chilled", label: "Chilled" },
              { id: "frozen", label: "Frozen" },
            ] as const
          ).map((chip) => (
            <button
              key={chip.id}
              type="button"
              aria-pressed={temp === chip.id}
              onClick={() => onTemp(chip.id)}
              className={`inline-flex min-h-11 items-center gap-1.5 rounded-control border px-3 text-sm font-semibold ${
                temp === chip.id ? "border-navy bg-navy text-white" : "border-line bg-surface text-ink hover:bg-raised"
              }`}
            >
              {chip.label}
              <span className={`tabular rounded-full px-1.5 text-xs ${temp === chip.id ? "bg-white/20" : "bg-raised text-muted"}`}>{counts[chip.id]}</span>
            </button>
          ))}
        </div>
      </div>

      {shown.length === 0 ? (
        <div className="mt-4 rounded-card border border-dashed border-line p-6 text-center">
          <p className="font-semibold text-ink">No products match{query.trim() ? ` “${query.trim()}”` : ""}</p>
          <p className="mt-1 text-sm text-muted">Try another name or SKU, or show every temperature.</p>
          <div className="mt-3 flex justify-center gap-2">
            {query ? <Button type="button" onClick={() => onQuery("")}>Clear search</Button> : null}
            {temp !== "all" ? <Button type="button" onClick={() => onTemp("all")}>Show all</Button> : null}
          </div>
        </div>
      ) : (
        <div className="mt-2 flex flex-col">
          {TEMPS.map((group) => {
            const rows = shown.filter((product) => product.tempRequirement === group.id);
            if (rows.length === 0) return null;
            return (
              <section key={group.id} aria-labelledby={`group-${group.id}`} className="mt-4">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 border-b border-line pb-2">
                  <h3 id={`group-${group.id}`} className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-ink">
                    <TempCue temp={group.id} className="text-sm" />
                    <span className="tabular font-semibold text-muted">{rows.length}</span>
                  </h3>
                  <p className="text-xs text-muted">{group.hint}</p>
                </div>
                {blocked.has(group.id) ? (
                  <p role="status" className="mt-2 rounded-control border border-bad/25 bg-bad-surface p-3 text-sm text-bad-ink">
                    <span className="font-semibold">{group.label} goods can&apos;t be delivered to this outlet.</span>{" "}
                    <span className="text-ink">No vehicle at your depot can carry them here. Contact your dispatcher.</span>
                  </p>
                ) : null}
                <ul className="divide-y divide-line">
                  {rows.map((product) => (
                    <ProductRow key={product.id} product={product} quantity={basket[product.id] ?? 0} onQuantity={onQuantity} />
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      )}
    </section>
  );
}

function ProductRow({
  product,
  quantity,
  onQuantity,
}: {
  product: Product;
  quantity: number;
  onQuantity: (productId: string, quantity: number) => void;
}) {
  const inputId = `qty-${product.id}`;
  return (
    <li className={`grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 py-3 ${quantity > 0 ? "bg-warn-surface/40 -mx-2 px-2 rounded-control" : ""}`}>
      <label htmlFor={inputId} className="min-w-0">
        <span className="block font-semibold text-ink">{product.name}</span>
        <span className="mt-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-xs text-muted">
          <span className="font-mono">{product.sku}</span>
          <span>by the {product.unitLabel}</span>
          <TempCue temp={product.tempRequirement} />
          <span className="tabular">{perUnitSize(product)}</span>
        </span>
      </label>
      <div className="flex items-center gap-1">
        <Button
          type="button"
          aria-label={`One fewer ${product.unitLabel} of ${product.name}`}
          onClick={() => onQuantity(product.id, quantity - 1)}
          disabled={quantity <= 0}
          className="px-0 w-11"
        >
          −
        </Button>
        <input
          id={inputId}
          type="number"
          inputMode="numeric"
          min={0}
          max={MAX_QUANTITY}
          step={1}
          value={quantity === 0 ? "" : quantity}
          placeholder="0"
          onChange={(event) => onQuantity(product.id, clampQuantity(Number(event.target.value)))}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.preventDefault();
          }}
          className="tabular min-h-11 w-[4.5rem] rounded-control border border-line bg-surface px-1 text-center text-base font-bold text-ink focus:border-link focus:outline-2 focus:outline-link"
        />
        <Button
          type="button"
          aria-label={`One more ${product.unitLabel} of ${product.name}`}
          onClick={() => onQuantity(product.id, quantity + 1)}
          disabled={quantity >= MAX_QUANTITY}
          className="px-0 w-11"
        >
          +
        </Button>
      </div>
    </li>
  );
}

function ReviewSection({ group }: { group: PlanGroup }) {
  const label = tempLabel(group.temp);
  return (
    <section aria-labelledby={`review-${group.temp}`} className="overflow-hidden rounded-control border border-line">
      <div className="flex flex-wrap items-center justify-between gap-2 bg-raised px-3 py-2.5">
        <h3 id={`review-${group.temp}`} className="flex items-center gap-2 text-sm font-bold text-ink">
          <TempCue temp={group.temp} className="text-sm" /> <span className="sr-only">{label} order</span>
          <span className="text-muted font-normal">placed as its own order</span>
        </h3>
        <p className="tabular text-sm font-semibold text-ink">{plural(group.units, "unit")}</p>
      </div>
      <table className="w-full text-sm">
        <caption className="sr-only">{label} products</caption>
        <thead className="text-left text-xs font-semibold uppercase tracking-wide text-muted">
          <tr>
            <th scope="col" className="px-3 py-2">Product</th>
            <th scope="col" className="px-3 py-2 text-right">Quantity</th>
          </tr>
        </thead>
        <tbody>
          {group.lines.map((line) => (
            <tr key={line.product.id} className="border-t border-line align-top">
              <td className="px-3 py-2.5">
                <span className="font-semibold text-ink">{line.product.name}</span>
                <span className="mt-0.5 block font-mono text-xs text-muted">{line.product.sku}</span>
              </td>
              <td className="tabular px-3 py-2.5 text-right font-bold text-ink">{quantityLabel(line.quantity, line.product.unitLabel)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="tabular border-t border-line bg-raised px-3 py-2 text-xs text-muted">
        {plural(group.lines.length, "product")} · {plural(group.units, "unit")} · Weight {formatKg(group.weightKg)} · Volume {formatM3(group.volumeM3)}
      </p>
    </section>
  );
}
