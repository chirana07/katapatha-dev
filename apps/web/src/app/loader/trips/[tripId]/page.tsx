import Link from "next/link";
import { ButtonLink } from "@/components/ui/button";
import { PageBody, PageHeader } from "@/components/ui/page-header";
import { ErrorPanel } from "@/components/ui/states";
import { requireRole } from "@/lib/auth";
import { todayInColombo } from "@/lib/dates";
import { readFailure } from "@/lib/failures";
import { loadDock, loadShift, loadTripView } from "../../dock-data.server";
import { tallyLines } from "../../dock-model";
import { DockStatus, Panel } from "../../dock-ui";
import { MobileHeader } from "../../mobile-header";
import { TripDetail, type DetailTab } from "../../trip-detail";
import { TRIP_STATUS_LABEL } from "../../wave";

export const dynamic = "force-dynamic";

type Params = Promise<{ tripId: string }>;
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/**
 * L-08: the loading list on its own page — the phone's second screen, and the
 * way into a trip from anywhere the dock panel is not shown. The trip says
 * which day it belongs to, so a bare link works.
 */
export default async function TripLoadListPage({ params, searchParams }: { params: Params; searchParams: SearchParams }) {
  const { tripId } = await params;
  const query = await searchParams;
  const user = await requireRole("LOADER", `/loader/trips/${tripId}`);
  const rawTab = Array.isArray(query.tab) ? query.tab[0] : query.tab;
  const tab: DetailTab = rawTab === "vehicle" || rawTab === "stops" ? rawTab : "list";
  const rawReport = Array.isArray(query.report) ? query.report[0] : query.report;
  const initialReport = rawReport === "chiller" ? "chiller" : rawReport === "1" ? "issue" : undefined;

  const view = await loadTripView(tripId);
  const date = view.ok && view.trip?.date ? view.trip.date : todayInColombo();
  const back = <ButtonLink href={`/loader?date=${date}`}>Dock queue</ButtonLink>;

  if (!view.ok) {
    const failure = readFailure(view.status, "this loading list");
    return (
      <PageBody>
        <PageHeader title="Loading list" action={back} />
        <ErrorPanel title={failure.title} detail={failure.detail} outcome="read" />
      </PageBody>
    );
  }

  const { trip, status, lines, districts, vehicle } = view;
  const [shift, day] = await Promise.all([loadShift(date), loadDock(date)]);
  const base = `/loader/trips/${encodeURIComponent(tripId)}`;
  const tally = tallyLines(lines);
  // The bay picker jumps to the vehicle loading at that bay.
  const bayOptions = (shift?.bays ?? []).map((bay) => {
    const at = bay.current ?? bay.next;
    return {
      label: at ? `Bay ${bay.bay} · ${at.vehicleId}` : `Bay ${bay.bay} · free`,
      href: at ? `/loader/trips/${encodeURIComponent(at.tripId)}` : `/loader?date=${date}&bay=${bay.bay}`,
      current: at?.tripId === tripId,
    };
  });
  const others = day.ok ? day.trips.filter((t) => t.id !== tripId && (t.status === "PLANNED" || t.status === "LOADING")).length : 0;

  return (
    <PageBody>
      <MobileHeader
        title={trip ? trip.vehicleId : "Loading list"}
        line={trip ? [`Trip ${trip.tripNo}`, trip.dockBay != null ? `Bay ${trip.dockBay}` : null, trip.plannedDepartAt ? `departs ${trip.plannedDepartAt}` : null].filter(Boolean).join("  ·  ") : ""}
        progressLabel={`${tally.loadedUnits} of ${tally.expectedUnits} units loaded`}
        value={tally.loadedUnits}
        max={tally.expectedUnits}
        bays={{ label: trip?.dockBay != null ? `Bay ${trip.dockBay}` : "Bays", options: bayOptions }}
      />

      <div className="hidden lg:block">
        <PageHeader
          title={trip ? trip.vehicleId : "Loading list"}
          subtitle={
            trip
              ? `Trip ${trip.tripNo} · ${trip.districtName}${trip.dockBay != null ? ` · Bay ${trip.dockBay}` : ""}${trip.plannedDepartAt ? ` · departs ${trip.plannedDepartAt}` : ""}`
              : "Load the last stop first."
          }
          aside={<DockStatus label={TRIP_STATUS_LABEL[status]} tone={status === "LOADING" ? "info" : status === "PLANNED" ? "neutral" : "good"} />}
          action={back}
        />
      </div>

      <p className="rounded-[10px] bg-info-surface px-3 py-2.5 text-[12.5px] font-medium text-[#1e3a8a] lg:hidden">
        Load the last stop first. It goes deepest in the truck.
      </p>

      <Panel className="px-4 pt-4 lg:max-w-3xl">
        <TripDetail
          tripId={tripId}
          trip={trip}
          status={status}
          lines={lines}
          districts={districts}
          vehicle={vehicle}
          checkerName={user.name}
          tab={tab}
          tabs={{ list: base, stops: `${base}?tab=stops`, vehicle: `${base}?tab=vehicle` }}
          dispatcherName={shift?.dispatcherName ?? null}
          heading={false}
          layout="page"
          initialReport={initialReport}
        />
      </Panel>

      <p className="text-center text-[13px] text-muted lg:hidden">
        <Link href={`/loader?date=${date}`} className="font-semibold text-link">
          Back to the queue
        </Link>
        {others > 0 ? ` · ${others} more at the dock` : ""}
      </p>
    </PageBody>
  );
}
