import type { ComponentProps, ReactNode } from "react";
import Link from "next/link";

/**
 * Action styling, as one table.
 *
 * DESIGN.md reserves action yellow for "the dominant action and progress", so
 * `primary` is the flame button and there is exactly one per view. `secondary`
 * is the outlined default, `critical` is destructive, and `dark` is the navy
 * button the designs use where flame would compete with a flame primary
 * already on screen (the driver's Navigate, the store's Download receipt).
 *
 * Every variant is at least 44px tall. DESIGN.md requires that on tablet and
 * phone; applying it everywhere costs nothing on desktop and removes a whole
 * class of mistake.
 */
export type Variant = "primary" | "secondary" | "critical" | "dark" | "ghost";

export const VARIANT_CLASS: Record<Variant, string> = {
  primary: "bg-action text-ink font-bold hover:brightness-95",
  secondary: "border border-line bg-surface text-ink font-semibold hover:bg-raised",
  critical: "bg-critical text-white font-bold hover:brightness-110",
  dark: "bg-rail text-white font-semibold hover:brightness-125",
  ghost: "text-ink font-semibold hover:bg-raised",
};

const BASE =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-control px-4 text-sm transition disabled:cursor-not-allowed disabled:opacity-50";

export function Button({
  variant = "secondary",
  className = "",
  ...props
}: ComponentProps<"button"> & { variant?: Variant }) {
  return <button {...props} className={`${BASE} ${VARIANT_CLASS[variant]} ${className}`} />;
}

export function ButtonLink({
  variant = "secondary",
  className = "",
  ...props
}: ComponentProps<typeof Link> & { variant?: Variant }) {
  return <Link {...props} className={`${BASE} ${VARIANT_CLASS[variant]} ${className}`} />;
}

/**
 * A disabled action with the reason it is disabled, beside it.
 *
 * DESIGN.md: "Disabled actions explain the unmet condition nearby." The loader
 * already does this properly via `readinessDisabledReason`; this makes the
 * pattern reusable so the next screen does not have to remember.
 */
export function BlockedAction({
  children,
  reason,
}: {
  /** The disabled control. */
  children: ReactNode;
  /** The unmet condition, in plain language. */
  reason: string;
}) {
  return (
    <div className="flex flex-col items-end gap-1.5">
      {children}
      <p role="status" className="text-right text-xs text-muted">
        {reason}
      </p>
    </div>
  );
}
