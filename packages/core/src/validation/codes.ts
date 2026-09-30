/**
 * Every way a plan can be wrong.
 *
 * The first group mirrors `check_allocation.py` rule for rule — if our
 * validator passes a plan, the organisers' checker must pass it too. The
 * second group covers constraints the Challenge Booklet states but their
 * checker does not test (fuel quotas and delivery windows, booklet p.5), and
 * the third is our own policy.
 *
 * `overridable` marks the codes a dispatcher may knowingly push past with a
 * recorded reason. Recalling a vehicle from the workshop is a real operational
 * action, so blocking it outright would be wrong; carrying chilled goods on an
 * ambient truck never is.
 */

export const RULE_CODES = [
  // --- Completeness: every order decided exactly once -----------------------
  "EVERY_ORDER_DECIDED",
  "DUPLICATE_ASSIGNMENT",
  "ORDER_SPLIT_ACROSS_TRIPS",
  "UNKNOWN_ORDER",
  "UNKNOWN_VEHICLE",
  "UNKNOWN_OUTLET",
  "SERVED_WITHOUT_VEHICLE",
  "TRIP_ID_RANGE",

  // --- The seven feasibility rules (booklet p.20) ---------------------------
  "MIXED_BRAND_IN_TRIP", // rule 1
  "MIXED_DISTRICT_IN_TRIP", // rule 1
  "CHILLED_ON_NON_REEFER", // rule 2
  "VAN_ONLY_OUTLET_NEEDS_VAN", // rule 3
  "DEPOT_MISMATCH", // rule 4
  "VOLUME_CAP_EXCEEDED", // rule 6
  "WEIGHT_CAP_EXCEEDED", // rule 6
  "TOO_MANY_TRIPS", // rule 7
  "VEHICLE_IN_WORKSHOP",

  // --- Wave budgets (booklet p.21) -----------------------------------------
  "PREDAWN_BUDGET_EXCEEDED",
  "DAYTIME_BUDGET_EXCEEDED",

  // --- Stated in the brief, absent from the organisers' checker -------------
  "FUEL_QUOTA_EXCEEDED",
  "WINDOW_CLOSE_MISSED",
  "MALL_WINDOW_MISSED",
  "NON_FRESH_WINDOW_MISSED",

  // --- Our policy -----------------------------------------------------------
  "ORDER_EXCEEDS_FLEET_CAPACITY",
  "DEFERRED_WITHOUT_REASON",
  "HIGH_PRIORITY_DEFERRED",
  "OPEN_SHORTFALL_AT_PUBLISH",
] as const;

export type RuleCode = (typeof RULE_CODES)[number];

/**
 * Codes a dispatcher may override with a recorded reason code. Everything else
 * is a hard stop: no reason makes a 5,510 kg load fit on a 3,990 kg truck.
 */
export const OVERRIDABLE_CODES: ReadonlySet<RuleCode> = new Set<RuleCode>([
  "VEHICLE_IN_WORKSHOP",
  "FUEL_QUOTA_EXCEEDED",
  "WINDOW_CLOSE_MISSED",
  "MALL_WINDOW_MISSED",
]);

/** Which rules the organisers' own checker enforces, for the coverage test. */
export const ORGANISER_ENFORCED: ReadonlySet<RuleCode> = new Set<RuleCode>([
  "EVERY_ORDER_DECIDED",
  "DUPLICATE_ASSIGNMENT",
  "ORDER_SPLIT_ACROSS_TRIPS",
  "UNKNOWN_ORDER",
  "UNKNOWN_VEHICLE",
  "SERVED_WITHOUT_VEHICLE",
  "TRIP_ID_RANGE",
  "MIXED_BRAND_IN_TRIP",
  "MIXED_DISTRICT_IN_TRIP",
  "CHILLED_ON_NON_REEFER",
  "VAN_ONLY_OUTLET_NEEDS_VAN",
  "DEPOT_MISMATCH",
  "VOLUME_CAP_EXCEEDED",
  "WEIGHT_CAP_EXCEEDED",
  "TOO_MANY_TRIPS",
  "VEHICLE_IN_WORKSHOP",
  "PREDAWN_BUDGET_EXCEEDED",
  "DAYTIME_BUDGET_EXCEEDED",
]);

/** Short human labels, used as reason-picker options and in the audit log. */
export const RULE_LABELS: Record<RuleCode, string> = {
  EVERY_ORDER_DECIDED: "Order has no decision",
  DUPLICATE_ASSIGNMENT: "Order assigned more than once",
  ORDER_SPLIT_ACROSS_TRIPS: "Order split across trips",
  UNKNOWN_ORDER: "Unknown order",
  UNKNOWN_VEHICLE: "Unknown vehicle",
  UNKNOWN_OUTLET: "Unknown outlet",
  SERVED_WITHOUT_VEHICLE: "Served order has no vehicle",
  TRIP_ID_RANGE: "Trip number must be 1 or 2",
  MIXED_BRAND_IN_TRIP: "Trip mixes brands",
  MIXED_DISTRICT_IN_TRIP: "Trip mixes districts",
  CHILLED_ON_NON_REEFER: "Chilled needs a refrigerated vehicle",
  VAN_ONLY_OUTLET_NEEDS_VAN: "Outlet can only be reached by van",
  DEPOT_MISMATCH: "Vehicle is based at another depot",
  VOLUME_CAP_EXCEEDED: "Over volume capacity",
  WEIGHT_CAP_EXCEEDED: "Over weight capacity",
  TOO_MANY_TRIPS: "More than two trips in a day",
  VEHICLE_IN_WORKSHOP: "Vehicle is in the workshop",
  PREDAWN_BUDGET_EXCEEDED: "Over the pre-dawn time budget",
  DAYTIME_BUDGET_EXCEEDED: "Over the daytime time budget",
  FUEL_QUOTA_EXCEEDED: "Over the weekly fuel quota",
  WINDOW_CLOSE_MISSED: "Arrives after the delivery window closes",
  MALL_WINDOW_MISSED: "Outside the mall's access window",
  NON_FRESH_WINDOW_MISSED: "Arrives after the requested window",
  ORDER_EXCEEDS_FLEET_CAPACITY: "No vehicle in the fleet can carry this order",
  DEFERRED_WITHOUT_REASON: "Deferral has no reason recorded",
  HIGH_PRIORITY_DEFERRED: "Outlet would be skipped twice running",
  OPEN_SHORTFALL_AT_PUBLISH: "Loading shortfall still undecided",
};
