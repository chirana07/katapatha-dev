"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Consequences, Modal } from "@/components/ui/modal";
import { ErrorPanel } from "@/components/ui/states";
import { setAvailability, type AvailabilityState } from "./actions";

const INITIAL: AvailabilityState = {};

/**
 * "Mark unavailable", with its consequences spelled out before the dispatcher
 * commits. The reason is the workshop note shown beside the vehicle afterwards;
 * it is optional because a dispatcher with a broken-down vehicle should not be
 * blocked on typing.
 */
export function MarkUnavailable({ vehicleId, date }: { vehicleId: string; date: string }) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(setAvailability, INITIAL);

  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)} className="flex-1">
        Mark unavailable
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        eyebrow="Fleet status"
        title={`Mark ${vehicleId} unavailable`}
        context={`For ${date}`}
      >
        <form action={formAction} className="flex flex-col gap-5">
          <input type="hidden" name="date" value={date} />
          <input type="hidden" name="vehicleId" value={vehicleId} />
          <input type="hidden" name="status" value="IN_WORKSHOP" />
          <label className="flex flex-col gap-1.5 text-sm font-semibold text-ink">
            Reason (optional)
            <input
              name="note"
              maxLength={200}
              placeholder="e.g. Compressor fault"
              className="min-h-11 rounded-control border border-line bg-surface px-3 font-normal text-ink"
            />
          </label>
          <Consequences
            items={[
              { who: "Planning", detail: `The next auto-plan run will not use ${vehicleId}.` },
              {
                who: "Publishing",
                detail: `A draft that still uses ${vehicleId} cannot be published until it is re-planned.`,
              },
              { who: "Decision log", detail: "The change is recorded with your name." },
            ]}
          />
          {state.failure ? (
            <ErrorPanel title={state.failure.title} detail={state.failure.detail} outcome={state.failure.outcome} />
          ) : null}
          <div className="-mx-5 -mb-4 flex flex-wrap items-center justify-end gap-2 border-t border-line bg-raised px-5 py-4">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="critical" disabled={pending}>
              {pending ? "Saving…" : "Mark unavailable"}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}

/** The way back: one tap, no consequences to confirm beyond the plan being able to use it again. */
export function BackInService({ vehicleId, date }: { vehicleId: string; date: string }) {
  const [state, formAction, pending] = useActionState(setAvailability, INITIAL);

  return (
    <form action={formAction} className="flex flex-1 flex-col gap-2">
      <input type="hidden" name="date" value={date} />
      <input type="hidden" name="vehicleId" value={vehicleId} />
      <input type="hidden" name="status" value="AVAILABLE" />
      <Button type="submit" variant="secondary" disabled={pending}>
        {pending ? "Saving…" : "Back in service"}
      </Button>
      {state.failure ? (
        <ErrorPanel title={state.failure.title} detail={state.failure.detail} outcome={state.failure.outcome} />
      ) : null}
    </form>
  );
}
