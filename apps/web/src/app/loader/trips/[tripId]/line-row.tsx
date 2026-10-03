"use client";

import { useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status-pill";
import { recordLoadCheck } from "../../actions";
import type { LoadLine } from "../../dock-model";
import { lineState, resolutionLabel, shortfallState } from "../../line-state";
import { newUuid, shortBy } from "../../shortage";
import type { ModalSeed } from "./shortage-modal";
import { UnitsStepper } from "./units-stepper";

/**
 * One order on the load list: what was ordered, what is on the vehicle, and the
 * two things a loader does about it.
 *
 * The count starts at what was ordered, so the common case is one tap on
 * "Mark loaded". Lowering the count turns that tap into "Report short", which
 * opens the issue dialog already filled in — a short line is a different act,
 * not a smaller number in the same one. Damaged and missing go through the
 * dialog directly.
 */

const STATE_PILL = {
  unchecked: null,
  ok: { label: "Loaded", tone: "good" },
  discrepancy: { label: "Reported", tone: "warn" },
  blocked: { label: "Missing", tone: "bad" },
} as const;

export function LineRow({
  tripId,
  line,
  editable,
  checkedBy,
  onReport,
}: {
  tripId: string;
  line: LoadLine;
  /** False once the vehicle is released: the list is a record then. */
  editable: boolean;
  checkedBy: string;
  onReport: (seed: ModalSeed) => void;
}) {
  const state = lineState(line);
  const [editing, setEditing] = useState(state === "unchecked");
  const [units, setUnits] = useState(line.loadedUnits ?? line.expectedUnits);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const requestId = useRef(newUuid());

  const held = shortfallState(line);
  const pill =
    held === "waiting"
      ? ({ label: "Waiting on dispatcher", tone: "warn" } as const)
      : held === "cleared"
        ? ({ label: "Cleared", tone: "good" } as const)
        : STATE_PILL[state];
  const short = shortBy(line.expectedUnits, units);
  const isFull = units >= line.expectedUnits;

  function markLoaded() {
    setError(null);
    start(async () => {
      const result = await recordLoadCheck({
        tripId,
        orderId: line.orderId,
        expectedUnits: line.expectedUnits,
        loadedUnits: line.expectedUnits,
        condition: "OK",
        checkedByName: checkedBy,
        reasonCode: null,
        clientRequestId: requestId.current,
      });
      if (result.ok) {
        requestId.current = newUuid();
        setEditing(false);
      } else {
        setError(
          result.outcome === "unknown"
            ? `${result.detail} It may have been saved, so reload before checking this line again.`
            : result.detail,
        );
      }
    });
  }

  const cardTone = state === "ok" || state === "unchecked" || held === "cleared" ? "" : state === "blocked" ? "bg-bad-surface/50" : "bg-warn-surface/50";

  return (
    <li className={`border-t border-line px-3 py-3 first:border-t-0 ${cardTone}`} data-state={state}>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <div className="min-w-0">
          <p className="font-semibold text-ink">{line.orderRef}</p>
          <p className="tabular text-sm text-muted">
            need <span className="font-semibold text-ink">{line.expectedUnits}</span>
            {state !== "unchecked" && !editing ? (
              <>
                {" "}
                · loaded <span className="font-semibold text-ink">{line.loadedUnits}</span>
              </>
            ) : null}
          </p>
        </div>

        {editable && editing ? (
          <UnitsStepper
            value={units}
            onChange={setUnits}
            max={line.expectedUnits}
            label={`Units loaded for ${line.orderRef}`}
            disabled={pending}
            tone={isFull ? "default" : "bad"}
          />
        ) : (
          <div className="flex items-center gap-1">
            {pill ? <StatusPill label={pill.label} tone={pill.tone} /> : !editable ? <StatusPill label="Not checked" tone="neutral" /> : null}
            {editable && held !== "cleared" ? (
              <Button type="button" variant="ghost" onClick={() => setEditing(true)}>
                Change
              </Button>
            ) : null}
          </div>
        )}
      </div>

      {!editing && state !== "ok" && state !== "unchecked" ? (
        <p className="text-sm text-muted">
          {shortBy(line.expectedUnits, line.loadedUnits ?? 0) > 0
            ? `${shortBy(line.expectedUnits, line.loadedUnits ?? 0)} short. `
            : ""}
          {held === "waiting"
            ? "Waiting on the dispatcher."
            : held === "cleared"
              ? `${resolutionLabel(line.shortfall?.resolution)}.`
              : "Reported to the dispatcher."}
        </p>
      ) : null}

      {editable && editing ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {isFull ? (
            <Button type="button" onClick={markLoaded} disabled={pending} className="flex-1 sm:flex-none">
              <span aria-hidden>&#10003;</span>
              {pending ? "Saving…" : "Mark loaded"}
            </Button>
          ) : (
            <Button
              type="button"
              onClick={() => onReport({ orderId: line.orderId, condition: units === 0 ? "MISSING" : "SHORT", loadedUnits: units })}
              className="flex-1 border-bad/40 text-bad-ink sm:flex-none"
            >
              Report short {short}
            </Button>
          )}
          <Button
            type="button"
            variant="ghost"
            onClick={() => onReport({ orderId: line.orderId, condition: "DAMAGED", loadedUnits: Math.min(units, Math.max(line.expectedUnits - 1, 0)) })}
          >
            Damaged or missing
          </Button>
          {state !== "unchecked" ? (
            <Button type="button" variant="ghost" onClick={() => setEditing(false)} disabled={pending}>
              Cancel
            </Button>
          ) : null}
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="mt-2 text-sm text-bad-ink">
          {error}
        </p>
      ) : null}
    </li>
  );
}
