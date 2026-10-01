"use client";

import { useActionState, useEffect, useId, useState } from "react";
// Form stays mounted across submissions, so useState is where the fresh
// clientRequestId lives after a save — not useEffect, per React 19's
// "no setState in effect" rule.
import { useFormStatus } from "react-dom";
import { CONDITION_LABEL, labelFor } from "../../reasons";
import { recordLoadCheck, type LoadCheckState } from "./actions";

type Line = {
  orderId: string;
  orderRef: string;
  outletId: string;
  seq: number;
  expectedUnits: number;
  loadedUnits?: number | null;
  condition?: "OK" | "SHORT" | "DAMAGED" | "MISSING" | null;
};

type Props = {
  tripId: string;
  line: Line;
  reasons: string[];
  defaultCheckedByName?: string;
  onCheckedByNameChange?: (value: string) => void;
};

const CONDITIONS: Array<{ value: "OK" | "SHORT" | "DAMAGED" | "MISSING"; label: string }> = [
  { value: "OK", label: CONDITION_LABEL.OK },
  { value: "SHORT", label: CONDITION_LABEL.SHORT },
  { value: "DAMAGED", label: CONDITION_LABEL.DAMAGED },
  { value: "MISSING", label: CONDITION_LABEL.MISSING },
];

export function LineForm({
  tripId,
  line,
  reasons,
  defaultCheckedByName = "",
  onCheckedByNameChange,
}: Props) {
  const [state, formAction] = useActionState<LoadCheckState, FormData>(recordLoadCheck, {
    tripId,
    orderId: line.orderId,
  });

  const [condition, setCondition] = useState<"OK" | "SHORT" | "DAMAGED" | "MISSING">(line.condition ?? "OK");
  const [loadedUnits, setLoadedUnits] = useState<string>(
    line.loadedUnits != null ? String(line.loadedUnits) : String(line.expectedUnits),
  );
  const [reasonCode, setReasonCode] = useState<string>(reasons[0] ?? "");
  const [checkedByName, setCheckedByName] = useState<string>(defaultCheckedByName);
  const [idTracker, setIdTracker] = useState<{ savedAt: string | undefined; id: string }>(() => ({
    savedAt: state.savedAt,
    id: generateUuid(),
  }));
  let clientRequestId = idTracker.id;
  if (idTracker.savedAt !== state.savedAt) {
    const next = { savedAt: state.savedAt, id: generateUuid() };
    setIdTracker(next);
    clientRequestId = next.id;
  }
  const needsReason = condition !== "OK";

  const idPrefix = useId();
  const unitsId = `${idPrefix}-units`;
  const conditionId = `${idPrefix}-condition`;
  const reasonId = `${idPrefix}-reason`;
  const nameId = `${idPrefix}-name`;
  const statusId = `${idPrefix}-status`;

  useEffect(() => {
    if (!onCheckedByNameChange) return;
    onCheckedByNameChange(checkedByName);
  }, [checkedByName, onCheckedByNameChange]);

  const correcting =
    line.condition != null && line.loadedUnits != null && state.savedAt == null;

  return (
    <form
      action={formAction}
      className="mt-4 grid gap-3 border-t border-line pt-4 md:grid-cols-[auto_1fr_1fr_auto]"
      aria-describedby={statusId}
      noValidate
    >
      <input type="hidden" name="tripId" value={tripId} />
      <input type="hidden" name="orderId" value={line.orderId} />
      <input type="hidden" name="clientRequestId" value={clientRequestId} />

      <div className="flex flex-col gap-1 md:w-32">
        <label htmlFor={unitsId} className="text-xs font-semibold uppercase tracking-wide text-muted">
          Loaded units
        </label>
        <input
          id={unitsId}
          name="loadedUnits"
          type="number"
          inputMode="numeric"
          min={0}
          step={1}
          required
          value={loadedUnits}
          onChange={(event) => setLoadedUnits(event.target.value)}
          className="tabular min-h-11 rounded-[var(--radius-control)] border border-line bg-surface px-3 text-ink"
          aria-describedby={`${unitsId}-hint`}
        />
        <p id={`${unitsId}-hint`} className="text-xs text-muted">
          Expected {line.expectedUnits}
        </p>
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor={conditionId} className="text-xs font-semibold uppercase tracking-wide text-muted">
          Condition
        </label>
        <select
          id={conditionId}
          name="condition"
          value={condition}
          onChange={(event) => setCondition(event.target.value as typeof condition)}
          className="min-h-11 rounded-[var(--radius-control)] border border-line bg-surface px-3 text-ink"
        >
          {CONDITIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        {needsReason ? (
          <>
            <label htmlFor={reasonId} className="mt-2 text-xs font-semibold uppercase tracking-wide text-muted">
              Reason
            </label>
            <select
              id={reasonId}
              name="reasonCode"
              value={reasonCode}
              onChange={(event) => setReasonCode(event.target.value)}
              required
              className="min-h-11 rounded-[var(--radius-control)] border border-line bg-surface px-3 text-ink"
            >
              {reasons.map((reason) => (
                <option key={reason} value={reason}>
                  {labelFor(reason)}
                </option>
              ))}
            </select>
          </>
        ) : null}
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor={nameId} className="text-xs font-semibold uppercase tracking-wide text-muted">
          Checked by
        </label>
        <input
          id={nameId}
          name="checkedByName"
          type="text"
          required
          minLength={2}
          autoComplete="off"
          value={checkedByName}
          onChange={(event) => setCheckedByName(event.target.value)}
          placeholder="e.g. Ranjith Silva"
          className="min-h-11 rounded-[var(--radius-control)] border border-line bg-surface px-3 text-ink"
        />
        <p className="text-xs text-muted">Shared terminal — type a real name each line.</p>
      </div>

      <SaveButton correcting={correcting} />

      <div
        id={statusId}
        aria-live="polite"
        role={state.error ? "alert" : "status"}
        className="md:col-span-4"
      >
        {state.error && (
          <p className="rounded-[var(--radius-control)] border border-red-200 bg-red-50 p-2 text-sm text-critical">
            {state.error}
          </p>
        )}
        {state.savedAt && !state.error && (
          <p className="rounded-[var(--radius-control)] border border-emerald-200 bg-emerald-50 p-2 text-sm text-emerald-800">
            Saved. The line now shows its recorded state above.
          </p>
        )}
      </div>
    </form>
  );
}

function SaveButton({ correcting }: { correcting: boolean }) {
  const { pending } = useFormStatus();
  const idle = correcting ? "Save correction" : "Save check";
  return (
    <button
      type="submit"
      disabled={pending}
      aria-disabled={pending}
      className="min-h-11 min-w-32 self-end rounded-[var(--radius-control)] bg-action px-4 font-semibold text-ink transition-[filter] hover:brightness-95 disabled:cursor-not-allowed disabled:bg-raised disabled:text-muted"
    >
      {pending ? "Saving…" : idle}
    </button>
  );
}

function generateUuid(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  // Fallback: RFC 4122 version-4 shape, random (not crypto-strong). The
  // server dedupes on the string, so collision risk is what matters.
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (char) => {
    const random = Math.random() * 16 | 0;
    const value = char === "x" ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}
