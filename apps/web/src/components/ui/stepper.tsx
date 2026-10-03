import type { ReactNode } from "react";

/**
 * Two different "progress through a sequence" components, kept apart on
 * purpose, because they answer different questions.
 *
 * `Stepper` is a form wizard: three numbered steps the operator walks through
 * themselves (Place an order: Select products -> Review -> Confirm).
 *
 * `Tracker` is an observed process: the five fixed delivery steps a store
 * manager watches someone else complete. It is explicitly NOT a progress bar
 * over time, because the product has no continuous position — see DOMAIN.md.
 * Each step is either done, current or still to come, and the detail line
 * under a step is where an estimate is labelled as one.
 */

export function Stepper({
  steps,
  current,
}: {
  steps: string[];
  /** Zero-based. */
  current: number;
}) {
  return (
    <ol className="flex items-center gap-2">
      {steps.map((step, index) => {
        const done = index < current;
        const active = index === current;
        return (
          <li key={step} className="flex min-w-0 flex-1 items-center gap-2">
            <span
              aria-current={active ? "step" : undefined}
              className={`tabular grid size-7 shrink-0 place-items-center rounded-full text-sm font-bold ${
                done || active ? "bg-good text-white" : "bg-line text-muted"
              }`}
            >
              {done ? "✓" : index + 1}
            </span>
            <span className={`truncate text-sm ${active ? "font-bold text-ink" : "font-medium text-muted"}`}>
              {step}
            </span>
            {index < steps.length - 1 ? (
              <span aria-hidden className={`h-0.5 min-w-4 flex-1 rounded-full ${done ? "bg-good" : "bg-line"}`} />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

export interface TrackerStep {
  label: string;
  /** The time it happened, or the estimate — say which in the text. */
  detail?: ReactNode;
  state: "done" | "current" | "todo";
}

export function Tracker({ steps }: { steps: TrackerStep[] }) {
  return (
    <ol className="flex gap-1">
      {steps.map((step) => (
        <li key={step.label} className="min-w-0 flex-1">
          <span
            aria-current={step.state === "current" ? "step" : undefined}
            className="flex items-center gap-1"
          >
            <span
              aria-hidden
              className={`size-2.5 shrink-0 rounded-full ${
                step.state === "todo" ? "bg-line" : "bg-info"
              } ${step.state === "current" ? "ring-4 ring-info/20" : ""}`}
            />
            <span className={`h-0.5 w-full rounded-full ${step.state === "done" ? "bg-info" : "bg-line"}`} />
          </span>
          <p className={`mt-2 truncate text-xs ${step.state === "todo" ? "text-muted" : "font-semibold text-ink"}`}>
            {step.label}
          </p>
          {step.detail ? <p className="tabular truncate text-xs text-muted">{step.detail}</p> : null}
        </li>
      ))}
    </ol>
  );
}

/**
 * The audit trail. Backed by `historyFor` in apps/api/src/lib/audit.ts, which
 * records who decided what and why.
 *
 * Carrying the reason is the product's first principle, so `reason` renders
 * even when it is the only thing the entry has.
 */
export function Timeline({
  entries,
}: {
  entries: { at: string; title: ReactNode; actor?: string; reason?: string; tone?: "bad" | "good" }[];
}) {
  return (
    <ol className="flex flex-col gap-3">
      {entries.map((entry, index) => (
        <li key={`${entry.at}-${index}`} className="flex gap-3">
          <span
            aria-hidden
            className={`mt-1.5 size-2 shrink-0 rounded-full ${
              entry.tone === "bad" ? "bg-bad" : entry.tone === "good" ? "bg-good" : "bg-muted"
            }`}
          />
          <div className="min-w-0">
            <p className="text-sm">
              <span className="tabular font-semibold text-ink">{entry.at}</span>{" "}
              <span className="text-ink">{entry.title}</span>
            </p>
            {entry.actor ? <p className="text-xs text-muted">{entry.actor}</p> : null}
            {entry.reason ? <p className="text-xs text-muted">Reason: {entry.reason}</p> : null}
          </div>
        </li>
      ))}
    </ol>
  );
}
