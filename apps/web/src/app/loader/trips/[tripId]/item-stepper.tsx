"use client";

import { useId } from "react";
import { MinusIcon, PlusIcon } from "../../icons";

/**
 * The Figma stepper (L-02 table, L-08 cards): two square buttons and the
 * count between them. The count is also a typed input, because a pallet of 55
 * is not loaded by pressing "+" fifty-five times. The count turns green when
 * the item is fully loaded.
 *
 * `size="lg"` is the phone's 40px target; the table uses 34px squares, which
 * the dock tablet's row height keeps at 44px.
 */
export function ItemStepper({
  value,
  max,
  onChange,
  label,
  disabled,
  size = "sm",
  tone,
}: {
  value: number;
  max: number;
  onChange: (next: number) => void;
  label: string;
  disabled?: boolean;
  size?: "sm" | "lg";
  tone?: "bad";
}) {
  const id = useId();
  const clamp = (n: number) => Math.min(max, Math.max(0, Number.isFinite(n) ? Math.trunc(n) : 0));
  const square = size === "lg" ? "size-10" : "size-8.5";
  const button = `${square} grid shrink-0 place-items-center rounded-[6px] border border-[#d1d5db] bg-surface text-[#111827] hover:bg-raised disabled:cursor-not-allowed disabled:text-[#d1d5db]`;
  const full = value >= max && max > 0;

  return (
    <div role="group" aria-labelledby={id} className="inline-flex items-center gap-1.5">
      <span id={id} className="sr-only">
        {label}
      </span>
      <button type="button" className={button} onClick={() => onChange(clamp(value - 1))} disabled={disabled || value <= 0} aria-label="One fewer">
        <MinusIcon className="size-4" />
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
        className={`tabular h-8.5 w-9 min-w-0 bg-transparent text-center font-bold focus:outline-none disabled:opacity-100 ${size === "lg" ? "text-base" : "text-[15px]"} ${
          tone === "bad" ? "text-bad-ink" : full ? "text-good" : "text-[#111827]"
        }`}
      />
      <button type="button" className={button} onClick={() => onChange(clamp(value + 1))} disabled={disabled || value >= max} aria-label="One more">
        <PlusIcon className="size-4" />
      </button>
    </div>
  );
}
