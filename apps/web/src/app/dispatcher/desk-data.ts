import "server-only";

import { redirect } from "next/navigation";
import type { components } from "@katapatha/contracts/types";
import { api } from "@/lib/api";
import { readFailure, type Failure } from "@/lib/failures";
import { currentPlan } from "./plan-summary";

type PlanningDay = components["schemas"]["PlanningDay"];
type Order = components["schemas"]["Order"];
type PlanSummary = components["schemas"]["PlanSummary"];
type FleetDay = components["schemas"]["FleetDay"];

export interface DayData {
  day: PlanningDay | undefined;
  orders: Order[];
  plans: PlanSummary[];
  /** The plan that stands for the day, if one has been built. */
  plan: PlanSummary | undefined;
  /** Supplementary: null when it could not be loaded, and the page still works. */
  fleet: FleetDay | null;
}

/**
 * The four reads every desk screen starts from, for one date.
 *
 * The server derives the depot from the signed-in dispatcher (the contract
 * lists a `depot` query but the API rejects it as an additional property), so
 * none is sent. Fleet status is fetched with the rest (unless `fleet: false`)
 * but is allowed to fail on its own: a desk that cannot show the fleet can
 * still close a queue.
 */
export async function loadDay(date: string, next: string, options: { fleet?: boolean } = {}): Promise<{ ok: true; data: DayData } | { ok: false; failure: Failure }> {
  const client = await api();
  let days, orders, plans, fleet;
  try {
    [days, orders, plans, fleet] = await Promise.all([
      client.GET("/planning-days", { params: { query: { date } } }),
      client.GET("/orders", { params: { query: { date } } }),
      client.GET("/plans", { params: { query: { date } } }),
      options.fleet === false ? Promise.resolve(null) : client.GET("/fleet/status", { params: { query: { date } } }),
    ]);
  } catch {
    return { ok: false, failure: readFailure(0, "the planning day") };
  }
  if ([days, orders, plans].some((result) => result.response.status === 401)) {
    redirect(`/sign-in?next=${encodeURIComponent(next)}`);
  }
  for (const result of [days, orders, plans]) {
    if (result.error || !result.data) return { ok: false, failure: readFailure(result.response.status, "the planning day") };
  }

  const day = days.data![0];
  return {
    ok: true,
    data: {
      day,
      orders: orders.data!,
      plans: plans.data!,
      plan: currentPlan(day, plans.data!),
      fleet: fleet?.data ?? null,
    },
  };
}
