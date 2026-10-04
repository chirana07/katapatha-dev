import Link from "next/link";
import type { ReactNode } from "react";
import { Facts } from "@/components/ui/detail-panel";
import { plural } from "@/lib/format";
import type { Vehicle } from "./dock-data.server";
import { groupByStop, tallyLines, type LoadLine } from "./dock-model";
import { Bar, NumberDisc, Tag } from "./dock-ui";
import { formatVolume, formatWeight } from "./format";
import { chillerByline, chillerHeadline, chillerVerdict } from "./chiller";
import { TruckIcon } from "./icons";
import { fetchShortfallReasons } from "./reasons.server";
import { SwapNotice } from "./swap-notice";
import { LoadingWorkbench } from "./trips/[tripId]/loading-workbench";
import { TRIP_STATUS_LABEL, type Trip, type TripStatus } from "./wave";

export type DetailTab = "list" | "stops" | "vehicle";

/**
 * One trip at the dock (L-02's right panel; L-08's body): who it is, how far
 * along, and the three tabs — the loading list, its stops, the vehicle.
 *
 * A server component, so the reasons vocabulary is read once on the server.
 * The swap notice (L-04) opens over it while a swap is unread.
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
  dispatcherName,
  heading = true,
  layout = "panel",
  initialReport,
}: {
  tripId: string;
  trip: Trip | null;
  status: TripStatus;
  lines: LoadLine[];
  districts: Record<string, string>;
  vehicle: Vehicle | null;
  checkerName: string;
  tab: DetailTab;
  /** Hrefs for the three tabs, built by the caller so each keeps its own query. */
  tabs: Record<DetailTab, string>;
  dispatcherName: string | null;
  heading?: boolean;
  layout?: "panel" | "page";
  initialReport?: "issue" | "chiller";
}) {
  const tally = tallyLines(lines);
  const percent = tally.expectedUnits > 0 ? Math.round((tally.loadedUnits / tally.expectedUnits) * 100) : 0;
  const { reasons, fallback } = await fetchShortfallReasons();
  const groups = groupByStop(lines);
  const refrigerated = vehicle?.temp === "reefer";
  const bay = trip?.dockBay ?? null;

  const label = trip ? `${trip.vehicleId} · Trip ${trip.tripNo} · ${trip.districtName}` : "Loading list";
  const context = [bay != null ? `Bay ${bay}` : null, plural(tally.stops, "stop"), trip?.plannedDepartAt ? `departs ${trip.plannedDepartAt}` : null]
    .filter(Boolean)
    .join(" · ");
  const departed = status === "DEPARTED" || status === "COMPLETED";

  return (
    <div className="flex flex-col gap-4">
      {trip?.swap ? (
        <SwapNotice
          tripId={tripId}
          swap={trip.swap}
          bay={bay}
          stops={groups.length}
          stopOrder={groups.map((g, i) => (i === 0 ? `Stop ${g.seq + 1} ${g.outletId}` : `Stop ${g.seq + 1}`)).join(" → ")}
          stores={new Set(lines.map((line) => line.outletId)).size}
          checkerName={checkerName}
          listHref={tabs.list}
        />
      ) : null}

      {heading && trip ? (
        <header className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <span aria-hidden className="grid size-12 shrink-0 place-items-center rounded-[10px] bg-info-surface text-link">
              <TruckIcon className="size-6" />
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-1.5">
                <h2 className="text-xl font-bold text-[#111827]">{trip.vehicleId}</h2>
                <Tag>Trip {trip.tripNo}</Tag>
                <Tag tone={trip.brand === "Fresh" ? "good" : trip.brand === "Style" ? "bad" : "info"}>{trip.brand}</Tag>
                {refrigerated ? <Tag>Refrigerated</Tag> : null}
              </div>
              <p className="mt-0.5 text-sm text-muted">
                {trip.districtName} · {plural(tally.stops, "stop")} · {plural(tally.lines, "order")}
                {bay != null ? ` · Bay ${bay}` : ""}
              </p>
            </div>
          </div>
          <div className="shrink-0 text-right">
            <p className="inline-block rounded-[5px] bg-raised px-1.5 py-0.5 text-xs text-[#374151]">
              {departed ? TRIP_STATUS_LABEL[status] : status === "READY" ? "Sealed · not yet departed" : "Not yet departed"}
            </p>
            {trip.plannedDepartAt ? <p className="tabular mt-1 text-sm text-[#111827]">Departs {trip.plannedDepartAt}</p> : null}
          </div>
        </header>
      ) : null}

      {refrigerated && trip?.chiller ? (
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-[10px] border border-[#e5e7eb] bg-[#f9fafb] px-3 py-2 text-[13px]">
          <span className="font-semibold text-[#111827]">Chiller</span>
          <span className={chillerVerdict(trip.chiller).tone === "bad" ? "font-semibold text-bad-ink" : "font-semibold text-good-ink"}>
            {chillerHeadline(trip.chiller)}
          </span>
          <span className="text-muted">{chillerByline(trip.chiller)}</span>
        </p>
      ) : null}

      {/* On a phone the dark header already shows the progress (L-08). */}
      <div className={layout === "page" ? "hidden lg:block" : undefined}>
        <p className="text-sm font-semibold text-[#111827]">Loading progress</p>
        <div className="mt-1.5 flex items-center gap-3">
          <div className="flex-1">
            <Bar segments={[{ value: tally.loadedUnits, color: "blue" }]} max={tally.expectedUnits} label="Units loaded" height="h-2" />
          </div>
          <p className="tabular shrink-0 text-sm text-[#374151]">
            <span className="font-bold text-[#111827]">{percent}%</span> ({tally.loadedUnits} / {tally.expectedUnits} units)
          </p>
        </div>
      </div>

      <div className={layout === "page" && tab === "list" ? "hidden lg:block" : undefined}>
        <DetailTabs
          current={tab}
          hrefs={tabs}
          labels={{ list: "Loading list", stops: `Stops (${groups.length})`, vehicle: "Vehicle info" }}
        />
      </div>

      {tab === "vehicle" ? (
        <VehicleInfo trip={trip} vehicle={vehicle} />
      ) : tab === "stops" ? (
        <StopsList lines={lines} districts={districts} />
      ) : lines.length === 0 ? (
        <p className="rounded-[10px] border border-dashed border-line p-6 text-center text-sm text-muted">
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
          dispatcherName={dispatcherName}
          refrigerated={refrigerated}
          layout={layout}
          initialReport={initialReport}
          vehicleHref={tabs.vehicle}
        />
      )}
    </div>
  );
}

/** The panel's tab strip: equal-width tabs, the current one on a flame wash
 *  with a flame underline (L-02). */
function DetailTabs({ current, hrefs, labels }: { current: DetailTab; hrefs: Record<DetailTab, string>; labels: Record<DetailTab, string> }) {
  return (
    <nav aria-label="Trip detail" className="-mx-4 grid grid-cols-3 border-b border-[#e5e7eb]">
      {(["list", "stops", "vehicle"] as const).map((key) => (
        <Link
          key={key}
          href={hrefs[key]}
          scroll={false}
          aria-current={current === key ? "page" : undefined}
          className={`flex min-h-11 items-center justify-center border-b-[3px] px-2 text-[15px] ${
            current === key ? "border-action bg-[#fff8e6] font-semibold text-[#111827]" : "border-transparent text-[#374151] hover:bg-raised"
          }`}
        >
          {labels[key]}
        </Link>
      ))}
    </nav>
  );
}

function StopsList({ lines, districts }: { lines: LoadLine[]; districts: Record<string, string> }) {
  const groups = groupByStop(lines);
  return (
    <ol className="flex flex-col divide-y divide-[#e5e7eb] rounded-[12px] border border-[#e5e7eb]">
      {groups.map((group) => (
        <li key={group.seq} className="flex items-start gap-3 px-3 py-3">
          <NumberDisc n={group.seq + 1} tone="night" size="md" />
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-[#111827]">
              Stop {group.seq + 1} · {group.outletId}
              {districts[group.outletId] ? ` · ${districts[group.outletId]}` : ""}
            </p>
            <p className="text-[13px] text-muted">
              Delivered {group.seq === 0 ? "first" : `${group.seq + 1}${group.seq === 1 ? "nd" : group.seq === 2 ? "rd" : "th"}`} · loaded{" "}
              {group.loadOrder === 1 ? "first" : group.loadOrder === groups.length ? "last" : `${group.loadOrder}${group.loadOrder === 2 ? "nd" : group.loadOrder === 3 ? "rd" : "th"}`}
            </p>
            <p className="mt-1 text-[13px] text-[#374151]">{group.lines.map((line) => `${line.orderRef} (${line.expectedUnits})`).join(" · ")}</p>
          </div>
          <p className="tabular shrink-0 text-sm text-[#374151]">
            {group.tally.loadedUnits} / {group.tally.expectedUnits}
          </p>
        </li>
      ))}
    </ol>
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
          { label: "Bay", value: trip?.dockBay != null ? `Bay ${trip.dockBay}` : "—" },
        ]}
      />
      <p className="text-sm text-muted">Capacities are the vehicle&rsquo;s limits; &ldquo;This trip&rdquo; is what the plan put on it.</p>
    </div>
  );
}
