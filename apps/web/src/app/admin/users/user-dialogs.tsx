"use client";

import { useRouter } from "next/navigation";
import { useActionState, useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Consequences, Modal } from "@/components/ui/modal";
import { ErrorPanel } from "@/components/ui/states";
import { Field, INPUT } from "../form-field";
import { saveUser, setUserActive, type ActiveState, type SaveUserState } from "./actions";
import { EMPTY_USER_FORM, MIN_PASSWORD, ROLES, ROLE_LABELS, needsDepot, needsOutlet, type UserField, type UserFormValues } from "./user-form";
import type { AdminUser } from "./user-view";

export type DepotOption = { code: string; name: string };
export type OutletOption = { id: string; label: string };

function valuesOf(user: AdminUser | null): UserFormValues {
  if (!user) return EMPTY_USER_FORM;
  return {
    email: user.email,
    name: user.name,
    role: user.role,
    password: "",
    depotCode: user.depotCode ?? "",
    outletId: user.outletId ?? "",
  };
}

/**
 * Add an account, or edit one. Opened by a link (`?add=1`, `?edit=<id>`), so
 * the dialog is part of the URL and the page behind it stays a server
 * component; closing it is navigating back to the list with its filters.
 *
 * The fields are controlled so a refused save keeps what was typed, and so the
 * depot or outlet select can follow the role as it is picked: a role is bound
 * to one or the other (or, for an admin, neither), and showing only the one
 * that applies keeps the admin from setting a binding that would be dropped.
 */
export function UserDialog({
  user,
  depots,
  outlets,
  returnTo,
}: {
  user: AdminUser | null;
  depots: DepotOption[];
  outlets: OutletOption[];
  returnTo: string;
}) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState<SaveUserState, FormData>(saveUser, {});
  const [values, setValues] = useState<UserFormValues>(() => valuesOf(user));
  const idPrefix = useId();
  const editing = user !== null;
  const errors = state.fieldErrors ?? {};

  const id = (field: UserField) => `${idPrefix}-${field}`;
  const set = (field: UserField) => (event: { target: { value: string } }) =>
    setValues((current) => ({ ...current, [field]: event.target.value }));
  const aria = (field: UserField, hint?: boolean) => ({
    id: id(field),
    name: field,
    "aria-invalid": errors[field] ? true : undefined,
    "aria-describedby": errors[field] ? `${id(field)}-error` : hint ? `${id(field)}-hint` : undefined,
  });
  const border = (field: UserField) => (errors[field] ? "border-bad" : "border-line");
  const close = () => router.push(returnTo);

  return (
    <Modal
      open
      onClose={close}
      eyebrow="Accounts"
      title={editing ? `Edit ${user.name}` : "Add a user"}
      context={editing ? user.email : "They can sign in as soon as it is saved."}
      wide
    >
      <form action={formAction} className="flex flex-col gap-4">
        <input type="hidden" name="returnTo" value={returnTo} />
        {editing ? <input type="hidden" name="userId" value={user.id} /> : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" htmlFor={id("name")} error={errors.name}>
            <input {...aria("name")} value={values.name} onChange={set("name")} maxLength={120} autoComplete="off" className={`${INPUT} ${border("name")}`} />
          </Field>
          <Field
            label="Email"
            htmlFor={id("email")}
            error={errors.email}
            hint={editing ? "An email can't be changed: it is how they sign in, and the log names it." : "What they sign in with."}
          >
            <input
              {...aria("email", true)}
              type="email"
              value={values.email}
              readOnly={editing}
              onChange={set("email")}
              maxLength={160}
              autoComplete="off"
              spellCheck={false}
              className={`${INPUT} ${border("email")} ${editing ? "bg-raised text-muted" : ""}`}
            />
          </Field>
          <Field label="Role" htmlFor={id("role")} error={errors.role} hint="Decides which workspace they sign in to.">
            <select {...aria("role", true)} value={values.role} onChange={set("role")} className={`${INPUT} ${border("role")}`}>
              {ROLES.map((role) => (
                <option key={role} value={role}>
                  {ROLE_LABELS[role]}
                </option>
              ))}
            </select>
          </Field>

          {needsDepot(values.role) ? (
            <Field label="Depot" htmlFor={id("depotCode")} error={errors.depotCode} hint="They see this depot's plans, vehicles and stops only.">
              <select {...aria("depotCode", true)} value={values.depotCode} onChange={set("depotCode")} className={`${INPUT} ${border("depotCode")}`}>
                <option value="">Choose a depot…</option>
                {depots.map((depot) => (
                  <option key={depot.code} value={depot.code}>
                    {depot.name}
                  </option>
                ))}
              </select>
            </Field>
          ) : null}

          {needsOutlet(values.role) ? (
            <Field label="Outlet" htmlFor={id("outletId")} error={errors.outletId} hint="They order and receive for this outlet only.">
              <select {...aria("outletId", true)} value={values.outletId} onChange={set("outletId")} className={`${INPUT} ${border("outletId")}`}>
                <option value="">Choose an outlet…</option>
                {outlets.map((outlet) => (
                  <option key={outlet.id} value={outlet.id}>
                    {outlet.label}
                  </option>
                ))}
              </select>
            </Field>
          ) : null}

          {values.role === "ADMIN" ? (
            <p className="self-end rounded-control bg-info-surface p-3 text-sm text-info-ink sm:col-span-1">
              An admin is not tied to a depot or outlet: they manage all of Waypoint.
            </p>
          ) : null}

          <Field
            label={editing ? "New password (optional)" : "Password"}
            htmlFor={id("password")}
            error={errors.password}
            hint={
              editing
                ? "Leave empty to keep the current password. Setting one signs them out everywhere."
                : `At least ${MIN_PASSWORD} characters. Give it to them in person.`
            }
          >
            <input
              {...aria("password", true)}
              type="password"
              value={values.password}
              onChange={set("password")}
              maxLength={200}
              autoComplete="new-password"
              className={`${INPUT} ${border("password")}`}
            />
          </Field>
        </div>

        {state.failure ? <ErrorPanel title={state.failure.title} detail={state.failure.detail} outcome={state.failure.outcome} /> : null}

        <div className="-mx-5 -mb-4 flex flex-wrap items-center justify-end gap-2 border-t border-line bg-raised px-5 py-4">
          <Button type="button" variant="secondary" onClick={close}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={pending}>
            {pending ? "Saving…" : editing ? "Save changes" : "Add user"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/** Disable, with what it does to the person and to their history spelled out first. */
export function DisableDialog({ user, returnTo }: { user: AdminUser; returnTo: string }) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState<ActiveState, FormData>(setUserActive, {});
  const close = () => router.push(returnTo);

  return (
    <Modal open onClose={close} eyebrow="Accounts" title={`Disable ${user.name}`} context={user.email}>
      <form action={formAction} className="flex flex-col gap-5">
        <input type="hidden" name="userId" value={user.id} />
        <input type="hidden" name="active" value="false" />
        <input type="hidden" name="returnTo" value={returnTo} />
        <Consequences
          items={[
            { who: "Now", detail: "They are signed out everywhere, on the web and on the phone app." },
            { who: "Sign-in", detail: "They can't sign in until the account is re-enabled." },
            { who: "History", detail: "Everything they did is kept, and the log still names them." },
            { who: "Later", detail: "You can re-enable the account at any time. Nothing is deleted." },
          ]}
        />
        {state.failure ? <ErrorPanel title={state.failure.title} detail={state.failure.detail} outcome={state.failure.outcome} /> : null}
        <div className="-mx-5 -mb-4 flex flex-wrap items-center justify-end gap-2 border-t border-line bg-raised px-5 py-4">
          <Button type="button" variant="secondary" onClick={close}>
            Cancel
          </Button>
          <Button type="submit" variant="critical" disabled={pending}>
            {pending ? "Saving…" : "Disable"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/** One tap: letting someone sign in again needs no warning, and their old password still works. */
export function ReenableButton({ user, returnTo }: { user: AdminUser; returnTo: string }) {
  const [state, formAction, pending] = useActionState<ActiveState, FormData>(setUserActive, {});
  return (
    <form action={formAction} className="flex flex-col items-start gap-1">
      <input type="hidden" name="userId" value={user.id} />
      <input type="hidden" name="active" value="true" />
      <input type="hidden" name="returnTo" value={returnTo} />
      <Button type="submit" variant="secondary" disabled={pending} aria-label={`Re-enable ${user.name}`}>
        {pending ? "Saving…" : "Re-enable"}
      </Button>
      {state.failure ? (
        <p role="alert" className="max-w-48 text-xs font-semibold text-bad-ink">
          {state.failure.title}. {state.failure.detail}
        </p>
      ) : null}
    </form>
  );
}
