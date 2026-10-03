import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import { ConnectivityPill } from "./connectivity";
import { PositionSharingMarker } from "./position-control";

/**
 * The navy header block shared by every driver screen. It stays navy in the
 * night rendering (navy is a brand hue, not a surface), and everything on it is
 * white text so it reads the same in both.
 */
function Frame({ children }: { children: ReactNode }) {
  return (
    <header className="rounded-b-3xl bg-navy px-4 pb-4 pt-4 text-white">
      <div className="mx-auto w-full max-w-xl">{children}</div>
    </header>
  );
}

export function TripHeader({
  vehicleId,
  subtitle,
  trips,
  done,
  total,
  menu,
}: {
  vehicleId: string;
  subtitle: string;
  /** Present only when the vehicle has more than one trip. */
  trips: { tripNo: number; href: string; current: boolean }[];
  done: number;
  total: number;
  /** The "Change vehicle" control, which is a form and so arrives as a slot. */
  menu?: ReactNode;
}) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  return (
    <Frame>
      <div className="flex items-center justify-between gap-3">
        <Image src="/logo/katapatha-lockup-dark.png" alt="Katapatha" width={1600} height={409} priority className="h-auto w-28" />
        <div className="flex flex-wrap items-center justify-end gap-2">
          <PositionSharingMarker />
          <ConnectivityPill />
        </div>
      </div>

      <div className="mt-4 flex items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="tabular truncate text-3xl font-bold tracking-tight">{vehicleId}</h1>
          <p className="tabular mt-0.5 text-sm text-white/70">{subtitle}</p>
        </div>
        {menu}
      </div>

      {trips.length > 1 ? (
        <nav aria-label="Trips" className="mt-3 flex gap-2">
          {trips.map((trip) => (
            <Link
              key={trip.tripNo}
              href={trip.href}
              aria-current={trip.current ? "page" : undefined}
              className={`inline-flex min-h-11 items-center rounded-control border px-4 text-sm font-semibold ${
                trip.current ? "border-action bg-action text-navy" : "border-white/25 text-white hover:bg-white/10"
              }`}
            >
              Trip {trip.tripNo}
            </Link>
          ))}
        </nav>
      ) : null}

      <div className="mt-4">
        <div className="tabular flex items-baseline justify-between text-sm">
          <span>
            {done} of {total} {total === 1 ? "stop" : "stops"} completed
          </span>
          <span className="font-semibold">{pct}%</span>
        </div>
        <div
          role="progressbar"
          aria-label="Stops completed"
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={done}
          className="mt-2 h-2 overflow-hidden rounded-full bg-white/15"
        >
          <div className="h-full rounded-full bg-action" style={{ width: `${pct}%` }} />
        </div>
      </div>
    </Frame>
  );
}

export type StepState = "done" | "current" | "todo";

export function StopHeader({
  backHref,
  title,
  subtitle,
  chip,
  detail,
  steps,
}: {
  backHref: string;
  title: string;
  subtitle: string;
  /** The status chip at the right, "Step 2 of 3", "Delivered". */
  chip?: { label: string; tone?: "default" | "good" | "bad" };
  detail?: string;
  steps?: { label: string; state: StepState }[];
}) {
  const chipClass =
    chip?.tone === "bad"
      ? "bg-bad text-white"
      : chip?.tone === "good"
        ? "bg-good-surface text-good-ink"
        : "bg-white/10 text-action";
  return (
    <Frame>
      <div className="flex items-center gap-3">
        <Link
          href={backHref}
          aria-label="Back to the run"
          className="grid size-11 shrink-0 place-items-center rounded-full bg-white/10 text-xl hover:bg-white/20"
        >
          <span aria-hidden>←</span>
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-xl font-bold leading-tight">{title}</h1>
          <p className="truncate text-sm text-white/70">{subtitle}</p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1.5">
          {chip ? <span className={`rounded-full px-3 py-1 text-xs font-bold ${chipClass}`}>{chip.label}</span> : null}
          <ConnectivityPill />
        </div>
      </div>
      {detail ? <p className="tabular mt-3 text-sm text-white/70">{detail}</p> : null}
      {steps ? (
        <ol className="mt-4 grid gap-2" style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }}>
          {steps.map((step) => (
            <li key={step.label} aria-current={step.state === "current" ? "step" : undefined}>
              <span
                aria-hidden
                className={`block h-1.5 rounded-full ${
                  step.state === "done" ? "bg-good" : step.state === "current" ? "bg-action" : "bg-white/15"
                }`}
              />
              <span
                className={`mt-1.5 block truncate text-sm ${
                  step.state === "done" ? "text-white/90" : step.state === "current" ? "font-semibold text-white" : "text-white/55"
                }`}
              >
                {step.state === "done" ? "✓ " : ""}
                {step.label}
              </span>
            </li>
          ))}
        </ol>
      ) : null}
    </Frame>
  );
}
