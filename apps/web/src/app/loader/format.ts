/** Weight and volume as the dock reads them. Kept short enough for a tablet. */
export function formatWeight(kg: number | undefined | null): string {
  if (kg == null || !Number.isFinite(kg)) return "—";
  if (kg >= 1000) return `${(kg / 1000).toFixed(2)} t`;
  return `${kg.toFixed(0)} kg`;
}

export function formatVolume(m3: number | undefined | null): string {
  if (m3 == null || !Number.isFinite(m3)) return "—";
  return `${m3.toFixed(1)} m³`;
}
