"use client";

import { useId } from "react";

/**
 * The − / count / + control the loader uses for units loaded.
 *
 * The count is a real number input as well as buttons: a pallet of 55 is not
 * loaded by pressing "−" eleven times. Every part is 44px, per the loader's
 * touch-target rule, and `max` stops a count above what was ordered.
 */
export function UnitsStepper({
  value,
  onChange,
  max,
  label,
  disabled,
  tone = "default",
}: {
  value: number;
  onChange: (next: number) => void;
  max: number;
  /** Names the control for screen readers, e.g. "Units loaded for DEMO-007". */
  label: string;
  disabled?: boolean;
  tone?: "default" | "bad";
}) {
  const id = useId();
  const clamp = (n: number) => Math.min(max, Math.max(0, Number.isFinite(n) ? Math.trunc(n) : 0));
  const button =
    "grid size-11 shrink-0 place-items-center focus-visible:outline-offset-[-2px] text-lg font-semibold text-ink hover:bg-raised disabled:cursor-not-allowed disabled:text-muted disabled:opacity-50";

  return (
    <div
      role="group"
      aria-labelledby={id}
      className={`inline-flex items-stretch overflow-hidden rounded-control border bg-surface focus-within:ring-2 focus-within:ring-link ${tone === "bad" ? "border-bad/40" : "border-line"}`}
    >
      <span id={id} className="sr-only">
        {label}
      </span>
      <button
        type="button"
        className={`${button} border-r border-line`}
        onClick={() => onChange(clamp(value - 1))}
        disabled={disabled || value <= 0}
        aria-label="One fewer"
      >
        <span aria-hidden>&minus;</span>
      </button>
      <input
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        value={value}
        disabled={disabled}
        aria-labelledby={id}
        onChange={(event) => onChange(clamp(Number(event.target.value.replace(/\D/g, ""))))}
        onFocus={(event) => event.target.select()}
        className={`tabular h-11 w-14 min-w-0 bg-transparent text-center text-base font-bold focus:outline-none ${tone === "bad" ? "text-bad-ink" : "text-ink"}`}
      />
      <button
        type="button"
        className={`${button} border-l border-line`}
        onClick={() => onChange(clamp(value + 1))}
        disabled={disabled || value >= max}
        aria-label="One more"
      >
        <span aria-hidden>+</span>
      </button>
    </div>
  );
}
