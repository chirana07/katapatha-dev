import type { components } from "@katapatha/contracts/types";
import { PendingButton } from "@/components/ui/pending-button";
import { StatusPill } from "@/components/ui/status-pill";
import { Advisory } from "@/components/ui/states";
import { plural } from "@/lib/format";
import { setVehicleStatus } from "./actions";

type FleetDay = components["schemas"]["FleetDay"];

const TYPE = { truck: "Truck", van: "Van" } as const;
const TEMP = { reefer: "Refrigerated", ambient: "Ambient" } as const;

/**
 * Fleet status for the day: which vehicles the allocator may use. A vehicle
 * marked in the workshop here is excluded from the next auto-plan run, and a
 * draft that still uses it cannot be published.
 *
 * Once the day's plan is published the API refuses the change (`editable` is
 * false), so the form is not drawn at all rather than drawn and refused.
 */
export function FleetPanel({ fleet }: { fleet: FleetDay }) {
  const inWorkshop = fleet.vehicles.filter((v) => v.status === "IN_WORKSHOP").length;

  return (
    <section aria-labelledby="fleet-heading" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 id="fleet-heading" className="text-lg font-bold text-ink">
            Fleet status
          </h2>
          <p className="text-sm text-muted">
            {fleet.editable
              ? "Mark a vehicle in the workshop before building the plan. The allocator only uses available vehicles."
              : "Which vehicles could run on this day."}
          </p>
        </div>
        <span className="tabular text-sm font-semibold text-muted">
          {fleet.vehicles.length - inWorkshop} of {plural(fleet.vehicles.length, "vehicle")} available
        </span>
      </div>

      {!fleet.editable ? (
        <Advisory>
          Locked. {fleet.lockedReason ?? "This day's plan is published, so vehicles can no longer be changed here."}
        </Advisory>
      ) : fleet.draftStale ? (
        <Advisory>
          A vehicle changed after the draft was built. Build the plan again: a draft that still uses a vehicle in the workshop cannot be published.
        </Advisory>
      ) : null}

      <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {fleet.vehicles.map((v) => {
          const out = v.status === "IN_WORKSHOP";
          return (
            <li key={v.vehicleId} className={`flex flex-col rounded-card border p-4 ${out ? "border-bad/25 bg-bad-surface" : "border-line bg-surface"}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-bold text-ink">{v.vehicleId}</p>
                  <p className="tabular mt-0.5 text-xs text-muted">
                    {TYPE[v.type]} · {TEMP[v.temp]} · {v.volumeCapM3} m³ · {Math.round(v.weightCapKg)} kg
                  </p>
                </div>
                <StatusPill label={out ? "In workshop" : "Available"} tone={out ? "bad" : "good"} />
              </div>

              {out && (v.note || v.setBy) ? (
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
                  <input type="hidden" name="status" value={out ? "AVAILABLE" : "IN_WORKSHOP"} />
                  <input type="hidden" name="from" value="planning" />
                  {!out ? (
                    <input
                      name="note"
                      maxLength={200}
                      placeholder="Reason (optional)"
                      aria-label={`Reason ${v.vehicleId} is in the workshop`}
                      className="min-h-11 rounded-control border border-line bg-surface px-3 text-sm text-ink"
                    />
                  ) : null}
                  <PendingButton variant="secondary" pendingLabel="Saving…">
                    {out ? "Back in service" : "Mark in workshop"}
                  </PendingButton>
                </form>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
