import Link from "next/link";
import type { components } from "@katapatha/contracts/types";
import { Facts, PanelSection } from "@/components/ui/detail-panel";
import { StatusPill } from "@/components/ui/status-pill";
import { Timeline } from "@/components/ui/stepper";
import { clockTime } from "@/lib/format";
import { CATEGORY_LABEL, decidedAs, reportedByLine, severityLabel, severityTone, unitsLabel, type ExceptionRow } from "./model";

type Activity = components["schemas"]["ExceptionActivityEvent"];

/** Pills, title, and the lines that say what and where. */
export function PanelHead({ row, backHref }: { row: ExceptionRow; backHref: string }) {
  const reported = reportedByLine(row.reportedBy);
  return (
    <div>
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <StatusPill label={severityLabel(row.severity)} tone={severityTone(row.severity)} />
          <StatusPill label={CATEGORY_LABEL[row.category]} tone="neutral" dot={false} />
        </div>
        {/* On a phone the panel follows the list; this is the way back up. */}
        <Link href={backHref} aria-label="Close and return to the list" className="grid size-9 shrink-0 place-items-center rounded-control text-muted hover:bg-raised hover:text-ink lg:hidden">
          <span aria-hidden>&times;</span>
        </Link>
      </div>
      <h2 className="mt-3 text-xl font-bold tracking-tight text-ink">{row.title}</h2>
      <p className="mt-1 text-sm text-muted">{row.subtitle}</p>
      {row.detail ? <p className="mt-1 text-sm text-ink/80">{row.detail}</p> : null}
      {reported ? <p className="mt-1 text-xs text-muted">{reported}</p> : null}
    </div>
  );
}

/**
 * The figures. A shortfall carries loaded / expected / short; everything else
 * shows what is known about the trip. Dock stock from the design is left out:
 * the system has no stock model to back it.
 */
export function PanelFacts({ row }: { row: ExceptionRow }) {
  if (row.quantities) {
    return (
      <PanelSection title="Quantities">
        <Facts
          items={[
            { label: "Loaded", value: `${row.quantities.loaded} / ${row.quantities.expected}` },
            { label: "Short", value: unitsLabel(row.quantities.short), tone: "bad" },
            { label: "Departs", value: row.departsAt ?? "—" },
          ]}
        />
        {row.orderRefs.length ? (
          <p className="mt-2 text-sm text-muted">
            {row.orderRefs.length === 1 ? "Order" : "Orders"} <span className="font-semibold text-ink">{row.orderRefs.join(", ")}</span>
            {row.vehicleId ? ` on ${row.vehicleId}` : ""}
          </p>
        ) : null}
      </PanelSection>
    );
  }
  const items = [
    { label: "Vehicle", value: row.vehicleId ?? "—" },
    { label: "Departs", value: row.departsAt ?? "—" },
    { label: "Raised", value: clockTime(row.raisedAt) },
  ];
  return (
    <PanelSection title="Where it stands">
      <Facts items={items} />
      {row.orderRefs.length ? (
        <p className="mt-2 text-sm text-muted">
          {row.orderRefs.length === 1 ? "Order" : "Orders"} <span className="font-semibold text-ink">{row.orderRefs.join(", ")}</span>
        </p>
      ) : null}
    </PanelSection>
  );
}

export function AffectedOutlets({ outlets }: { outlets: ExceptionRow["affectedOutlets"] }) {
  if (outlets.length === 0) return null;
  return (
    <PanelSection title="Affected outlets">
      <ul className="divide-y divide-line">
        {outlets.map((outlet) => (
          <li key={`${outlet.outletId}-${outlet.stopSeq}`} className="flex items-center justify-between gap-3 py-2">
            <div className="min-w-0">
              <p className="font-semibold text-ink">
                {outlet.outletId}
                {outlet.outletName ? ` · ${outlet.outletName}` : ""}
              </p>
              <p className="text-xs text-muted">
                {[outlet.stopSeq !== null ? `Stop ${outlet.stopSeq}` : null, outlet.ordered !== null ? `ordered ${outlet.ordered}` : null]
                  .filter(Boolean)
                  .join(" · ") || "Not on a stop yet"}
              </p>
            </div>
            {outlet.delta !== null ? (
              <span className="tabular shrink-0 text-lg font-bold text-bad-ink" aria-label={`${Math.abs(outlet.delta)} short`}>
                {outlet.delta < 0 ? `−${Math.abs(outlet.delta)}` : `+${outlet.delta}`}
              </span>
            ) : null}
          </li>
        ))}
      </ul>
    </PanelSection>
  );
}

/** Where the exception stands when there is nothing to choose: decided, acknowledged, or not decidable here. */
export function Standing({ row, planningHref }: { row: ExceptionRow; planningHref: string }) {
  if (row.status === "resolved") {
    return (
      <PanelSection title="Resolution">
        <div className="rounded-card border border-good/25 bg-good-surface p-3 text-sm">
          <p className="font-semibold text-good-ink">
            {row.resolution?.decision ? `Decided to ${decidedAs(row.resolution.decision)}` : "Resolved"}
            {row.resolution?.byName ? ` by ${row.resolution.byName}` : ""}
            {row.resolution?.at ? ` at ${clockTime(row.resolution.at)}` : ""}
          </p>
          {row.resolution?.note ? <p className="mt-1 text-ink">{row.resolution.note}</p> : null}
        </div>
      </PanelSection>
    );
  }
  if (row.kind === "PLANNING") {
    return (
      <PanelSection title="Decision">
        <p className="rounded-card border border-line bg-raised p-3 text-sm text-muted">
          A planning item is cleared by changing the plan, not by a decision here.{" "}
          <Link href={planningHref} className="font-semibold text-link hover:underline">
            Open planning
          </Link>
          .
        </p>
      </PanelSection>
    );
  }
  if (row.acknowledgement) {
    return (
      <PanelSection title="Decision">
        <p className="rounded-card border border-line bg-raised p-3 text-sm text-muted">
          Acknowledged by {row.acknowledgement.byName} at {clockTime(row.acknowledgement.at)}. It stays open until the condition clears.
        </p>
      </PanelSection>
    );
  }
  return null;
}

const GOOD = /resolve|decid|send_short|hold|cancel|move/i;

export function ActivityList({ events }: { events: Activity[] }) {
  if (events.length === 0) return null;
  return (
    <PanelSection title="Activity">
      <Timeline
        entries={events.map((event) => ({
          at: clockTime(event.at),
          title: event.summary,
          reason: event.note ?? undefined,
          tone: /raise|flag/i.test(event.action) ? "bad" : GOOD.test(event.action) ? "good" : undefined,
        }))}
      />
    </PanelSection>
  );
}
