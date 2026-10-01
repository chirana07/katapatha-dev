"use client";

import { useActionState, useState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { deviceId, generateUlid } from "../../format";
import type { EventState } from "./actions";

type ActionFn = (previous: EventState, formData: FormData) => Promise<EventState>;

type Props = {
  stopId: string;
  action: ActionFn;
  buttonLabel: string;
  pendingLabel: string;
  variant?: "primary" | "secondary" | "critical";
  disabled?: boolean;
  savedCopy?: (state: EventState) => string;
  children?: ReactNode;
};

export function EventForm({
  stopId,
  action,
  buttonLabel,
  pendingLabel,
  variant = "primary",
  disabled = false,
  savedCopy,
  children,
}: Props) {
  const [state, formAction] = useActionState<EventState, FormData>(action, { stopId });
  const [tracker, setTracker] = useState<{ savedAt: string | undefined; eventId: string; device: string }>(
    () => ({
      savedAt: state.savedAt,
      eventId: generateUlid(),
      device: typeof window === "undefined" ? "" : deviceId(),
    }),
  );

  if (tracker.savedAt !== state.savedAt) {
    setTracker({
      savedAt: state.savedAt,
      eventId: generateUlid(),
      device: tracker.device || (typeof window === "undefined" ? "" : deviceId()),
    });
  }
  const occurredAt = new Date().toISOString();

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="stopId" value={stopId} />
      <input type="hidden" name="eventId" value={tracker.eventId} />
      <input type="hidden" name="deviceId" value={tracker.device || "device-ephemeral"} />
      <input type="hidden" name="occurredAt" value={occurredAt} />
      {children}
      <SubmitButton variant={variant} disabled={disabled} label={buttonLabel} pendingLabel={pendingLabel} />
      {state.error && (
        <p
          role="alert"
          className="rounded-[var(--radius-control)] border border-red-200 bg-red-50 p-3 text-sm text-critical"
        >
          {state.error}
        </p>
      )}
      {state.savedAt && !state.error && (
        <p
          role="status"
          className="rounded-[var(--radius-control)] border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800"
        >
          {savedCopy ? savedCopy(state) : "Saved."}
          {state.savedStatus === "duplicate" && " The server already had this event, which is a correct replay."}
          {state.savedConflictState === "STALE_ASSIGNMENT" &&
            " Note: the server flagged a stale assignment — reload the run before the next action."}
        </p>
      )}
    </form>
  );
}

const VARIANT: Record<NonNullable<Props["variant"]>, string> = {
  primary: "bg-action text-ink hover:brightness-95",
  secondary: "border border-line bg-surface text-ink hover:bg-raised",
  critical: "border border-red-300 bg-red-50 text-critical hover:bg-red-100",
};

function SubmitButton({
  variant,
  disabled,
  label,
  pendingLabel,
}: {
  variant: NonNullable<Props["variant"]>;
  disabled: boolean;
  label: string;
  pendingLabel: string;
}) {
  const { pending } = useFormStatus();
  const isDisabled = disabled || pending;
  return (
    <button
      type="submit"
      disabled={isDisabled}
      aria-disabled={isDisabled}
      className={`min-h-12 w-full rounded-[var(--radius-control)] px-4 text-base font-semibold transition-[filter] disabled:cursor-not-allowed disabled:bg-raised disabled:text-muted ${VARIANT[variant]}`}
    >
      {pending ? pendingLabel : label}
    </button>
  );
}
