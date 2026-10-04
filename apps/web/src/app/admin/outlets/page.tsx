import type { Metadata } from "next";
import Link from "next/link";
import { Button, ButtonLink } from "@/components/ui/button";
import { DataTable, RowCard, Td, Th, Tr } from "@/components/ui/data-table";
import { PageBody, PageHeader } from "@/components/ui/page-header";
import { EmptyState, ErrorPanel } from "@/components/ui/states";
import { BrandPill, StatusPill } from "@/components/ui/status-pill";
import { Tabs } from "@/components/ui/tabs";
import { api } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { readFailure } from "@/lib/failures";
import { plural } from "@/lib/format";
import { BRANDS } from "./outlet-form";
import { OutletDialog } from "./outlet-dialogs";
import {
  OUTLETS_PATH,
  depotCounts,
  dockLabel,
  filterOutlets,
  mallWindowLabel,
  outletsHref,
  parkingLabel,
  parseFilters,
  positionLabel,
  windowLabel,
  type Outlet,
  type OutletFilters,
} from "./outlet-view";

export const metadata: Metadata = { title: "Outlets · Katapatha" };
export const dynamic = "force-dynamic";

type Query = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined) {
  return (Array.isArray(value) ? value[0] : value) || undefined;
}

/**
 * Every outlet at every depot, as the admin manages them. Outlets are never
 * deleted — orders point at them — so the page only adds and edits.
 *
 * Filters, and the add / edit dialogs, are search params, so a view is a link
 * and the page stays a server component; only the dialog's form is client
 * code. All outlets are read once and filtered here, which keeps the depot tab
 * counts honest without a request per tab. The directory comes alongside: it
 * names the depot tabs and gives the add form its districts.
 */
export default async function OutletsPage({ searchParams }: { searchParams: Promise<Query> }) {
  await requireRole("ADMIN", OUTLETS_PATH);
  const query = await searchParams;
  const editId = first(query.edit);
  const adding = first(query.add) === "1";

  const client = await api();
  const [result, directoryResult] = await Promise.all([
    client.GET("/admin/outlets").catch(() => null),
    client.GET("/admin/directory").catch(() => null),
  ]);

  const directory = directoryResult?.data;
  const depotCodes = directory?.depots.map((depot) => depot.code) ?? [];
  const filters = parseFilters(query, depotCodes);

  const header = (
    <PageHeader
      title="Outlets"
      subtitle="Where each store takes deliveries, and when. Planners route to these docks and windows."
      action={
        <ButtonLink href={outletsHref(filters, { add: true })} variant="primary">
          Add outlet
        </ButtonLink>
      }
    />
  );

  if (!result?.data || !directory) {
    const status = !result?.data ? (result?.response.status ?? 0) : (directoryResult?.response.status ?? 0);
    const failure = readFailure(status, "the outlets");
    return (
      <PageBody>
        {header}
        <ErrorPanel
          title={failure.title}
          detail={failure.detail}
          outcome="read"
          action={
            <ButtonLink href={OUTLETS_PATH} variant="secondary">
              Try again
            </ButtonLink>
          }
        />
      </PageBody>
    );
  }

  const outlets = result.data;
  const rows = filterOutlets(outlets, filters);
  const counts = depotCounts(outlets, filters, depotCodes);
  const filtering = filters.depot !== null || filters.brand !== "any" || filters.q !== "";
  const returnTo = outletsHref(filters);
  const editing = editId ? outlets.find((outlet) => outlet.id === editId) : undefined;
  const approximate = outlets.filter((outlet) => outlet.geoSource === "SYNTHETIC").length;

  return (
    <PageBody>
      {header}

      {outlets.length === 0 ? (
        <EmptyState
          title="No outlets yet"
          detail="Stores can only be delivered to once their outlet is here."
          action={
            <ButtonLink href={outletsHref(filters, { add: true })} variant="primary">
              Add the first outlet
            </ButtonLink>
          }
        />
      ) : (
        <section aria-label="Outlets" className="flex flex-col gap-4">
          <Tabs
            label="Depot"
            items={[
              { label: "All", href: outletsHref({ ...filters, depot: null }), current: filters.depot === null, count: counts.all },
              ...directory.depots.map((depot) => ({
                label: depot.code,
                href: outletsHref({ ...filters, depot: depot.code }),
                current: filters.depot === depot.code,
                count: counts.byDepot[depot.code] ?? 0,
              })),
            ]}
          />

          <form method="get" action={OUTLETS_PATH} role="search" className="flex flex-wrap items-end gap-2">
            {filters.depot ? <input type="hidden" name="depot" value={filters.depot} /> : null}
            <label className="min-w-0 flex-1 basis-56">
              <span className="sr-only">Search by id, name or district</span>
              <input
                type="search"
                name="q"
                defaultValue={filters.q}
                maxLength={80}
                placeholder="Search by id, name or district…"
                className="min-h-11 w-full rounded-control border border-line bg-surface px-3 text-sm text-ink"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs font-semibold text-muted">
              Brand
              <select name="brand" defaultValue={filters.brand} className="min-h-11 rounded-control border border-line bg-surface px-3 text-sm font-normal text-ink">
                <option value="any">Any brand</option>
                {BRANDS.map((brand) => (
                  <option key={brand} value={brand}>
                    {brand}
                  </option>
                ))}
              </select>
            </label>
            <Button type="submit">Apply</Button>
            {filtering ? (
              <ButtonLink href={OUTLETS_PATH} variant="ghost">
                Clear
              </ButtonLink>
            ) : null}
          </form>

          <OutletsTable rows={rows} filters={filters} />

          <p className="text-xs text-muted">
            {rows.length === outlets.length ? plural(outlets.length, "outlet") : `${rows.length} of ${plural(outlets.length, "outlet")}`}
            {approximate > 0 ? ` · ${approximate} placed approximately, near their district centre` : ""}
          </p>
        </section>
      )}

      {adding ? <OutletDialog key="add" outlet={null} directory={directory} returnTo={returnTo} /> : null}
      {editing ? <OutletDialog key={editing.id} outlet={editing} directory={directory} returnTo={returnTo} /> : null}
    </PageBody>
  );
}

function EditAction({ outlet, filters }: { outlet: Outlet; filters: OutletFilters }) {
  return (
    <ButtonLink href={outletsHref(filters, { edit: outlet.id })} variant="secondary" aria-label={`Edit ${outlet.id}`}>
      Edit
    </ButtonLink>
  );
}

function PositionCell({ outlet }: { outlet: Outlet }) {
  const position = positionLabel(outlet);
  return <StatusPill label={position.label} tone={position.tone} />;
}

function WindowCell({ outlet }: { outlet: Outlet }) {
  const mall = mallWindowLabel(outlet);
  return (
    <span className="flex flex-col">
      <span className="tabular">{windowLabel(outlet.windowOpen, outlet.windowClose)}</span>
      {mall ? <span className="tabular text-xs text-muted">Mall {mall}</span> : null}
    </span>
  );
}

function OutletsTable({ rows, filters }: { rows: Outlet[]; filters: OutletFilters }) {
  return (
    <DataTable
      caption="Outlets"
      empty={
        rows.length === 0 ? (
          <EmptyState
            title="No outlets match"
            detail="Clear a filter or search for something else."
            action={
              <ButtonLink href={OUTLETS_PATH} variant="secondary">
                Show all outlets
              </ButtonLink>
            }
          />
        ) : undefined
      }
      head={
        <tr>
          <Th>Outlet</Th>
          <Th>Brand</Th>
          <Th>District · Depot</Th>
          <Th>Dock</Th>
          <Th>Receiving window</Th>
          <Th>Position</Th>
          <Th numeric>Managers</Th>
          <Th>
            <span className="sr-only">Actions</span>
          </Th>
        </tr>
      }
      cards={rows.map((outlet) => (
        <RowCard key={outlet.id}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="font-semibold text-ink">{outlet.displayName ?? outlet.id}</p>
              <p className="font-mono text-xs text-muted">{outlet.id}</p>
            </div>
            <BrandPill brand={outlet.brand} />
          </div>
          <p className="mt-2 text-sm text-muted">
            {outlet.districtName} · {outlet.depotCode}
          </p>
          <p className="mt-1 text-sm text-muted">
            {dockLabel(outlet.dockType)} · {parkingLabel(outlet.parkingConstraint)} parking
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink">
            <WindowCell outlet={outlet} />
            <PositionCell outlet={outlet} />
            <span className="text-muted">{plural(outlet.managers, "manager")}</span>
          </div>
          <div className="mt-3">
            <EditAction outlet={outlet} filters={filters} />
          </div>
        </RowCard>
      ))}
    >
      {rows.map((outlet) => (
        <Tr key={outlet.id}>
          <Td>
            <Link href={outletsHref(filters, { edit: outlet.id })} className="font-mono font-semibold text-link underline-offset-2 hover:underline">
              {outlet.id}
            </Link>
            {outlet.displayName ? <span className="block text-sm text-ink">{outlet.displayName}</span> : null}
          </Td>
          <Td>
            <BrandPill brand={outlet.brand} />
          </Td>
          <Td>
            {outlet.districtName} <span className="text-muted">· {outlet.depotCode}</span>
          </Td>
          <Td>
            <span className="block">{dockLabel(outlet.dockType)}</span>
            <span className="block text-xs text-muted">{parkingLabel(outlet.parkingConstraint)} parking</span>
          </Td>
          <Td>
            <WindowCell outlet={outlet} />
          </Td>
          <Td>
            <PositionCell outlet={outlet} />
          </Td>
          <Td numeric>{outlet.managers}</Td>
          <Td>
            <EditAction outlet={outlet} filters={filters} />
          </Td>
        </Tr>
      ))}
    </DataTable>
  );
}
