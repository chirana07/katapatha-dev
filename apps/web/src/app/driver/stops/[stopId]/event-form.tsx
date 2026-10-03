"use client";

import { useActionState, useState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { useConnectivity } from "../../connectivity";
import { OFFLINE_SUBMIT_REASON, canSubmit } from "../../connectivity-state";
import { deviceId, generateUlid } from "../../format";
import { ThumbBar } from "../../thumb-bar";
import type { EventState } from "./actions";

type ActionFn = (previous: EventState, formData: FormData) => Promise<EventState>;

type Props = {
  stopId: string;
  action: ActionFn;
  buttonLabel: string;
  pendingLabel: string;
  variant?: "primary" | "critical";
  disabled?: boolean;
  /** The quieter action beside the dominant one (a "Report issue" link, a "Back"). */
  secondary?: ReactNode;
  children?: ReactNode;
};

/**
 * One driver intent as a form: fields in the page, the dominant action on the
 * pinned thumb bar.
 *
 * The event id is minted once per intent and changes only after the server has
 * confirmed a save, so pressing again after an unanswered request replays the
 * same ULID and the API answers `duplicate` instead of recording it twice.
 */
export function EventForm({
  stopId,
  action,
  buttonLabel,
  pendingLabel,
  variant = "primary",
  disabled = false,
  secondary,
  children,
}: Props) {
  const [state, formAction] = useActionState<EventState, FormData>(action, { stopId });
  const [tracker, setTracker] = useState<{ savedAt: string | undefined; eventId: string; device: string }>(() => ({
    savedAt: state.savedAt,
    eventId: generateUlid(),
    device: typeof window === "undefined" ? "" : deviceId(),
  }));

  if (tracker.savedAt !== state.savedAt) {
    setTracker({
      savedAt: state.savedAt,
      eventId: generateUlid(),
      device: tracker.device || (typeof window === "undefined" ? "" : deviceId()),
    });
  }
  const occurredAt = new Date().toISOString();

  return (
    <form action={formAction} className="contents">
      <input type="hidden" name="stopId" value={stopId} />
      <input type="hidden" name="eventId" value={tracker.eventId} />
      <input type="hidden" name="deviceId" value={tracker.device || "device-ephemeral"} />
      <input type="hidden" name="occurredAt" value={occurredAt} />
      {children}
      <ThumbBar notice={<Notices state={state} />}>
        {secondary}
        <SubmitButton variant={variant} disabled={disabled} label={buttonLabel} pendingLabel={pendingLabel} />
      </ThumbBar>
    </form>
  );
}

function Notices({ state }: { state: EventState }) {
  const { status } = useConnectivity();
  if (!canSubmit(status)) return <p role="status" className="text-sm text-warn-ink">{OFFLINE_SUBMIT_REASON}</p>;
  if (state.error) {
    return (
      <p role="alert" className="rounded-control border border-bad/25 bg-bad-surface p-3 text-sm text-ink">
        {state.error}
      </p>
    );
  }
  if (state.savedAt) {
    return (
      <p role="status" className="text-sm text-good-ink">
        Recorded.
        {state.savedDuplicate ? " Katapatha already had this record, which is a correct repeat." : ""}
        {state.staleAssignment ? " The server flagged a stale assignment. Reload the run before the next action." : ""}
      </p>
    );
  }
  return null;
}

function SubmitButton({
  variant,
  disabled,
  label,
  pendingLabel,
}: {
  variant: "primary" | "critical";
  disabled: boolean;
  label: string;
  pendingLabel: string;
}) {
  const { pending } = useFormStatus();
  const { status } = useConnectivity();
  return (
    <Button
      type="submit"
      variant={variant}
      disabled={disabled || pending || !canSubmit(status)}
      className="min-h-12 min-w-0 flex-1 text-base"
    >
      {pending ? pendingLabel : label}
    </Button>
  );
}
