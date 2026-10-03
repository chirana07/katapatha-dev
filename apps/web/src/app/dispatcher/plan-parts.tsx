import type { components } from "@katapatha/contracts/types";
import { BrandPill, StatusPill, type Tone } from "@/components/ui/status-pill";
import { DataTable, RowCard, Td, Th, Tr } from "@/components/ui/data-table";
import { Meter } from "@/components/ui/stat-card";
import { minutesLabel, meterRows, violationRefs, violationTitle } from "./plan-summary";

type Trip = components["schemas"]["Trip"];
type Violation = components["schemas"]["Violation"];
type Meter_ = components["schemas"]["VehicleMeter"];

/**
 * Pieces shared by the planning desk and the plan board.
 *
 * Both screens show the same plan — one as the day's summary, one as the page
 * the dispatcher reviews and publishes from — so the trip table, the
 * utilisation bars and the violation list live here once. A status that read
 * one way on the desk and another on the board would be the exact drift the
 * shared pill exists to prevent.
 */

const PLAN_STATUS: Record<string, { label: string; tone: Tone }> = {
  DRAFT: { label: "Draft", tone: "warn" },
  PUBLISHED: { label: "Published", tone: "good" },
  SUPERSEDED: { label: "Replaced", tone: "neutral" },
};

export function PlanStatusPill({ status }: { status: string }) {
  const { label, tone } = PLAN_STATUS[status] ?? { label: status.toLowerCase(), tone: "neutral" as Tone };
  return <StatusPill label={label} tone={tone} />;
}

const TRIP_STATUS: Record<Trip["status"], { label: string; tone: Tone }> = {
  PLANNED: { label: "Planned", tone: "neutral" },
  LOADING: { label: "Loading", tone: "warn" },
  READY: { label: "Ready", tone: "good" },
  DEPARTED: { label: "Departed", tone: "info" },
  COMPLETED: { label: "Completed", tone: "good" },
  CANCELLED: { label: "Cancelled", tone: "bad" },
};

export function TripStatusPill({ status }: { status: Trip["status"] }) {
  const { label, tone } = TRIP_STATUS[status];
  return <StatusPill label={label} tone={tone} />;
}

const WAVE: Record<Trip["wave"], string> = { PREDAWN: "Pre-dawn", DAYTIME: "Daytime" };

export function TripsTable({ trips }: { trips: Trip[] }) {
  return (
    <DataTable
      caption="Trips in this plan"
      empty={
        trips.length === 0 ? (
          <p className="rounded-card border border-dashed border-line bg-surface p-6 text-center text-sm text-muted">
            No trips were built for this plan.
          </p>
        ) : undefined
      }
      head={
        <tr>
          <Th>Vehicle</Th>
          <Th>Brand</Th>
          <Th>District</Th>
          <Th>Wave</Th>
          <Th numeric>Departs</Th>
          <Th numeric>Duration</Th>
          <Th numeric>Weight</Th>
          <Th numeric>Volume</Th>
          <Th>Status</Th>
        </tr>
      }
      cards={trips.map((trip) => (
        <RowCard key={trip.id}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="font-semibold text-ink">
                {trip.vehicleId} <span className="font-normal text-muted">· Trip {trip.tripNo}</span>
              </p>
              <p className="mt-0.5 text-sm text-muted">
                {trip.districtName} · {WAVE[trip.wave]}
              </p>
            </div>
            <TripStatusPill status={trip.status} />
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
            <BrandPill brand={trip.brand} />
            <span className="tabular text-muted">Departs {trip.plannedDepartAt ?? "—"}</span>
            <span className="tabular text-muted">{minutesLabel(trip.plannedMinutes)}</span>
            <span className="tabular text-muted">
              {trip.sumWeightKg != null ? `${Math.round(trip.sumWeightKg)} kg` : "—"} ·{" "}
              {trip.sumVolumeM3 != null ? `${trip.sumVolumeM3.toFixed(1)} m³` : "—"}
            </span>
          </div>
        </RowCard>
      ))}
    >
      {trips.map((trip) => (
        <Tr key={trip.id}>
          <Td>
            <span className="whitespace-nowrap">
              <span className="font-semibold text-ink">{trip.vehicleId}</span> <span className="text-muted">· Trip {trip.tripNo}</span>
            </span>
          </Td>
          <Td>
            <BrandPill brand={trip.brand} />
          </Td>
          <Td>{trip.districtName}</Td>
          <Td>
            <span className="whitespace-nowrap">{WAVE[trip.wave]}</span>
          </Td>
          <Td numeric>{trip.plannedDepartAt ?? "—"}</Td>
          <Td numeric>{minutesLabel(trip.plannedMinutes)}</Td>
          <Td numeric>
            <span className="whitespace-nowrap">{trip.sumWeightKg != null ? `${Math.round(trip.sumWeightKg)} kg` : "—"}</span>
          </Td>
          <Td numeric>{trip.sumVolumeM3 != null ? `${trip.sumVolumeM3.toFixed(1)} m³` : "—"}</Td>
          <Td>
            <TripStatusPill status={trip.status} />
          </Td>
        </Tr>
      ))}
    </DataTable>
  );
}

/**
 * One vehicle's day against its limits, as the allocator measured it when it
 * built the plan — not what has happened on the road since. The weekly fuel
 * line counts every day of the week the plan touches, which is why it can look
 * high on a day with one short trip.
 */
export function UtilisationList({ meters }: { meters: Meter_[] | undefined }) {
  const rows = meterRows(meters);
  if (rows.length === 0) {
    return (
      <p className="rounded-card border border-dashed border-line bg-surface p-4 text-sm text-muted">
        This plan was built before utilisation was recorded, so there are no bars to show.
      </p>
    );
  }
  return (
    <ul className="grid gap-3 md:grid-cols-2">
      {rows.map((row) => (
        <li key={row.vehicleId} className="rounded-card border border-line bg-surface p-4">
          <div className="flex items-baseline justify-between gap-3">
            <h3 className="font-semibold text-ink">{row.vehicleId}</h3>
            <span className="tabular text-sm text-muted">
              {row.trips.used} of {row.trips.max} trips
            </span>
          </div>
          <dl className="mt-3 flex flex-col gap-3">
            <Bar
              label="Pre-dawn time"
              text={`${row.predawn.used} of ${row.predawn.budget} min`}
              value={row.predawn.used}
              max={row.predawn.budget}
              level={row.predawn.level}
            />
            <Bar
              label="Daytime"
              text={`${row.daytime.used} of ${row.daytime.budget} min`}
              value={row.daytime.used}
              max={row.daytime.budget}
              level={row.daytime.level}
            />
            <Bar
              label="Fuel this week"
              text={`${Math.round(row.fuel.used)} of ${Math.round(row.fuel.quota)} L`}
              value={row.fuel.used}
              max={row.fuel.quota}
              level={row.fuel.level}
            />
          </dl>
        </li>
      ))}
    </ul>
  );
}

function Bar({
  label,
  text,
  value,
  max,
  level,
}: {
  label: string;
  text: string;
  value: number;
  max: number;
  level: "ok" | "near" | "over";
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3 text-xs">
        <dt className="text-muted">{label}</dt>
        <dd className="tabular font-semibold text-ink">{text}</dd>
      </div>
      <div className="mt-1">
        <Meter value={value} max={max} level={level} label={`${label}: ${text}`} />
      </div>
    </div>
  );
}

/**
 * Errors block publication; warnings do not. Both say which order or outlet they
 * are about. `blocks` is false once a plan is published, where "blocks publishing"
 * would describe something that can no longer happen.
 */
export function ViolationList({ violations, blocks = true }: { violations: Violation[]; blocks?: boolean }) {
  if (violations.length === 0) return null;
  return (
    <ul className="flex flex-col divide-y divide-line">
      {violations.map((item, index) => {
        const refs = violationRefs(item);
        const isError = item.severity === "error";
        return (
          <li key={`${item.code}-${index}`} className="flex gap-3 py-3 first:pt-0 last:pb-0">
            <span className="mt-0.5 shrink-0">
              <StatusPill label={isError ? (blocks ? "Blocks publishing" : "Error") : "Warning"} tone={isError ? "bad" : "warn"} dot={false} />
            </span>
            <div className="min-w-0 text-sm">
              <p className="font-semibold text-ink">{violationTitle(item.code)}</p>
              <p className="mt-0.5 text-muted">{item.message}</p>
              {refs.length ? <p className="tabular mt-1 text-xs text-muted">{refs.join(" · ")}</p> : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
