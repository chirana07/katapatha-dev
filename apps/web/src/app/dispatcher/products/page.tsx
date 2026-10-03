import type { Metadata } from "next";
import Link from "next/link";
import { Button, ButtonLink } from "@/components/ui/button";
import { DataTable, RowCard, Td, Th, Tr } from "@/components/ui/data-table";
import { PageBody, PageHeader } from "@/components/ui/page-header";
import { EmptyState, ErrorPanel } from "@/components/ui/states";
import { BrandPill, StatusPill } from "@/components/ui/status-pill";
import { Tabs } from "@/components/ui/tabs";
import { TempCue } from "@/components/ui/temp-cue";
import { api } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { readFailure } from "@/lib/failures";
import { plural } from "@/lib/format";
import { formatKg, formatM3 } from "@/lib/product-format";
import { BRANDS } from "./product-form";
import { DeactivateDialog, ProductDialog, ReactivateButton } from "./product-dialogs";
import {
  PRODUCTS_PATH,
  brandLabel,
  filterCatalogue,
  parseFilters,
  productsHref,
  tempCounts,
  type Product,
  type ProductFilters,
} from "./product-view";

export const metadata: Metadata = { title: "Products · Katapatha" };
export const dynamic = "force-dynamic";

type Query = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined) {
  return (Array.isArray(value) ? value[0] : value) || undefined;
}

/**
 * The catalogue, as the dispatcher manages it: every product including the
 * deactivated ones, which stay listed because past orders point at them.
 *
 * Filters, and the add / edit / deactivate dialogs, are search params, so a
 * view is a link and the page stays a server component; only the dialogs'
 * forms are client code. The whole catalogue is read once and filtered here,
 * which keeps the tab counts honest without a request per tab.
 */
export default async function ProductsPage({ searchParams }: { searchParams: Promise<Query> }) {
  await requireRole("DISPATCHER", PRODUCTS_PATH);
  const query = await searchParams;
  const filters = parseFilters(query);
  const editId = first(query.edit);
  const deactivateId = first(query.deactivate);
  const adding = first(query.add) === "1";

  const client = await api();
  const result = await client.GET("/products", { params: { query: { includeInactive: "true" } } }).catch(() => null);

  const header = (
    <PageHeader
      title="Products"
      subtitle="What stores can order. Sizes here are what orders are weighed and measured by."
      action={
        <ButtonLink href={productsHref(filters, { add: true })} variant="primary">
          Add product
        </ButtonLink>
      }
    />
  );

  if (!result?.data) {
    const failure = readFailure(result?.response.status ?? 0, "the catalogue");
    return (
      <PageBody>
        {header}
        <ErrorPanel
          title={failure.title}
          detail={failure.detail}
          outcome="read"
          action={
            <ButtonLink href={PRODUCTS_PATH} variant="secondary">
              Try again
            </ButtonLink>
          }
        />
      </PageBody>
    );
  }

  const catalogue = result.data;
  const rows = filterCatalogue(catalogue, filters);
  const counts = tempCounts(catalogue, filters);
  const active = catalogue.filter((product) => product.active).length;
  const filtering = filters.temp !== null || filters.brand !== "any" || filters.status !== "all" || filters.q !== "";
  const returnTo = productsHref(filters);
  const editing = editId ? catalogue.find((product) => product.id === editId) : undefined;
  const deactivating = deactivateId ? catalogue.find((product) => product.id === deactivateId && product.active) : undefined;

  return (
    <PageBody>
      {header}

      {catalogue.length === 0 ? (
        <EmptyState
          title="No products yet"
          detail="Stores can only order products that are in the catalogue."
          action={
            <ButtonLink href={productsHref(filters, { add: true })} variant="primary">
              Add the first product
            </ButtonLink>
          }
        />
      ) : (
        <section aria-label="Catalogue" className="flex flex-col gap-4">
          <Tabs
            label="Temperature"
            items={[
              { label: "All", href: productsHref({ ...filters, temp: null }), current: filters.temp === null, count: counts.all },
              { label: "Ambient", href: productsHref({ ...filters, temp: "ambient" }), current: filters.temp === "ambient", count: counts.ambient },
              { label: "Chilled", href: productsHref({ ...filters, temp: "chilled" }), current: filters.temp === "chilled", count: counts.chilled },
            ]}
          />

          <form method="get" action={PRODUCTS_PATH} role="search" className="flex flex-wrap items-end gap-2">
            {filters.temp ? <input type="hidden" name="temp" value={filters.temp} /> : null}
            <label className="min-w-0 flex-1 basis-56">
              <span className="sr-only">Search by name or SKU</span>
              <input
                type="search"
                name="q"
                defaultValue={filters.q}
                maxLength={80}
                placeholder="Search by name or SKU…"
                className="min-h-11 w-full rounded-control border border-line bg-surface px-3 text-sm text-ink"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs font-semibold text-muted">
              Brand
              <select name="brand" defaultValue={filters.brand} className="min-h-11 rounded-control border border-line bg-surface px-3 text-sm font-normal text-ink">
                <option value="any">Any brand</option>
                <option value="all-brands">All brands only</option>
                {BRANDS.map((brand) => (
                  <option key={brand} value={brand}>
                    {brand}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs font-semibold text-muted">
              Status
              <select name="status" defaultValue={filters.status} className="min-h-11 rounded-control border border-line bg-surface px-3 text-sm font-normal text-ink">
                <option value="all">Active and inactive</option>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            </label>
            <Button type="submit">Apply</Button>
            {filtering ? (
              <ButtonLink href={PRODUCTS_PATH} variant="ghost">
                Clear
              </ButtonLink>
            ) : null}
          </form>

          <ProductsTable rows={rows} filters={filters} returnTo={returnTo} />

          <p className="text-xs text-muted">
            {rows.length === catalogue.length
              ? `${plural(catalogue.length, "product")} · ${active} active`
              : `${rows.length} of ${plural(catalogue.length, "product")}`}
          </p>
        </section>
      )}

      {adding ? <ProductDialog key="add" product={null} returnTo={returnTo} /> : null}
      {editing ? <ProductDialog key={editing.id} product={editing} returnTo={returnTo} /> : null}
      {deactivating ? <DeactivateDialog key={deactivating.id} product={deactivating} returnTo={returnTo} /> : null}
    </PageBody>
  );
}

function RowActions({ product, filters, returnTo }: { product: Product; filters: ProductFilters; returnTo: string }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <ButtonLink href={productsHref(filters, { edit: product.id })} variant="secondary" aria-label={`Edit ${product.name}`}>
        Edit
      </ButtonLink>
      {product.active ? (
        <ButtonLink href={productsHref(filters, { deactivate: product.id })} variant="ghost" aria-label={`Deactivate ${product.name}`}>
          Deactivate
        </ButtonLink>
      ) : (
        <ReactivateButton product={product} returnTo={returnTo} />
      )}
    </div>
  );
}

function StatusCell({ product }: { product: Product }) {
  return <StatusPill label={product.active ? "Active" : "Inactive"} tone={product.active ? "good" : "neutral"} />;
}

function BrandCell({ brand }: { brand: Product["brand"] }) {
  return brand ? <BrandPill brand={brand} /> : <span className="text-sm text-muted">{brandLabel(brand)}</span>;
}

function ProductsTable({ rows, filters, returnTo }: { rows: Product[]; filters: ProductFilters; returnTo: string }) {
  return (
    <DataTable
      caption="Product catalogue"
      empty={
        rows.length === 0 ? (
          <EmptyState
            title="No products match"
            detail="Clear a filter or search for something else."
            action={
              <ButtonLink href={PRODUCTS_PATH} variant="secondary">
                Show all products
              </ButtonLink>
            }
          />
        ) : undefined
      }
      head={
        <tr>
          <Th>SKU</Th>
          <Th>Name</Th>
          <Th>Brand</Th>
          <Th>Temperature</Th>
          <Th>Unit</Th>
          <Th numeric>kg / unit</Th>
          <Th numeric>m³ / unit</Th>
          <Th>Status</Th>
          <Th>
            <span className="sr-only">Actions</span>
          </Th>
        </tr>
      }
      cards={rows.map((product) => (
        <RowCard key={product.id}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="font-semibold text-ink">{product.name}</p>
              <p className="font-mono text-xs text-muted">{product.sku}</p>
            </div>
            <StatusCell product={product} />
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
            <BrandCell brand={product.brand} />
            <TempCue temp={product.tempRequirement} />
            <span>by the {product.unitLabel}</span>
          </div>
          <p className="tabular mt-1 text-sm text-muted">
            {formatKg(product.kgPerUnit)} · {formatM3(product.m3PerUnit)} each
          </p>
          <div className="mt-3">
            <RowActions product={product} filters={filters} returnTo={returnTo} />
          </div>
        </RowCard>
      ))}
    >
      {rows.map((product) => (
        <Tr key={product.id}>
          <Td>
            <Link href={productsHref(filters, { edit: product.id })} className="font-mono font-semibold text-link underline-offset-2 hover:underline">
              {product.sku}
            </Link>
          </Td>
          <Td>
            <span className={product.active ? "font-semibold text-ink" : "text-muted"}>{product.name}</span>
          </Td>
          <Td>
            <BrandCell brand={product.brand} />
          </Td>
          <Td>
            <TempCue temp={product.tempRequirement} />
          </Td>
          <Td>{product.unitLabel}</Td>
          <Td numeric>{product.kgPerUnit.toLocaleString("en-GB", { maximumFractionDigits: 3 })}</Td>
          <Td numeric>{product.m3PerUnit.toLocaleString("en-GB", { maximumFractionDigits: 4 })}</Td>
          <Td>
            <StatusCell product={product} />
          </Td>
          <Td>
            <RowActions product={product} filters={filters} returnTo={returnTo} />
          </Td>
        </Tr>
      ))}
    </DataTable>
  );
}
