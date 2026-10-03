import { ButtonLink } from "@/components/ui/button";
import { PageBody, PageHeader } from "@/components/ui/page-header";
import { ErrorPanel } from "@/components/ui/states";
import { StatusPill } from "@/components/ui/status-pill";
import { requireRole } from "@/lib/auth";
import { todayInColombo } from "@/lib/dates";
import { readFailure } from "@/lib/failures";
import { loadTripView } from "../../dock-data.server";
import { statusTone } from "../../dock-model";
import { TripDetail } from "../../trip-detail";
import { TRIP_STATUS_LABEL } from "../../wave";

export const dynamic = "force-dynamic";

type Params = Promise<{ tripId: string }>;
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/**
 * The loading list on its own page: the phone's second screen, and the way into
 * a trip from anywhere the dock panel is not shown. The trip itself says which
 * day it belongs to, so a bare link works; `?date=` is no longer needed.
 */
export default async function TripLoadListPage({ params, searchParams }: { params: Params; searchParams: SearchParams }) {
  const { tripId } = await params;
  const query = await searchParams;
  const user = await requireRole("LOADER", `/loader/trips/${tripId}`);
  const tab = (Array.isArray(query.tab) ? query.tab[0] : query.tab) === "vehicle" ? "vehicle" : "list";

  const view = await loadTripView(tripId);
  const back = <ButtonLink href={`/loader?date=${view.ok && view.trip?.date ? view.trip.date : todayInColombo()}`}>Dock queue</ButtonLink>;

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
  const base = `/loader/trips/${encodeURIComponent(tripId)}`;

  return (
    <PageBody>
      <PageHeader
        title={trip ? trip.vehicleId : "Loading list"}
        subtitle={
          trip
            ? `Trip ${trip.tripNo} · ${trip.districtName}${trip.plannedDepartAt ? ` · departs ${trip.plannedDepartAt}` : ""}`
            : "Load the last stop first."
        }
        aside={<StatusPill label={TRIP_STATUS_LABEL[status]} tone={statusTone(status)} />}
        action={back}
      />
      <section className="rounded-card border border-line bg-surface p-4">
        <TripDetail
          tripId={tripId}
          trip={trip}
          status={status}
          lines={lines}
          districts={districts}
          vehicle={vehicle}
          checkerName={user.name}
          tab={tab}
          tabs={{ list: base, vehicle: `${base}?tab=vehicle` }}
          heading={false}
        />
      </section>
    </PageBody>
  );
}
