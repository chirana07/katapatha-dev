/**
 * Fixed reason codes.
 *
 * Free text is unsearchable and uncountable. Fixed codes mean a dispatcher can
 * later ask "how often did we run out of refrigerated capacity this month?"
 * and get an answer, which is the difference between a record and a note.
 *
 * Each list is deliberately short. A picker with twenty options gets the first
 * one clicked every time, under pressure, at four in the morning.
 */

export const DEFERRAL_REASONS = [
  { code: "REEFER_FULL", label: "Refrigerated capacity full" },
  { code: "NO_VAN", label: "No van available" },
  { code: "WINDOW_UNREACHABLE", label: "Can't reach the window" },
  { code: "TIME_BUDGET", label: "No time left in the run" },
  { code: "FUEL_QUOTA", label: "Weekly fuel quota reached" },
  { code: "VEHICLE_IN_WORKSHOP", label: "Vehicle in the workshop" },
  { code: "ORDER_TOO_LARGE", label: "Order too large for any vehicle" },
  { code: "AFTER_CUTOFF", label: "Ordered after the cutoff" },
] as const;

export type DeferralReasonCode = (typeof DEFERRAL_REASONS)[number]["code"];

export const SHORTFALL_REASONS = [
  { code: "MISSING", label: "Missing from the dock" },
  { code: "DAMAGED", label: "Damaged" },
  { code: "SHORT_QUANTITY", label: "Short quantity" },
  { code: "NOT_COLD_ENOUGH", label: "Not cold enough" },
  { code: "WRONG_ITEM", label: "Wrong item picked" },
] as const;

export const PROBLEM_REASONS = [
  { code: "OUTLET_CLOSED", label: "Outlet closed" },
  { code: "ACCESS_DENIED", label: "Can't get access" },
  { code: "VEHICLE_BREAKDOWN", label: "Vehicle problem" },
  { code: "ROAD_BLOCKED", label: "Road blocked" },
  { code: "DELIVERY_REFUSED", label: "Delivery refused" },
] as const;

/**
 * What an outlet can raise against a delivery, in `ProblemKind` values.
 *
 * A subset of the driver's list, because the two roles see different failures:
 * a store manager cannot report a vehicle breakdown they did not witness, and
 * a road being blocked is the driver's to record. `OTHER` is last and carries
 * the note, which is also how the "contact dispatcher" action arrives here.
 */
export const STORE_PROBLEM_KINDS = [
  { code: "GOODS_DAMAGED", label: "Goods arrived damaged" },
  { code: "ACCESS_DENIED", label: "The vehicle could not get in" },
  { code: "OUTLET_CLOSED", label: "Nobody was here to receive it" },
  { code: "DELIVERY_REFUSED", label: "We had to refuse the delivery" },
  { code: "OTHER", label: "Something else" },
] as const;

export type StoreProblemKind = (typeof STORE_PROBLEM_KINDS)[number]["code"];

export const STORE_ISSUE_REASONS = [
  { code: "ITEMS_MISSING", label: "Items missing" },
  { code: "ITEMS_DAMAGED", label: "Items damaged" },
  { code: "ARRIVED_WARM", label: "Chilled goods arrived warm" },
  { code: "WRONG_ITEMS", label: "Wrong items" },
] as const;

const ALL = [
  ...DEFERRAL_REASONS,
  ...SHORTFALL_REASONS,
  ...PROBLEM_REASONS,
  ...STORE_ISSUE_REASONS,
];

export function reasonLabel(code: string | null | undefined): string {
  if (!code) return "No reason recorded";
  return ALL.find((r) => r.code === code)?.label ?? code;
}

/**
 * The allocator's own codes, in words.
 *
 * `reasonLabel` covers the codes a dispatcher picks. These are the ones the
 * allocator derives, and they reach the screen whenever an order was never
 * confirmed by hand — without this, the panel shows a dispatcher something
 * like ORDER_EXCEEDS_FLEET_CAPACITY and expects them to translate it.
 */
const REJECTION_LABELS: Record<string, string> = {
  ORDER_EXCEEDS_FLEET_CAPACITY: "Too large for any vehicle in the fleet",
  NO_REEFER_IN_FLEET: "This depot has no refrigerated vehicle",
  NO_VAN_IN_FLEET: "This depot has no van",
  DISTRICT_UNREACHABLE_IN_BUDGET: "The district cannot be reached inside the window",
  NO_REEFER_AVAILABLE: "Every refrigerated vehicle is committed",
  NO_VAN_AVAILABLE: "Every van is committed",
  VEHICLE_IN_WORKSHOP: "The vehicle it needs is in the workshop",
  WRONG_DEPOT: "Served from another depot",
  VOLUME_CAP_EXCEEDED: "No vehicle has the volume left",
  WEIGHT_CAP_EXCEEDED: "No vehicle has the weight allowance left",
  NO_TRIP_SLOT: "Every compatible vehicle has used both its trips",
  PREDAWN_BUDGET_EXCEEDED: "No pre-dawn time left on any vehicle",
  DAYTIME_BUDGET_EXCEEDED: "No trading-day time left on any vehicle",
  FUEL_QUOTA_EXCEEDED: "The weekly fuel quota is spent",
  WINDOW_UNREACHABLE: "The outlet closes before a vehicle could reach it",
  YIELDED_TO_HIGHER_PRIORITY: "Space went to an outlet skipped yesterday",
};

export function rejectionLabel(code: string | null | undefined): string {
  if (!code) return "No vehicle could take it";
  return REJECTION_LABELS[code] ?? reasonLabel(code);
}
