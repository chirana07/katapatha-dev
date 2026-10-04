import type { ReactNode } from "react";

/** The input look every admin form shares; add `border-bad` or `border-line`. */
export const INPUT = "min-h-11 w-full rounded-control border bg-surface px-3 text-sm font-normal text-ink";

/**
 * A labelled form field with its hint or its error underneath. The error
 * replaces the hint rather than stacking under it, and is announced.
 */
export function Field({
  label,
  error,
  hint,
  htmlFor,
  children,
}: {
  label: string;
  error?: string;
  hint?: string;
  htmlFor: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-sm font-semibold text-ink">
        {label}
      </label>
      {children}
      {hint && !error ? (
        <p id={`${htmlFor}-hint`} className="text-xs text-muted">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${htmlFor}-error`} role="alert" className="text-xs font-semibold text-bad-ink">
          {error}
        </p>
      ) : null}
    </div>
  );
}
