import { describe, expect, it } from "vitest";
import { EMPTY_PRODUCT_FORM, normaliseSku, validateNewProduct, validateProductEdit, type ProductFormValues } from "./product-form";

const valid: ProductFormValues = {
  sku: " fa010 ",
  name: " Samba Rice 5 kg ",
  brand: "Fresh",
  tempRequirement: "ambient",
  unitLabel: "bag",
  kgPerUnit: "5.1",
  m3PerUnit: "0.007",
  sortOrder: "",
};

describe("validateNewProduct", () => {
  it("builds the request, upper-casing the SKU and trimming text", () => {
    expect(validateNewProduct(valid)).toEqual({
      ok: true,
      data: { sku: "FA010", name: "Samba Rice 5 kg", brand: "Fresh", tempRequirement: "ambient", unitLabel: "bag", kgPerUnit: 5.1, m3PerUnit: 0.007 },
    });
  });

  it("sends null for All brands and a sort order only when given", () => {
    const result = validateNewProduct({ ...valid, brand: "", sortOrder: "30" });
    expect(result.ok && result.data).toMatchObject({ brand: null, sortOrder: 30 });
  });

  it("reports every field that is wrong at once, so the form can mark them all", () => {
    const result = validateNewProduct(EMPTY_PRODUCT_FORM);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(Object.keys(result.errors).sort()).toEqual(["kgPerUnit", "m3PerUnit", "name", "sku", "unitLabel"]);
  });

  it("rejects a SKU the API would", () => {
    for (const sku of ["F", "-FA1", "FA 1", "FA001!", "A".repeat(33)]) {
      const result = validateNewProduct({ ...valid, sku });
      expect(result.ok).toBe(false);
    }
    expect(validateNewProduct({ ...valid, sku: "wg-001_b" }).ok).toBe(true);
  });

  it("rejects sizes that are zero, negative, not numbers or too big", () => {
    for (const kgPerUnit of ["0", "-1", "abc", "1000.5", " "]) {
      expect(validateNewProduct({ ...valid, kgPerUnit }).ok).toBe(false);
    }
    expect(validateNewProduct({ ...valid, m3PerUnit: "100.1" }).ok).toBe(false);
    expect(validateNewProduct({ ...valid, m3PerUnit: "100" }).ok).toBe(true);
  });

  it("rejects a bad temperature, brand or sort order", () => {
    expect(validateNewProduct({ ...valid, tempRequirement: "frozen" }).ok).toBe(false);
    expect(validateNewProduct({ ...valid, brand: "Acme" }).ok).toBe(false);
    expect(validateNewProduct({ ...valid, sortOrder: "1.5" }).ok).toBe(false);
    expect(validateNewProduct({ ...valid, sortOrder: "-1" }).ok).toBe(false);
  });
});

describe("validateProductEdit", () => {
  it("never carries a SKU, even when the form has one", () => {
    const result = validateProductEdit(valid);
    expect(result.ok && "sku" in result.data).toBe(false);
  });

  it("does not require a valid SKU, since it is read-only", () => {
    expect(validateProductEdit({ ...valid, sku: "" }).ok).toBe(true);
  });

  it("validates the same fields as a create", () => {
    expect(validateProductEdit({ ...valid, name: "x" }).ok).toBe(false);
  });
});

describe("normaliseSku", () => {
  it("upper-cases and trims", () => {
    expect(normaliseSku(" fa001 ")).toBe("FA001");
  });
});
