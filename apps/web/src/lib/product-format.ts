/**
 * Sizes of goods, as the catalogue states them. A single bag is a few kilos
 * and a few thousandths of a cubic metre; an order is hundreds of kilos. One
 * rule per figure keeps the picker, the review and the dispatcher's table from
 * rounding the same number three different ways.
 */

const trimmed = (value: number, digits: number) =>
  value.toLocaleString("en-GB", { minimumFractionDigits: 0, maximumFractionDigits: digits });

/** "5.1 kg", "126 kg", "1,260 kg": one decimal under 100 kg, whole kilos above. */
export function formatKg(kg: number): string {
  return `${trimmed(kg, kg < 100 ? 1 : 0)} kg`;
}

/** "0.007 m³", "0.14 m³", "4.3 m³": more digits for the tiny per-unit figures. */
export function formatM3(m3: number): string {
  return `${trimmed(m3, m3 < 0.1 ? 3 : m3 < 10 ? 2 : 1)} m³`;
}

/** The size of one unit as the catalogue states it, for a row's fine print. */
export function perUnitSize(product: { kgPerUnit: number; m3PerUnit: number }): string {
  return `${formatKg(product.kgPerUnit)} · ${formatM3(product.m3PerUnit)} each`;
}
