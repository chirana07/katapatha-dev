/**
 * Making a built plan better.
 *
 * Construction places each order where it costs least *at that moment*; this
 * looks at the finished plan and asks whether any single change makes it
 * cheaper. A deterministic local search: it considers every move in a fixed
 * neighbourhood, applies the one that lowers the objective most, and repeats
 * until nothing does or the budget runs out.
 *
 *   resequence   reorder the stops of one trip to drive a shorter way round
 *   relocate     move a stop from one trip to another in the same lane
 *   swap         exchange a stop between two trips in the same lane
 *   eliminate    empty a trip into its neighbours, saving a whole outbound leg
 *   reassign     move a trip to a vehicle better suited to it
 *   reinsert     try the orders still left out, now that the plan has changed
 *
 * It never decides what is allowed. Every candidate is built and handed to
 * `checkTrip`, the same function construction uses, so no move can produce a
 * plan the rules forbid. A move that changes two trips is verified once more as
 * a whole after it is applied, because two trips of one vehicle interact through
 * its day in a way each check alone cannot see, and is undone if it fails.
 *
 * Only strictly improving moves are applied, so the objective never rises, and
 * the search is deterministic: neighbourhoods are scanned in a fixed order, ties
 * keep the first found, and the budget is a count of candidate trips checked
 * rather than a clock, so a fast machine and a slow one reach the same plan.
 */

import { roadKmOf } from "@katapatha/core/domain/roadSchedule";
import { needsReefer, type OrderRef } from "@katapatha/core/domain/types";
import { scheduleVehicleDay } from "@katapatha/core/domain/vehicleDay";
import { applyToTrip, checkTrip, dayTripOfBuild, type TripFigures, type TripSpec } from "./feasibility";
import { insertStop, specOf, tryPlace } from "./construct";
import { objectiveOf, tripCost } from "./objective";
import { over, tripsOf, waveBudget, type Context, type StopBuild, type TripBuild } from "./state";
import type { AllocatorVehicle, SearchSummary } from "./types";

const EPS = 1e-9;
/** Most improving moves of one kind applied in one round, so no kind starves the others. */
const MAX_PER_STEP = 200;
/** Up to this many stops a trip is resequenced by trying every order; beyond it, by local moves. */
const EXHAUSTIVE_STOPS = 8;

interface Budget {
  start: number;
  max: number;
}
const hasBudget = (ctx: Context, b: Budget): boolean => ctx.evaluations - b.start < b.max;

/** A trip as it would be after a move, with the figures that say what it costs. */
export interface Replacement {
  trip: TripBuild;
  spec: TripSpec;
  figures: TripFigures;
}

export interface Move {
  /** The change in the objective; negative is an improvement. */
  delta: number;
  replacements: Replacement[];
  /** Trips emptied by the move. */
  removed: TripBuild[];
}

const costNow = (ctx: Context, t: TripBuild): number => tripCost(ctx, t.vehicle, t.stops, t.roadKm, t.road.waitMin);
const costAfter = (ctx: Context, r: Replacement): number =>
  tripCost(ctx, r.spec.vehicle, r.spec.stops, r.figures.roadKm, r.figures.road.waitMin);

const sameLane = (a: TripBuild, b: TripBuild): boolean => a !== b && a.brand === b.brand && a.district === b.district;

/** Whether this vehicle may carry every order of these stops, whatever else it carries. */
function canCarry(ctx: Context, v: AllocatorVehicle, stops: readonly StopBuild[]): boolean {
  if (!v.available) return false;
  for (const stop of stops) {
    const outlet = ctx.outlets.get(stop.outletId)!;
    if (outlet.parkingConstraint === "van_only" && v.type !== "van") return false;
    if (stop.orders.some((o) => needsReefer(o.tempRequirement)) && v.temp !== "reefer") return false;
  }
  return true;
}

const byId = (ctx: Context): TripBuild[] => [...ctx.trips].sort((a, b) => a.id - b.id);

/** A vehicle's trips, taken together, still obey its budgets, its fuel and its day. */
function vehicleConsistent(ctx: Context, vehicleId: string): boolean {
  const trips = tripsOf(ctx, vehicleId);
  if (trips.length === 0) return true;
  for (const wave of ["PREDAWN", "DAYTIME"] as const) {
    const used = trips.filter((t) => t.wave === wave).reduce((n, t) => n + t.minutes, 0);
    if (over(used, waveBudget(ctx.config, wave))) return false;
  }
  if (ctx.config.enforceFuelQuota) {
    const s = ctx.vehicleState.get(vehicleId)!;
    if (over(s.committedOtherDaysL + trips.reduce((n, t) => n + t.fuelL, 0), s.quotaL)) return false;
  }
  if (trips.length > ctx.config.maxTripsPerVehicle) return false;
  return scheduleVehicleDay(trips.map((t) => dayTripOfBuild(ctx, t)), ctx.config.reloadMin) !== null;
}

/**
 * Apply a move, then check the vehicles it touched as a whole. If any no longer
 * holds together the plan is put back exactly as it was and the move reports
 * failure.
 */
export function commit(ctx: Context, move: Move): boolean {
  const touched = new Set<string>();
  const before = [...ctx.trips];
  const snapshots = new Map<TripBuild, TripBuild>();
  const snap = (t: TripBuild) => {
    if (!snapshots.has(t)) snapshots.set(t, { ...t, stops: t.stops.map((s) => ({ ...s, orders: [...s.orders] })) });
  };

  for (const r of move.replacements) {
    snap(r.trip);
    touched.add(r.trip.vehicle.vehicleId);
    touched.add(r.spec.vehicle.vehicleId);
    applyToTrip(r.trip, r.spec, r.figures);
  }
  for (const t of move.removed) {
    snap(t);
    touched.add(t.vehicle.vehicleId);
  }
  ctx.trips = ctx.trips.filter((t) => !move.removed.includes(t));

  if ([...touched].every((id) => vehicleConsistent(ctx, id))) return true;

  for (const [trip, saved] of snapshots) Object.assign(trip, saved);
  ctx.trips = before;
  return false;
}

/** Apply the best of a set of candidate moves, if any improves the plan. */
function applyBest(ctx: Context, candidates: readonly Move[]): boolean {
  const ranked = candidates.filter((m) => m.delta < -EPS).sort((a, b) => a.delta - b.delta);
  // The best may fail its whole-vehicle check; take the next, rather than give up.
  for (const move of ranked) if (commit(ctx, move)) return true;
  return false;
}

// ---------------------------------------------------------------------------
// resequence
// ---------------------------------------------------------------------------

/** Every ordering of the list, in a fixed order (Heap's algorithm). */
function permutations<T>(items: readonly T[]): T[][] {
  const out: T[][] = [];
  const a = [...items];
  const c = new Array<number>(a.length).fill(0);
  out.push([...a]);
  let i = 0;
  while (i < a.length) {
    if (c[i]! < i) {
      const j = i % 2 === 0 ? 0 : c[i]!;
      [a[j], a[i]] = [a[i]!, a[j]!];
      out.push([...a]);
      c[i]! += 1;
      i = 0;
    } else {
      c[i] = 0;
      i += 1;
    }
  }
  return out;
}

/** The neighbours of an order by 2-opt (reverse a stretch) and or-opt (move a short run). */
function localOrders(stops: readonly StopBuild[]): StopBuild[][] {
  const n = stops.length;
  const out: StopBuild[][] = [];
  for (let i = 0; i < n - 1; i += 1) {
    for (let j = i + 1; j < n; j += 1) {
      out.push([...stops.slice(0, i), ...stops.slice(i, j + 1).reverse(), ...stops.slice(j + 1)]);
    }
  }
  for (let len = 1; len <= 3; len += 1) {
    for (let i = 0; i + len <= n; i += 1) {
      const run = stops.slice(i, i + len);
      const rest = [...stops.slice(0, i), ...stops.slice(i + len)];
      for (let at = 0; at <= rest.length; at += 1) {
        if (at === i) continue;
        out.push([...rest.slice(0, at), ...run, ...rest.slice(at)]);
      }
    }
  }
  return out;
}

/** Reorder each trip's stops to the shortest feasible tour. Returns whether any trip changed. */
function resequence(ctx: Context, budget: Budget): boolean {
  let changed = false;
  for (const trip of byId(ctx)) {
    if (!hasBudget(ctx, budget)) break;
    if (trip.stops.length < 2) continue;

    // Repeats only for the local moves, which improve a step at a time.
    for (let pass = 0; pass < (trip.stops.length > EXHAUSTIVE_STOPS ? 50 : 1); pass += 1) {
      const km = (stops: readonly StopBuild[]) =>
        roadKmOf(trip.vehicle.depot, stops.map((s) => s.outletId), ctx.matrix);
      const current = trip.roadKm;
      const candidates = (trip.stops.length <= EXHAUSTIVE_STOPS ? permutations(trip.stops) : localOrders(trip.stops))
        .map((stops, index) => ({ stops, index, km: km(stops) }))
        .filter((c) => c.km < current - EPS)
        .sort((a, b) => a.km - b.km || a.index - b.index);

      let applied = false;
      for (const c of candidates) {
        if (!hasBudget(ctx, budget)) break;
        const spec = specOf(trip, c.stops);
        const check = checkTrip(ctx, spec, trip);
        if (!check.ok) continue;
        applyToTrip(trip, spec, check.figures);
        applied = true;
        changed = true;
        break;
      }
      if (!applied) break;
    }
  }
  return changed;
}

// ---------------------------------------------------------------------------
// relocate, swap
// ---------------------------------------------------------------------------

function relocate(ctx: Context, budget: Budget): boolean {
  const candidates: Move[] = [];
  const trips = byId(ctx);

  for (const from of trips) {
    for (const stop of from.stops) {
      if (!hasBudget(ctx, budget)) return applyBest(ctx, candidates);
      const rest = from.stops.filter((s) => s !== stop);

      // What the trip it leaves becomes: shorter, or gone.
      let leaving: Replacement | null = null;
      if (rest.length > 0) {
        const spec = specOf(from, rest);
        const check = checkTrip(ctx, spec, from);
        if (!check.ok) continue;
        leaving = { trip: from, spec, figures: check.figures };
      }

      for (const to of trips) {
        if (!sameLane(from, to) || !canCarry(ctx, to.vehicle, [stop])) continue;
        for (const stops of insertStop(to.stops, stop)) {
          const spec = specOf(to, stops);
          const check = checkTrip(ctx, spec, to);
          if (!check.ok) continue;
          const arriving: Replacement = { trip: to, spec, figures: check.figures };

          const w = ctx.config.objective;
          const delta =
            costAfter(ctx, arriving) -
            costNow(ctx, to) +
            (leaving ? costAfter(ctx, leaving) - costNow(ctx, from) : -costNow(ctx, from) - w.lambdaTrip);
          candidates.push({
            delta,
            replacements: leaving ? [leaving, arriving] : [arriving],
            removed: leaving ? [] : [from],
          });
        }
      }
    }
  }
  return applyBest(ctx, candidates);
}

function swap(ctx: Context, budget: Budget): boolean {
  const candidates: Move[] = [];
  const trips = byId(ctx);

  for (let i = 0; i < trips.length; i += 1) {
    for (let j = i + 1; j < trips.length; j += 1) {
      const a = trips[i]!;
      const b = trips[j]!;
      if (!sameLane(a, b)) continue;

      for (const sa of a.stops) {
        for (const sb of b.stops) {
          if (!hasBudget(ctx, budget)) return applyBest(ctx, candidates);
          if (sa.outletId === sb.outletId) continue;
          // Neither trip may already visit the outlet it would be given.
          if (a.stops.some((s) => s.outletId === sb.outletId) || b.stops.some((s) => s.outletId === sa.outletId)) continue;
          if (!canCarry(ctx, a.vehicle, [sb]) || !canCarry(ctx, b.vehicle, [sa])) continue;

          const newA = a.stops.map((s) => (s === sa ? sb : s));
          const newB = b.stops.map((s) => (s === sb ? sa : s));
          const specA = specOf(a, newA);
          const checkA = checkTrip(ctx, specA, a);
          if (!checkA.ok) continue;
          const specB = specOf(b, newB);
          const checkB = checkTrip(ctx, specB, b);
          if (!checkB.ok) continue;

          const ra: Replacement = { trip: a, spec: specA, figures: checkA.figures };
          const rb: Replacement = { trip: b, spec: specB, figures: checkB.figures };
          candidates.push({
            delta: costAfter(ctx, ra) + costAfter(ctx, rb) - costNow(ctx, a) - costNow(ctx, b),
            replacements: [ra, rb],
            removed: [],
          });
        }
      }
    }
  }
  return applyBest(ctx, candidates);
}

// ---------------------------------------------------------------------------
// eliminate
// ---------------------------------------------------------------------------

/**
 * Empty a trip into the others in its lane, one stop at a time, each to the
 * place that costs least given what has already been moved. A trip that can be
 * dissolved saves its whole outbound and return legs and its trip cost.
 */
function eliminate(ctx: Context, budget: Budget): boolean {
  const candidates: Move[] = [];
  const trips = byId(ctx);

  for (const gone of trips) {
    if (!hasBudget(ctx, budget)) break;
    const others = trips.filter((t) => sameLane(gone, t));
    if (others.length === 0) continue;

    // What each receiving trip looks like as stops arrive, starting as it is.
    const sim = new Map<TripBuild, Replacement | null>(others.map((t) => [t, null]));
    const current = (t: TripBuild): TripSpec => sim.get(t)?.spec ?? specOf(t, t.stops);
    const costOf = (t: TripBuild): number => {
      const r = sim.get(t);
      return r ? costAfter(ctx, r) : costNow(ctx, t);
    };

    let ok = true;
    for (const stop of gone.stops) {
      let best: { to: TripBuild; replacement: Replacement; added: number } | null = null;
      for (const to of others) {
        if (!canCarry(ctx, to.vehicle, [stop])) continue;
        for (const stops of insertStop(current(to).stops, stop)) {
          const spec = specOf(to, stops);
          const check = checkTrip(ctx, spec, to);
          if (!check.ok) continue;
          const replacement: Replacement = { trip: to, spec, figures: check.figures };
          const added = costAfter(ctx, replacement) - costOf(to);
          if (!best || added < best.added - EPS) best = { to, replacement, added };
        }
      }
      if (!best) {
        ok = false;
        break;
      }
      sim.set(best.to, best.replacement);
    }
    if (!ok) continue;

    const replacements = [...sim.values()].filter((r): r is Replacement => r !== null);
    const delta =
      replacements.reduce((n, r) => n + costAfter(ctx, r) - costNow(ctx, r.trip), 0) -
      costNow(ctx, gone) -
      ctx.config.objective.lambdaTrip;
    candidates.push({ delta, replacements, removed: [gone] });
  }
  return applyBest(ctx, candidates);
}

// ---------------------------------------------------------------------------
// reassign
// ---------------------------------------------------------------------------

/** Give a trip to a vehicle it suits better, such as ambient work off a reefer. */
function reassign(ctx: Context, budget: Budget): boolean {
  const candidates: Move[] = [];
  const vehicles = [...ctx.input.vehicles].sort((a, b) => a.vehicleId.localeCompare(b.vehicleId));

  for (const trip of byId(ctx)) {
    for (const v of vehicles) {
      if (!hasBudget(ctx, budget)) return applyBest(ctx, candidates);
      if (v.vehicleId === trip.vehicle.vehicleId || v.depot !== trip.vehicle.depot) continue;
      if (!canCarry(ctx, v, trip.stops)) continue;
      if (tripsOf(ctx, v.vehicleId).length >= ctx.config.maxTripsPerVehicle) continue;

      const spec: TripSpec = { ...specOf(trip, trip.stops), vehicle: v };
      const check = checkTrip(ctx, spec, null);
      if (!check.ok) continue;
      const r: Replacement = { trip, spec, figures: check.figures };
      candidates.push({ delta: costAfter(ctx, r) - costNow(ctx, trip), replacements: [r], removed: [] });
    }
  }
  return applyBest(ctx, candidates);
}

// ---------------------------------------------------------------------------
// the search
// ---------------------------------------------------------------------------

const STEPS: ReadonlyArray<readonly [string, (ctx: Context, b: Budget) => boolean]> = [
  ["resequence", resequence],
  ["relocate", relocate],
  ["swap", swap],
  ["eliminate", eliminate],
  ["reassign", reassign],
];

export function improve(ctx: Context, unplaced: readonly OrderRef[]): { unplaced: OrderRef[]; search: SearchSummary } {
  const before = objectiveOf(ctx);
  const moves: Record<string, number> = Object.fromEntries([...STEPS.map(([name]) => [name, 0]), ["reinsert", 0]]);
  const budget: Budget = { start: ctx.evaluations, max: ctx.config.localSearch.maxEvaluations };
  let remaining = [...unplaced];
  let rounds = 0;

  while (rounds < ctx.config.localSearch.maxRounds && hasBudget(ctx, budget)) {
    rounds += 1;
    let changed = false;

    for (const [name, step] of STEPS) {
      for (let applied = 0; applied < MAX_PER_STEP && hasBudget(ctx, budget); applied += 1) {
        if (!step(ctx, budget)) break;
        moves[name]! += 1;
        changed = true;
      }
    }

    // The plan has changed, so an order that found no room may find it now.
    const stillOut: OrderRef[] = [];
    for (const order of remaining) {
      if (hasBudget(ctx, budget) && tryPlace(ctx, order)) {
        ctx.ledger.clear(order.ref);
        moves.reinsert! += 1;
        changed = true;
      } else {
        stillOut.push(order);
      }
    }
    remaining = stillOut;

    if (!changed) break;
  }

  return {
    unplaced: remaining,
    search: { rounds, evaluations: ctx.evaluations - budget.start, moves, before, after: objectiveOf(ctx) },
  };
}

