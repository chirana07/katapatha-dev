import type { components } from "@katapatha/contracts/types";
import { isTemp, tempLabel } from "@/lib/temperature";
import { BRANDS } from "./product-form";

export type Product = components["schemas"]["Product"];
type Brand = components["schemas"]["Brand"];
type Temp = Product["tempRequirement"];

export type StatusFilter = "all" | "active" | "inactive";
/** "any" shows everything; "all-brands" only the products for every brand. */
export type BrandFilter = "any" | "all-brands" | Brand;

export interface ProductFilters {
  temp: Temp | null;
  brand: BrandFilter;
  status: StatusFilter;
  q: string;
}

type Query = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

/** The page's filters from its search params; anything unrecognised means "no filter". */
export function parseFilters(query: Query): ProductFilters {
  const temp = first(query.temp);
  const brand = first(query.brand);
  const status = first(query.status);
  return {
    temp: isTemp(temp) ? temp : null,
    brand: brand === "all-brands" ? "all-brands" : (BRANDS as readonly string[]).includes(brand) ? (brand as Brand) : "any",
    status: status === "active" || status === "inactive" ? status : "all",
    q: first(query.q).trim().slice(0, 80),
  };
}

export function brandLabel(brand: Product["brand"]): string {
  return brand ?? "All brands";
}

export { tempLabel };

/**
 * The catalogue narrowed by the filters. `ignore` lets the tab counts apply
 * every filter except the one the tab itself is, so "Chilled (7)" still says
 * 7 while the Ambient tab is open.
 */
export function filterCatalogue(products: readonly Product[], filters: ProductFilters, ignore?: "temp"): Product[] {
  const needle = filters.q.toLowerCase();
  return products.filter((product) => {
    if (ignore !== "temp" && filters.temp && product.tempRequirement !== filters.temp) return false;
    if (filters.brand === "all-brands" && product.brand !== null) return false;
    if (filters.brand !== "any" && filters.brand !== "all-brands" && product.brand !== filters.brand) return false;
    if (filters.status === "active" && !product.active) return false;
    if (filters.status === "inactive" && product.active) return false;
    return needle === "" || product.name.toLowerCase().includes(needle) || product.sku.toLowerCase().includes(needle);
  });
}

export function tempCounts(products: readonly Product[], filters: ProductFilters): Record<"all" | Temp, number> {
  const rest = filterCatalogue(products, filters, "temp");
  return {
    all: rest.length,
    ambient: rest.filter((product) => product.tempRequirement === "ambient").length,
    chilled: rest.filter((product) => product.tempRequirement === "chilled").length,
    frozen: rest.filter((product) => product.tempRequirement === "frozen").length,
  };
}

export const PRODUCTS_PATH = "/dispatcher/products";

/** A link back to the page keeping the filters, with the dialog (if any) the link opens. */
export function productsHref(filters: ProductFilters, extra?: { edit?: string; deactivate?: string; add?: boolean }): string {
  const params = new URLSearchParams();
  if (filters.temp) params.set("temp", filters.temp);
  if (filters.brand !== "any") params.set("brand", filters.brand);
  if (filters.status !== "all") params.set("status", filters.status);
  if (filters.q) params.set("q", filters.q);
  if (extra?.edit) params.set("edit", extra.edit);
  if (extra?.deactivate) params.set("deactivate", extra.deactivate);
  if (extra?.add) params.set("add", "1");
  const qs = params.toString();
  return qs ? `${PRODUCTS_PATH}?${qs}` : PRODUCTS_PATH;
}

/**
 * Where a form returns to. It arrives as a hidden field, so it is followed only
 * when it stays on this page: anything else falls back to the bare page.
 */
export function safeProductsPath(value: FormDataEntryValue | null): string {
  if (typeof value !== "string") return PRODUCTS_PATH;
  if (value !== PRODUCTS_PATH && !value.startsWith(`${PRODUCTS_PATH}?`)) return PRODUCTS_PATH;
  if (value.includes("\\") || value.includes("//")) return PRODUCTS_PATH;
  return value;
}
