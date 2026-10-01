export function colomboToday(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Colombo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const map: Record<string, string> = {};
  for (const part of parts) if (part.type !== "literal") map[part.type] = part.value;
  return `${map.year}-${map.month}-${map.day}`;
}

export function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export function formatMinutes(total: number | undefined | null): string {
  if (total == null || !Number.isFinite(total) || total < 0) return "—";
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  if (hours === 0) return `${minutes}m`;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes.toString().padStart(2, "0")}m`;
}

export function formatWeight(kg: number | undefined | null): string {
  if (kg == null || !Number.isFinite(kg)) return "—";
  if (kg >= 1000) return `${(kg / 1000).toFixed(2)} t`;
  return `${kg.toFixed(0)} kg`;
}

export function formatVolume(m3: number | undefined | null): string {
  if (m3 == null || !Number.isFinite(m3)) return "—";
  return `${m3.toFixed(1)} m³`;
}

export function formatPlannedTime(clock: string | undefined | null): string {
  if (!clock || !/^\d{2}:\d{2}$/.test(clock)) return "—";
  return clock;
}
