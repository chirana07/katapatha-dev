"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import type { components } from "@katapatha/contracts/types";
import { Button } from "@/components/ui/button";
import { recordSwapStep } from "./actions";
import { CheckIcon } from "./icons";
import { InfoStrip, NumberDisc } from "./dock-ui";

type Swap = components["schemas"]["VehicleSwap"];

/**
 * L-04: the dispatcher moved this trip onto another vehicle while the dock was
 * loading it.
 *
 * It opens by itself on the dock and on the loading list until the loader
 * opens the new vehicle's list (which records that they have read it). The
 * three steps are the physical job — take off what was loaded, wait for the
 * replacement at the bay, reload last stop first — and the first two are
 * recorded with the loader's name as they are done. The third is the loading
 * list itself, which the swap cleared.
 */
export function SwapNotice({
  tripId,
  swap,
  bay,
  stops,
  stopOrder,
  stores,
  checkerName,
  listHref,
}: {
  tripId: string;
  swap: Swap;
  bay: number | null;
  stops: number;
  /** "Stop 4 OUT063 → Stop 3 → …", the order the reload goes in. */
  stopOrder: string;
  stores: number;
  checkerName: string;
  listHref: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(swap.acknowledgedAt == null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const node = dialog.current;
    if (!node) return;
    if (open && !node.open) node.showModal();
    if (!open && node.open) node.close();
  }, [open]);
  const at = (iso: string | null) =>
    iso
      ? new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Colombo", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso))
      : null;
  const bayText = bay != null ? `Bay ${bay}` : "the bay";
  const moved = swap.newDepartAt !== swap.previousDepartAt;

  function step(next: "UNLOADED" | "ARRIVED" | "ACKNOWLEDGED", then?: () => void) {
    setError(null);
    start(async () => {
      const saved = await recordSwapStep({ tripId, swapId: swap.id, step: next, byName: checkerName });
      if (!saved.ok) {
        setError(saved.detail);
        return;
      }
      if (then) then();
      else router.refresh();
    });
  }

  if (!open) {
    return swap.acknowledgedAt == null ? (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full rounded-[10px] border border-warn/30 bg-warn-surface px-3 py-2.5 text-left text-[13px] font-semibold text-warn-ink"
      >
        Plan changed: {swap.fromVehicleId}&rsquo;s load moves to {swap.toVehicleId}. Open the steps
      </button>
    ) : null;
  }

  const steps = [
    {
      title: `Unload the ${swap.unloadedUnits} units already on ${swap.fromVehicleId}`,
      detail: swap.unloadedUnits === 0 ? "Nothing had gone on yet." : `Keep them together at ${bayText}, in the order they came off.`,
      done: swap.unloadedAt,
      by: swap.unloadedByName,
      action: swap.unloadedAt ? null : { label: "Done", run: () => step("UNLOADED") },
    },
    {
      title: `Wait for ${swap.toVehicleId} at ${bayText}`,
      detail: swap.arrivedAt ? `At the bay` : "Tap when it is backed onto the bay.",
      done: swap.arrivedAt,
      by: swap.arrivedByName,
      action: swap.arrivedAt ? null : { label: "It's here", run: () => step("ARRIVED") },
    },
    {
      title: "Reload in the same order, last stop first",
      detail: `${stopOrder} · the list below updates live`,
      done: null,
      by: null,
      action: null,
    },
  ];

  return (
    <dialog
      ref={dialog}
      aria-labelledby={`swap-${swap.id}`}
      onCancel={() => setOpen(false)}
      onClose={() => setOpen(false)}
      className="m-auto w-[calc(100vw-2rem)] max-w-[720px] rounded-[14px] border-0 bg-transparent p-0 backdrop:bg-ink/40"
    >
      <div className="max-h-[92vh] w-full overflow-y-auto rounded-[14px] bg-surface shadow-xl">
        <p className="flex items-center gap-2.5 rounded-t-[14px] bg-[#fff1e0] px-6 py-3 text-[14px] font-semibold text-[#b45309]">
          <span aria-hidden className="grid size-5 place-items-center rounded-full bg-[#f59e0b] text-xs font-bold text-white">
            !
          </span>
          Plan changed by dispatch at {at(swap.createdAt)} · the printed sheet for {swap.fromVehicleId} is void
        </p>

        <div className="flex flex-col gap-4 px-6 py-5">
          <div>
            <h2 id={`swap-${swap.id}`} className="text-2xl font-bold tracking-tight text-[#111827]">
              Move {swap.fromVehicleId}&rsquo;s load to {swap.toVehicleId}
            </h2>
            <p className="mt-1.5 text-[14.5px] text-[#374151]">
              {swap.fromVehicleId} was pulled: {swap.reason.charAt(0).toLowerCase() + swap.reason.slice(1)}. {swap.toVehicleId} is taking
              the same trip from {bayText}
              {moved ? `, and departure moves from ${swap.previousDepartAt} to ${swap.newDepartAt}` : ""}. The stores have been told.
            </p>
          </div>

          <div className="grid items-center gap-3 sm:grid-cols-[1fr_auto_1fr]">
            <div className="rounded-[10px] border border-[#e5e7eb] bg-[#f9fafb] p-3">
              <p className="flex items-center gap-2">
                <span className="text-lg font-bold text-muted line-through">{swap.fromVehicleId}</span>
                <span className="rounded-full bg-bad-surface px-2 py-0.5 text-xs font-semibold text-bad-ink">Taken off</span>
              </p>
              <p className="mt-1 text-[13px] text-muted">
                {bayText} · {swap.unloadedUnits} units loaded · {swap.reason}
              </p>
            </div>
            <span aria-hidden className="justify-self-center text-xl text-[#374151]">
              →
            </span>
            <div className="rounded-[10px] border border-[#e5e7eb] p-3">
              <p className="flex items-center gap-2">
                <span className="text-lg font-bold text-[#111827]">{swap.toVehicleId}</span>
                <span className="rounded-full bg-good-surface px-2 py-0.5 text-xs font-semibold text-good-ink">Replacement</span>
              </p>
              <p className="mt-1 text-[13px] text-muted">
                {swap.arrivedAt ? `At ${bayText} since ${at(swap.arrivedAt)}` : `Coming to ${bayText}`} · same {stops} {stops === 1 ? "stop" : "stops"}
              </p>
            </div>
          </div>

          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">Do this in order</h3>
            <ol className="mt-2 divide-y divide-[#e5e7eb] overflow-hidden rounded-[10px] border border-[#e5e7eb]">
              {steps.map((item, index) => (
                <li key={item.title} className={`flex items-center gap-3 px-4 py-3 ${item.done ? "bg-good-surface" : ""}`}>
                  {item.done ? (
                    <span aria-hidden className="grid size-7 shrink-0 place-items-center rounded-full bg-good text-white">
                      <CheckIcon className="size-4" />
                    </span>
                  ) : (
                    <NumberDisc n={index + 1} tone="night" size="md" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-[#111827]">{item.title}</p>
                    <p className="text-[13px] text-muted">{item.detail}</p>
                  </div>
                  {item.done ? (
                    <span className="shrink-0 rounded-full bg-good-surface px-2.5 py-1 text-xs font-semibold text-good-ink ring-1 ring-good/25">
                      Done {at(item.done)}
                    </span>
                  ) : item.action ? (
                    <Button type="button" onClick={item.action.run} disabled={pending} className="shrink-0">
                      {item.action.label}
                    </Button>
                  ) : null}
                </li>
              ))}
            </ol>
          </section>

          <InfoStrip>
            Using a printed sheet? Reprint it from {swap.toVehicleId}&rsquo;s list. The old {swap.fromVehicleId} sheet won&rsquo;t match the
            driver&rsquo;s phone.
          </InfoStrip>

          {error ? (
            <p role="alert" className="rounded-[10px] border border-bad/25 bg-bad-surface px-3 py-2 text-sm text-bad-ink">
              {error}
            </p>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center justify-end gap-3 border-t border-[#e5e7eb] px-6 py-4">
          <p className="mr-auto text-[13px] text-muted">
            {moved ? `Departure ${swap.previousDepartAt} → ${swap.newDepartAt} · ` : ""}
            {stores} {stores === 1 ? "store" : "stores"} notified
          </p>
          <Button type="button" onClick={() => setOpen(false)}>
            Not now
          </Button>
          <Button
            type="button"
            variant="primary"
            disabled={pending}
            onClick={() =>
              step("ACKNOWLEDGED", () => {
                setOpen(false);
                router.push(listHref);
                router.refresh();
              })
            }
          >
            Open {swap.toVehicleId} list
          </Button>
        </div>
      </div>
    </dialog>
  );
}
