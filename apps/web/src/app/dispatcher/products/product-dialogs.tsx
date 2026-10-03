"use client";

import { useRouter } from "next/navigation";
import { useActionState, useId, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Consequences, Modal } from "@/components/ui/modal";
import { ErrorPanel } from "@/components/ui/states";
import { setProductActive, saveProduct, type ActiveState, type SaveProductState } from "./actions";
import { BRANDS, EMPTY_PRODUCT_FORM, type ProductField, type ProductFormValues } from "./product-form";
import type { Product } from "./product-view";

const INPUT = "min-h-11 w-full rounded-control border bg-surface px-3 text-sm font-normal text-ink";

function Field({
  label,
  error,
  hint,
  htmlFor,
  children,
}: {
  label: string;
  error?: string;
  hint?: string;
  htmlFor: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-sm font-semibold text-ink">
        {label}
      </label>
      {children}
      {hint && !error ? (
        <p id={`${htmlFor}-hint`} className="text-xs text-muted">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${htmlFor}-error`} role="alert" className="text-xs font-semibold text-bad-ink">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function valuesOf(product: Product | null): ProductFormValues {
  if (!product) return EMPTY_PRODUCT_FORM;
  return {
    sku: product.sku,
    name: product.name,
    brand: product.brand ?? "",
    tempRequirement: product.tempRequirement,
    unitLabel: product.unitLabel,
    kgPerUnit: String(product.kgPerUnit),
    m3PerUnit: String(product.m3PerUnit),
    sortOrder: String(product.sortOrder),
  };
}

/**
 * Add a product, or edit one. Opened by a link (`?add=1`, `?edit=<id>`), so
 * the dialog is part of the URL and the page behind it stays a server
 * component; closing it is navigating back to the list with its filters.
 * The fields are controlled so a refused save (taken SKU, a number out of
 * range) leaves what was typed in place.
 */
export function ProductDialog({ product, returnTo }: { product: Product | null; returnTo: string }) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState<SaveProductState, FormData>(saveProduct, {});
  const [values, setValues] = useState<ProductFormValues>(() => valuesOf(product));
  const idPrefix = useId();
  const editing = product !== null;
  const errors = state.fieldErrors ?? {};

  const id = (field: ProductField) => `${idPrefix}-${field}`;
  const set = (field: ProductField) => (event: { target: { value: string } }) =>
    setValues((current) => ({ ...current, [field]: event.target.value }));
  const aria = (field: ProductField, hint?: boolean) => ({
    id: id(field),
    name: field,
    "aria-invalid": errors[field] ? true : undefined,
    "aria-describedby": errors[field] ? `${id(field)}-error` : hint ? `${id(field)}-hint` : undefined,
  });
  const border = (field: ProductField) => (errors[field] ? "border-bad" : "border-line");
  const close = () => router.push(returnTo);

  return (
    <Modal
      open
      onClose={close}
      eyebrow="Catalogue"
      title={editing ? `Edit ${product.name}` : "Add a product"}
      context={editing ? product.sku : "Stores can order it as soon as it is saved."}
      wide
    >
      <form action={formAction} className="flex flex-col gap-4">
        <input type="hidden" name="returnTo" value={returnTo} />
        {editing ? <input type="hidden" name="productId" value={product.id} /> : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="SKU"
            htmlFor={id("sku")}
            error={errors.sku}
            hint={editing ? "A SKU can't be changed once created: orders and people refer to it." : "Letters, digits, dashes. Upper-case, for example FA010."}
          >
            <input
              {...aria("sku", true)}
              value={values.sku}
              readOnly={editing}
              onChange={(event) => setValues((current) => ({ ...current, sku: event.target.value.toUpperCase().replace(/\s/g, "") }))}
              maxLength={32}
              autoComplete="off"
              spellCheck={false}
              className={`${INPUT} ${border("sku")} font-mono uppercase ${editing ? "bg-raised text-muted" : ""}`}
            />
          </Field>
          <Field label="Name" htmlFor={id("name")} error={errors.name}>
            <input {...aria("name")} value={values.name} onChange={set("name")} maxLength={120} autoComplete="off" className={`${INPUT} ${border("name")}`} />
          </Field>
          <Field label="Brand" htmlFor={id("brand")} error={errors.brand} hint="Stores see the products for their own brand and for All brands.">
            <select {...aria("brand", true)} value={values.brand} onChange={set("brand")} className={`${INPUT} ${border("brand")}`}>
              <option value="">All brands</option>
              {BRANDS.map((brand) => (
                <option key={brand} value={brand}>
                  {brand}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Temperature" htmlFor={id("tempRequirement")} error={errors.tempRequirement} hint="Chilled goods travel on a refrigerated vehicle.">
            <select {...aria("tempRequirement", true)} value={values.tempRequirement} onChange={set("tempRequirement")} className={`${INPUT} ${border("tempRequirement")}`}>
              <option value="ambient">Ambient</option>
              <option value="chilled">Chilled</option>
            </select>
          </Field>
          <Field label="Unit label" htmlFor={id("unitLabel")} error={errors.unitLabel} hint="What one unit is called: bag, carton, crate.">
            <input {...aria("unitLabel", true)} value={values.unitLabel} onChange={set("unitLabel")} maxLength={24} autoComplete="off" className={`${INPUT} ${border("unitLabel")}`} />
          </Field>
          <Field label="Sort order (optional)" htmlFor={id("sortOrder")} error={errors.sortOrder} hint="Lower numbers come first in the store's list. Empty puts it last.">
            <input {...aria("sortOrder", true)} value={values.sortOrder} onChange={set("sortOrder")} inputMode="numeric" className={`${INPUT} ${border("sortOrder")}`} />
          </Field>
          <Field label="Weight per unit (kg)" htmlFor={id("kgPerUnit")} error={errors.kgPerUnit} hint="The real weight of one unit, packaging included.">
            <input {...aria("kgPerUnit", true)} value={values.kgPerUnit} onChange={set("kgPerUnit")} inputMode="decimal" autoComplete="off" className={`${INPUT} ${border("kgPerUnit")} tabular`} />
          </Field>
          <Field label="Volume per unit (m³)" htmlFor={id("m3PerUnit")} error={errors.m3PerUnit} hint="The space one unit takes on a vehicle, for example 0.007.">
            <input {...aria("m3PerUnit", true)} value={values.m3PerUnit} onChange={set("m3PerUnit")} inputMode="decimal" autoComplete="off" className={`${INPUT} ${border("m3PerUnit")} tabular`} />
          </Field>
        </div>

        {editing ? (
          <p className="rounded-control bg-info-surface p-3 text-sm text-info-ink">
            Changes apply to orders placed from now on. Orders already placed keep the name and size they were placed with.
          </p>
        ) : null}

        {state.failure ? <ErrorPanel title={state.failure.title} detail={state.failure.detail} outcome={state.failure.outcome} /> : null}

        <div className="-mx-5 -mb-4 flex flex-wrap items-center justify-end gap-2 border-t border-line bg-raised px-5 py-4">
          <Button type="button" variant="secondary" onClick={close}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={pending}>
            {pending ? "Saving…" : editing ? "Save changes" : "Add product"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/** Deactivate, with what it does to stores and to existing orders spelled out first. */
export function DeactivateDialog({ product, returnTo }: { product: Product; returnTo: string }) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState<ActiveState, FormData>(setProductActive, {});
  const close = () => router.push(returnTo);

  return (
    <Modal open onClose={close} eyebrow="Catalogue" title={`Deactivate ${product.name}`} context={product.sku}>
      <form action={formAction} className="flex flex-col gap-5">
        <input type="hidden" name="productId" value={product.id} />
        <input type="hidden" name="active" value="false" />
        <input type="hidden" name="returnTo" value={returnTo} />
        <Consequences
          items={[
            { who: "Stores", detail: "Stores will no longer see it when ordering." },
            { who: "Existing orders", detail: "Orders already placed keep it, with the name and size they were placed with." },
            { who: "Later", detail: "You can reactivate it at any time. Nothing is deleted." },
          ]}
        />
        {state.failure ? <ErrorPanel title={state.failure.title} detail={state.failure.detail} outcome={state.failure.outcome} /> : null}
        <div className="-mx-5 -mb-4 flex flex-wrap items-center justify-end gap-2 border-t border-line bg-raised px-5 py-4">
          <Button type="button" variant="secondary" onClick={close}>
            Cancel
          </Button>
          <Button type="submit" variant="critical" disabled={pending}>
            {pending ? "Saving…" : "Deactivate"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/** One tap: there is nothing to warn about when a product becomes orderable again. */
export function ReactivateButton({ product, returnTo }: { product: Product; returnTo: string }) {
  const [state, formAction, pending] = useActionState<ActiveState, FormData>(setProductActive, {});
  return (
    <form action={formAction} className="flex flex-col items-start gap-1">
      <input type="hidden" name="productId" value={product.id} />
      <input type="hidden" name="active" value="true" />
      <input type="hidden" name="returnTo" value={returnTo} />
      <Button type="submit" variant="secondary" disabled={pending} aria-label={`Reactivate ${product.name}`}>
        {pending ? "Saving…" : "Reactivate"}
      </Button>
      {state.failure ? (
        <p role="alert" className="max-w-48 text-xs font-semibold text-bad-ink">
          {state.failure.title}. {state.failure.detail}
        </p>
      ) : null}
    </form>
  );
}
