import type { components } from "@katapatha/contracts/types";
import { RULE_LABELS } from "@katapatha/core/validation/codes";
import { level, type Level } from "@katapatha/core/domain/capacity";

type Trip = components["schemas"]["Trip"];
type Meter = components["schemas"]["VehicleMeter"];
type Deferral = components["schemas"]["DeferralRow"];
type Violation = components["schemas"]["Violation"];
type PlanningDay = components["schemas"]["PlanningDay"];
type PlanSummary = components["schemas"]["PlanSummary"];

/**
 * What a dispatcher is told a publication will do.
 *
 * Every figure comes from the plan the page already loaded, and every sentence
 * from what POST /plans/{id}/publication does today (apps/api/src/routes/
 * planning.ts): it flips the served orders to PLANNED, defers the rest and
 * writes a notification to each deferred outlet, makes the trips visible to the
 * loaders and drivers, locks the day, and writes the decision log. If that
 * route changes, this list is the thing that must change with it.
 */
export interface PublishFacts {
  served: number;
  deferred: number;
  trips: number;
  vehicles: number;
  /** Outlets that will receive a deferral notice. */
  notifiedOutlets: number;
}

export function publishFacts(plan: {
  stats: { served: number; deferred: number };
  trips: Pick<Trip, "vehicleId">[];
  deferrals: Pick<Deferral, "order">[];
}): PublishFacts {
  const outlets = new Set(plan.deferrals.map((d) => d.order?.outletId).filter(Boolean));
  return {
    served: plan.stats.served,
    deferred: plan.stats.deferred,
    trips: plan.trips.length,
    vehicles: new Set(plan.trips.map((t) => t.vehicleId)).size,
    notifiedOutlets: outlets.size,
  };
}

const noun = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const verb = (n: number) => (n === 1 ? "becomes" : "become");

export function publishConsequences(facts: PublishFacts): { who: string; detail: string }[] {
  const items = [
    {
      who: "Orders",
      detail:
        facts.deferred > 0
          ? `${noun(facts.served, "served order")} ${verb(facts.served)} Planned. ${noun(facts.deferred, "deferred order")} ${verb(facts.deferred)} Deferred, each with the reason you recorded.`
          : `${noun(facts.served, "served order")} ${verb(facts.served)} Planned.`,
    },
    {
      who: "Loaders",
      detail: `Loading lists open for ${noun(facts.trips, "trip")} on ${noun(facts.vehicles, "vehicle")}, last stop loaded first.`,
    },
    {
      who: "Drivers",
      detail:
        facts.vehicles === 1
          ? "The run for the 1 vehicle is released to whoever claims it."
          : `The run for each of ${facts.vehicles} vehicles is released to whoever claims that vehicle.`,
    },
    {
      who: "Store managers",
      detail:
        facts.notifiedOutlets > 0
          ? `${noun(facts.notifiedOutlets, "outlet")} with a deferred order ${facts.notifiedOutlets === 1 ? "gets" : "get"} a notice with the reason. Every other outlet sees its order as planned.`
          : "Every outlet sees its order as planned. No deferral notices go out.",
    },
    {
      who: "Decision log",
      detail: "The publication and each order's outcome, with deferral reasons, are written to the log under your name.",
    },
  ];
  return items;
}

/** Said once under the consequences: what cannot be undone. Both halves are enforced by the API. */
export const PUBLISH_FINAL_NOTE =
  "Publishing is final for this day. The plan cannot be re-run afterwards, and vehicle status can no longer be changed from the planning desk.";

/** What stops the Publish button, in plain words; null when nothing does. */
export function publishBlocker(input: {
  status: PlanSummary["status"];
  pendingDeferrals: number;
  validationAvailable: boolean;
  blockingErrors: number;
}): string | null {
  if (input.status !== "DRAFT") return input.status === "PUBLISHED" ? "This plan is already published." : "A newer draft replaced this plan.";
  if (input.pendingDeferrals > 0) {
    return `${noun(input.pendingDeferrals, "deferral")} still ${input.pendingDeferrals === 1 ? "needs" : "need"} a reason.`;
  }
  if (!input.validationAvailable) return "The publication check could not be loaded. Reload before publishing.";
  if (input.blockingErrors > 0) return `${noun(input.blockingErrors, "blocking issue")} must be resolved first.`;
  return null;
}

/**
 * The API returns `orderRefs` and `outletIds` on a violation (they are on the
 * core Violation type), while the OpenAPI schema still declares a singular
 * `orderRef`. Read both so the badge survives the contract being fixed.
 */
export function violationRefs(violation: Violation): string[] {
  const extra = violation as Violation & { orderRefs?: string[]; outletIds?: string[] };
  return [...(extra.orderRefs ?? (violation.orderRef ? [violation.orderRef] : [])), ...(extra.outletIds ?? [])];
}

export function violationTitle(code: string): string {
  return (RULE_LABELS as Record<string, string>)[code] ?? code.replaceAll("_", " ").toLowerCase();
}

export function countErrors(violations: readonly Pick<Violation, "severity">[]): number {
  return violations.filter((v) => v.severity === "error").length;
}

/** The workflow the planning desk walks through, as the Stepper's current index. */
export const DESK_STEPS = ["Queue open", "Queue closed", "Plan built", "Plan published"] as const;

export function deskStep(status: PlanningDay["status"] | undefined): number {
  switch (status) {
    case "OPEN":
      return 0;
    case "CLOSED":
      return 1;
    case "PLANNING":
      return 2;
    case "PUBLISHED":
      // Past the last step, so all four read as done.
      return DESK_STEPS.length;
    default:
      return 0;
  }
}

/**
 * The plan that represents the day. A published day shows its published plan; an
 * earlier day-state shows the latest draft. Superseded plans are history.
 */
export function currentPlan<T extends Pick<PlanSummary, "status">>(day: Pick<PlanningDay, "status"> | undefined, plans: readonly T[]): T | undefined {
  if (day?.status === "PUBLISHED") return plans.find((p) => p.status === "PUBLISHED");
  return plans.find((p) => p.status === "DRAFT");
}

export interface MeterRow {
  vehicleId: string;
  tripsUsed: number;
  trips: { used: number; max: number };
  predawn: { used: number; budget: number; level: Level };
  daytime: { used: number; budget: number; level: Level };
  fuel: { used: number; quota: number; level: Level };
}

/** Two trips a day is the rule (feasibility rule: MAX_TRIPS_PER_VEHICLE), kept here as a label for the bar. */
const MAX_TRIPS = 2;

/** Bars for the plan summary. `level` uses the allocator's thresholds, so "near" means what it means there. */
export function meterRows(meters: readonly Meter[] | undefined): MeterRow[] {
  return (meters ?? []).map((m) => ({
    vehicleId: m.vehicleId,
    tripsUsed: m.tripsUsed,
    trips: { used: m.tripsUsed, max: MAX_TRIPS },
    predawn: { used: m.predawnUsedMin, budget: m.predawnBudgetMin, level: level(m.predawnUsedMin, m.predawnBudgetMin) },
    daytime: { used: m.daytimeUsedMin, budget: m.daytimeBudgetMin, level: level(m.daytimeUsedMin, m.daytimeBudgetMin) },
    fuel: { used: m.fuelCommittedL, quota: m.fuelQuotaL, level: level(m.fuelCommittedL, m.fuelQuotaL) },
  }));
}

/** "4h 28m" / "45m". */
export function minutesLabel(minutes: number | undefined): string {
  if (minutes === undefined || !Number.isFinite(minutes)) return "—";
  const hours = Math.floor(minutes / 60);
  const rest = Math.round(minutes % 60);
  return hours ? `${hours}h ${rest}m` : `${rest}m`;
}
