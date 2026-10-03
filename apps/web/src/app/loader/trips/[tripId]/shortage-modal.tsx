"use client";

import { useId, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { recordLoadCheck } from "../../actions";
import { CONDITION_LABEL, labelFor } from "../../reasons";
import { defaultReason, newUuid, shortBy, validateLoadCheck, type Condition } from "../../shortage";
import type { LoadLine } from "../../dock-model";
import { UnitsStepper } from "./units-stepper";

/**
 * L-03: report a loading issue.
 *
 * It is the load-check call with a non-OK condition and a reason from the
 * server's shortfall vocabulary. Nothing here is a separate "flag" — raising
 * the shortfall is a side effect of the check, and the dispatcher sees it in
 * Exceptions. So the copy says exactly that, and no more: it does not claim
 * anyone is alerted, and it does not offer a stock figure or a substitute,
 * because the system models neither.
 */

const PROBLEMS: { value: Exclude<Condition, "OK">; label: string }[] = [
  { value: "SHORT", label: CONDITION_LABEL.SHORT },
  { value: "DAMAGED", label: CONDITION_LABEL.DAMAGED },
  { value: "MISSING", label: CONDITION_LABEL.MISSING },
];

export type ModalSeed = { orderId: string; condition: Exclude<Condition, "OK">; loadedUnits: number };

export type ShortageDialogProps = {
  open: boolean;
  onClose: () => void;
  tripId: string;
  tripLabel: string;
  tripContext: string;
  lines: LoadLine[];
  districts: Record<string, string>;
  reasons: string[];
  seed: ModalSeed;
  checkedBy: string;
  onCheckedBy: (value: string) => void;
};

/** Mounted with a new `key` on every open, so the form always starts from the
 *  line the loader pointed at rather than from the last report. */
export function ShortageDialog({ open, onClose, tripId, tripLabel, tripContext, lines, districts, reasons, seed, checkedBy, onCheckedBy }: ShortageDialogProps) {
  const formId = useId();
  const [orderId, setOrderId] = useState(seed.orderId);
  const line = lines.find((candidate) => candidate.orderId === orderId) ?? lines[0]!;
  const [condition, setCondition] = useState<Exclude<Condition, "OK">>(seed.condition);
  const [loaded, setLoaded] = useState(seed.condition === "MISSING" ? 0 : seed.loadedUnits);
  const [reason, setReason] = useState(defaultReason(seed.condition, reasons));
  const [error, setError] = useState<{ title: string; detail: string; unknown: boolean } | null>(null);
  const [pending, start] = useTransition();
  // One id for this dialog: a retry after an unanswered request re-sends it, so
  // the server sees the same check. The next open mounts a fresh dialog and id.
  const [requestId] = useState(newUuid);

  const effectiveLoaded = condition === "MISSING" ? 0 : Math.min(loaded, line.expectedUnits);
  const short = shortBy(line.expectedUnits, effectiveLoaded);
  const input = {
    tripId,
    orderId: line.orderId,
    expectedUnits: line.expectedUnits,
    loadedUnits: effectiveLoaded,
    condition,
    checkedByName: checkedBy,
    reasonCode: reason || null,
    clientRequestId: requestId,
  };
  const problem = validateLoadCheck(input);

  function chooseCondition(next: Exclude<Condition, "OK">) {
    setCondition(next);
    setReason(defaultReason(next, reasons));
    if (next === "MISSING") setLoaded(0);
    else if (loaded === 0 || loaded >= line.expectedUnits) setLoaded(Math.max(line.expectedUnits - 1, 0));
  }

  function changeLine(next: string) {
    const target = lines.find((candidate) => candidate.orderId === next);
    if (!target) return;
    setOrderId(next);
    setLoaded(condition === "MISSING" ? 0 : Math.max(target.expectedUnits - 1, 0));
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (problem) {
      setError({ title: "This cannot be sent yet", detail: problem, unknown: false });
      return;
    }
    start(async () => {
      const result = await recordLoadCheck(input);
      if (result.ok) {
        onClose();
      } else {
        setError({ title: result.title, detail: result.detail, unknown: result.outcome === "unknown" });
      }
    });
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      eyebrow="Report a loading issue"
      title={tripLabel}
      context={tripContext}
      footer={
        <>
          <p className="mr-auto max-w-56 text-xs text-muted">It will appear in the dispatcher&rsquo;s Exceptions list straight away.</p>
          <Button type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form={formId} variant="primary" disabled={pending}>
            {pending ? "Sending\u2026" : "Send to dispatcher"}
          </Button>
        </>
      }
    >
    <form id={formId} onSubmit={submit} className="flex flex-col gap-5">
      <fieldset>
        <legend className="text-xs font-bold uppercase tracking-wider text-muted">What&rsquo;s wrong?</legend>
        <div className="mt-2 grid grid-cols-3 gap-2">
          {PROBLEMS.map((option) => (
            <button
              key={option.value}
              type="button"
              aria-pressed={condition === option.value}
              onClick={() => chooseCondition(option.value)}
              className={`min-h-11 rounded-control border px-2 text-sm font-semibold ${
                condition === option.value ? "border-rail bg-rail text-white" : "border-line bg-surface text-ink hover:bg-raised"
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </fieldset>

      <section>
        <h3 className="text-xs font-bold uppercase tracking-wider text-muted">Order</h3>
        <div className="mt-2 flex items-center justify-between gap-3 rounded-control border border-line p-3">
          <div className="min-w-0">
            <p className="font-bold text-ink">{line.orderRef}</p>
            <p className="text-sm text-muted">
              Stop {line.seq + 1} · {line.outletId}
              {districts[line.outletId] ? ` · ${districts[line.outletId]}` : ""}
            </p>
          </div>
          {lines.length > 1 ? (
            <label className="shrink-0">
              <span className="sr-only">Change order</span>
              <select
                value={orderId}
                onChange={(event) => changeLine(event.target.value)}
                className="min-h-11 max-w-40 rounded-control border border-line bg-surface px-2 text-sm font-semibold text-link"
              >
                {lines.map((candidate) => (
                  <option key={candidate.orderId} value={candidate.orderId}>
                    {candidate.orderRef} · stop {candidate.seq + 1}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </div>
      </section>

      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-control border border-line p-3">
          <p className="text-xs text-muted">Required</p>
          <p className="tabular mt-1 text-2xl font-bold text-ink">{line.expectedUnits}</p>
        </div>
        <div className="rounded-control border border-line p-3">
          <p className="text-xs text-muted">Loaded</p>
          <div className="mt-1">
            <UnitsStepper
              value={effectiveLoaded}
              onChange={setLoaded}
              max={line.expectedUnits}
              label={`Units loaded for ${line.orderRef}`}
              disabled={condition === "MISSING"}
            />
          </div>
        </div>
        <div className="rounded-control border border-bad/25 bg-bad-surface p-3">
          <p className="text-xs text-bad-ink">Short</p>
          <p className="tabular mt-1 text-2xl font-bold text-bad-ink">{short}</p>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-bold uppercase tracking-wider text-muted">Reason</span>
          <select
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            className="min-h-11 rounded-control border border-line bg-surface px-3 text-ink"
          >
            {reasons.map((code) => (
              <option key={code} value={code}>
                {labelFor(code)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-bold uppercase tracking-wider text-muted">Checked by</span>
          <input
            type="text"
            value={checkedBy}
            onChange={(event) => onCheckedBy(event.target.value)}
            autoComplete="off"
            className="min-h-11 rounded-control border border-line bg-surface px-3 text-ink"
          />
        </label>
      </div>

      <section>
        <h3 className="text-xs font-bold uppercase tracking-wider text-muted">Affected stop</h3>
        <div className="mt-2 flex items-center justify-between gap-3 rounded-control border border-line p-3">
          <div className="min-w-0">
            <p className="font-semibold text-ink">
              Stop {line.seq + 1} · {line.outletId}
              {districts[line.outletId] ? ` · ${districts[line.outletId]}` : ""}
            </p>
            <p className="text-sm text-muted">ordered {line.expectedUnits}</p>
          </div>
          <p className="tabular text-lg font-bold text-bad-ink">{short > 0 ? `−${short}` : "0"}</p>
        </div>
      </section>

      <p className="rounded-card border border-info/25 bg-info-surface p-3 text-sm text-ink">
        This holds the vehicle until the dispatcher decides in Exceptions &mdash; send it short, hold the order, cancel the
        line or move it to trip 2. You can keep loading the other lines meanwhile.
      </p>

      {error ? (
        <div role="alert" className="rounded-card border border-bad/25 bg-bad-surface p-3 text-sm">
          <p className="font-semibold text-bad-ink">{error.title}</p>
          <p className="mt-0.5 text-ink">{error.detail}</p>
          {error.unknown ? <p className="mt-0.5 text-muted">It may have been saved. Reload the dock before sending it again.</p> : null}
        </div>
      ) : null}

    </form>
    </Modal>
  );
}
