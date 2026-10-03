"use client";

import { useState, type ReactNode } from "react";
import { deferralMessage, deferralReasonLabel } from "@katapatha/core/domain/deferral";

/** The reasons offered as radios when the allocator has no suggestion of its own. */
const COMMON = ["REEFER_FULL", "VEHICLE_IN_WORKSHOP", "WINDOW_UNREACHABLE", "TIME_BUDGET"] as const;
const OTHER = "__other__";

/**
 * Figma D-05 reason block: the allocator's suggestion first with a
 * 'Suggested' chip, two common alternatives, and 'Other · add a note'. The
 * preview underneath is built by the same function the API uses to write the
 * store's notification, so what the dispatcher reads is what the store gets.
 */
export function ReasonPicker({
  assignmentId,
  orderRef,
  windowOpen,
  windowClose,
  movesTo,
  permanent,
  suggested,
  initialReason,
  initialNote,
  allReasons,
  recipient,
  readOnly,
  sent = false,
  children,
}: {
  assignmentId: string;
  orderRef: string;
  windowOpen: string;
  windowClose: string;
  movesTo: string;
  permanent: boolean;
  suggested: string | null;
  initialReason: string | null;
  initialNote: string | null;
  allReasons: string[];
  recipient: string;
  readOnly: boolean;
  /** The plan is published: the message has been sent, not "will be". */
  sent?: boolean;
  /** Rendered between the reasons and the store preview (the "Moves to" card). */
  children?: ReactNode;
}) {
  const radios = [
    ...(suggested ? [suggested] : []),
    ...COMMON.filter((code) => code !== suggested && allReasons.includes(code)),
  ].slice(0, 3);
  const others = allReasons.filter((code) => !radios.includes(code));

  const startOnOther = Boolean(initialReason && !radios.includes(initialReason));
  const [choice, setChoice] = useState<string>(
    startOnOther ? OTHER : (initialReason ?? suggested ?? ""),
  );
  // No default under "Other": a pre-picked code would be saved — and sent to
  // the store — if the dispatcher only typed a note.
  const [otherCode, setOtherCode] = useState<string>(startOnOther ? initialReason! : "");
  const [note, setNote] = useState<string>(initialNote ?? "");

  const reasonCode = choice === OTHER ? otherCode : choice;
  const preview = reasonCode
    ? deferralMessage({ ref: orderRef, windowOpen, windowClose }, reasonCode, movesTo, permanent)
    : null;

  return (
    <>
      <fieldset disabled={readOnly}>
        <legend className="text-xs font-semibold uppercase tracking-wide text-muted">
          Reason · saved on the order and shown to the store
        </legend>
        <div className="mt-3 flex flex-col gap-2">
          {radios.map((code) => (
            <ReasonOption
              key={code}
              name={`choice:${assignmentId}`}
              checked={choice === code}
              onSelect={() => setChoice(code)}
              label={deferralReasonLabel(code)}
              chip={code === suggested ? "Suggested" : undefined}
            />
          ))}
          <ReasonOption
            name={`choice:${assignmentId}`}
            checked={choice === OTHER}
            onSelect={() => setChoice(OTHER)}
            label="Other · add a note"
          />
          {choice === OTHER ? (
            <div className="ml-7 flex flex-col gap-2">
              <select
                aria-label="Other reason"
                value={otherCode}
                required
                onChange={(event) => setOtherCode(event.target.value)}
                className="min-h-11 rounded-[var(--radius-control)] border border-line bg-surface px-3 text-sm text-ink"
              >
                <option value="" disabled>
                  Choose a reason…
                </option>
                {others.map((code) => (
                  <option key={code} value={code}>
                    {deferralReasonLabel(code)}
                  </option>
                ))}
              </select>
              <textarea
                name={`note:${assignmentId}`}
                value={note}
                onChange={(event) => setNote(event.target.value)}
                maxLength={500}
                rows={2}
                placeholder="Note for the record (optional)"
                className="rounded-[var(--radius-control)] border border-line bg-surface px-3 py-2 text-sm text-ink"
              />
            </div>
          ) : null}
        </div>
      </fieldset>

      {/* The one value the server action reads for this deferral. */}
      <input type="hidden" name={`reasonCode:${assignmentId}`} value={reasonCode} />

      {children}

      <div className="mt-5 rounded-[var(--radius-control)] bg-raised p-4 text-sm">
        <p className="text-xs font-semibold text-muted">{sent ? `Sent to ${lowerFirst(recipient)}` : `${recipient} will see`}</p>
        <p className="mt-1 text-ink">
          {preview ? <>&ldquo;{preview}&rdquo;</> : "Pick a reason to preview the message."}
        </p>
        {!readOnly ? (
          <p className="mt-2 text-xs text-muted">Sent to the store when the plan is published.</p>
        ) : null}
      </div>
    </>
  );
}

function ReasonOption({
  name,
  checked,
  onSelect,
  label,
  chip,
}: {
  name: string;
  checked: boolean;
  onSelect: () => void;
  label: string;
  chip?: string;
}) {
  return (
    <label
      className={`flex cursor-pointer items-center gap-3 rounded-[var(--radius-control)] border p-3 transition-colors has-[:disabled]:cursor-default ${checked ? "border-amber-300 bg-amber-50" : "border-line bg-surface hover:border-[color:var(--c-navy)]"}`}
    >
      <input
        type="radio"
        name={name}
        checked={checked}
        onChange={onSelect}
        className="h-4 w-4 accent-[color:var(--c-flame)]"
      />
      <span className="flex-1 text-sm font-semibold text-ink">
        {label}
        {chip ? (
          <span className="ml-2 inline-flex items-center rounded-md bg-emerald-50 px-1.5 py-0.5 text-[11px] font-semibold text-emerald-700">
            {chip}
          </span>
        ) : null}
      </span>
    </label>
  );
}

/** "The store at OUT010" → "the store at OUT010"; names stay as they are. */
function lowerFirst(value: string) {
  return value.startsWith("The ") ? `the ${value.slice(4)}` : value;
}
