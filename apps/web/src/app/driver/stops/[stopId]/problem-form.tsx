"use client";

import { useState } from "react";
import { labelFor } from "../../reasons";
import { reportProblem } from "./actions";
import { EventForm } from "./event-form";

export function ProblemForm({
  stopId,
  reasons,
  disabled,
}: {
  stopId: string;
  reasons: string[];
  disabled: boolean;
}) {
  const [reasonCode, setReasonCode] = useState<string>(reasons[0] ?? "");

  return (
    <EventForm
      stopId={stopId}
      action={reportProblem}
      buttonLabel="Report problem"
      pendingLabel="Reporting…"
      variant="critical"
      disabled={disabled}
      savedCopy={() => "Problem reported. The dispatcher sees the reason on their board."}
    >
      <label className="flex flex-col gap-1">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted">Reason</span>
        <select
          name="reasonCode"
          value={reasonCode}
          onChange={(event) => setReasonCode(event.target.value)}
          required
          className="min-h-12 rounded-[var(--radius-control)] border border-line bg-surface px-3 text-base text-ink"
        >
          {reasons.map((reason) => (
            <option key={reason} value={reason}>
              {labelFor(reason)}
            </option>
          ))}
        </select>
        <span className="text-xs text-muted">
          Pick the closest reason. A problem report closes the stop — the dispatcher will decide the follow-up.
        </span>
      </label>
    </EventForm>
  );
}
