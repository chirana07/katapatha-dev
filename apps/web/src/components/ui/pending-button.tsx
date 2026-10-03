"use client";

import type { ComponentProps } from "react";
import { useFormStatus } from "react-dom";
import { VARIANT_CLASS, type Variant } from "./button";

/**
 * A submit button that disables itself while its form's server action runs.
 *
 * The actions behind these buttons are idempotent, but a double click still
 * sends two requests and the second one comes back as "already done", which
 * reads as an error. Disabling during the round trip removes the cause rather
 * than explaining the symptom. It must sit inside the <form> it submits, since
 * useFormStatus reads the nearest ancestor form.
 */
export function PendingButton({
  variant = "secondary",
  pendingLabel,
  className = "",
  children,
  ...props
}: Omit<ComponentProps<"button">, "type"> & { variant?: Variant; pendingLabel?: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      {...props}
      type="submit"
      disabled={pending || props.disabled}
      aria-busy={pending}
      className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-control px-4 text-sm transition disabled:cursor-not-allowed disabled:opacity-50 ${VARIANT_CLASS[variant]} ${className}`}
    >
      {pending && pendingLabel ? pendingLabel : children}
    </button>
  );
}
