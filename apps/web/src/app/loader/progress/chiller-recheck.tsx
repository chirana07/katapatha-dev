"use client";

import { useId, useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status-pill";
import { recordChillerReading } from "../actions";
import { chillerByline, chillerVerdict, type Reading } from "../chiller";
import { formatTemp, newUuid } from "../shortage";

/**
 * Record a chiller gauge reading for a refrigerated vehicle at the bay.
 *
 * It shows the trip's latest reading (from the API) or the one just recorded,
 * as a person's reading with who, where and how long ago — not a current
 * temperature. The age is measured from the reading's own `recordedAt`, never
 * from when this screen received it.
 */
export function ChillerRecheck({ tripId, vehicleId, tripNo, latest }: { tripId: string; vehicleId: string; tripNo: number; latest: Reading | null }) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [saved, setSaved] = useState<Reading | null>(null);
  const [error, setError] = useState<{ detail: string; unknown: boolean } | null>(null);
  const [pending, start] = useTransition();
  const requestId = useRef(newUuid());
  const inputId = useId();
  const shown = saved ?? latest;

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const tempC = Number(value.replace(",", "."));
    if (value.trim() === "" || !Number.isFinite(tempC)) {
      setError({ detail: "Enter the temperature the gauge shows, for example 3.8.", unknown: false });
      return;
    }
    setError(null);
    start(async () => {
      const result = await recordChillerReading({ tripId, tempC, clientReadingId: requestId.current });
      if (result.ok) {
        requestId.current = newUuid();
        setSaved(result);
        setOpen(false);
        setValue("");
      } else {
        setError({ detail: result.detail, unknown: result.outcome === "unknown" });
      }
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-semibold text-ink">
            {vehicleId} · Trip {tripNo}
          </p>
          <p className="text-sm text-muted">Refrigerated. The target is 2&ndash;5 &deg;C.</p>
        </div>
        {!open ? (
          <Button type="button" onClick={() => setOpen(true)} className="shrink-0">
            {shown ? "Recheck" : "Record reading"}
          </Button>
        ) : null}
      </div>

      {shown ? (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <StatusPill label={`${formatTemp(shown.tempC)} ${chillerVerdict(shown).label}`} tone={chillerVerdict(shown).tone} />
          <span className="text-muted">{chillerByline(shown)}</span>
        </div>
      ) : (
        <p className="text-sm text-muted">No gauge reading recorded for this trip yet.</p>
      )}
      {shown && !shown.inRange ? (
        <p className="text-sm text-muted">Recorded for the dispatcher. An out-of-range reading does not block the vehicle by itself.</p>
      ) : null}

      {open ? (
        <form onSubmit={submit} className="flex flex-wrap items-end gap-2">
          <label htmlFor={inputId} className="flex flex-col gap-1">
            <span className="text-xs font-bold uppercase tracking-wider text-muted">Gauge shows (&deg;C)</span>
            <input
              id={inputId}
              autoFocus
              inputMode="decimal"
              value={value}
              onChange={(event) => setValue(event.target.value)}
              autoComplete="off"
              className="tabular min-h-11 w-32 rounded-control border border-line bg-surface px-3 text-ink"
            />
          </label>
          <Button type="submit" variant="primary" disabled={pending}>
            {pending ? "Saving…" : "Save reading"}
          </Button>
          <Button type="button" onClick={() => setOpen(false)} disabled={pending}>
            Cancel
          </Button>
        </form>
      ) : null}

      {error ? (
        <p role="alert" className="text-sm text-bad-ink">
          {error.detail}
          {error.unknown ? " It may have been saved, so reload before recording it again." : ""}
        </p>
      ) : null}
    </div>
  );
}
