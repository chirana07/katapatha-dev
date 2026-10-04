"use client";

import { useRouter } from "next/navigation";
import { useActionState, useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { ErrorPanel } from "@/components/ui/states";
import { Field, INPUT } from "../form-field";
import { saveOutlet, type SaveOutletState } from "./actions";
import {
  BRANDS,
  DOCK_TYPES,
  EMPTY_OUTLET_FORM,
  LAT_RANGE,
  LNG_RANGE,
  PARKING_CONSTRAINTS,
  type OutletField,
  type OutletFormValues,
} from "./outlet-form";
import { dockLabel, outletName, parkingLabel, type Directory, type Outlet } from "./outlet-view";

function valuesOf(outlet: Outlet | null): OutletFormValues {
  if (!outlet) return EMPTY_OUTLET_FORM;
  return {
    id: outlet.id,
    displayName: outlet.displayName ?? "",
    brand: outlet.brand,
    districtName: outlet.districtName,
    dockType: outlet.dockType,
    parkingConstraint: outlet.parkingConstraint,
    windowOpen: outlet.windowOpen,
    windowClose: outlet.windowClose,
    mallWindowOpen: outlet.mallWindowOpen ?? "",
    mallWindowClose: outlet.mallWindowClose ?? "",
    // Never sent on an edit: the position is moved on the dispatcher's map.
    lat: "",
    lng: "",
  };
}

/** A fact the admin cannot change here, shown where the input would be. */
function Fixed({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-sm font-semibold text-ink">{label}</span>
      <span className={`flex min-h-11 items-center rounded-control border border-line bg-raised px-3 text-sm text-muted ${mono ? "font-mono" : ""}`}>{value}</span>
    </div>
  );
}

/**
 * Add an outlet, or edit one. Opened by a link (`?add=1`, `?edit=<id>`), so
 * the dialog is part of the URL and the page behind it stays a server
 * component; closing it is navigating back to the list with its filters.
 * The fields are controlled so a refused save (taken id, a window that closes
 * before it opens) leaves what was typed in place.
 */
export function OutletDialog({ outlet, directory, returnTo }: { outlet: Outlet | null; directory: Directory; returnTo: string }) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState<SaveOutletState, FormData>(saveOutlet, {});
  const [values, setValues] = useState<OutletFormValues>(() => valuesOf(outlet));
  const idPrefix = useId();
  const editing = outlet !== null;
  const errors = state.fieldErrors ?? {};

  const id = (field: OutletField) => `${idPrefix}-${field}`;
  const set = (field: OutletField) => (event: { target: { value: string } }) =>
    setValues((current) => ({ ...current, [field]: event.target.value }));
  const aria = (field: OutletField, hint?: boolean) => ({
    id: id(field),
    name: field,
    "aria-invalid": errors[field] ? true : undefined,
    "aria-describedby": errors[field] ? `${id(field)}-error` : hint ? `${id(field)}-hint` : undefined,
  });
  const border = (field: OutletField) => (errors[field] ? "border-bad" : "border-line");
  const close = () => router.push(returnTo);

  // The depot is not chosen: it follows from the district, one to one.
  const depotCode = directory.districts.find((district) => district.name === values.districtName)?.depotCode;
  const depotName = (code: string) => directory.depots.find((depot) => depot.code === code)?.name ?? code;
  const mallBay = values.dockType === "mall_bay";

  return (
    <Modal
      open
      onClose={close}
      eyebrow="Outlets"
      title={editing ? `Edit ${outletName(outlet)}` : "Add an outlet"}
      context={editing ? outlet.id : "Its depot can plan deliveries to it as soon as it is saved."}
      wide
    >
      <form action={formAction} className="flex flex-col gap-4">
        <input type="hidden" name="returnTo" value={returnTo} />
        {editing ? <input type="hidden" name="outletId" value={outlet.id} /> : null}

        {editing ? (
          <div className="flex flex-col gap-2">
            <div className="grid gap-4 sm:grid-cols-3">
              <Fixed label="Outlet id" value={outlet.id} mono />
              <Fixed label="Brand" value={outlet.brand} />
              <Fixed label="District · Depot" value={`${outlet.districtName} · ${depotName(outlet.depotCode)}`} />
            </div>
            <p className="text-xs text-muted">
              The id, brand and district can&apos;t be changed: orders and delivery plans hang on them. The position is moved on the dispatcher&apos;s map.
            </p>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Outlet id" htmlFor={id("id")} error={errors.id} hint="Letters, digits, dashes. Upper-case, for example OUT200. It can't be changed later.">
              <input
                {...aria("id", true)}
                value={values.id}
                onChange={(event) => setValues((current) => ({ ...current, id: event.target.value.toUpperCase().replace(/\s/g, "") }))}
                maxLength={32}
                autoComplete="off"
                spellCheck={false}
                className={`${INPUT} ${border("id")} font-mono uppercase`}
              />
            </Field>
            <Field label="Brand" htmlFor={id("brand")} error={errors.brand}>
              <select {...aria("brand")} value={values.brand} onChange={set("brand")} className={`${INPUT} ${border("brand")}`}>
                <option value="" disabled>
                  Choose a brand
                </option>
                {BRANDS.map((brand) => (
                  <option key={brand} value={brand}>
                    {brand}
                  </option>
                ))}
              </select>
            </Field>
            <Field
              label="District"
              htmlFor={id("districtName")}
              error={errors.districtName}
              hint={depotCode ? `Depot: ${depotName(depotCode)}. The depot follows from the district.` : "The depot follows from the district."}
            >
              <select {...aria("districtName", true)} value={values.districtName} onChange={set("districtName")} className={`${INPUT} ${border("districtName")}`}>
                <option value="" disabled>
                  Choose a district
                </option>
                {directory.districts.map((district) => (
                  <option key={district.name} value={district.name}>
                    {district.name}
                  </option>
                ))}
              </select>
            </Field>
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name (optional)" htmlFor={id("displayName")} error={errors.displayName} hint="What people call the store. Empty shows it by its id.">
            <input {...aria("displayName", true)} value={values.displayName} onChange={set("displayName")} maxLength={120} autoComplete="off" className={`${INPUT} ${border("displayName")}`} />
          </Field>
          <div className="hidden sm:block" aria-hidden />
          <Field label="Dock" htmlFor={id("dockType")} error={errors.dockType} hint="Where a vehicle unloads.">
            <select {...aria("dockType", true)} value={values.dockType} onChange={set("dockType")} className={`${INPUT} ${border("dockType")}`}>
              {DOCK_TYPES.map((dock) => (
                <option key={dock} value={dock}>
                  {dockLabel(dock)}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Parking" htmlFor={id("parkingConstraint")} error={errors.parkingConstraint} hint="Vans only keeps trucks away from the outlet.">
            <select {...aria("parkingConstraint", true)} value={values.parkingConstraint} onChange={set("parkingConstraint")} className={`${INPUT} ${border("parkingConstraint")}`}>
              {PARKING_CONSTRAINTS.map((parking) => (
                <option key={parking} value={parking}>
                  {parkingLabel(parking)}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Receiving opens" htmlFor={id("windowOpen")} error={errors.windowOpen} hint="24-hour clock, Sri Lanka time.">
            <input {...aria("windowOpen", true)} type="time" value={values.windowOpen} onChange={set("windowOpen")} className={`${INPUT} ${border("windowOpen")} tabular`} />
          </Field>
          <Field label="Receiving closes" htmlFor={id("windowClose")} error={errors.windowClose} hint="Deliveries arriving later are refused.">
            <input {...aria("windowClose", true)} type="time" value={values.windowClose} onChange={set("windowClose")} className={`${INPUT} ${border("windowClose")} tabular`} />
          </Field>
          <Field
            label={mallBay ? "Mall window opens" : "Mall window opens (optional)"}
            htmlFor={id("mallWindowOpen")}
            error={errors.mallWindowOpen}
            hint={mallBay ? "A mall bay is only reachable while the mall lets deliveries in." : "Only for outlets inside a mall. Both times or neither."}
          >
            <input {...aria("mallWindowOpen", true)} type="time" value={values.mallWindowOpen} onChange={set("mallWindowOpen")} className={`${INPUT} ${border("mallWindowOpen")} tabular`} />
          </Field>
          <Field label={mallBay ? "Mall window closes" : "Mall window closes (optional)"} htmlFor={id("mallWindowClose")} error={errors.mallWindowClose}>
            <input {...aria("mallWindowClose")} type="time" value={values.mallWindowClose} onChange={set("mallWindowClose")} className={`${INPUT} ${border("mallWindowClose")} tabular`} />
          </Field>

          {editing ? null : (
            <>
              <Field
                label="Latitude (optional)"
                htmlFor={id("lat")}
                error={errors.lat}
                hint={`${LAT_RANGE.min} to ${LAT_RANGE.max}. Leave both empty to place it near the district centre, marked approximate.`}
              >
                <input {...aria("lat", true)} value={values.lat} onChange={set("lat")} inputMode="decimal" autoComplete="off" className={`${INPUT} ${border("lat")} tabular`} />
              </Field>
              <Field label="Longitude (optional)" htmlFor={id("lng")} error={errors.lng} hint={`${LNG_RANGE.min} to ${LNG_RANGE.max}. Both coordinates or neither.`}>
                <input {...aria("lng", true)} value={values.lng} onChange={set("lng")} inputMode="decimal" autoComplete="off" className={`${INPUT} ${border("lng")} tabular`} />
              </Field>
            </>
          )}
        </div>

        {state.failure ? <ErrorPanel title={state.failure.title} detail={state.failure.detail} outcome={state.failure.outcome} /> : null}

        <div className="-mx-5 -mb-4 flex flex-wrap items-center justify-end gap-2 border-t border-line bg-raised px-5 py-4">
          <Button type="button" variant="secondary" onClick={close}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={pending}>
            {pending ? "Saving…" : editing ? "Save changes" : "Add outlet"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
