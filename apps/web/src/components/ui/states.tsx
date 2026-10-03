import type { ReactNode } from "react";

/**
 * Empty, error and loading, as three components instead of twelve.
 *
 * The app previously carried Banner, Notice, ErrorBanner, ReadFailure,
 * BoardError, TripError, StopError, RunError, WorkspaceUnavailable, EmptyRun,
 * EmptyBoard and EmptyList — all one-offs, with inconsistent roles and
 * inconsistent promises about whether a write had landed.
 *
 * The honesty rule the old code got right and this keeps: never say a mutation
 * failed when the outcome is unknown. `ErrorPanel` takes `outcome` for exactly
 * that, and says so in words rather than leaving it to the caller's copy.
 */

export function EmptyState({
  title,
  detail,
  action,
}: {
  title: string;
  detail?: string;
  action?: ReactNode;
}) {
  return (
    <div className="rounded-card border border-dashed border-line bg-surface p-8 text-center">
      <p className="font-semibold text-ink">{title}</p>
      {detail ? <p className="mx-auto mt-1 max-w-prose text-sm text-muted">{detail}</p> : null}
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
    </div>
  );
}

export function ErrorPanel({
  title,
  detail,
  outcome = "failed",
  action,
}: {
  title: string;
  detail?: string;
  /**
   * "failed"  — nothing was written, it is safe to retry.
   * "unknown" — the request may have landed. Do not retry blindly.
   * "read"    — a read failed, so nothing was at stake.
   */
  outcome?: "failed" | "unknown" | "read";
  action?: ReactNode;
}) {
  const note =
    outcome === "unknown"
      ? "This may have been saved. Reload before trying again, so you do not record it twice."
      : outcome === "failed"
        ? "Nothing was changed."
        : null;

  return (
    <div role="alert" className="rounded-card border border-bad/25 bg-bad-surface p-5">
      <p className="font-semibold text-bad-ink">{title}</p>
      {detail ? <p className="mt-1 text-sm text-ink">{detail}</p> : null}
      {note ? <p className="mt-1 text-sm text-muted">{note}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

/**
 * A non-blocking advisory. Used where the screen still works but is operating
 * on a fallback — the reason vocabularies being unreachable, a vehicle in Lamp
 * Mode, a figure that is an estimate rather than an observation.
 */
export function Advisory({ children }: { children: ReactNode }) {
  return (
    <p role="status" className="rounded-card border border-warn/30 bg-warn-surface px-4 py-3 text-sm text-ink">
      {children}
    </p>
  );
}

/**
 * Route-level skeleton. `aria-busy` plus an sr-only label, so a screen reader
 * announces the wait instead of reading a wall of empty boxes.
 */
export function LoadingSkeleton({ label = "Loading", rows = 6 }: { label?: string; rows?: number }) {
  return (
    <div aria-busy="true" className="flex flex-col gap-3">
      <span className="sr-only">{label}</span>
      <div className="h-24 animate-pulse rounded-card bg-raised" />
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="h-12 animate-pulse rounded-card bg-raised" />
      ))}
    </div>
  );
}
