/**
 * Small display helpers shared across workspaces.
 *
 * Age is always measured from when a thing happened, never from when it
 * arrived — a position that sat in a phone's outbox for twenty minutes is
 * twenty minutes old, and says so.
 */

/** "just now", "8 min ago", "2 h ago", "1 d ago" — from a number of seconds. */
export function ageLabel(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "just now";
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.floor(hours / 24)} d ago`;
}

/** The same, from an ISO timestamp. `now` is injectable so a test can pin it. */
export function agoFrom(iso: string, now: Date = new Date()): string {
  return ageLabel((now.getTime() - new Date(iso).getTime()) / 1000);
}

/** "06:42", Colombo wall clock, from an ISO timestamp. */
export function clockTime(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Colombo",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(iso));
}

export function plural(count: number, one: string, many: string = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** 0–100 for a ratio that may be missing or out of range. */
export function percent(part: number, whole: number): number {
  if (!whole || !Number.isFinite(part / whole)) return 0;
  return Math.max(0, Math.min(100, Math.round((part / whole) * 100)));
}
