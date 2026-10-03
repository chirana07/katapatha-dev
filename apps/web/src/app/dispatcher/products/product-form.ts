import type { components } from "@katapatha/contracts/types";

type Create = components["schemas"]["CreateProductRequest"];
type Update = components["schemas"]["UpdateProductRequest"];
type Brand = components["schemas"]["Brand"];

export const BRANDS: readonly Brand[] = ["Fresh", "Style", "Tech"];
export const SKU_PATTERN = /^[A-Z0-9][A-Z0-9_-]{1,31}$/;

/** What the form holds: every field as the text the dispatcher typed or picked. */
export interface ProductFormValues {
  sku: string;
  name: string;
  /** "" is every brand. */
  brand: string;
  tempRequirement: string;
  unitLabel: string;
  kgPerUnit: string;
  m3PerUnit: string;
  /** "" leaves it to the API (end of the list on create, unchanged on edit). */
  sortOrder: string;
}

export type ProductField = keyof ProductFormValues;
export type FieldErrors = Partial<Record<ProductField, string>>;

export const EMPTY_PRODUCT_FORM: ProductFormValues = {
  sku: "",
  name: "",
  brand: "",
  tempRequirement: "ambient",
  unitLabel: "",
  kgPerUnit: "",
  m3PerUnit: "",
  sortOrder: "",
};

export function readProductForm(formData: FormData): ProductFormValues {
  const text = (name: ProductField) => {
    const value = formData.get(name);
    return typeof value === "string" ? value : "";
  };
  return {
    sku: text("sku"),
    name: text("name"),
    brand: text("brand"),
    tempRequirement: text("tempRequirement"),
    unitLabel: text("unitLabel"),
    kgPerUnit: text("kgPerUnit"),
    m3PerUnit: text("m3PerUnit"),
    sortOrder: text("sortOrder"),
  };
}

/** The SKU as the catalogue stores it: upper-case, no stray spaces. */
export function normaliseSku(value: string): string {
  return value.trim().toUpperCase();
}

function size(value: string, label: string, maximum: number): { value: number } | { error: string } {
  const text = value.trim();
  if (text === "") return { error: `Enter the ${label}.` };
  const parsed = Number(text);
  if (!Number.isFinite(parsed) || parsed <= 0) return { error: `The ${label} must be a number above 0.` };
  if (parsed > maximum) return { error: `The ${label} can be at most ${maximum}.` };
  return { value: parsed };
}

type Checked = { ok: true; fields: Omit<Create, "sku"> } | { ok: false; errors: FieldErrors };

/** The fields a create and an edit share. */
function checkFields(values: ProductFormValues): Checked {
  const errors: FieldErrors = {};

  const name = values.name.trim();
  if (name.length < 2 || name.length > 120) errors.name = "Give the product a name of 2 to 120 characters.";

  const brand = values.brand.trim();
  if (brand !== "" && !BRANDS.includes(brand as Brand)) errors.brand = "Choose a brand, or All brands.";

  if (values.tempRequirement !== "ambient" && values.tempRequirement !== "chilled") {
    errors.tempRequirement = "Choose ambient or chilled.";
  }

  const unitLabel = values.unitLabel.trim();
  if (unitLabel.length < 1 || unitLabel.length > 24) errors.unitLabel = "Name the unit in 1 to 24 characters, for example bag or carton.";

  const kg = size(values.kgPerUnit, "weight per unit", 1000);
  if ("error" in kg) errors.kgPerUnit = kg.error;
  const m3 = size(values.m3PerUnit, "volume per unit", 100);
  if ("error" in m3) errors.m3PerUnit = m3.error;

  let sortOrder: number | undefined;
  if (values.sortOrder.trim() !== "") {
    const parsed = Number(values.sortOrder.trim());
    if (!Number.isInteger(parsed) || parsed < 0 || parsed > 1_000_000) {
      errors.sortOrder = "Sort order is a whole number from 0 to 1,000,000, or leave it empty.";
    } else sortOrder = parsed;
  }

  if (Object.keys(errors).length > 0 || "error" in kg || "error" in m3) return { ok: false, errors };
  return {
    ok: true,
    fields: {
      name,
      brand: brand === "" ? null : (brand as Brand),
      tempRequirement: values.tempRequirement as "ambient" | "chilled",
      unitLabel,
      kgPerUnit: kg.value,
      m3PerUnit: m3.value,
      ...(sortOrder !== undefined ? { sortOrder } : {}),
    },
  };
}

export function validateNewProduct(values: ProductFormValues): { ok: true; data: Create } | { ok: false; errors: FieldErrors } {
  const sku = normaliseSku(values.sku);
  const checked = checkFields(values);
  const errors: FieldErrors = checked.ok ? {} : checked.errors;
  if (!SKU_PATTERN.test(sku)) {
    errors.sku = "Use 2 to 32 letters, digits, dashes or underscores, starting with a letter or digit. For example FA010.";
  }
  if (!checked.ok || errors.sku) return { ok: false, errors };
  return { ok: true, data: { sku, ...checked.fields } };
}

/** The SKU is not editable, so an edit never sends one. */
export function validateProductEdit(values: ProductFormValues): { ok: true; data: Update } | { ok: false; errors: FieldErrors } {
  const checked = checkFields(values);
  return checked.ok ? { ok: true, data: checked.fields } : { ok: false, errors: checked.errors };
}
