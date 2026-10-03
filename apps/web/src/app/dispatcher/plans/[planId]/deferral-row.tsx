"use client";

import { useState } from "react";

type Deferral = {
  assignmentId: string;
  orderId: string;
  orderRef: string;
  reasonCode?: string | null;
};

const COMMON_REASONS = [
  { code: "REEFER_FULL", label: "Refrigerated capacity short", suggested: true },
  { code: "VEHICLE_IN_WORKSHOP", label: "Vehicle in workshop", suggested: false },
  { code: "WINDOW_UNREACHABLE", label: "Delivery window can't be met", suggested: false },
  { code: "TIME_BUDGET", label: "Route time budget exceeded", suggested: false },
] as const;

/**
 * Figma D-05 'Defer order' pattern, served inline (not as a modal).
 * Radio group on the four common codes + an 'Other reason' dropdown for the
 * rest, a 'Suggested' chip on the top option, and a live preview of the
 * message the store manager sees.
 */
export function DeferralRow({
  deferral,
  allReasons,
}: {
  deferral: Deferral;
  allReasons: string[];
}) {
  const initial = deferral.reasonCode ?? "";
  const inCommon = COMMON_REASONS.some((r) => r.code === initial);
  const [selected, setSelected] = useState<string>(initial);
  const [showOther, setShowOther] = useState<boolean>(initial !== "" && !inCommon);
  const otherReasons = allReasons.filter((code) => !COMMON_REASONS.some((r) => r.code === code));

  const inputName = `reasonCode:${deferral.assignmentId}`;
  const selectedLabel =
    selected === ""
      ? "no reason chosen yet"
      : (COMMON_REASONS.find((r) => r.code === selected)?.label ?? reasonLabel(selected)).toLowerCase();

  return (
    <li className="rounded-[var(--radius-card)] border border-line bg-surface p-4">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line pb-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-[color:var(--c-ruby)]">Defer order</p>
          <p className="mt-0.5 text-lg font-semibold text-ink">{deferral.orderRef}</p>
          <p className="font-mono text-xs text-muted">{deferral.orderId}</p>
        </div>
        <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-md px-2 py-1 text-xs font-semibold ${deferral.reasonCode ? "bg-emerald-50 text-emerald-700 border border-emerald-200" : "bg-amber-50 text-amber-900 border border-amber-200"}`}>
          <span aria-hidden className="size-1.5 rounded-full bg-current" />
          {deferral.reasonCode ? "Reason saved" : "Needs reason"}
        </span>
      </div>

      <fieldset className="mt-4">
        <legend className="text-xs font-semibold uppercase tracking-wide text-muted">
          Reason · saved on the order and shown to the store
        </legend>
        <div className="mt-3 flex flex-col gap-2">
          {COMMON_REASONS.map((reason) => {
            const checked = selected === reason.code;
            return (
              <label
                key={reason.code}
                className={`flex cursor-pointer items-start gap-3 rounded-[var(--radius-control)] border p-3 transition-colors ${checked ? "border-[color:var(--c-navy)] bg-action/10" : "border-line hover:border-[color:var(--c-navy)]"}`}
              >
                <input
                  type="radio"
                  name={inputName}
                  value={reason.code}
                  checked={checked}
                  onChange={() => {
                    setSelected(reason.code);
                    setShowOther(false);
                  }}
                  className="mt-0.5 h-4 w-4 accent-[color:var(--c-navy)]"
                />
                <span className="flex-1 text-sm font-semibold text-ink">
                  {reason.label}
                  {reason.suggested && (
                    <span className="ml-2 inline-flex items-center rounded-md bg-action/20 px-1.5 py-0.5 text-[11px] font-semibold text-[color:var(--c-navy)]">
                      Suggested
                    </span>
                  )}
                </span>
              </label>
            );
          })}
          {/* 'Other reason' row — opens the dropdown of less-common codes */}
          <label className={`flex cursor-pointer items-start gap-3 rounded-[var(--radius-control)] border p-3 transition-colors ${showOther ? "border-[color:var(--c-navy)] bg-action/10" : "border-line hover:border-[color:var(--c-navy)]"}`}>
            <input
              type="radio"
              name={`${inputName}:other-toggle`}
              checked={showOther}
              onChange={() => {
                setShowOther(true);
                // If selected is a common reason, clear it so the dropdown's
                // first value takes over as the submitted reason.
                if (COMMON_REASONS.some((r) => r.code === selected) || selected === "") {
                  setSelected(otherReasons[0] ?? "");
                }
              }}
              className="mt-0.5 h-4 w-4 accent-[color:var(--c-navy)]"
            />
            <span className="flex-1 text-sm font-semibold text-ink">Other reason</span>
          </label>
          {showOther && (
            <select
              aria-label="Other reason"
              name={inputName}
              value={selected}
              onChange={(event) => setSelected(event.target.value)}
              className="min-h-11 rounded-[var(--radius-control)] border border-line bg-surface px-3 text-sm text-ink"
            >
              {otherReasons.map((code) => (
                <option key={code} value={code}>
                  {reasonLabel(code)}
                </option>
              ))}
            </select>
          )}
        </div>
      </fieldset>

      <div className="mt-4 rounded-[var(--radius-control)] bg-raised p-3 text-sm text-muted">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted">The store manager will see</p>
        <p className="mt-1 text-ink">
          &ldquo;Your order <span className="font-semibold">{deferral.orderRef}</span> was deferred to the next run — reason: <span className="font-semibold">{selectedLabel}</span>.&rdquo;
        </p>
      </div>

      {/* Fallback: when nothing is selected, this hidden input makes the form
          submit an empty value for this assignment so the server-side validator
          catches it as 'pick a reason' instead of silently skipping the row. */}
      {selected === "" && (
        <input type="hidden" name={inputName} value="" />
      )}
    </li>
  );
}

function reasonLabel(code: string) {
  return code.replaceAll("_", " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}
