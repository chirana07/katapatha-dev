import type { components } from "@katapatha/contracts/types";
import { setVehicleStatus } from "./actions";

type FleetDay = components["schemas"]["FleetDay"];

/**
 * Fleet status for the day: which vehicles the allocator may use. A vehicle
 * marked in the workshop here is excluded from the next auto-plan run, and a
 * draft that still uses it cannot be published.
 */
export function FleetPanel({ fleet }: { fleet: FleetDay }) {
  const out = fleet.vehicles.filter((v) => v.status === "IN_WORKSHOP").length;

  return (
    <section aria-labelledby="fleet-heading" className="mt-6 rounded-[var(--radius-card)] border border-line bg-surface p-5 sm:p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h2 id="fleet-heading" className="text-lg font-semibold">Fleet status</h2>
          <p className="mt-0.5 text-sm text-muted">
            {fleet.editable
              ? "Mark a vehicle in the workshop before running auto-plan. The allocator only uses available vehicles."
              : "Which vehicles ran on this day."}
          </p>
        </div>
        <span className="text-sm font-semibold text-muted">
          {fleet.vehicles.length - out} of {fleet.vehicles.length} available
        </span>
      </div>

      {!fleet.editable ? (
        <p role="status" className="mt-3 flex items-start gap-2 rounded-[var(--radius-control)] border border-blue-200 bg-blue-50 p-3 text-sm font-semibold text-blue-900">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mt-0.5 h-4 w-4 shrink-0" aria-hidden>
            <rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" />
          </svg>
          Locked — this day&apos;s plan is published, so vehicles can no longer be changed here.
        </p>
      ) : fleet.draftStale ? (
        <p className="mt-3 rounded-[var(--radius-control)] border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          A vehicle changed after the draft was built. Use <span className="font-semibold">Re-run auto-plan</span> — a draft that still uses a vehicle in the workshop can&apos;t be published.
        </p>
      ) : null}

      <ul className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {fleet.vehicles.map((v) => {
          const inWorkshop = v.status === "IN_WORKSHOP";
          return (
            <li
              key={v.vehicleId}
              className={`flex flex-col rounded-[var(--radius-control)] border p-4 ${inWorkshop ? "border-red-200 bg-red-50/50" : "border-line"}`}
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-semibold text-ink">{v.vehicleId}</p>
                  <p className="mt-0.5 text-xs text-muted">
                    {cap(v.type)} · {cap(v.temp)} · {v.volumeCapM3} m³ · {Math.round(v.weightCapKg)} kg
                  </p>
                </div>
                <span
                  className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-md px-2 py-1 text-xs font-semibold ${inWorkshop ? "bg-red-50 text-[color:var(--c-ruby)]" : "bg-emerald-50 text-emerald-700"}`}
                >
                  <span aria-hidden className="size-1.5 rounded-full bg-current" />
                  {inWorkshop ? "In workshop" : "Available"}
                </span>
              </div>

              {inWorkshop && (v.note || v.setBy) ? (
                <p className="mt-2 text-xs text-muted">
                  {v.note}
                  {v.note && v.setBy ? " · " : ""}
                  {v.setBy ? `set by ${v.setBy}` : ""}
                </p>
              ) : null}

              {fleet.editable ? (
                <form action={setVehicleStatus} className="mt-3 flex flex-col gap-2">
                  <input type="hidden" name="date" value={fleet.date} />
                  <input type="hidden" name="vehicleId" value={v.vehicleId} />
                  <input type="hidden" name="status" value={inWorkshop ? "AVAILABLE" : "IN_WORKSHOP"} />
                  {!inWorkshop ? (
                    <input
                      name="note"
                      maxLength={200}
                      placeholder="Reason (optional)"
                      aria-label={`Reason ${v.vehicleId} is in the workshop`}
                      className="min-h-10 rounded-[var(--radius-control)] border border-line bg-surface px-3 text-sm text-ink"
                    />
                  ) : null}
                  <button
                    type="submit"
                    className="min-h-10 rounded-[var(--radius-control)] border border-line bg-surface px-3 text-sm font-semibold text-ink hover:bg-raised"
                  >
                    {inWorkshop ? "Back in service" : "Mark in workshop"}
                  </button>
                </form>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function cap(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
