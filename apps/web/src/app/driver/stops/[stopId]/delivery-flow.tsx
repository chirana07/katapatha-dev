"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { Button, ButtonLink } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status-pill";
import { clockTime, plural } from "@/lib/format";
import { ConnectivityBanner, useConnectivity } from "../../connectivity";
import { OFFLINE_SUBMIT_REASON, canSubmit } from "../../connectivity-state";
import { StopHeader, type StepState } from "../../driver-header";
import { deviceId, generateUlid } from "../../format";
import { CheckGlyph, PlusGlyph, WarningGlyph } from "../../glyphs";
import { canAddPage } from "../../image-fit";
import { readPodPage } from "../../pod-pages";
import { ThumbBar } from "../../thumb-bar";

type Order = { orderId: string; orderRef: string; expectedUnits: number };
type Page = { id: string; dataUrl: string; capturedAt: string };
type Summary = { delivered: number; expected: number; recipient: string; at: string; pages: number; duplicate: boolean };

export interface FlowProps {
  stopId: string;
  orders: Order[];
  /** "Stop 2" and the outlet. */
  title: string;
  /** Access note · order refs · units. */
  subtitle: string;
  detail?: string;
  runHref: string;
  reportHref: string;
  next: { href: string; label: string } | null;
}

const STEP_LABELS = ["Check items", "Receipt", "Confirm"] as const;

function steps(current: 0 | 1 | 2): { label: string; state: StepState }[] {
  return STEP_LABELS.map((label, index) => ({
    label,
    state: index < current ? "done" : index === current ? "current" : "todo",
  }));
}

/**
 * The delivery, in the designs' three steps (R-07, R-04, R-09): count what was
 * handed over, add the receipt and the recipient's name, then the recorded
 * result. Everything entered lives in this page's memory until Complete
 * delivery is accepted by the server; the web driver has no offline store, so
 * nothing here is, or is described as, saved on the phone.
 */
export function DeliveryFlow(props: FlowProps) {
  const { stopId, orders } = props;
  const { status } = useConnectivity();
  const online = canSubmit(status);

  const [step, setStep] = useState<0 | 1>(0);
  const [units, setUnits] = useState<Record<string, string>>(() =>
    Object.fromEntries(orders.map((order) => [order.orderId, String(order.expectedUnits)])),
  );
  const [pages, setPages] = useState<Page[]>([]);
  const [reduced, setReduced] = useState<string | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [viewing, setViewing] = useState(0);
  const [recipient, setRecipient] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);

  // Minted once per delivery and reused on every retry, so an unanswered
  // request that is pressed again replays the same ULIDs and records nothing twice.
  const [ids] = useState(() => ({
    lines: Object.fromEntries(orders.map((order) => [order.orderId, generateUlid()])) as Record<string, string>,
    pod: generateUlid(),
  }));
  const firstAttemptAt = useRef<string | null>(null);

  const expectedTotal = orders.reduce((sum, order) => sum + order.expectedUnits, 0);
  const parsed = orders.map((order) => {
    const text = (units[order.orderId] ?? "").trim();
    const value = /^\d+$/.test(text) ? Number(text) : NaN;
    return { order, value, valid: Number.isSafeInteger(value) && value >= 0 && value <= order.expectedUnits };
  });
  const countsValid = parsed.every((row) => row.valid);
  const deliveredTotal = parsed.reduce((sum, row) => sum + (row.valid ? row.value : 0), 0);
  const isComplete = countsValid && deliveredTotal === expectedTotal;

  function setCount(orderId: string, next: number, max: number) {
    const clamped = Math.max(0, Math.min(max, next));
    setUnits((current) => ({ ...current, [orderId]: String(clamped) }));
  }

  async function addPage(file: File | undefined) {
    if (!file) return;
    setPageError(null);
    setReading(true);
    const result = await readPodPage(file);
    setReading(false);
    if (!result.ok) {
      setPageError(result.error);
      return;
    }
    setPages((current) => {
      setViewing(current.length);
      return [...current, { id: generateUlid(), dataUrl: result.dataUrl, capturedAt: new Date().toISOString() }];
    });
    setReduced(result.reducedFrom === null ? null : "This photo was shrunk to fit before sending. The text should still be readable; check the preview.");
  }

  function removePage(id: string) {
    setPages((current) => current.filter((page) => page.id !== id));
    setViewing(0);
  }

  async function complete() {
    setError(null);
    setSubmitting(true);
    // The first press is when it happened; a retry keeps that time.
    firstAttemptAt.current ??= new Date().toISOString();
    const occurredAt = firstAttemptAt.current;
    try {
      const response = await fetch(`/driver/stops/${encodeURIComponent(stopId)}/delivery`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          deviceId: deviceId(),
          occurredAt,
          recipientName: recipient.trim(),
          podEventId: ids.pod,
          lines: parsed.map((row) => ({
            orderId: row.order.orderId,
            eventId: ids.lines[row.order.orderId],
            deliveredUnits: row.value,
            expectedUnits: row.order.expectedUnits,
          })),
          pages: pages.map((page) => ({ id: page.id, kind: "RECEIPT", data: page.dataUrl, capturedAt: page.capturedAt })),
        }),
      });
      const body = (await response.json().catch(() => null)) as
        | { ok: true; duplicate: boolean }
        | { ok: false; error: string }
        | null;
      if (response.ok && body?.ok) {
        setSummary({
          delivered: deliveredTotal,
          expected: expectedTotal,
          recipient: recipient.trim(),
          at: occurredAt,
          pages: pages.length,
          duplicate: body.duplicate,
        });
      } else {
        setError(body && !body.ok ? body.error : "Katapatha did not answer, so this delivery may or may not have been recorded.");
      }
    } catch {
      setError(
        "Katapatha did not answer, so this delivery may or may not have been recorded. Press Complete delivery again: it will not be recorded twice.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  if (summary) return <Recorded {...props} summary={summary} />;

  const header = (
    <StopHeader
      backHref={props.runHref}
      title={props.title}
      subtitle={props.subtitle}
      detail={props.detail}
      chip={{ label: `Step ${step + 1} of 3` }}
      steps={steps(step)}
    />
  );

  if (step === 0) {
    return (
      <>
        {header}
        <main className="mx-auto flex w-full max-w-xl flex-col gap-4 p-4 pb-44">
          <ConnectivityBanner />
          <section aria-labelledby="count-heading">
            <h2 id="count-heading" className="text-xl font-bold text-ink">
              Count with the store
            </h2>
            <p className="mt-1 text-sm text-muted">
              {plural(orders.length, "order")} · {expectedTotal} units on the vehicle. Lower a count if something is
              missing or damaged; that records a part delivery.
            </p>
          </section>

          <ul className="divide-y divide-line overflow-hidden rounded-card border border-line bg-surface">
            {parsed.map(({ order, value, valid }) => (
              <li key={order.orderId} className="flex items-center gap-3 p-3">
                <span className="min-w-0 flex-1">
                  <span className="block font-bold text-ink">{order.orderRef}</span>
                  <span className="tabular block text-sm text-muted">of {order.expectedUnits}</span>
                </span>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    aria-label={`One fewer for ${order.orderRef}`}
                    disabled={!valid || value <= 0}
                    onClick={() => setCount(order.orderId, value - 1, order.expectedUnits)}
                    className="size-12 px-0 text-xl"
                  >
                    −
                  </Button>
                  <input
                    aria-label={`Units handed over for ${order.orderRef}`}
                    inputMode="numeric"
                    pattern="[0-9]*"
                    value={units[order.orderId] ?? ""}
                    onChange={(event) => setUnits((current) => ({ ...current, [order.orderId]: event.target.value }))}
                    aria-invalid={!valid}
                    className={`tabular h-12 w-16 rounded-control border bg-surface text-center text-lg font-bold text-ink ${
                      valid ? "border-line" : "border-bad"
                    }`}
                  />
                  <Button
                    type="button"
                    aria-label={`One more for ${order.orderRef}`}
                    disabled={!valid || value >= order.expectedUnits}
                    onClick={() => setCount(order.orderId, value + 1, order.expectedUnits)}
                    className="size-12 px-0 text-xl"
                  >
                    +
                  </Button>
                </div>
              </li>
            ))}
          </ul>

          {!countsValid ? (
            <p role="alert" className="rounded-card border border-bad/25 bg-bad-surface p-4 text-sm text-ink">
              Each count must be a whole number from 0 up to what is on the vehicle for that order.
            </p>
          ) : isComplete ? (
            <div className="flex items-center gap-3 rounded-card border border-good/30 bg-good-surface p-4">
              <span className="grid size-9 shrink-0 place-items-center rounded-full bg-good text-white">
                <CheckGlyph className="h-5 w-5" />
              </span>
              <div>
                <p className="tabular font-bold text-ink">
                  {deliveredTotal} / {expectedTotal} units counted
                </p>
                <p className="text-sm text-muted">Matches what was loaded for this stop.</p>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-3 rounded-card border border-warn/40 bg-warn-surface p-4">
              <span className="grid size-9 shrink-0 place-items-center rounded-full bg-warn text-navy">
                <WarningGlyph className="h-5 w-5" />
              </span>
              <div>
                <p className="tabular font-bold text-ink">
                  {deliveredTotal} / {expectedTotal} units counted
                </p>
                <p className="text-sm text-muted">{expectedTotal - deliveredTotal} short. This will be recorded as a part delivery.</p>
              </div>
            </div>
          )}

          <ButtonLink href={props.reportHref} variant="secondary" className="w-full">
            <WarningGlyph /> Can&apos;t deliver? Report a problem
          </ButtonLink>
        </main>

        <ThumbBar>
          <ButtonLink href={props.runHref} variant="secondary" className="min-h-12 w-28 shrink-0">
            Back
          </ButtonLink>
          <Button type="button" variant="primary" disabled={!countsValid} onClick={() => setStep(1)} className="min-h-12 min-w-0 flex-1 text-base">
            Next: receipt
          </Button>
        </ThumbBar>
      </>
    );
  }

  const shown = pages[viewing] ?? pages[0];
  const recipientOk = recipient.trim().length >= 2;
  return (
    <>
      {header}
      <main className="mx-auto flex w-full max-w-xl flex-col gap-4 p-4 pb-48">
        <ConnectivityBanner />

        <section aria-labelledby="receipt-heading">
          <div className="flex items-baseline justify-between gap-3">
            <h2 id="receipt-heading" className="text-xl font-bold text-ink">
              Receipt photo
            </h2>
            <p className="tabular text-sm text-muted" aria-live="polite">
              {pages.length === 0 ? "No pages yet" : `Page ${Math.min(viewing, pages.length - 1) + 1} of ${pages.length}`}
            </p>
          </div>

          <div className="mt-3 grid min-h-48 place-items-center overflow-hidden rounded-card border border-line bg-raised">
            {shown ? (
              // eslint-disable-next-line @next/next/no-img-element -- a data URL the driver just captured; next/image cannot optimise it
              <img src={shown.dataUrl} alt={`Receipt page ${pages.indexOf(shown) + 1}`} className="max-h-72 w-full object-contain" />
            ) : (
              <p className="max-w-xs p-6 text-center text-sm text-muted">
                Take a photo of the signed receipt. It is sent with this delivery.
              </p>
            )}
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-3">
            {pages.map((page, index) => (
              <div key={page.id} className="relative">
                <button
                  type="button"
                  onClick={() => setViewing(index)}
                  aria-label={`Show page ${index + 1}`}
                  aria-current={index === viewing ? "true" : undefined}
                  className={`block size-16 overflow-hidden rounded-control border-2 ${index === viewing ? "border-action" : "border-line"}`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- a captured data URL thumbnail */}
                  <img src={page.dataUrl} alt="" className="size-full object-cover" />
                </button>
                <button
                  type="button"
                  onClick={() => removePage(page.id)}
                  aria-label={`Remove page ${index + 1}`}
                  className="absolute -right-2 -top-2 grid size-7 place-items-center rounded-full border border-line bg-surface text-sm font-bold text-ink shadow"
                >
                  ×
                </button>
              </div>
            ))}
            {canAddPage(pages.length) ? (
              <label className="grid size-16 cursor-pointer place-items-center rounded-control border-2 border-dashed border-line text-muted hover:bg-raised focus-within:outline focus-within:outline-2 focus-within:outline-link">
                <span className="flex flex-col items-center text-xs font-semibold">
                  <PlusGlyph className="h-5 w-5" />
                  {reading ? "Reading…" : "Add page"}
                </span>
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  disabled={reading}
                  className="sr-only"
                  onChange={(event) => {
                    void addPage(event.target.files?.[0]);
                    event.target.value = "";
                  }}
                />
              </label>
            ) : null}
            <p className="min-w-40 flex-1 text-sm text-muted">
              Add a page if the receipt has more than one sheet, or a delivery note. Up to 8 pages.
            </p>
          </div>

          {canAddPage(pages.length) ? (
            <label className="mt-2 inline-flex min-h-11 cursor-pointer items-center text-sm font-semibold text-link hover:underline focus-within:outline focus-within:outline-2 focus-within:outline-link">
              Choose a picture from the phone instead
              <input
                type="file"
                accept="image/*"
                disabled={reading}
                className="sr-only"
                onChange={(event) => {
                  void addPage(event.target.files?.[0]);
                  event.target.value = "";
                }}
              />
            </label>
          ) : null}
          {reduced ? <p className="mt-2 text-sm text-muted">{reduced}</p> : null}
          {pageError ? (
            <p role="alert" className="mt-2 rounded-control border border-bad/25 bg-bad-surface p-3 text-sm text-ink">
              {pageError}
            </p>
          ) : null}
          {pages.length === 0 ? (
            <p className="mt-3 text-sm text-warn-ink">
              No receipt page added. The delivery will be recorded with the recipient&apos;s name only.
            </p>
          ) : null}
        </section>

        <section className="border-t border-line pt-4">
          <label htmlFor="recipient" className="text-lg font-bold text-ink">
            Received by
          </label>
          <input
            id="recipient"
            name="recipientName"
            type="text"
            autoComplete="off"
            required
            minLength={2}
            value={recipient}
            onChange={(event) => setRecipient(event.target.value)}
            placeholder="Name of the person signing for the delivery"
            className="mt-2 min-h-12 w-full rounded-control border border-line bg-surface px-3 text-base text-ink"
          />
          <p className="mt-1 text-sm text-muted">Required. Stored with the proof of delivery for every order at this stop.</p>
        </section>

        <div
          className={`flex items-center gap-3 rounded-card border p-4 ${
            isComplete ? "border-good/30 bg-good-surface" : "border-warn/40 bg-warn-surface"
          }`}
        >
          <div className="min-w-0 flex-1">
            <p className="tabular font-bold text-ink">
              {deliveredTotal} / {expectedTotal} units checked
            </p>
            <p className="text-sm text-muted">{isComplete ? "Nothing short recorded." : "Recorded as a part delivery."}</p>
          </div>
          <button type="button" onClick={() => setStep(0)} className="min-h-11 px-2 text-sm font-bold text-link hover:underline">
            Edit
          </button>
        </div>
      </main>

      <ThumbBar
        notice={
          !online ? (
            <p role="status" className="text-sm text-warn-ink">{OFFLINE_SUBMIT_REASON}</p>
          ) : error ? (
            <p role="alert" className="rounded-control border border-bad/25 bg-bad-surface p-3 text-sm text-ink">{error}</p>
          ) : !recipientOk ? (
            <p className="text-sm text-muted">Type the name of the person receiving the delivery to finish.</p>
          ) : null
        }
      >
        <Button type="button" variant="secondary" onClick={() => setStep(0)} disabled={submitting} className="min-h-12 w-28 shrink-0">
          Back
        </Button>
        <Button
          type="button"
          variant="primary"
          disabled={submitting || reading || !online || !recipientOk || !countsValid}
          onClick={() => void complete()}
          className="min-h-12 min-w-0 flex-1 text-base"
        >
          <CheckGlyph className="h-5 w-5" />
          {submitting ? "Recording…" : "Complete delivery"}
        </Button>
      </ThumbBar>
    </>
  );
}

function Recorded({ summary, next, runHref, title, subtitle }: FlowProps & { summary: Summary }) {
  const part = summary.delivered < summary.expected;
  return (
    <>
      <StopHeader
        backHref={runHref}
        title={title}
        subtitle={subtitle}
        chip={{ label: "Done", tone: "good" }}
        steps={STEP_LABELS.map((label) => ({ label, state: "done" as const }))}
      />
      <main className="mx-auto flex w-full max-w-xl flex-col gap-4 p-4 pb-44">
        <ConnectivityBanner />
        <div className="flex flex-col items-center gap-3 pt-4 text-center">
          <span className="grid size-24 place-items-center rounded-full bg-good text-white">
            <CheckGlyph className="h-12 w-12" />
          </span>
          <h2 className="text-3xl font-bold text-ink">Delivery recorded</h2>
          <p className="tabular text-sm text-muted">{subtitle} · {clockTime(summary.at)}</p>
        </div>
        <dl className="divide-y divide-line overflow-hidden rounded-card border border-line bg-surface">
          <Row label="Units" value={`${summary.delivered} / ${summary.expected}${part ? " · part delivery" : " · no issues"}`} />
          <Row label="Received by" value={`${summary.recipient} · ${clockTime(summary.at)}`} />
          <Row label="Receipt" value={summary.pages === 0 ? "No page added" : plural(summary.pages, "page")} />
          <div className="flex items-center justify-between gap-3 p-4">
            <dt className="text-muted">Status</dt>
            <dd>
              <StatusPill label="Recorded by Katapatha" tone="good" />
            </dd>
          </div>
        </dl>
        {summary.duplicate ? (
          <p className="text-sm text-muted">Katapatha already had this delivery, which is a correct repeat.</p>
        ) : null}
        {next ? (
          <Link href={next.href} className="flex items-center gap-3 rounded-card border border-line bg-surface p-4 hover:bg-raised">
            <span className="min-w-0 flex-1">
              <span className="block text-sm text-muted">Next stop</span>
              <span className="block truncate font-bold text-ink">{next.label}</span>
            </span>
            <span aria-hidden className="text-muted">›</span>
          </Link>
        ) : null}
      </main>
      <ThumbBar>
        <ButtonLink href={runHref} variant={next ? "secondary" : "primary"} className="min-h-12 flex-1 text-base">
          Back to the run
        </ButtonLink>
        {next ? (
          <ButtonLink href={next.href} variant="primary" className="min-h-12 min-w-0 flex-[2] text-base">
            <span className="truncate">Go to next stop</span> <span aria-hidden>→</span>
          </ButtonLink>
        ) : null}
      </ThumbBar>
    </>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 p-4">
      <dt className="text-muted">{label}</dt>
      <dd className="tabular text-right font-bold text-ink">{value}</dd>
    </div>
  );
}
