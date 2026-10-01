/**
 * Problem reason codes and their labels.
 *
 * Used ONLY when GET /reference/vocabularies is unreachable. The server list
 * always wins, and a screen falling back to this must say so -- the web console
 * shows a banner, and the handset does the same.
 *
 * Copied verbatim from apps/web/src/app/driver/reasons.ts. One wording table for
 * both clients: a driver who used the web console yesterday should read the
 * same sentence on the handset today. Promotion into @katapatha/core is a later
 * move-only PR.
 */
export const FALLBACK_PROBLEM_REASONS: string[] = [
  "OUTLET_CLOSED",
  "ACCESS_DENIED",
  "VEHICLE_BREAKDOWN",
  "ROAD_BLOCKED",
  "DELIVERY_REFUSED",
];

export const PROBLEM_REASON_LABEL: Record<string, string> = {
  OUTLET_CLOSED: "Outlet closed",
  ACCESS_DENIED: "Access denied",
  VEHICLE_BREAKDOWN: "Vehicle breakdown",
  ROAD_BLOCKED: "Road blocked",
  DELIVERY_REFUSED: "Delivery refused",
};

export function labelFor(reason: string): string {
  return PROBLEM_REASON_LABEL[reason] ?? reason;
}
