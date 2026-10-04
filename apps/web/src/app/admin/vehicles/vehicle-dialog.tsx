"use client";

import { useRouter } from "next/navigation";
import { useActionState, useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { ErrorPanel } from "@/components/ui/states";
import { Field, INPUT } from "../form-field";
import { saveVehicle, type SaveVehicleState } from "./actions";
import { EMPTY_VEHICLE_FORM, type VehicleField, type VehicleFormValues } from "./vehicle-form";
import type { AdminVehicle, Depot } from "./vehicle-view";

function valuesOf(vehicle: AdminVehicle | null, defaultDepot: string): VehicleFormValues {
  if (!vehicle) return { ...EMPTY_VEHICLE_FORM, depotCode: defaultDepot };
  return {
    id: vehicle.id,
    type: vehicle.type,
    temp: vehicle.temp,
    weightCapKg: String(vehicle.weightCapKg),
    volumeCapM3: String(vehicle.volumeCapM3),
    fuelType: vehicle.fuelType,
    kmPerL: String(vehicle.kmPerL),
    weeklyFuelQuotaL: String(vehicle.weeklyFuelQuotaL),
    depotCode: vehicle.depotCode,
  };
}

/**
 * Add a vehicle, or edit one. Opened by a link (`?add=1`, `?edit=<id>`), so
 * the dialog is part of the URL and the page behind it stays a server
 * component; closing it is navigating back to the list with its filters.
 * The fields are controlled so a refused save (taken id, a figure out of
 * range) leaves what was typed in place.
 *
 * `defaultDepot` is the depot tab the admin was on, since adding from a
 * depot's tab almost always means adding to that depot.
 */
export function VehicleDialog({
  vehicle,
  depots,
  defaultDepot,
  returnTo,
}: {
  vehicle: AdminVehicle | null;
  depots: readonly Depot[];
  defaultDepot: string;
  returnTo: string;
}) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState<SaveVehicleState, FormData>(saveVehicle, {});
  const [values, setValues] = useState<VehicleFormValues>(() => valuesOf(vehicle, defaultDepot));
  const idPrefix = useId();
  const editing = vehicle !== null;
  const errors = state.fieldErrors ?? {};
  const depotName = (code: string) => depots.find((depot) => depot.code === code)?.name ?? code;

  const id = (field: VehicleField) => `${idPrefix}-${field}`;
  const set = (field: VehicleField) => (event: { target: { value: string } }) =>
    setValues((current) => ({ ...current, [field]: event.target.value }));
  const aria = (field: VehicleField, hint?: boolean) => ({
    id: id(field),
    name: field,
    "aria-invalid": errors[field] ? true : undefined,
    "aria-describedby": errors[field] ? `${id(field)}-error` : hint ? `${id(field)}-hint` : undefined,
  });
  const border = (field: VehicleField) => (errors[field] ? "border-bad" : "border-line");
  const close = () => router.push(returnTo);
  const fixed = "bg-raised text-muted";

  return (
    <Modal
      open
      onClose={close}
      eyebrow="Fleet"
      title={editing ? `Edit ${vehicle.id}` : "Add a vehicle"}
      context={editing ? depotName(vehicle.depotCode) : "It is a candidate for the depot's next plan as soon as it is saved."}
      wide
    >
      <form action={formAction} className="flex flex-col gap-4">
        <input type="hidden" name="returnTo" value={returnTo} />
        {editing ? <input type="hidden" name="vehicleId" value={vehicle.id} /> : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Vehicle id"
            htmlFor={id("id")}
            error={errors.id}
            hint={editing ? "Fixed once created: plans, trips and fuel ledgers refer to it." : "Letters, digits, dashes. Upper-case, for example VEH120."}
          >
            <input
              {...aria("id", true)}
              value={values.id}
              readOnly={editing}
              onChange={(event) => setValues((current) => ({ ...current, id: event.target.value.toUpperCase().replace(/\s/g, "") }))}
              maxLength={32}
              autoComplete="off"
              spellCheck={false}
              className={`${INPUT} ${border("id")} font-mono uppercase ${editing ? fixed : ""}`}
            />
          </Field>
          <Field
            label="Depot"
            htmlFor={id("depotCode")}
            error={errors.depotCode}
            hint={editing ? "Fixed once created: its plans and fuel ledger belong to this depot." : "The depot whose plans it runs on."}
          >
            {editing ? (
              // Read-only text rather than a disabled select, so it is still read out and still focusable.
              <input {...aria("depotCode", true)} name={undefined} value={depotName(values.depotCode)} readOnly className={`${INPUT} ${border("depotCode")} ${fixed}`} />
            ) : (
              <select {...aria("depotCode", true)} value={values.depotCode} onChange={set("depotCode")} className={`${INPUT} ${border("depotCode")}`}>
                <option value="" disabled>
                  Choose a depot
                </option>
                {depots.map((depot) => (
                  <option key={depot.code} value={depot.code}>
                    {depot.name}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label="Type" htmlFor={id("type")} error={errors.type}>
            <select {...aria("type")} value={values.type} onChange={set("type")} className={`${INPUT} ${border("type")}`}>
              <option value="truck">Truck</option>
              <option value="van">Van</option>
            </select>
          </Field>
          <Field
            label="Temperature"
            htmlFor={id("temp")}
            error={errors.temp}
            hint="A refrigerated vehicle carries chilled, frozen and ambient orders; an ambient one only ambient."
          >
            <select {...aria("temp", true)} value={values.temp} onChange={set("temp")} className={`${INPUT} ${border("temp")}`}>
              <option value="reefer">Refrigerated</option>
              <option value="ambient">Ambient</option>
            </select>
          </Field>
          <Field label="Weight capacity (kg)" htmlFor={id("weightCapKg")} error={errors.weightCapKg} hint="The most it may legally carry, in whole kilos.">
            <input {...aria("weightCapKg", true)} value={values.weightCapKg} onChange={set("weightCapKg")} inputMode="numeric" autoComplete="off" className={`${INPUT} ${border("weightCapKg")} tabular`} />
          </Field>
          <Field label="Volume capacity (m³)" htmlFor={id("volumeCapM3")} error={errors.volumeCapM3} hint="The usable load space, for example 18.5.">
            <input {...aria("volumeCapM3", true)} value={values.volumeCapM3} onChange={set("volumeCapM3")} inputMode="decimal" autoComplete="off" className={`${INPUT} ${border("volumeCapM3")} tabular`} />
          </Field>
          <Field label="Fuel" htmlFor={id("fuelType")} error={errors.fuelType} hint="What it runs on, for example diesel or petrol.">
            <input {...aria("fuelType", true)} value={values.fuelType} onChange={set("fuelType")} maxLength={24} autoComplete="off" className={`${INPUT} ${border("fuelType")}`} />
          </Field>
          <Field label="Fuel economy (km/L)" htmlFor={id("kmPerL")} error={errors.kmPerL} hint="Loaded, on real routes. The planner costs trips with it.">
            <input {...aria("kmPerL", true)} value={values.kmPerL} onChange={set("kmPerL")} inputMode="decimal" autoComplete="off" className={`${INPUT} ${border("kmPerL")} tabular`} />
          </Field>
          <Field label="Weekly fuel quota (L)" htmlFor={id("weeklyFuelQuotaL")} error={errors.weeklyFuelQuotaL} hint="The litres it may draw in a week, in whole litres.">
            <input {...aria("weeklyFuelQuotaL", true)} value={values.weeklyFuelQuotaL} onChange={set("weeklyFuelQuotaL")} inputMode="numeric" autoComplete="off" className={`${INPUT} ${border("weeklyFuelQuotaL")} tabular`} />
          </Field>
        </div>

        {editing ? (
          <p className="rounded-control bg-info-surface p-3 text-sm text-info-ink">
            Changes apply to plans built from now on. Plans already built keep the figures they were built with.
          </p>
        ) : null}

        {state.failure ? <ErrorPanel title={state.failure.title} detail={state.failure.detail} outcome={state.failure.outcome} /> : null}

        <div className="-mx-5 -mb-4 flex flex-wrap items-center justify-end gap-2 border-t border-line bg-raised px-5 py-4">
          <Button type="button" variant="secondary" onClick={close}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={pending}>
            {pending ? "Saving…" : editing ? "Save changes" : "Add vehicle"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
