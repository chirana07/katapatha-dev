"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Advisory } from "@/components/ui/states";
import { StatusPill } from "@/components/ui/status-pill";
import { markTripReady, type Release } from "../../actions";
import { groupByStop, loadOrderLabel, tallyLines, type LoadLine } from "../../dock-model";
import { canMarkReady, isReleasable, readinessDisabledReason } from "../../line-state";
import type { TripStatus } from "../../wave";
import { LineRow } from "./line-row";
import { ShortageDialog, type ModalSeed } from "./shortage-modal";

/**
 * The loading list and the two actions that finish it: report an issue, and
 * mark the vehicle ready.
 *
 * One client component holds the "checking as" name, the open dialog and the
 * release result, because all three cross rows: the dialog opens from a row or
 * from the footer, and the name belongs to the terminal, not to any line.
 * Everything else (lines, tallies, status) arrives as props from the server and
 * is refreshed by the actions' revalidation.
 */
export function LoadingWorkbench({
  tripId,
  tripLabel,
  tripContext,
  status,
  lines,
  districts,
  reasons,
  reasonsFallback,
  checkerName,
  blocked,
}: {
  tripId: string;
  tripLabel: string;
  tripContext: string;
  status: TripStatus;
  lines: LoadLine[];
  districts: Record<string, string>;
  reasons: string[];
  reasonsFallback: boolean;
  checkerName: string;
  /** The API's flag for an open shortfall holding the trip; absent, the lines decide. */
  blocked?: boolean;
}) {
  const [checkedBy, setCheckedBy] = useState(checkerName);
  const [editingName, setEditingName] = useState(false);
  const [dialog, setDialog] = useState<{ open: boolean; session: number; seed: ModalSeed | null }>({
    open: false,
    session: 0,
    seed: null,
  });

  const groups = groupByStop(lines);
  const tally = tallyLines(lines);
  const held = blocked ?? tally.awaiting > 0;
  const editable = isReleasable(status);
  // Open the stop still being worked; when every stop is checked, open the
  // first with a reported line so the loader lands on what needs a look.
  const unfinished = groups.findIndex((group) => group.state !== "done");
  const firstOpen = unfinished !== -1 ? unfinished : groups.findIndex((group) => group.tally.flagged > 0);

  function openReport(seed: ModalSeed) {
    setDialog((current) => ({ open: true, session: current.session + 1, seed }));
  }

  /** From the footer: the first unchecked line, else the first line. */
  function reportFromFooter() {
    const target = lines.find((line) => line.condition == null) ?? lines[0];
    if (!target) return;
    openReport({
      orderId: target.orderId,
      condition: "SHORT",
      loadedUnits: Math.max(target.expectedUnits - 1, 0),
    });
  }

  return (
    <div className="flex flex-col gap-4">
      {reasonsFallback ? (
        <Advisory>
          The reason list could not be loaded, so the dock is using a short built-in list. Reload once the connection is back to
          get the current one.
        </Advisory>
      ) : null}

      {editable ? (
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <p className="text-muted">
          Checking as{" "}
          {editingName ? null : <span className="font-semibold text-ink">{checkedBy || "no one yet"}</span>}
        </p>
        {editingName ? (
          <label className="flex min-w-0 flex-1 items-center gap-2">
            <span className="sr-only">Who is checking</span>
            <input
              autoFocus
              value={checkedBy}
              onChange={(event) => setCheckedBy(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") setEditingName(false);
              }}
              autoComplete="off"
              className="min-h-11 min-w-0 flex-1 rounded-control border border-line bg-surface px-3 text-ink"
            />
            <Button type="button" onClick={() => setEditingName(false)}>
              Done
            </Button>
          </label>
        ) : (
          <Button type="button" variant="ghost" onClick={() => setEditingName(true)} className="-mr-2">
            Not you? Change
          </Button>
        )}
      </div>
      ) : null}

      {editable ? (
        <p className="rounded-card border border-info/25 bg-info-surface px-3 py-2.5 text-sm text-info-ink">
          Load the last stop first &mdash; it goes deepest in the vehicle. Check each order as it goes on; report anything short,
          damaged or missing before closing the vehicle.
        </p>
      ) : (
        <p className="rounded-card border border-line bg-raised px-3 py-2.5 text-sm text-muted">
          This vehicle has been released, so the list is a record. Checks can no longer be changed here.
        </p>
      )}

      {editable && held ? (
        <p className="rounded-card border border-warn/30 bg-warn-surface px-3 py-2.5 text-sm text-ink">
          <span className="font-semibold">Waiting on the dispatcher.</span>{" "}
          {tally.awaiting === 1 ? "One reported order" : tally.awaiting > 1 ? `${tally.awaiting} reported orders` : "A reported order"}{" "}
          still holds this vehicle. They decide in Exceptions; you can keep loading the rest, and the release opens once they
          have.
        </p>
      ) : null}

      <ol className="flex flex-col gap-3">
        {groups.map((group, index) => {
          const done = group.state === "done";
          const reported = group.tally.awaiting > 0;
          const stateLabel = reported ? "Waiting" : done ? "Loaded" : group.state === "partial" ? "In progress" : "Not started";
          const stateTone = reported ? "warn" : done ? "good" : group.state === "partial" ? "info" : "neutral";
          return (
            <li key={group.seq}>
              <details open={index === firstOpen} className="group rounded-card border border-line bg-surface">
                <summary className="flex min-h-14 cursor-pointer list-none items-center gap-3 px-3 py-2 [&::-webkit-details-marker]:hidden">
                  <span
                    aria-hidden
                    className={`tabular grid size-8 shrink-0 place-items-center rounded-full text-sm font-bold text-white ${
                      reported ? "bg-warn" : done ? "bg-good" : group.state === "partial" ? "bg-info" : "bg-rail"
                    }`}
                  >
                    {group.loadOrder}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold text-ink">
                      Stop {group.seq + 1} · {group.outletId}
                      {districts[group.outletId] ? ` · ${districts[group.outletId]}` : ""}
                    </span>
                    <span className="block text-sm text-muted">
                      {loadOrderLabel(group.loadOrder, groups.length)} · {group.tally.lines}{" "}
                      {group.tally.lines === 1 ? "order" : "orders"} · {group.tally.expectedUnits} units
                    </span>
                  </span>
                  <span className="shrink-0 text-right">
                    <StatusPill label={stateLabel} tone={stateTone} />
                    <span className="tabular mt-1 block text-sm text-muted">
                      {group.tally.loadedUnits} / {group.tally.expectedUnits}
                    </span>
                  </span>
                  <span aria-hidden className="text-muted transition-transform group-open:rotate-180">
                    &#9662;
                  </span>
                </summary>
                <ul className="border-t border-line">
                  {group.lines.map((line) => (
                    <LineRow
                      key={`${line.orderId}:${line.condition}:${line.loadedUnits}`}
                      tripId={tripId}
                      line={line}
                      editable={editable}
                      checkedBy={checkedBy}
                      onReport={openReport}
                    />
                  ))}
                </ul>
              </details>
            </li>
          );
        })}
      </ol>

      <ReleaseBar
        tripId={tripId}
        status={status}
        total={tally.lines}
        checked={tally.checked}
        flagged={tally.flagged}
        blocked={held}
        onReport={reportFromFooter}
      />

      {dialog.seed ? (
        <ShortageDialog
          key={dialog.session}
          open={dialog.open}
          onClose={() => setDialog((current) => ({ ...current, open: false }))}
          tripId={tripId}
          tripLabel={tripLabel}
          tripContext={tripContext}
          lines={lines}
          districts={districts}
          reasons={reasons}
          seed={dialog.seed}
          checkedBy={checkedBy}
          onCheckedBy={setCheckedBy}
        />
      ) : null}
    </div>
  );
}

function ReleaseBar({
  tripId,
  status,
  total,
  checked,
  flagged,
  blocked,
  onReport,
}: {
  tripId: string;
  status: TripStatus;
  total: number;
  checked: number;
  flagged: number;
  blocked: boolean;
  onReport: () => void;
}) {
  const [result, setResult] = useState<Release | null>(null);
  const [pending, start] = useTransition();
  const context = { total, checked, flagged, blocked, status };
  const router = useRouter();
  const ready = canMarkReady(context);
  const reason = readinessDisabledReason(context);

  function release() {
    start(async () => {
      setResult(await markTripReady(tripId));
    });
  }

  if (!isReleasable(status)) {
    return result?.ok ? (
      <p role="status" className="rounded-card border border-good/25 bg-good-surface px-3 py-2.5 text-sm font-semibold text-good-ink">
        Vehicle marked ready.
      </p>
    ) : null;
  }

  return (
    <div className="sticky bottom-0 -mx-4 -mb-4 flex flex-col gap-3 border-t border-line bg-raised p-4">
      {result && !result.ok ? <ReleaseNote result={result} /> : null}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" onClick={onReport} className="flex-1 sm:flex-none">
          <span aria-hidden>&#9888;</span>
          Report issue
        </Button>
        <Button type="button" variant="primary" disabled={!ready || pending} onClick={release} className="flex-[2] sm:flex-none">
          <span aria-hidden>&#10003;</span>
          {pending ? "Checking…" : "Mark loading complete"}
        </Button>
      </div>
      {!ready ? (
        <div className="flex flex-wrap items-center gap-x-3">
          <p role="status" className="text-sm text-muted">
            {reason}
          </p>
          {blocked && isReleasable(status) && total > 0 && checked === total ? (
            <Button type="button" variant="ghost" onClick={() => router.refresh()}>
              Check again
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function ReleaseNote({ result }: { result: Exclude<Release, { ok: true }> }) {
  if ("blocked" in result) {
    const { code, message, count } = result.blocked;
    if (code === "SHORTFALL_BLOCKING") {
      return (
        <div role="alert" className="rounded-card border border-warn/30 bg-warn-surface px-3 py-2.5 text-sm">
          <p className="font-semibold text-warn-ink">Waiting on the dispatcher</p>
          <p className="mt-0.5 text-ink">
            {count === 1 ? "A reported shortage still holds" : count ? `${count} reported shortages still hold` : "A reported shortage still holds"}{" "}
            this vehicle. The dispatcher decides in Exceptions &mdash; send it short, hold the order, cancel the line or move it to
            trip 2. When they have, press Mark loading complete again.
          </p>
        </div>
      );
    }
    return (
      <div role="alert" className="rounded-card border border-warn/30 bg-warn-surface px-3 py-2.5 text-sm">
        <p className="font-semibold text-warn-ink">Not released yet</p>
        <p className="mt-0.5 text-ink">{message}</p>
      </div>
    );
  }
  return (
    <div role="alert" className="rounded-card border border-bad/25 bg-bad-surface px-3 py-2.5 text-sm">
      <p className="font-semibold text-bad-ink">{result.title}</p>
      <p className="mt-0.5 text-ink">{result.detail}</p>
      {result.outcome === "unknown" ? <p className="mt-0.5 text-muted">Reload the dock to see whether it went through.</p> : null}
    </div>
  );
}
