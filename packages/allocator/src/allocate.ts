/**
 * The allocator.
 *
 * Deterministic greedy, priority-first, placing each order where it costs the
 * least road. It never trusts itself: the last step runs the shared validator
 * over its own output, so auto-plan output that reaches a dispatcher has
 * already been checked against the same rules the organisers check, and the
 * road rules besides.
 *
 *   screening     separate "no day could serve this" from "the fleet ran out"
 *   the queue     priority bands first, then scarce goods, then lanes and size
 *   building      construct.ts: insert each order at its cheapest feasible stop
 *                 position, asking feasibility.ts whether the trip is allowed
 *   departures    lay each vehicle's trips end to end on its day
 *   output        output.ts: trips, meters, the self-check, the fingerprint
 *
 * It is pure: no I/O, no clock, no randomness, and every tie is broken by an
 * identifier. Road travel times arrive as an input rather than being fetched,
 * which is what makes a plan reproducible from its inputs.
 *
 * Complexity is comfortable: at most 36 lanes (12 districts x 3 brands),
 * roughly 85 to 160 orders and 38 vehicles. Each placement tries a handful of
 * stop positions and each check is a few small binary searches, so a day plans
 * in well under a second, which is why re-running it can be an ordinary button
 * rather than a background job.
 */

import { matrixCovers } from "@katapatha/core/domain/roadSchedule";
import { travelFromDistricts } from "@katapatha/core/domain/travel";
import { assignDepartures } from "./feasibility";
import { buildPlan, orderQueue, screenOrders } from "./construct";
import { improve } from "./improve";
import { hashAllocation, selfCheck, toAllocatedTrip, toMeters } from "./output";
import { RejectionLedger } from "./rejection";
import { ordersOf, type Context, type VehicleState } from "./state";
import {
  DEFAULT_ALLOCATOR_CONFIG,
  type AllocatorConfig,
  type AllocatorInput,
  type AllocatorOutput,
  type AllocatorOverrides,
  type DeferredOrder,
} from "./types";

/** The working state for one run, with the road legs it will plan on chosen. */
export function createContext(input: AllocatorInput): Context {
  const config = resolveConfig(input.config);
  const { outlets, districts, allowance } = input;

  // The road legs to plan on: the ones supplied, if they cover every outlet in
  // the queue, else the organisers' district table turned into legs.
  const queued = input.orders.map((o) => o.outletId).filter((id) => outlets.has(id));
  const matrix =
    input.travel && matrixCovers(input.travel, input.depot, queued)
      ? input.travel
      : travelFromDistricts(input.depot, outlets.values(), districts);

  const vehicleState = new Map<string, VehicleState>();
  for (const v of input.vehicles) {
    const fuel = input.fuel.get(v.vehicleId);
    vehicleState.set(v.vehicleId, {
      vehicle: v,
      quotaL: fuel?.quotaL ?? v.weeklyFuelQuotaL,
      committedOtherDaysL: fuel?.committedOtherDaysL ?? 0,
    });
  }

  return {
    input,
    config,
    ledger: new RejectionLedger(),
    matrix,
    outlets,
    districts,
    allowance,
    vehicleState,
    trips: [],
    nextTripId: 1,
    evaluations: 0,
  };
}

/** Defaults, overridden by whatever the caller gave, nested settings included. */
export function resolveConfig(overrides: AllocatorOverrides | undefined): AllocatorConfig {
  const { localSearch, objective, ...flat } = overrides ?? {};
  return {
    ...DEFAULT_ALLOCATOR_CONFIG,
    ...flat,
    localSearch: { ...DEFAULT_ALLOCATOR_CONFIG.localSearch, ...localSearch },
    objective: { ...DEFAULT_ALLOCATOR_CONFIG.objective, ...objective },
  };
}

export function allocate(input: AllocatorInput): AllocatorOutput {
  const ctx = createContext(input);

  const { screened, permanentlyDeferred } = screenOrders(ctx);
  const built = buildPlan(ctx, orderQueue(ctx, screened));
  // Construction places each order where it costs least at the time; this looks
  // at the whole plan and keeps any change that makes it cheaper.
  const { unplaced: finalUnplaced, search } = improve(ctx, built);
  assignDepartures(ctx);

  const allocatedTrips = ctx.trips
    .filter((t) => ordersOf(t).length > 0)
    .map((t) => toAllocatedTrip(ctx, t))
    .sort((a, b) => a.vehicleId.localeCompare(b.vehicleId) || a.tripNo - b.tripNo);

  const unserved = [...permanentlyDeferred, ...finalUnplaced];
  const deferred: DeferredOrder[] = unserved
    .map((o) => ctx.ledger.explain(o))
    .sort((a, b) => a.orderRef.localeCompare(b.orderRef));

  const served = allocatedTrips.reduce((n, t) => n + t.stops.reduce((m, s) => m + s.orderRefs.length, 0), 0);

  return {
    trips: allocatedTrips,
    deferred,
    meters: toMeters(ctx),
    selfCheck: selfCheck(ctx, unserved),
    stats: {
      orders: input.orders.length,
      served,
      deferred: deferred.length,
      tripsBuilt: allocatedTrips.length,
      hash: hashAllocation(allocatedTrips, deferred),
    },
    travelSource: ctx.matrix.source,
    search,
  };
}
