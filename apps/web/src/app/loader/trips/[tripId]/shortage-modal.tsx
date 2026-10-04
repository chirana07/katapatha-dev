"use client";

import { useId, useMemo, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { recordChillerReading, recordLoadCheck } from "../../actions";
import type { LoadLine } from "../../dock-model";
import { BoxIcon, MinusIcon, PlusIcon } from "../../icons";
import { InfoStrip } from "../../dock-ui";
import { itemsOf, productsOnTrip, shortName, spreadShort, sumCounts, type Counts } from "../../load-items";
import { newUuid, validateChillerTemp, validateLoadCheck } from "../../shortage";

/**
 * L-03: report a loading issue.
 *
 * Short, damaged and wrong item are each the load check with a non-OK
 * condition, sent for every order the shortfall falls on; the dispatcher sees
 * them in Exceptions. Chiller temp is a gauge reading instead. Nothing here
 * claims a stock figure or a substitute — the system models neither — so the
 * note says what the dispatcher will decide, not what the warehouse holds.
 */

export type ReportKind = "SHORT" | "DAMAGED" | "WRONG_ITEM" | "CHILLER";

export type ReportSeed = { orderId: string; key: string; kind: ReportKind };

const KINDS: { value: ReportKind; label: string }[] = [
  { value: "SHORT", label: "Short" },
  { value: "DAMAGED", label: "Damaged" },
  { value: "WRONG_ITEM", label: "Wrong item" },
  { value: "CHILLER", label: "Chiller temp" },
];

const REASON: Record<Exclude<ReportKind, "CHILLER">, string> = {
  SHORT: "SHORT_QUANTITY",
  DAMAGED: "DAMAGED",
  WRONG_ITEM: "WRONG_ITEM",
};

const MAX_PHOTO_EDGE = 1280;

export function ReportDialog({
  open,
  onClose,
  tripId,
  tripLabel,
  tripContext,
  lines,
  counts,
  districts,
  reasons,
  seed,
  checkedBy,
  dispatcherName,
  refrigerated,
  onSent,
}: {
  open: boolean;
  onClose: () => void;
  tripId: string;
  tripLabel: string;
  tripContext: string;
  lines: LoadLine[];
  counts: Record<string, Counts>;
  districts: Record<string, string>;
  reasons: string[];
  seed: ReportSeed;
  checkedBy: string;
  dispatcherName: string | null;
  refrigerated: boolean;
  onSent: () => void;
}) {
  const formId = useId();
  // Only lines not yet checked can be reported from here; a checked line is a
  // record the dispatcher already has.
  const open_ = lines.filter((line) => line.condition == null);
  const products = useMemo(() => productsOnTrip(open_.length > 0 ? open_ : lines, counts), [open_, lines, counts]);
  const seedKey = (() => {
    const line = lines.find((l) => l.orderId === seed.orderId);
    const item = line ? itemsOf(line).find((i) => i.key === seed.key) : null;
    return item?.sku ?? `__units:${seed.orderId}`;
  })();
  const [kind, setKind] = useState<ReportKind>(refrigerated || seed.kind !== "CHILLER" ? seed.kind : "SHORT");
  const [productKey, setProductKey] = useState(products.some((p) => p.key === seedKey) ? seedKey : (products[0]?.key ?? ""));
  const [changing, setChanging] = useState(false);
  const product = products.find((p) => p.key === productKey) ?? products[0];
  const initialShort = product ? Math.max(1, product.required - product.loaded) : 1;
  const [short, setShort] = useState(initialShort);
  const [hold, setHold] = useState(true);
  const [photo, setPhoto] = useState<string | null>(null);
  const [temp, setTemp] = useState("");
  const [error, setError] = useState<{ title: string; detail: string; unknown: boolean } | null>(null);
  const [pending, start] = useTransition();

  const required = product?.required ?? 0;
  const clampedShort = Math.min(Math.max(short, 1), Math.max(required, 1));
  const affected = product ? spreadShort(product, clampedShort) : [];

  function chooseProduct(key: string) {
    setProductKey(key);
    const next = products.find((p) => p.key === key);
    setShort(next ? Math.max(1, next.required - next.loaded) : 1);
    setChanging(false);
  }

  async function attachPhoto(file: File | undefined) {
    if (!file) return;
    try {
      setPhoto(await compress(file));
    } catch {
      setError({ title: "That photo could not be read", detail: "Take it again, or send the report without one.", unknown: false });
    }
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (kind === "CHILLER") {
      const value = Number(temp.replace(",", "."));
      const invalid = validateChillerTemp(value);
      if (invalid) {
        setError({ title: "That reading cannot be saved", detail: invalid, unknown: false });
        return;
      }
      start(async () => {
        const saved = await recordChillerReading({ tripId, tempC: value, clientReadingId: newUuid() });
        if (saved.ok) {
          onSent();
          onClose();
        } else setError({ title: saved.title, detail: saved.detail, unknown: saved.outcome === "unknown" });
      });
      return;
    }
    if (!product || affected.length === 0) {
      setError({ title: "Nothing to report", detail: "Pick the item that is short or damaged.", unknown: false });
      return;
    }

    // One check per order the shortfall falls on. The other items on that
    // order are recorded as loaded in full: the report is about this item.
    const inputs = affected.map((hit) => {
      const line = lines.find((l) => l.orderId === hit.orderId)!;
      const items = itemsOf(line);
      const next: Counts = Object.fromEntries(items.map((item) => [item.key, item.quantity]));
      const key = product.sku ?? items[0]!.key;
      next[key] = Math.max(0, (next[key] ?? 0) - hit.short);
      const loadedUnits = sumCounts(next);
      const reason = REASON[kind];
      return {
        tripId,
        orderId: line.orderId,
        expectedUnits: line.expectedUnits,
        loadedUnits,
        condition: (kind === "DAMAGED" ? "DAMAGED" : loadedUnits === 0 ? "MISSING" : "SHORT") as "DAMAGED" | "MISSING" | "SHORT",
        checkedByName: checkedBy,
        reasonCode: reasons.includes(reason) ? reason : loadedUnits === 0 && reasons.includes("MISSING") ? "MISSING" : (reasons[0] ?? reason),
        clientRequestId: newUuid(),
        itemCounts: product.sku ? next : null,
        productSku: product.sku,
        photoData: photo,
        holdSealing: hold,
      };
    });
    for (const input of inputs) {
      const problem = validateLoadCheck(input);
      if (problem) {
        setError({ title: "This cannot be sent yet", detail: problem, unknown: false });
        return;
      }
    }
    start(async () => {
      for (const input of inputs) {
        const saved = await recordLoadCheck(input);
        if (!saved.ok) {
          setError({ title: saved.title, detail: saved.detail, unknown: saved.outcome === "unknown" });
          onSent();
          return;
        }
      }
      onSent();
      onClose();
    });
  }

  const who = dispatcherName ? `${dispatcherName} (dispatcher)` : "The dispatcher";

  return (
    <Modal
      open={open}
      onClose={onClose}
      eyebrow="Report a loading issue"
      title={tripLabel}
      context={tripContext}
      footer={
        <>
          <p className="mr-auto max-w-60 text-[13px] text-muted">{who} sees it in Exceptions straight away.</p>
          <Button type="button" onClick={onClose} className="px-6">
            Cancel
          </Button>
          <Button type="submit" form={formId} variant="primary" disabled={pending} className="px-6">
            {pending ? "Sending…" : kind === "CHILLER" ? "Record reading" : "Send to dispatcher"}
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={submit} className="flex flex-col gap-4">
        <fieldset>
          <legend className="text-xs font-semibold uppercase tracking-wide text-muted">What&rsquo;s wrong?</legend>
          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {KINDS.map((option) => {
              const disabled = option.value === "CHILLER" && !refrigerated;
              return (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={kind === option.value}
                  disabled={disabled}
                  title={disabled ? "Only refrigerated vehicles take a gauge reading" : undefined}
                  onClick={() => setKind(option.value)}
                  className={`min-h-12 rounded-[8px] border px-2 text-[15px] font-semibold disabled:cursor-not-allowed disabled:opacity-40 ${
                    kind === option.value ? "border-[#111827] bg-[#111827] text-white" : "border-[#d1d5db] bg-surface text-[#111827] hover:bg-raised"
                  }`}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
        </fieldset>

        {kind === "CHILLER" ? (
          <section className="flex flex-col gap-2">
            <label className="flex flex-col gap-1">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted">Gauge reads (°C)</span>
              <input
                inputMode="decimal"
                value={temp}
                onChange={(event) => setTemp(event.target.value)}
                placeholder="e.g. 6"
                className="min-h-12 rounded-[10px] border border-[#d1d5db] bg-surface px-3 text-lg font-semibold text-ink"
              />
            </label>
            <InfoStrip>
              A reading is your look at the gauge, saved with your name and the time. An out-of-range reading does not hold the
              vehicle by itself; the dispatcher sees it in Exceptions.
            </InfoStrip>
          </section>
        ) : product ? (
          <>
            <section>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">Item</h3>
              <div className="mt-2 flex items-center gap-3 rounded-[10px] border border-[#e5e7eb] p-3">
                <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-[8px] bg-[#fff8e6] text-warn">
                  <BoxIcon className="size-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-[#111827]">{shortName(product.name)}</p>
                  <p className="text-[13px] text-muted">
                    {product.sku ? `${product.sku} · ` : ""}
                    {product.unitLabel} · on {new Set(product.orders.map((o) => o.seq)).size}{" "}
                    {new Set(product.orders.map((o) => o.seq)).size === 1 ? "stop" : "stops"}
                  </p>
                </div>
                {products.length > 1 ? (
                  changing ? (
                    <label>
                      <span className="sr-only">Pick the item</span>
                      <select
                        autoFocus
                        value={productKey}
                        onChange={(event) => chooseProduct(event.target.value)}
                        onBlur={() => setChanging(false)}
                        className="min-h-10 max-w-48 rounded-control border border-line bg-surface px-2 text-sm"
                      >
                        {products.map((p) => (
                          <option key={p.key} value={p.key}>
                            {shortName(p.name)}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : (
                    <button type="button" onClick={() => setChanging(true)} className="min-h-10 px-1 text-[15px] font-semibold text-link">
                      Change
                    </button>
                  )
                ) : null}
              </div>
            </section>

            <div className="grid grid-cols-3 gap-2.5">
              <div className="rounded-[10px] border border-[#e5e7eb] p-3">
                <p className="text-[13px] text-muted">Required</p>
                <p className="tabular mt-1 text-[26px] font-bold text-[#111827]">{required}</p>
              </div>
              <div className="rounded-[10px] border border-[#e5e7eb] p-3">
                <p className="text-[13px] text-muted">Loaded</p>
                <p className="tabular mt-1 text-[26px] font-bold text-[#111827]">{required - clampedShort}</p>
              </div>
              <div className="rounded-[10px] border border-bad/30 bg-bad-surface p-3">
                <p className="text-[13px] text-bad-ink">{kind === "DAMAGED" ? "Damaged" : "Short"}</p>
                <div className="mt-1 flex items-center gap-2">
                  <button
                    type="button"
                    aria-label="One fewer"
                    disabled={clampedShort <= 1}
                    onClick={() => setShort(clampedShort - 1)}
                    className="grid size-8 place-items-center rounded-[6px] border border-[#d1d5db] bg-surface disabled:opacity-40"
                  >
                    <MinusIcon className="size-4" />
                  </button>
                  <span className="tabular text-[26px] font-bold text-bad-ink" aria-live="polite">
                    {clampedShort}
                  </span>
                  <button
                    type="button"
                    aria-label="One more"
                    disabled={clampedShort >= required}
                    onClick={() => setShort(clampedShort + 1)}
                    className="grid size-8 place-items-center rounded-[6px] border border-[#d1d5db] bg-surface disabled:opacity-40"
                  >
                    <PlusIcon className="size-4" />
                  </button>
                </div>
              </div>
            </div>

            <InfoStrip>
              {kind === "WRONG_ITEM"
                ? "The wrong item stays off the vehicle. "
                : kind === "DAMAGED"
                  ? "Damaged units stay off the vehicle. "
                  : ""}
              The dispatcher decides whether to send it short, hold the order or move it to trip 2.
            </InfoStrip>

            <section>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">Affected stops · filled from the loading list</h3>
              <ul className="mt-2 divide-y divide-[#e5e7eb] rounded-[10px] border border-[#e5e7eb]">
                {affected.map((hit) => (
                  <li key={hit.orderId} className="flex items-center justify-between gap-3 px-3 py-2.5">
                    <div className="min-w-0">
                      <p className="font-semibold text-[#111827]">
                        Stop {hit.seq + 1} · {hit.outletId}
                        {districts[hit.outletId] ? ` · ${districts[hit.outletId]}` : ""}
                      </p>
                      <p className="text-[13px] text-muted">
                        {hit.orderRef} · ordered {hit.quantity}
                      </p>
                    </div>
                    <p className="tabular text-lg font-bold text-bad-ink">−{hit.short}</p>
                  </li>
                ))}
              </ul>
            </section>

            <div className="grid gap-2.5 sm:grid-cols-[88px_1fr]">
              <label className="relative grid min-h-18 cursor-pointer place-items-center overflow-hidden rounded-[10px] border border-dashed border-[#d1d5db] text-center text-[13px] text-[#374151] hover:bg-raised">
                {photo ? (
                  // eslint-disable-next-line @next/next/no-img-element -- a local data URL preview, not a remote image
                  <img src={photo} alt="Photo attached to this report" className="size-full object-cover" />
                ) : (
                  <span>
                    <span aria-hidden className="block text-lg leading-none">+</span>Add photo
                  </span>
                )}
                <input type="file" accept="image/*" capture="environment" className="sr-only" onChange={(event) => attachPhoto(event.target.files?.[0])} />
              </label>
              <label className="flex cursor-pointer items-center justify-between gap-3 rounded-[10px] border border-[#e5e7eb] px-3 py-2.5">
                <span>
                  <span className="block font-semibold text-[#111827]">Hold sealing until dispatch decides</span>
                  <span className="block text-[13px] text-muted">
                    {hold ? "Keep loading other items meanwhile" : "The vehicle can be sealed and leave with this short"}
                  </span>
                </span>
                <input type="checkbox" role="switch" checked={hold} onChange={(event) => setHold(event.target.checked)} className="peer sr-only" />
                <span
                  aria-hidden
                  className={`relative h-7 w-12 shrink-0 rounded-full transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-link ${hold ? "bg-good" : "bg-[#d1d5db]"}`}
                >
                  <span className={`absolute top-0.5 size-6 rounded-full bg-white shadow transition-all ${hold ? "left-5.5" : "left-0.5"}`} />
                </span>
              </label>
            </div>
          </>
        ) : (
          <p className="text-sm text-muted">Every order on this vehicle is already checked. Nothing is left to report from the dock.</p>
        )}

        {error ? (
          <div role="alert" className="rounded-[10px] border border-bad/25 bg-bad-surface p-3 text-sm">
            <p className="font-semibold text-bad-ink">{error.title}</p>
            <p className="mt-0.5 text-ink">{error.detail}</p>
            {error.unknown ? <p className="mt-0.5 text-muted">It may have been saved. Reload the dock before sending it again.</p> : null}
          </div>
        ) : null}
      </form>
    </Modal>
  );
}

/** A camera photo shrunk to a sensible size, as a JPEG data URL. */
function compress(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      const scale = Math.min(1, MAX_PHOTO_EDGE / Math.max(image.width, image.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(image.width * scale);
      canvas.height = Math.round(image.height * scale);
      canvas.getContext("2d")?.drawImage(image, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL("image/jpeg", 0.72));
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("unreadable"));
    };
    image.src = url;
  });
}
