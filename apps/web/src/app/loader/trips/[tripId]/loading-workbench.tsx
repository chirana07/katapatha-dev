"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Advisory } from "@/components/ui/states";
import { markTripReady, recordLoadCheck, saveLoadProgress, type Release } from "../../actions";
import { groupByStop, loadOrderLabel, tallyLines, type LoadLine, type StopGroup } from "../../dock-model";
import Link from "next/link";
import { AlertIcon, BoxIcon, CheckIcon, ChevronDownIcon, ChevronUpIcon, DocumentIcon, InfoIcon } from "../../icons";
import { NumberDisc } from "../../dock-ui";
import { isReleasable, shortfallState } from "../../line-state";
import {
  apiItemCounts,
  initialCounts,
  itemsOf,
  packOf,
  productsOnTrip,
  shortName,
  sumCounts,
  type Counts,
} from "../../load-items";
import { newUuid } from "../../shortage";
import type { TripStatus } from "../../wave";
import { ItemStepper } from "./item-stepper";
import { ReportDialog, type ReportSeed } from "./shortage-modal";

/**
 * L-02's loading list (in the panel beside the queue) and L-08's (the phone's
 * second screen): the stops in loading order, each item with a stepper, and
 * the two actions that finish the vehicle.
 *
 * Counting is saved as it happens — a count in progress, debounced, so every
 * other dock screen sees the vehicle fill up — but it is never a check. The
 * checks land on "Mark loading complete", one per order, with the item counts
 * they were made of; a short item goes through "Report issue" instead, which
 * is the load check with a non-OK condition. The server's ready gate is still
 * the gate: every order checked, nothing waiting on the dispatcher.
 */

const SAVE_DELAY_MS = 700;

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
  dispatcherName,
  refrigerated,
  layout = "panel",
  initialReport,
  vehicleHref,
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
  /** The API's flag for an open shortfall holding the trip. */
  blocked?: boolean;
  dispatcherName: string | null;
  refrigerated: boolean;
  /** "panel" beside the queue; "page" for the full loading-list screen. */
  layout?: "panel" | "page";
  /** Open the report dialog on arrival (from "Report issue" or "Recheck"). */
  initialReport?: "issue" | "chiller";
  /** The phone footer's "Vehicle info" (L-08). */
  vehicleHref?: string;
}) {
  const router = useRouter();
  const [checkedBy, setCheckedBy] = useState(checkerName);
  const [editingName, setEditingName] = useState(false);
  const [view, setView] = useState<"stop" | "category">("stop");
  const [local, setLocal] = useState<Record<string, Counts>>(() =>
    Object.fromEntries(lines.map((line) => [line.orderId, initialCounts(line)])),
  );
  const [saving, setSaving] = useState<Set<string>>(new Set());
  const [saveError, setSaveError] = useState<string | null>(null);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const inflight = useRef(new Map<string, Promise<unknown>>());
  // Arriving from "Report issue" or "Recheck" opens the dialog straight away.
  const [dialog, setDialog] = useState<{ open: boolean; session: number; seed: ReportSeed | null }>(() => {
    const seed =
      !initialReport || !isReleasable(status)
        ? null
        : initialReport === "chiller" && refrigerated && lines[0]
          ? ({ orderId: lines[0].orderId, key: itemsOf(lines[0])[0]!.key, kind: "CHILLER" } as const)
          : firstShortSeed(lines, Object.fromEntries(lines.map((line) => [line.orderId, initialCounts(line)])));
    return { open: seed != null, session: seed ? 1 : 0, seed };
  });
  const [result, setResult] = useState<Release | null>(null);
  const [completeError, setCompleteError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const editable = isReleasable(status);
  const isChecked = (line: LoadLine) => line.condition != null && line.loadedUnits != null;
  // A checked line shows what its check said; an unchecked one, what is being
  // counted here (falling back to the server's count in progress).
  const countsFor = useCallback(
    (line: LoadLine): Counts => (isChecked(line) ? initialCounts(line) : (local[line.orderId] ?? initialCounts(line))),
    [local],
  );
  const counts: Record<string, Counts> = Object.fromEntries(lines.map((line) => [line.orderId, countsFor(line)]));

  useEffect(() => {
    const pendingTimers = timers.current;
    return () => {
      for (const timer of pendingTimers.values()) clearTimeout(timer);
    };
  }, []);

  function persist(line: LoadLine, next: Counts) {
    const run = saveLoadProgress({
      tripId,
      orderId: line.orderId,
      loadedUnits: sumCounts(next),
      itemCounts: apiItemCounts(next),
      updatedByName: checkedBy,
    }).then((saved) => {
      setSaving((current) => {
        const copy = new Set(current);
        copy.delete(line.orderId);
        return copy;
      });
      if (!saved.ok) setSaveError(saved.detail);
      else setSaveError(null);
      inflight.current.delete(line.orderId);
    });
    inflight.current.set(line.orderId, run);
    return run;
  }

  function setCount(line: LoadLine, key: string, value: number) {
    const next = { ...countsFor(line), [key]: value };
    setLocal((current) => ({ ...current, [line.orderId]: next }));
    setSaving((current) => new Set(current).add(line.orderId));
    const existing = timers.current.get(line.orderId);
    if (existing) clearTimeout(existing);
    timers.current.set(
      line.orderId,
      setTimeout(() => {
        timers.current.delete(line.orderId);
        void persist(line, next);
      }, SAVE_DELAY_MS),
    );
  }

  /** Sends every count still waiting on its timer, and waits for all of them. */
  async function flush() {
    for (const [orderId, timer] of timers.current) {
      clearTimeout(timer);
      timers.current.delete(orderId);
      const line = lines.find((candidate) => candidate.orderId === orderId);
      if (line) void persist(line, countsFor(line));
    }
    await Promise.all(inflight.current.values());
  }

  const groups = groupByStop(lines);
  const tally = tallyLines(lines);
  const held = blocked ?? tally.awaiting > 0;
  const unchecked = lines.filter((line) => !isChecked(line));
  const onBoard = lines.reduce((sum, line) => sum + sumCounts(counts[line.orderId] ?? {}), 0);
  const unitsLeft = unchecked.reduce((sum, line) => sum + Math.max(0, line.expectedUnits - sumCounts(counts[line.orderId] ?? {})), 0);
  const firstOpen = (() => {
    const unfinished = groups.findIndex((group) => group.lines.some((line) => !isChecked(line)));
    return unfinished !== -1 ? unfinished : groups.findIndex((group) => group.tally.flagged > 0);
  })();
  const [open, setOpen] = useState<Set<number>>(() => new Set(firstOpen >= 0 ? [groups[firstOpen]!.seq] : []));
  const toggle = (seq: number) =>
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(seq)) next.delete(seq);
      else next.add(seq);
      return next;
    });

  function openReport(seed: ReportSeed) {
    setDialog((current) => ({ open: true, session: current.session + 1, seed }));
  }

  /** The footer's Report issue: the first item still short, else the first item. */
  function reportFromFooter() {
    const seed = firstShortSeed(lines, counts);
    if (seed) openReport(seed);
  }

  function complete() {
    setCompleteError(null);
    start(async () => {
      await flush();
      // Every unchecked order is fully counted (the button is disabled
      // otherwise), so each gets its check: loaded correctly, with its items.
      for (const line of lines) {
        if (isChecked(line)) continue;
        const c = counts[line.orderId] ?? {};
        const saved = await recordLoadCheck({
          tripId,
          orderId: line.orderId,
          expectedUnits: line.expectedUnits,
          loadedUnits: sumCounts(c),
          condition: "OK",
          checkedByName: checkedBy,
          reasonCode: null,
          clientRequestId: newUuid(),
          itemCounts: apiItemCounts(c),
        });
        if (!saved.ok) {
          setCompleteError(`${line.orderRef}: ${saved.detail}`);
          router.refresh();
          return;
        }
      }
      setResult(await markTripReady(tripId));
    });
  }

  const busy = pending || saving.size > 0;
  const ready = editable && unitsLeft === 0 && !held && lines.length > 0;
  const reason = !editable
    ? null
    : lines.length === 0
      ? "No orders on this trip."
      : unitsLeft > 0
        ? `${unitsLeft} units left to load`
        : held
          ? "Waiting on the dispatcher: a reported issue still holds this vehicle."
          : null;

  return (
    <div className="flex flex-col gap-3">
      {reasonsFallback ? (
        <Advisory>The reason list could not be loaded, so the dock is using a short built-in list.</Advisory>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-[17px] font-bold text-[#111827]">
          Planned items{" "}
          <span className="text-sm font-normal text-muted">
            ({tally.lines} {tally.lines === 1 ? "order" : "orders"} · {tally.expectedUnits} units)
          </span>
        </h3>
        <div role="group" aria-label="Group the list" className="inline-flex rounded-[6px] border border-[#e5e7eb] p-0.5 text-[13px]">
          {(["stop", "category"] as const).map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={view === option}
              onClick={() => setView(option)}
              className={`min-h-8 rounded-[5px] px-2.5 font-medium ${view === option ? "bg-[#fff8e6] text-[#111827]" : "text-[#374151] hover:bg-raised"}`}
            >
              {option === "stop" ? "By stop" : "By category"}
            </button>
          ))}
        </div>
      </div>

      {editable ? (
        <div className="flex flex-wrap items-center justify-between gap-2 text-[13px]">
          <p className="text-muted">
            Loading as {editingName ? null : <span className="font-semibold text-ink">{checkedBy || "no one yet"}</span>}
            {saving.size > 0 ? <span className="ml-2 text-muted">· Saving…</span> : null}
          </p>
          {editingName ? (
            <label className="flex min-w-0 flex-1 items-center gap-2">
              <span className="sr-only">Who is loading</span>
              <input
                autoFocus
                value={checkedBy}
                onChange={(event) => setCheckedBy(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") setEditingName(false);
                }}
                autoComplete="off"
                className="min-h-10 min-w-0 flex-1 rounded-control border border-line bg-surface px-3 text-ink"
              />
              <Button type="button" onClick={() => setEditingName(false)}>
                Done
              </Button>
            </label>
          ) : (
            <button type="button" onClick={() => setEditingName(true)} className="min-h-10 font-semibold text-link">
              Not you? Change
            </button>
          )}
        </div>
      ) : (
        <p className="rounded-[10px] border border-line bg-raised px-3 py-2.5 text-sm text-muted">
          This vehicle has been sealed, so the list is a record. Counts can no longer be changed here.
        </p>
      )}

      {editable && held ? (
        <p className="rounded-[10px] border border-warn/30 bg-warn-surface px-3 py-2.5 text-[13px] text-ink">
          <span className="font-semibold">Waiting on the dispatcher.</span> A reported issue holds this vehicle until{" "}
          {dispatcherName ?? "the dispatcher"} decides. Keep loading the rest meanwhile.
        </p>
      ) : null}

      {saveError ? (
        <p role="alert" className="rounded-[10px] border border-bad/25 bg-bad-surface px-3 py-2 text-[13px] text-bad-ink">
          {saveError}
        </p>
      ) : null}

      {view === "category" ? (
        <CategoryView lines={lines} counts={counts} />
      ) : (
        <ol className="flex flex-col gap-2.5">
          {groups.map((group) => (
            <li key={group.seq}>
              <StopCard
                group={group}
                stops={groups.length}
                districts={districts}
                counts={counts}
                open={open.has(group.seq)}
                onToggle={() => toggle(group.seq)}
                editable={editable}
                isChecked={isChecked}
                onCount={setCount}
                onReport={openReport}
                layout={layout}
              />
            </li>
          ))}
        </ol>
      )}

      {editable ? (
        <div className="flex items-start gap-2.5 rounded-[10px] bg-raised px-3 py-2.5 text-[12.5px] text-muted">
          <InfoIcon className="mt-0.5 size-4 shrink-0" />
          <p>Load items for the last stop first. Check for damaged or missing items before closing the vehicle.</p>
        </div>
      ) : null}

      {result && !result.ok ? <ReleaseNote result={result} /> : null}
      {result?.ok ? (
        <p role="status" className="rounded-[10px] border border-good/25 bg-good-surface px-3 py-2.5 text-sm font-semibold text-good-ink">
          Vehicle sealed and marked ready.
        </p>
      ) : null}
      {completeError ? (
        <p role="alert" className="rounded-[10px] border border-bad/25 bg-bad-surface px-3 py-2.5 text-sm text-bad-ink">
          {completeError}
        </p>
      ) : null}

      {editable ? (
        <div
          className={
            layout === "page"
              ? "sticky bottom-0 -mx-4 flex flex-col gap-2 border-t border-[#e5e7eb] bg-[#fafafa] p-4"
              : "sticky bottom-0 -mx-4 -mb-4 flex flex-col gap-2 border-t border-[#e5e7eb] bg-surface p-4"
          }
        >
          {layout === "page" ? (
            // L-08: two quiet buttons over one full-width primary.
            <div className="flex flex-col gap-2 lg:flex-row lg:gap-3">
              <div className="grid grid-cols-2 gap-2 lg:flex lg:gap-3">
                <Button type="button" onClick={reportFromFooter} className="lg:px-6">
                  <AlertIcon className="size-4.5" />
                  Report issue
                </Button>
                {vehicleHref ? (
                  <Link
                    href={vehicleHref}
                    className="inline-flex min-h-11 items-center justify-center gap-2 rounded-control border border-line bg-surface px-4 text-sm font-semibold text-ink hover:bg-raised lg:hidden"
                  >
                    <DocumentIcon className="size-4.5" />
                    Vehicle info
                  </Link>
                ) : null}
              </div>
              <Button type="button" variant="primary" disabled={!ready || busy} onClick={complete} className="w-full lg:w-auto lg:px-7">
                {unitsLeft === 0 ? <CheckIcon className="size-5" /> : null}
                {pending ? "Sealing…" : unitsLeft > 0 ? `${unitsLeft} units left to load` : "Mark loading complete"}
              </Button>
            </div>
          ) : (
            <div className="flex gap-3">
              <Button type="button" onClick={reportFromFooter} className="flex-1 sm:flex-none sm:px-6">
                <AlertIcon className="size-5" />
                Report issue
              </Button>
              <Button type="button" variant="primary" disabled={!ready || busy} onClick={complete} className="flex-[1.6] sm:px-7">
                <CheckIcon className="size-5" />
                {pending ? "Sealing…" : "Mark loading complete"}
              </Button>
            </div>
          )}
          {reason && !(layout === "page" && unitsLeft > 0) ? (
            <div className="flex flex-wrap items-center gap-x-3">
              <p role="status" className="text-[12.5px] text-muted">
                {reason}
              </p>
              {held && unitsLeft === 0 ? (
                <button type="button" onClick={() => router.refresh()} className="min-h-9 text-[12.5px] font-semibold text-link">
                  Check again
                </button>
              ) : null}
            </div>
          ) : null}
          <span className="sr-only" aria-live="polite">
            {onBoard} units on board
          </span>
        </div>
      ) : null}

      {dialog.seed ? (
        <ReportDialog
          key={dialog.session}
          open={dialog.open}
          onClose={() => setDialog((current) => ({ ...current, open: false }))}
          tripId={tripId}
          tripLabel={tripLabel}
          tripContext={tripContext}
          lines={lines}
          counts={counts}
          districts={districts}
          reasons={reasons}
          seed={dialog.seed}
          checkedBy={checkedBy}
          dispatcherName={dispatcherName}
          refrigerated={refrigerated}
          onSent={() => router.refresh()}
        />
      ) : null}
    </div>
  );
}

/** Where "Report issue" starts: the first unchecked item not fully loaded, else
 *  the first item on the list. */
function firstShortSeed(lines: LoadLine[], counts: Record<string, Counts>): ReportSeed | null {
  for (const line of lines) {
    if (line.condition != null) continue;
    const c = counts[line.orderId] ?? {};
    const short = itemsOf(line).find((item) => (c[item.key] ?? 0) < item.quantity);
    if (short) return { orderId: line.orderId, key: short.key, kind: "SHORT" };
  }
  const first = lines[0];
  return first ? { orderId: first.orderId, key: itemsOf(first)[0]!.key, kind: "SHORT" } : null;
}

function StopCard({
  group,
  stops,
  districts,
  counts,
  open,
  onToggle,
  editable,
  isChecked,
  onCount,
  onReport,
  layout,
}: {
  group: StopGroup;
  stops: number;
  districts: Record<string, string>;
  counts: Record<string, Counts>;
  open: boolean;
  onToggle: () => void;
  editable: boolean;
  isChecked: (line: LoadLine) => boolean;
  onCount: (line: LoadLine, key: string, value: number) => void;
  onReport: (seed: ReportSeed) => void;
  layout: "panel" | "page";
}) {
  const required = group.lines.reduce((sum, line) => sum + line.expectedUnits, 0);
  const loaded = group.lines.reduce((sum, line) => sum + sumCounts(counts[line.orderId] ?? {}), 0);
  const items = group.lines.reduce((sum, line) => sum + itemsOf(line).length, 0);
  const waiting = group.lines.some((line) => shortfallState(line) === "waiting");
  const reported = group.lines.some((line) => line.condition != null && line.condition !== "OK");
  const allChecked = group.lines.every(isChecked);
  const state = waiting ? "waiting" : allChecked ? (reported ? "reported" : "done") : loaded > 0 ? "progress" : "idle";
  const disc = state === "done" ? "green" : state === "waiting" || state === "reported" ? "amber" : state === "progress" ? "blue" : "night";
  const district = districts[group.outletId];
  const first = group.loadOrder === 1 && stops > 1;

  return (
    <div className={`overflow-hidden rounded-[12px] border bg-surface ${state === "progress" && open ? "border-[1.5px] border-link" : "border-[#e5e7eb]"}`}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex min-h-14 w-full items-center gap-2.5 px-3 py-2.5 text-left"
      >
        <NumberDisc n={group.loadOrder} tone={disc} size="md" />
        <span className="min-w-0 flex-1">
          <span className="block text-[14.5px] font-semibold leading-snug text-[#111827]">
            Stop {group.seq + 1} · {group.outletId}
            {first ? <span className="font-medium text-link"> · Last stop (load first)</span> : null}
          </span>
          <span className="block truncate text-[12.5px] text-muted">
            {loadOrderLabel(group.loadOrder, stops)} · {items} {items === 1 ? "item" : "items"} · {required} units
            {district ? ` · ${district}` : ""}
          </span>
        </span>
        <span className="shrink-0 text-right">
          <StopState state={state} />
          <span className="tabular block text-[12.5px] text-[#374151]">
            {loaded} / {required}
          </span>
        </span>
        <span aria-hidden className="text-[#374151]">
          {open ? <ChevronUpIcon className="size-4" /> : <ChevronDownIcon className="size-4" />}
        </span>
      </button>

      {open ? (
        <div className="border-t border-[#f0f0f0]">
          {group.lines.map((line) => (
            <OrderItems
              key={line.orderId}
              line={line}
              counts={counts[line.orderId] ?? {}}
              editable={editable && !isChecked(line)}
              showRef={group.lines.length > 1 || layout === "page"}
              onCount={(key, value) => onCount(line, key, value)}
              onReport={onReport}
              layout={layout}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function StopState({ state }: { state: "done" | "progress" | "idle" | "waiting" | "reported" }) {
  if (state === "done")
    return (
      <span className="inline-flex items-center gap-1 text-[12.5px] font-medium text-good">
        <CheckIcon className="size-3.5" /> Loaded
      </span>
    );
  if (state === "waiting") return <span className="text-[12.5px] font-medium text-warn-ink">Waiting on dispatcher</span>;
  if (state === "reported") return <span className="text-[12.5px] font-medium text-warn-ink">Reported</span>;
  if (state === "progress")
    return (
      <span className="inline-flex items-center gap-1 text-[12.5px] font-medium text-link">
        <span aria-hidden className="size-2.5 rounded-full border-2 border-link" /> In progress
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1 text-[12.5px] font-medium text-[#374151]">
      <span aria-hidden className="size-2 rounded-full bg-muted" /> Not started
    </span>
  );
}

function OrderItems({
  line,
  counts,
  editable,
  showRef,
  onCount,
  onReport,
  layout,
}: {
  line: LoadLine;
  counts: Counts;
  editable: boolean;
  showRef: boolean;
  onCount: (key: string, value: number) => void;
  onReport: (seed: ReportSeed) => void;
  layout: "panel" | "page";
}) {
  const items = itemsOf(line);
  const held = shortfallState(line);
  const note =
    line.condition && line.condition !== "OK"
      ? held === "waiting"
        ? "Reported · waiting on the dispatcher"
        : held === "cleared"
          ? "Reported · the dispatcher has decided"
          : "Reported to the dispatcher"
      : line.condition === "OK"
        ? "Checked"
        : null;

  return (
    <div className="border-b border-[#f0f0f0] last:border-b-0">
      {showRef || note ? (
        <div className="flex items-center justify-between gap-2 bg-[#f9fafb] px-3 py-1.5 text-[12px]">
          <span className="font-semibold text-[#374151]">{line.orderRef}</span>
          {note ? <span className={held === "waiting" ? "font-medium text-warn-ink" : "text-muted"}>{note}</span> : null}
        </div>
      ) : null}

      {/* The table on a wide panel, cards on a phone (L-02 / L-08). */}
      <table className={`w-full text-[13px] ${layout === "page" ? "hidden md:table" : ""}`}>
        <thead>
          <tr className="text-left text-[12.5px] text-[#374151]">
            <th className="px-3 py-1.5 font-medium">Item</th>
            <th className="px-1 py-1.5 font-medium">Pack size</th>
            <th className="px-1 py-1.5 text-right font-medium">Required</th>
            <th className="px-3 py-1.5 text-center font-medium">Loaded</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.key} className="border-t border-[#f0f0f0]">
              <td className="px-3 py-1.5">
                <span className="flex items-center gap-2">
                  <span aria-hidden className="grid size-7 shrink-0 place-items-center rounded-[6px] bg-[#fff8e6] text-warn">
                    <BoxIcon className="size-4" />
                  </span>
                  <span className="min-w-0 text-[#111827]">
                    {shortName(item.name)}
                    {item.sku ? <span className="text-muted"> ({item.sku})</span> : null}
                  </span>
                </span>
              </td>
              <td className="px-1 py-1.5 text-[#374151]">{packOf(item)}</td>
              <td className="tabular px-1 py-1.5 text-right text-[#374151]">{item.quantity}</td>
              <td className="px-3 py-1.5 text-center">
                <ItemStepper
                  value={counts[item.key] ?? 0}
                  max={item.quantity}
                  onChange={(value) => onCount(item.key, value)}
                  label={`${shortName(item.name)} loaded for ${line.orderRef}`}
                  disabled={!editable}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {layout === "page" ? (
        <ul className="md:hidden">
          {items.map((item) => {
            const n = counts[item.key] ?? 0;
            return (
              <li key={item.key} className="flex items-center gap-2 border-t border-[#f0f0f0] px-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="text-[13.5px] font-semibold text-[#111827]">{shortName(item.name)}</p>
                  <p className={`text-[12px] ${n >= item.quantity ? "text-good" : "text-muted"}`}>need {item.quantity}</p>
                </div>
                <ItemStepper
                  size="lg"
                  value={n}
                  max={item.quantity}
                  onChange={(value) => onCount(item.key, value)}
                  label={`${shortName(item.name)} loaded for ${line.orderRef}`}
                  disabled={!editable}
                />
              </li>
            );
          })}
        </ul>
      ) : null}

      {editable && items.some((item) => (counts[item.key] ?? 0) < item.quantity) && sumCounts(counts) > 0 ? (
        <div className="flex justify-end px-3 pb-2">
          <button
            type="button"
            onClick={() => {
              const short = items.find((item) => (counts[item.key] ?? 0) < item.quantity)!;
              onReport({ orderId: line.orderId, key: short.key, kind: "SHORT" });
            }}
            className="min-h-9 text-[12.5px] font-semibold text-bad-ink"
          >
            Can&rsquo;t load it all? Report it
          </button>
        </div>
      ) : null}
    </div>
  );
}

function CategoryView({ lines, counts }: { lines: LoadLine[]; counts: Record<string, Counts> }) {
  const products = productsOnTrip(lines, counts);
  return (
    <div className="overflow-hidden rounded-[12px] border border-[#e5e7eb] bg-surface">
      <table className="w-full text-[13px]">
        <thead className="bg-[#f9fafb]">
          <tr className="text-left text-[12.5px] text-[#374151]">
            <th className="px-3 py-2 font-medium">Item</th>
            <th className="px-1 py-2 font-medium">Stops</th>
            <th className="px-1 py-2 text-right font-medium">Required</th>
            <th className="px-3 py-2 text-right font-medium">Loaded</th>
          </tr>
        </thead>
        <tbody>
          {products.map((product) => (
            <tr key={product.key} className="border-t border-[#f0f0f0]">
              <td className="px-3 py-2 text-[#111827]">
                {shortName(product.name)}
                {product.sku ? <span className="text-muted"> ({product.sku})</span> : null}
                <span className="block text-[12px] text-muted">{product.unitLabel}</span>
              </td>
              <td className="px-1 py-2 text-[#374151]">{[...new Set(product.orders.map((o) => o.seq + 1))].join(", ")}</td>
              <td className="tabular px-1 py-2 text-right text-[#374151]">{product.required}</td>
              <td className={`tabular px-3 py-2 text-right font-semibold ${product.loaded >= product.required ? "text-good" : "text-[#111827]"}`}>
                {product.loaded}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="border-t border-[#f0f0f0] px-3 py-2 text-[12px] text-muted">Totals across every stop. Count by stop to load.</p>
    </div>
  );
}

function ReleaseNote({ result }: { result: Exclude<Release, { ok: true }> }) {
  if ("blocked" in result) {
    const { code, message } = result.blocked;
    return (
      <div role="alert" className="rounded-[10px] border border-warn/30 bg-warn-surface px-3 py-2.5 text-sm">
        <p className="font-semibold text-warn-ink">{code === "SHORTFALL_BLOCKING" ? "Waiting on the dispatcher" : "Not sealed yet"}</p>
        <p className="mt-0.5 text-ink">
          {code === "SHORTFALL_BLOCKING"
            ? "A reported issue still holds this vehicle. The dispatcher decides in Exceptions; press Mark loading complete again once they have."
            : message}
        </p>
      </div>
    );
  }
  return (
    <div role="alert" className="rounded-[10px] border border-bad/25 bg-bad-surface px-3 py-2.5 text-sm">
      <p className="font-semibold text-bad-ink">{result.title}</p>
      <p className="mt-0.5 text-ink">{result.detail}</p>
      {result.outcome === "unknown" ? <p className="mt-0.5 text-muted">Reload the dock to see whether it went through.</p> : null}
    </div>
  );
}
