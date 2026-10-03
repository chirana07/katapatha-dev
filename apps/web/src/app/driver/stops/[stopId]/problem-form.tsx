"use client";

import { useState } from "react";
import { labelFor } from "../../reasons";
import { reportProblem } from "./actions";
import { EventForm } from "./event-form";

/**
 * R-11: "What stopped the delivery?" as big radio cards, and one red action.
 * The reasons are the API's own vocabulary; the design's call-and-wait log has
 * no field behind it, so it is not here.
 */
export function ProblemForm({
  stopId,
  reasons,
  secondary,
}: {
  stopId: string;
  reasons: string[];
  secondary?: React.ReactNode;
}) {
  const [reasonCode, setReasonCode] = useState<string>("");

  return (
    <EventForm
      stopId={stopId}
      action={reportProblem}
      buttonLabel="Record failed delivery"
      pendingLabel="Recording…"
      variant="critical"
      disabled={reasonCode === ""}
      secondary={secondary}
    >
      <fieldset className="flex flex-col gap-3">
        <legend className="text-xl font-bold text-ink">What stopped the delivery?</legend>
        {reasons.map((reason) => {
          const selected = reason === reasonCode;
          return (
            <label
              key={reason}
              className={`flex min-h-14 cursor-pointer items-center gap-3 rounded-card border px-4 py-3 ${
                selected ? "border-2 border-action bg-warn-surface" : "border-line bg-surface hover:bg-raised"
              }`}
            >
              <input
                type="radio"
                name="reasonCode"
                value={reason}
                checked={selected}
                onChange={() => setReasonCode(reason)}
                className="size-5 shrink-0 appearance-none rounded-full border-2 border-muted bg-surface checked:border-[6px] checked:border-action"
              />
              <span className="text-base font-semibold text-ink">{labelFor(reason)}</span>
            </label>
          );
        })}
        {reasonCode === "" ? <p className="text-sm text-muted">Pick the closest reason to continue.</p> : null}
      </fieldset>
    </EventForm>
  );
}
