import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { Button, ButtonLink } from "@/components/ui/button";
import { DataTable, RowCard, Td, Th, Tr } from "@/components/ui/data-table";
import { PageBody, PageHeader } from "@/components/ui/page-header";
import { EmptyState, ErrorPanel } from "@/components/ui/states";
import { StatusPill } from "@/components/ui/status-pill";
import { Tabs } from "@/components/ui/tabs";
import { api } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { readFailure } from "@/lib/failures";
import { VehicleDialog } from "./vehicle-dialog";
import {
  VEHICLES_PATH,
  capacityLabel,
  depotCounts,
  filterFleet,
  fleetSummary,
  fuelLabel,
  knownDepots,
  parseFilters,
  vehicleTempLabel,
  vehicleTypeLabel,
  vehiclesHref,
  type AdminVehicle,
  type VehicleFilters,
} from "./vehicle-view";

export const metadata: Metadata = { title: "Vehicles · Katapatha" };
export const dynamic = "force-dynamic";

type Query = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined) {
  return (Array.isArray(value) ? value[0] : value) || undefined;
}

/**
 * Every vehicle at every depot, as the admin keeps the fleet: what each one
 * can carry and burn, which is what the allocator plans with. Vehicles are
 * never deleted, because plans, trips and fuel ledgers point at them.
 *
 * Filters and the add / edit dialog are search params, so a view is a link and
 * the page stays a server component; only the dialog's form is client code.
 * The whole fleet is read once and filtered here, which keeps the depot tab
 * counts honest without a request per tab.
 */
export default async function VehiclesPage({ searchParams }: { searchParams: Promise<Query> }) {
  await requireRole("ADMIN", VEHICLES_PATH);
  const query = await searchParams;
  const editId = first(query.edit);
  const adding = first(query.add) === "1";

  const client = await api();
  // The directory only names the depots; without it the page still works from the codes the vehicles carry.
  const [fleetResult, directoryResult] = await Promise.all([
    client.GET("/admin/vehicles").catch(() => null),
    client.GET("/admin/directory").catch(() => null),
  ]);

  const header = (action?: ReactNode) => (
    <PageHeader
      title="Vehicles"
      subtitle="The fleet the allocator plans with: what each vehicle can carry, and the fuel it is costed on."
      action={action}
    />
  );

  if (!fleetResult?.data) {
    const failure = readFailure(fleetResult?.response.status ?? 0, "the fleet");
    return (
      <PageBody>
        {header()}
        <ErrorPanel
          title={failure.title}
          detail={failure.detail}
          outcome="read"
          action={
            <ButtonLink href={VEHICLES_PATH} variant="secondary">
              Try again
            </ButtonLink>
          }
        />
      </PageBody>
    );
  }

  const fleet = fleetResult.data;
  const depots = knownDepots(directoryResult?.data?.depots ?? null, fleet);
  const filters = parseFilters(query, depots.map((depot) => depot.code));
  const rows = filterFleet(fleet, filters);
  const counts = depotCounts(fleet, filters);
  const filtering = filters.temp !== null || filters.type !== null;
  const returnTo = vehiclesHref(filters);
  const editing = editId ? fleet.find((vehicle) => vehicle.id === editId) : undefined;
  const depotName = (code: string) => depots.find((depot) => depot.code === code)?.name ?? code;
  // Adding needs a depot to add to; with none known the button would open a form that cannot be saved.
  const canAdd = depots.length > 0;
  const addButton = canAdd ? (
    <ButtonLink href={vehiclesHref(filters, { add: true })} variant="primary">
      Add vehicle
    </ButtonLink>
  ) : undefined;

  return (
    <PageBody>
      {header(addButton)}

      <p className="text-sm text-muted">
        Taking a vehicle out for the workshop is the dispatcher&apos;s call, made on the day; it is not set here.
      </p>

      {fleet.length === 0 ? (
        <EmptyState
          title="No vehicles yet"
          detail="The allocator can only plan trips on vehicles listed here."
          action={
            canAdd ? (
              <ButtonLink href={vehiclesHref(filters, { add: true })} variant="primary">
                Add the first vehicle
              </ButtonLink>
            ) : undefined
          }
        />
      ) : (
        <section aria-label="Fleet" className="flex flex-col gap-4">
          <Tabs
            label="Depot"
            items={[
              { label: "All", href: vehiclesHref({ ...filters, depot: null }), current: filters.depot === null, count: counts.all },
              ...depots.map((depot) => ({
                label: depot.name,
                href: vehiclesHref({ ...filters, depot: depot.code }),
                current: filters.depot === depot.code,
                count: counts.byDepot[depot.code] ?? 0,
              })),
            ]}
          />

          <form method="get" action={VEHICLES_PATH} className="flex flex-wrap items-end gap-2">
            {filters.depot ? <input type="hidden" name="depot" value={filters.depot} /> : null}
            <label className="flex flex-col gap-1 text-xs font-semibold text-muted">
              Temperature
              <select name="temp" defaultValue={filters.temp ?? ""} className="min-h-11 rounded-control border border-line bg-surface px-3 text-sm font-normal text-ink">
                <option value="">Any temperature</option>
                <option value="reefer">Refrigerated</option>
                <option value="ambient">Ambient</option>
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs font-semibold text-muted">
              Type
              <select name="type" defaultValue={filters.type ?? ""} className="min-h-11 rounded-control border border-line bg-surface px-3 text-sm font-normal text-ink">
                <option value="">Any type</option>
                <option value="truck">Truck</option>
                <option value="van">Van</option>
              </select>
            </label>
            <Button type="submit">Apply</Button>
            {filtering ? (
              <ButtonLink href={vehiclesHref({ ...filters, temp: null, type: null })} variant="ghost">
                Clear
              </ButtonLink>
            ) : null}
          </form>

          <VehiclesTable rows={rows} filters={filters} depotName={depotName} />

          <p className="tabular text-xs text-muted">{fleetSummary(rows, fleet.length)}</p>
        </section>
      )}

      {adding && canAdd ? (
        <VehicleDialog key="add" vehicle={null} depots={depots} defaultDepot={filters.depot ?? (depots.length === 1 ? depots[0].code : "")} returnTo={returnTo} />
      ) : null}
      {editing ? <VehicleDialog key={editing.id} vehicle={editing} depots={depots} defaultDepot={editing.depotCode} returnTo={returnTo} /> : null}
    </PageBody>
  );
}

function TempCell({ vehicle }: { vehicle: AdminVehicle }) {
  // Info tone for refrigerated so the cold-capable vehicles stand out; the word carries the meaning, not the tint.
  return <StatusPill label={vehicleTempLabel(vehicle.temp)} tone={vehicle.temp === "reefer" ? "info" : "neutral"} dot={false} />;
}

function EditLink({ vehicle, filters }: { vehicle: AdminVehicle; filters: VehicleFilters }) {
  return (
    <ButtonLink href={vehiclesHref(filters, { edit: vehicle.id })} variant="secondary" aria-label={`Edit ${vehicle.id}`}>
      Edit
    </ButtonLink>
  );
}

function VehiclesTable({ rows, filters, depotName }: { rows: AdminVehicle[]; filters: VehicleFilters; depotName: (code: string) => string }) {
  return (
    <DataTable
      caption="Vehicles"
      empty={
        rows.length === 0 ? (
          <EmptyState
            title="No vehicles match"
            detail="Clear a filter or pick another depot."
            action={
              <ButtonLink href={VEHICLES_PATH} variant="secondary">
                Show every vehicle
              </ButtonLink>
            }
          />
        ) : undefined
      }
      head={
        <tr>
          <Th>Vehicle</Th>
          <Th>Depot</Th>
          <Th>Type</Th>
          <Th>Temperature</Th>
          <Th numeric>Capacity</Th>
          <Th>Fuel</Th>
          <Th numeric>Trips planned</Th>
          <Th>
            <span className="sr-only">Actions</span>
          </Th>
        </tr>
      }
      cards={rows.map((vehicle) => (
        <RowCard key={vehicle.id}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="font-mono font-semibold text-ink">{vehicle.id}</p>
              <p className="text-xs text-muted">
                {vehicleTypeLabel(vehicle.type)} · {depotName(vehicle.depotCode)}
              </p>
            </div>
            <TempCell vehicle={vehicle} />
          </div>
          <p className="tabular mt-2 text-sm text-ink">{capacityLabel(vehicle)}</p>
          <p className="tabular mt-1 text-sm text-muted">{fuelLabel(vehicle)}</p>
          <p className="tabular mt-1 text-xs text-muted">{vehicle.trips.toLocaleString("en-GB")} trips planned</p>
          <div className="mt-3">
            <EditLink vehicle={vehicle} filters={filters} />
          </div>
        </RowCard>
      ))}
    >
      {rows.map((vehicle) => (
        <Tr key={vehicle.id}>
          <Td>
            <Link href={vehiclesHref(filters, { edit: vehicle.id })} className="font-mono font-semibold text-link underline-offset-2 hover:underline">
              {vehicle.id}
            </Link>
          </Td>
          <Td>{depotName(vehicle.depotCode)}</Td>
          <Td>{vehicleTypeLabel(vehicle.type)}</Td>
          <Td>
            <TempCell vehicle={vehicle} />
          </Td>
          <Td numeric>{capacityLabel(vehicle)}</Td>
          <Td>
            <span className="tabular text-sm">{fuelLabel(vehicle)}</span>
          </Td>
          <Td numeric>{vehicle.trips.toLocaleString("en-GB")}</Td>
          <Td>
            <EditLink vehicle={vehicle} filters={filters} />
          </Td>
        </Tr>
      ))}
    </DataTable>
  );
}
