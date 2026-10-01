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
