import type { ReactNode } from "react";
import { BrandPill, StatusPill } from "@/components/ui/status-pill";
import { Meter } from "@/components/ui/stat-card";
import { Facts } from "@/components/ui/detail-panel";
import { Tabs } from "@/components/ui/tabs";
import { plural } from "@/lib/format";
import type { Vehicle } from "./dock-data.server";
import { tallyLines, statusTone, type LoadLine } from "./dock-model";
import { formatVolume, formatWeight } from "./format";
import { chillerByline, chillerHeadline, chillerVerdict } from "./chiller";
import { fetchShortfallReasons } from "./reasons.server";
import { LoadingWorkbench } from "./trips/[tripId]/loading-workbench";
import { TRIP_STATUS_LABEL, type Trip, type TripStatus } from "./wave";

/**
 * One trip at the dock: who it is, how far along it is, and the list to work.
 *
 * The Dock page shows it in the panel beside the queue; the loading-list page
 * (the phone's second screen) shows the same thing full width. It is a server
 * component so the reasons vocabulary is read once, on the server, with its
 * local fallback — the client only ever receives the resulting list.
 */
export async function TripDetail({
  tripId,
  trip,
  status,
  lines,
  districts,
  vehicle,
  checkerName,
  tab,
  tabs,
  heading = true,
}: {
  tripId: string;
  /** Null when the trip is not on the day being viewed. */
  trip: Trip | null;
  status: TripStatus;
  lines: LoadLine[];
  districts: Record<string, string>;
  vehicle: Vehicle | null;
  checkerName: string;
  tab: "list" | "vehicle";
  /** Hrefs for the two tabs, built by the caller so each keeps its own query. */
  tabs: { list: string; vehicle: string };
  /** The panel needs its own title; the full page already has a PageHeader. */
  heading?: boolean;
}) {
  const tally = tallyLines(lines);
  const percent = tally.expectedUnits > 0 ? Math.round((tally.loadedUnits / tally.expectedUnits) * 100) : 0;
  const { reasons, fallback } = await fetchShortfallReasons();

  const label = trip ? `${trip.vehicleId} · Trip ${trip.tripNo} · ${trip.districtName}` : "Loading list";
  const context = [
    plural(tally.stops, "stop"),
    trip?.plannedDepartAt ? `departs ${trip.plannedDepartAt}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="flex flex-col gap-4">
      {heading && trip ? (
        <header className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-xl font-bold text-ink">{trip.vehicleId}</h2>
              <span className="rounded-control border border-line bg-raised px-2 py-0.5 text-xs font-semibold text-muted">
                Trip {trip.tripNo}
              </span>
              <BrandPill brand={trip.brand} />
              {vehicle?.temp === "reefer" ? <StatusPill label="Refrigerated" tone="info" dot={false} /> : null}
            </div>
            <p className="mt-1 text-sm text-muted">
              {trip.districtName} · {plural(tally.stops, "stop")} · {plural(tally.lines, "order")}
            </p>
          </div>
          <div className="shrink-0 text-right">
            <StatusPill label={TRIP_STATUS_LABEL[status]} tone={statusTone(status)} />
            {trip.plannedDepartAt ? <p className="tabular mt-1 text-sm text-muted">Departs {trip.plannedDepartAt}</p> : null}
          </div>
        </header>
      ) : null}

      {vehicle?.temp === "reefer" || trip?.chiller ? (
        <div className="rounded-card border border-line bg-raised p-3 text-sm">
          <p className="text-xs font-bold uppercase tracking-wider text-muted">Chiller</p>
          {trip?.chiller ? (
            <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
              <StatusPill label={chillerHeadline(trip.chiller)} tone={chillerVerdict(trip.chiller).tone} />
              <span className="text-muted">{chillerByline(trip.chiller)}</span>
            </p>
          ) : (
            <p className="mt-1 text-muted">No gauge reading recorded for this trip yet. Record one from Loading progress.</p>
          )}
        </div>
      ) : null}

      <div>
        <div className="flex items-baseline justify-between gap-3 text-sm">
          <span className="font-semibold text-ink">Loading progress</span>
          <span className="tabular text-muted">
            <span className="font-bold text-ink">{percent}%</span> ({tally.loadedUnits} / {tally.expectedUnits} units)
          </span>
        </div>
        <div className="mt-1.5">
          <Meter value={tally.loadedUnits} max={tally.expectedUnits} level="near" label="Units loaded" />
        </div>
        <p className="tabular mt-1 text-xs text-muted">
          {tally.checked} of {plural(tally.lines, "order")} checked
        </p>
      </div>

      <Tabs
        label="Trip detail"
        items={[
          { label: "Loading list", href: tabs.list, current: tab === "list" },
          { label: "Vehicle info", href: tabs.vehicle, current: tab === "vehicle" },
        ]}
      />

      {tab === "vehicle" ? (
        <VehicleInfo trip={trip} vehicle={vehicle} />
      ) : lines.length === 0 ? (
        <p className="rounded-card border border-dashed border-line p-6 text-center text-sm text-muted">
          This trip has no orders on it. The dispatcher may have held or cancelled them all.
        </p>
      ) : (
        <LoadingWorkbench
          tripId={tripId}
          tripLabel={label}
          tripContext={context}
          status={status}
          lines={lines}
          districts={districts}
          reasons={reasons}
          reasonsFallback={fallback}
          checkerName={checkerName}
          blocked={trip?.blocked}
        />
      )}
    </div>
  );
}

function VehicleInfo({ trip, vehicle }: { trip: Trip | null; vehicle: Vehicle | null }): ReactNode {
  if (!vehicle) {
    return <p className="text-sm text-muted">Vehicle details could not be loaded.</p>;
  }
  return (
    <div className="flex flex-col gap-3">
      <Facts
        items={[
          { label: "Vehicle", value: vehicle.id },
          { label: "Type", value: vehicle.type === "truck" ? "Truck" : "Van" },
          { label: "Temperature", value: vehicle.temp === "reefer" ? "Refrigerated" : "Ambient" },
          { label: "Weight capacity", value: formatWeight(vehicle.weightCapKg) },
          { label: "Volume capacity", value: formatVolume(vehicle.volumeCapM3) },
          { label: "This trip", value: trip ? `${formatWeight(trip.sumWeightKg)} · ${formatVolume(trip.sumVolumeM3)}` : "—" },
        ]}
      />
      <p className="text-sm text-muted">
        Capacities are the vehicle&rsquo;s limits; the last figure is what the plan put on this trip.
      </p>
    </div>
  );
}
