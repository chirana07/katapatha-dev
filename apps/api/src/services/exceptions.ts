import type { Role } from "@prisma/client";
import { isInRange } from "@katapatha/core/domain/chiller";
import { PROBLEM_REASONS, STORE_ISSUE_REASONS, STORE_PROBLEM_KINDS, reasonLabel } from "@katapatha/core/domain/reasons";
import { RULE_LABELS } from "@katapatha/core/validation/codes";
import type { Violation } from "@katapatha/core/validation/types";
import { validatePlan } from "@katapatha/core/validation/rules";
import type { DepotCode } from "@katapatha/core/domain/types";
import { prisma } from "../lib/db";
import { historyFor } from "../lib/audit";
import { loadDayContext, loadPlan, asDate, isoDate } from "./plans";
import { snapshotFromPlan } from "./snapshot";
import { nextOperatingDate } from "./store";
import {
  LAMP_AFTER_MINUTES,
  ageSecondsOf,
  clockOf,
  colomboMinutes,
  isLamp,
  lateMinutes,
  latestPositions,
} from "./positions";

/**
 * The Exceptions console: one read model over six unrelated tables.
 *
 * Nothing here is stored. An "exception" is a *derived* fact — a shortfall row
 * that is still OPEN, a trip that is thirty minutes behind its own plan, a
 * vehicle whose phone has gone quiet — and the console is simply those facts
 * put in one list and sorted. That is why `deriveExceptions` is a pure function
 * over plain rows: the rules are the interesting part, and they can be tested
 * without a database. `loadExceptionInputs` is the only part that touches
 * Prisma, and it only gathers.
 *
 * What the product may and may not claim is binding (DOMAIN.md, "What the
 * product may claim, and how"), and it shows up in the copy below:
 *   - a chiller figure is "read", by a named person, from a gauge — never a
 *     "sensor alert";
 *   - lateness is measured at the last stop the driver *recorded arriving at*,
 *     not from a live position;
 *   - Lamp Mode says "last reliable update" and that the ETA is estimated.
 *
 * Item ids are stable strings, because the console has no table of its own:
 *   shortfall:<shortfallId>   problem:<problemId>   chiller:<readingId>
 *   late:<tripId>             lamp:<tripId>         plan:<planId>:<ruleCode>:<n>
 * `chiller:` keys on the *reading*, so a newer out-of-band reading is a new
 * exception (and an acknowledgement of the old one does not carry over).
 * `plan:` keys on the plan id, so re-running the allocator, which replaces the
 * draft, retires every old planning id with it — correct, since the violations
 * belonged to a plan that no longer exists. `<n>` is the violation's position
 * among those sharing its rule code, in the validator's own order.
 */

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

export type ExceptionKind = "SHORTFALL" | "CHILLER" | "PLANNING" | "LATE" | "LAMP" | "PROBLEM";
export type ExceptionSeverity = "critical" | "warning" | "info";
export type ExceptionCategory = "planning" | "loading" | "on_the_road" | "store";
export type ExceptionStatus = "open" | "resolved";
export type DecisionCode =
  | "SEND_SHORT"
  | "HOLD_ORDER"
  | "CANCEL_LINE"
  | "MOVE_TO_TRIP_2"
  | "ACKNOWLEDGE"
  | "RESOLVE";

export const DECISION_CODES: readonly DecisionCode[] = [
  "SEND_SHORT",
  "HOLD_ORDER",
  "CANCEL_LINE",
  "MOVE_TO_TRIP_2",
  "ACKNOWLEDGE",
  "RESOLVE",
];

export const CATEGORIES: readonly ExceptionCategory[] = ["planning", "loading", "on_the_road", "store"];

/** Late is a warning from ten minutes behind and critical from thirty. */
export const LATE_WARNING_MINUTES = 10;
export const LATE_CRITICAL_MINUTES = 30;

const SEVERITY_RANK: Record<ExceptionSeverity, number> = { info: 0, warning: 1, critical: 2 };

// ---------------------------------------------------------------------------
// Inputs: plain rows, no Prisma types
// ---------------------------------------------------------------------------

export interface Person {
  name: string;
  role: Role | null;
}

export interface StopInput {
  id: string;
  seq: number;
  outletId: string;
  outletName: string | null;
  status: string;
  plannedArrivalAt: string;
  arrivedAt: Date | null;
  orders: Array<{
    id: string;
    ref: string;
    units: number;
    tempRequirement: "chilled" | "ambient";
    weightKg: number;
    volumeM3: number;
  }>;
}

export interface TripInput {
  id: string;
  planId: string;
  vehicleId: string;
  vehicleTemp: "reefer" | "ambient";
  vehicleWeightCapKg: number;
  vehicleVolumeCapM3: number;
  tripNo: number;
  status: string;
  brand: string;
  districtName: string;
  plannedDepartAt: string;
  departedAt: Date | null;
  sumWeightKg: number;
  sumVolumeM3: number;
  stops: StopInput[];
}

export interface ShortfallInput {
  id: string;
  tripId: string;
  orderId: string;
  orderRef: string;
  orderUnits: number;
  orderWeightKg: number;
  orderVolumeM3: number;
  outletId: string;
  outletName: string | null;
  kind: string;
  missingUnits: number;
  reasonCode: string | null;
  note: string | null;
  raisedBy: Person;
  raisedByUserId: string | null;
  raisedAt: Date;
  status: "OPEN" | "RESOLVED";
  resolution: "SEND_SHORT" | "HOLD_ORDER" | "MOVE_TO_TRIP_2" | "CANCEL_LINE" | null;
  resolvedAt: Date | null;
  resolvedByName: string | null;
  blocksDeparture: boolean;
}

export interface ChillerInput {
  id: string;
  tripId: string;
  tempC: number;
  targetMinC: number;
  targetMaxC: number;
  source: "LOADER_AT_BAY" | "DRIVER_ON_ARRIVAL";
  recordedByName: string | null;
  recordedAt: Date;
}

export interface ProblemInput {
  id: string;
  kind: string;
  note: string | null;
  reasonCode: string | null;
  status: "NEW" | "ACKNOWLEDGED" | "RESOLVED";
  resolution: string | null;
  raisedBy: Person;
  raisedAt: Date;
  acknowledgedAt: Date | null;
  acknowledgedByName: string | null;
  /** The Problem table has no resolvedAt; it is read back from the decision log. */
  resolvedAt: Date | null;
  resolvedByName: string | null;
  /** Units a store manager said were affected. Also lives only in the decision log. */
  units: number | null;
  orderId: string | null;
  orderRef: string | null;
  orderUnits: number | null;
  outletId: string | null;
  outletName: string | null;
  stopSeq: number | null;
  tripId: string | null;
  vehicleId: string | null;
}

export interface PlanningInput {
  planId: string;
  createdAt: Date;
  violations: Violation[];
  outletNames: Map<string, string | null>;
  /** "<vehicleId>|<tripNo>" -> planned departure, so a trip-level violation can sort by it. */
  departAtByTrip: Map<string, string>;
}

export interface AcknowledgementFact {
  at: Date;
  byName: string;
  /** The severity the item had when it was acknowledged. A worse one re-opens the question. */
  severity: ExceptionSeverity;
}

export interface ShortfallDecisionFact {
  at: Date;
  byName: string;
  note: string | null;
  decision: string;
}

export interface ExceptionInputs {
  date: string;
  /** Next operating day after `date`: where held orders and follow-up orders land. */
  followUpDate: string;
  trips: TripInput[];
  shortfalls: ShortfallInput[];
  /** Latest reading per reefer trip not yet completed. */
  chiller: ChillerInput[];
  /** Latest ping per vehicle, as `latestPositions` reports it. */
  pings: Map<string, { recordedAt: Date }>;
  problems: ProblemInput[];
  planning: PlanningInput | null;
  acknowledgements: Map<string, AcknowledgementFact>;
  shortfallDecisions: Map<string, ShortfallDecisionFact>;
}

export function emptyInputs(date: string, followUpDate = date): ExceptionInputs {
  return {
    date,
    followUpDate,
    trips: [],
    shortfalls: [],
    chiller: [],
    pings: new Map(),
    problems: [],
    planning: null,
    acknowledgements: new Map(),
    shortfallDecisions: new Map(),
  };
}

// ---------------------------------------------------------------------------
// Outputs
// ---------------------------------------------------------------------------

export interface Consequence {
  /** Who or what the step touches. */
  audience: "loader" | "driver" | "store" | "order" | "trip" | "record";
  title: string;
  detail: string;
}

export interface DecisionOption {
  decision: DecisionCode;
  label: string;
  description: string;
  recommended: boolean;
  requiresNote: boolean;
  /** Only on SEND_SHORT: the optional follow-up order for the missing units. */
  followUp: { forDate: string; units: number; label: string } | null;
  /** What confirming this will do, in order. Same text the response confirms. */
  consequences: Consequence[];
}

export interface AffectedOutlet {
  outletId: string;
  outletName: string | null;
  stopSeq: number | null;
  ordered: number | null;
  delta: number | null;
}

export interface ExceptionItem {
  id: string;
  kind: ExceptionKind;
  severity: ExceptionSeverity;
  category: ExceptionCategory;
  status: ExceptionStatus;
  title: string;
  subtitle: string;
  detail: string | null;
  reportedBy: Person;
  raisedAt: string;
  ageMinutes: number;
  resolvedAt: string | null;
  vehicleId: string | null;
  tripId: string | null;
  planId: string | null;
  departsAt: string | null;
  orderRefs: string[];
  affectedOutlets: AffectedOutlet[];
  quantities: { loaded: number; expected: number; short: number } | null;
  acknowledgement: { at: string; byName: string } | null;
  resolution: { decision: string | null; note: string | null; at: string | null; byName: string | null } | null;
  decisionOptions: DecisionOption[];
}

const SYSTEM: Person = { name: "System", role: null };

// ---------------------------------------------------------------------------
// Small pure helpers
// ---------------------------------------------------------------------------

/** Colombo is UTC+05:30 all year (no DST), so a fixed offset is exact. */
export function colomboDayStart(date: string): Date {
  return new Date(`${date}T00:00:00+05:30`);
}

export function colomboDateOf(at: Date): string {
  return new Date(at.getTime() + 330 * 60_000).toISOString().slice(0, 10);
}

function clockOfInstant(at: Date): string {
  return clockOf(colomboMinutes(at));
}

function minutesBetween(from: Date, to: Date): number {
  return Math.max(0, Math.floor((to.getTime() - from.getTime()) / 60_000));
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

function shortDay(date: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "UTC",
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(new Date(`${date}T00:00:00Z`));
}

function formatBand(min: number, max: number): string {
  return min === max ? `${min} °C` : `${min}–${max} °C`;
}

const SOURCE_LABEL: Record<ChillerInput["source"], { who: string; role: Role }> = {
  LOADER_AT_BAY: { who: "loader at the bay", role: "LOADER" },
  DRIVER_ON_ARRIVAL: { who: "driver on arrival", role: "DRIVER" },
};

function kindLabel(kind: string, store: boolean): string {
  if (store) return STORE_PROBLEM_KINDS.find((k) => k.code === kind)?.label ?? kind;
  if (kind === "GOODS_DAMAGED") return "Goods damaged";
  if (kind === "OTHER") return "Other problem";
  return PROBLEM_REASONS.find((r) => r.code === kind)?.label ?? kind;
}

function storeIssueLabel(kind: string, reasonCode: string | null): string {
  if (reasonCode) {
    const reason = STORE_ISSUE_REASONS.find((r) => r.code === reasonCode);
    if (reason) return reason.label;
  }
  return kindLabel(kind, true);
}

/**
 * Severity of a reported problem.
 *
 * Driver-raised: severity is about whether the run can still finish.
 *   VEHICLE_BREAKDOWN  critical — the vehicle may not continue, so every stop
 *                      still ahead of it is at risk, not just one.
 *   ROAD_BLOCKED       warning  — delays the run, usually recoverable.
 *   OUTLET_CLOSED, ACCESS_DENIED, DELIVERY_REFUSED, GOODS_DAMAGED
 *                      warning  — one stop failed; an order needs a new plan.
 *   OTHER              info     — a note with no stated consequence.
 *
 * Store-raised: the delivery has already happened, so nothing is in flight and
 * the default is info (the design's "Short delivery reported" is Info). Two
 * exceptions rise to warning: chilled goods that arrived warm (a food-safety
 * question that cannot wait for tomorrow's review) and a refused delivery or
 * blocked access (the store and the driver disagree about what happened).
 */
export function problemSeverity(kind: string, fromStore: boolean, reasonCode: string | null): ExceptionSeverity {
  if (fromStore) {
    if (reasonCode === "ARRIVED_WARM" || kind === "DELIVERY_REFUSED" || kind === "ACCESS_DENIED") return "warning";
    return "info";
  }
  switch (kind) {
    case "VEHICLE_BREAKDOWN":
      return "critical";
    case "OTHER":
      return "info";
    default:
      return "warning";
  }
}

export function lateSeverity(minutes: number): ExceptionSeverity | null {
  if (minutes >= LATE_CRITICAL_MINUTES) return "critical";
  if (minutes >= LATE_WARNING_MINUTES) return "warning";
  return null;
}

function pendingStops(trip: TripInput): StopInput[] {
  return trip.stops.filter((s) => s.status === "PENDING");
}

function outletsOf(stops: StopInput[], onlyChilled = false): AffectedOutlet[] {
  return stops
    .map((s) => {
      const orders = onlyChilled ? s.orders.filter((o) => o.tempRequirement === "chilled") : s.orders;
      return { stop: s, orders };
    })
    .filter(({ orders }) => orders.length > 0 || !onlyChilled)
    .map(({ stop, orders }) => ({
      outletId: stop.outletId,
      outletName: stop.outletName,
      stopSeq: stop.seq,
      ordered: orders.length > 0 ? orders.reduce((n, o) => n + o.units, 0) : null,
      delta: null,
    }));
}

function refsOf(stops: StopInput[], onlyChilled = false): string[] {
  return stops.flatMap((s) => s.orders.filter((o) => !onlyChilled || o.tempRequirement === "chilled").map((o) => o.ref));
}

/**
 * Whether the later trip of the same vehicle can take this order.
 *
 * The booklet's rule 1 puts one brand and one district in a trip, so the
 * second run can only absorb an order that already matches both; a Fresh order
 * moved onto a Style run would be a plan the validator rejects. A trip the
 * loader has already sealed (READY) is not a target: its load list was
 * declared complete, and a new line would appear after the dock signed off.
 * Capacity is
 * checked against the vehicle's own caps. Not checked: the wave's time budget.
 * The move lengthens trip 2 and the validator is not re-run on a published
 * plan, so a dispatcher choosing this is choosing it knowingly — the option's
 * description says so.
 */
export function moveTarget(sf: ShortfallInput, trip: TripInput, all: readonly TripInput[]): TripInput | null {
  const candidates = all
    .filter(
      (t) =>
        t.planId === trip.planId &&
        t.vehicleId === trip.vehicleId &&
        t.tripNo > trip.tripNo &&
        ["PLANNED", "LOADING"].includes(t.status) &&
        t.brand === trip.brand &&
        t.districtName === trip.districtName,
    )
    .sort((a, b) => a.tripNo - b.tripNo);
  const stop = trip.stops.find((s) => s.orders.some((o) => o.id === sf.orderId));
  const order = stop?.orders.find((o) => o.id === sf.orderId);
  if (!order) return null;
  return (
    candidates.find(
      (t) =>
        t.sumWeightKg + order.weightKg <= t.vehicleWeightCapKg && t.sumVolumeM3 + order.volumeM3 <= t.vehicleVolumeCapM3,
    ) ?? null
  );
}

// ---------------------------------------------------------------------------
// Consequences: what confirming a decision actually does
// ---------------------------------------------------------------------------

export interface ShortfallDecisionContext {
  sf: ShortfallInput;
  trip: TripInput;
  followUpDate: string;
  moveTo: TripInput | null;
}

/**
 * The plain-language steps of a shortfall decision.
 *
 * Every line here corresponds to a write the decision performs — nothing is
 * decoration. In particular there is no "driver counts adjusted" line for
 * SEND_SHORT: the driver's expected figure is the order's own `units`, and the
 * decision does not change the order, so the driver app will record the
 * delivery as part-delivered rather than being re-counted. Listing it would
 * promise something the system does not do.
 *
 * `performed` carries what only exists after the write (the follow-up order's
 * ref); without it the same function renders the preview.
 */
export function shortfallConsequences(
  ctx: ShortfallDecisionContext,
  decision: DecisionCode,
  opts: { followUp?: boolean; followUpRef?: string; actorName?: string } = {},
): Consequence[] {
  const { sf, trip } = ctx;
  const sendable = sf.orderUnits - sf.missingUnits;
  const who = opts.actorName ?? "the dispatcher";
  const out: Consequence[] = [];
  const loaderLine = (detail: string): Consequence => ({
    audience: "loader",
    title: `Loader · ${sf.raisedBy.name}`,
    detail,
  });
  const record: Consequence = {
    audience: "record",
    title: "Decision record",
    detail: `Logged by ${who} against the shortfall and order ${sf.orderRef}.`,
  };
  const storeTitle = `Store · ${sf.outletName ?? sf.outletId}`;
  const loadedNote =
    sendable > 0 ? ` Take the ${plural(sendable, "loaded unit")} for ${sf.orderRef} off the vehicle.` : "";

  switch (decision) {
    case "SEND_SHORT": {
      out.push(loaderLine(`The departure block is lifted: ${trip.vehicleId} can be marked ready with ${sendable} of ${sf.orderUnits} units.`));
      out.push({
        audience: "store",
        title: storeTitle,
        detail: `Told before departure that ${sendable} of ${sf.orderUnits} units are on the way for ${sf.orderRef}.`,
      });
      if (opts.followUp) {
        out.push({
          audience: "order",
          title: `Next run · ${shortDay(ctx.followUpDate)}`,
          detail: opts.followUpRef
            ? `The ${plural(sf.missingUnits, "missing unit")} are queued as order ${opts.followUpRef} for ${sf.outletName ?? sf.outletId}.`
            : `The ${plural(sf.missingUnits, "missing unit")} are queued as a new order for ${sf.outletName ?? sf.outletId}.`,
        });
      }
      break;
    }
    case "HOLD_ORDER": {
      out.push(loaderLine(`The departure block is lifted and ${sf.orderRef} is no longer on ${trip.vehicleId}'s load list.${loadedNote}`));
      out.push({
        audience: "driver",
        title: `Driver · ${trip.vehicleId}`,
        detail: `${sf.orderRef} is removed from the stop list.`,
      });
      out.push({
        audience: "store",
        title: storeTitle,
        detail: `Told that ${sf.orderRef} is held and moves to ${shortDay(ctx.followUpDate)}.`,
      });
      out.push({
        audience: "order",
        title: `Order ${sf.orderRef}`,
        detail: "Marked deferred and recorded as a deferral to the next operating day.",
      });
      break;
    }
    case "CANCEL_LINE": {
      out.push(loaderLine(`The departure block is lifted and ${sf.orderRef} is no longer on ${trip.vehicleId}'s load list.${loadedNote}`));
      out.push({
        audience: "driver",
        title: `Driver · ${trip.vehicleId}`,
        detail: `${sf.orderRef} is removed from the stop list.`,
      });
      out.push({
        audience: "store",
        title: storeTitle,
        detail: `Told that ${sf.orderRef} is cancelled and will not be delivered.`,
      });
      out.push({
        audience: "order",
        title: `Order ${sf.orderRef}`,
        detail: "Marked cancelled. This is not undone from the console.",
      });
      break;
    }
    case "MOVE_TO_TRIP_2": {
      const target = ctx.moveTo;
      out.push(
        loaderLine(
          `The departure block is lifted and ${sf.orderRef} leaves ${trip.vehicleId}'s trip ${trip.tripNo} load list; it loads on trip ${target?.tripNo ?? "2"}.${loadedNote}`,
        ),
      );
      out.push({
        audience: "driver",
        title: `Driver · ${trip.vehicleId}`,
        detail: `${sf.orderRef} moves from trip ${trip.tripNo} to trip ${target?.tripNo ?? "2"}; a stop left with no orders is marked skipped.`,
      });
      out.push({
        audience: "store",
        title: storeTitle,
        detail: `Told that ${sf.orderRef} now arrives on the vehicle's second run.`,
      });
      out.push({
        audience: "trip",
        title: `Trip ${target?.tripNo ?? "2"}`,
        detail: "Weight and volume totals include the order. The wave's time budget is not re-checked.",
      });
      break;
    }
    default:
      break;
  }
  out.push(record);
  return out;
}

function acknowledgeConsequences(actorName?: string): Consequence[] {
  return [
    {
      audience: "record",
      title: "Decision record",
      detail: `Acknowledged by ${actorName ?? "the dispatcher"}. The exception stays open for as long as the condition lasts.`,
    },
  ];
}

export function problemConsequences(
  decision: "ACKNOWLEDGE" | "RESOLVE",
  fromStore: boolean,
  outletName: string | null,
  actorName?: string,
): Consequence[] {
  const out: Consequence[] = [];
  if (decision === "ACKNOWLEDGE") {
    out.push({
      audience: "order",
      title: "Problem",
      detail: "Marked acknowledged, with who and when.",
    });
  } else {
    out.push({
      audience: "order",
      title: "Problem",
      detail: "Marked resolved, with your note kept as the resolution.",
    });
  }
  if (fromStore) {
    out.push({
      audience: "store",
      title: `Store · ${outletName ?? "outlet"}`,
      detail:
        decision === "ACKNOWLEDGE"
          ? "Told that dispatch has seen the issue."
          : "Told that the issue is resolved, with your note.",
    });
  }
  out.push({
    audience: "record",
    title: "Decision record",
    detail: `Logged by ${actorName ?? "the dispatcher"} against the problem.`,
  });
  return out;
}

// ---------------------------------------------------------------------------
// Decision options
// ---------------------------------------------------------------------------

function shortfallOptions(sf: ShortfallInput, trip: TripInput | undefined, all: readonly TripInput[], followUpDate: string): DecisionOption[] {
  if (sf.status !== "OPEN" || !trip) return [];
  const sendable = sf.orderUnits - sf.missingUnits;
  const departed = ["DEPARTED", "COMPLETED", "CANCELLED"].includes(trip.status);
  const moveTo = departed ? null : moveTarget(sf, trip, all);
  const ctx: ShortfallDecisionContext = { sf, trip, followUpDate, moveTo };
  const options: DecisionOption[] = [];

  // Sending short is only a decision when there is something to send. With
  // nothing on the vehicle it would be a delivery of zero, and offering it as
  // the recommendation would be wrong.
  if (sendable > 0) {
    options.push({
      decision: "SEND_SHORT",
      label: "Send short and notify the store",
      description: `${trip.vehicleId} leaves on time with ${sendable} of ${sf.orderUnits} units. The store is told before departure.`,
      recommended: true,
      requiresNote: false,
      followUp: {
        forDate: followUpDate,
        units: sf.missingUnits,
        label: `Add the ${plural(sf.missingUnits, "missing unit")} to ${shortDay(followUpDate)}'s orders`,
      },
      consequences: shortfallConsequences(ctx, "SEND_SHORT"),
    });
  }
  if (moveTo) {
    options.push({
      decision: "MOVE_TO_TRIP_2",
      label: `Move to trip ${moveTo.tripNo}`,
      description: `${trip.vehicleId} leaves without it and carries the whole order on trip ${moveTo.tripNo} instead. The extra stop lengthens that trip; its time budget is not re-checked.`,
      recommended: sendable <= 0,
      requiresNote: false,
      followUp: null,
      consequences: shortfallConsequences(ctx, "MOVE_TO_TRIP_2"),
    });
  }
  if (!departed) {
    options.push({
      decision: "HOLD_ORDER",
      label: "Hold the order for the next run",
      description: `${trip.vehicleId} leaves without ${sf.orderRef}; it is deferred to ${shortDay(followUpDate)}.`,
      recommended: sendable <= 0 && !moveTo,
      requiresNote: false,
      followUp: null,
      consequences: shortfallConsequences(ctx, "HOLD_ORDER"),
    });
    options.push({
      decision: "CANCEL_LINE",
      label: "Cancel the order",
      description: `${sf.orderRef} is cancelled for ${sf.outletName ?? sf.outletId} and not rescheduled.`,
      recommended: false,
      requiresNote: false,
      followUp: null,
      consequences: shortfallConsequences(ctx, "CANCEL_LINE"),
    });
  }
  return options;
}

function problemOptions(p: ProblemInput, fromStore: boolean): DecisionOption[] {
  if (p.status === "RESOLVED") return [];
  const options: DecisionOption[] = [];
  if (p.status === "NEW") {
    options.push({
      decision: "ACKNOWLEDGE",
      label: "Acknowledge",
      description: fromStore
        ? "Tell the store dispatch has seen this. It stays open until you resolve it."
        : "Mark it seen. It stays open until you resolve it.",
      recommended: true,
      requiresNote: false,
      followUp: null,
      consequences: problemConsequences("ACKNOWLEDGE", fromStore, p.outletName ?? p.outletId),
    });
  }
  options.push({
    decision: "RESOLVE",
    label: "Resolve",
    description: "Close it. Your note is kept as the resolution" + (fromStore ? " and sent to the store." : "."),
    recommended: p.status === "ACKNOWLEDGED",
    requiresNote: true,
    followUp: null,
    consequences: problemConsequences("RESOLVE", fromStore, p.outletName ?? p.outletId),
  });
  return options;
}

function acknowledgeOption(): DecisionOption {
  return {
    decision: "ACKNOWLEDGE",
    label: "Acknowledge",
    description:
      "Mark it seen. It stays open while the condition lasts and clears by itself when the evidence changes.",
    recommended: true,
    requiresNote: false,
    followUp: null,
    consequences: acknowledgeConsequences(),
  };
}

// ---------------------------------------------------------------------------
// Derivation
// ---------------------------------------------------------------------------

function ack(
  inputs: ExceptionInputs,
  id: string,
  severity: ExceptionSeverity,
): { at: string; byName: string } | null {
  const fact = inputs.acknowledgements.get(id);
  if (!fact) return null;
  // An acknowledgement answers "have you seen this?" at a given severity. If
  // the trip has since slipped from a warning into a critical, the dispatcher
  // has not seen *that*, so it is asked again.
  if (SEVERITY_RANK[severity] > SEVERITY_RANK[fact.severity]) return null;
  return { at: fact.at.toISOString(), byName: fact.byName };
}

/**
 * Every exception for one depot-day, open and resolved, in console order.
 *
 * Order: open before resolved; then the trip's planned departure (the thing the
 * dispatcher is racing); then when it was raised. Items with no departure to
 * race — a store issue about a delivery already made, a plan violation not tied
 * to one trip — sort after those that have one.
 */
export function deriveExceptions(inputs: ExceptionInputs, now: Date): ExceptionItem[] {
  const items: Array<ExceptionItem & { sortDepart: string }> = [];
  const tripById = new Map(inputs.trips.map((t) => [t.id, t]));
  const NO_DEPARTURE = "99:99";

  const age = (raised: Date) => minutesBetween(raised, now);

  // --- SHORTFALL ------------------------------------------------------------
  // Critical while it is OPEN and still blocks departure: the vehicle cannot
  // go until somebody decides. Category loading, because the dock is where it
  // is raised and where it is cleared.
  for (const sf of inputs.shortfalls) {
    const trip = tripById.get(sf.tripId);
    const stop = trip?.stops.find((s) => s.orders.some((o) => o.id === sf.orderId));
    const open = sf.status === "OPEN";
    const loaded = sf.orderUnits - sf.missingUnits;
    const decision = inputs.shortfallDecisions.get(sf.id);
    const kindText =
      sf.kind === "DAMAGED"
        ? `${plural(sf.missingUnits, "unit")} damaged`
        : sf.kind === "MISSING"
          ? `${plural(sf.missingUnits, "unit")} missing`
          : `Short ${plural(sf.missingUnits, "unit")}`;
    items.push({
      id: `shortfall:${sf.id}`,
      kind: "SHORTFALL",
      severity: open && sf.blocksDeparture ? "critical" : "warning",
      category: "loading",
      status: open ? "open" : "resolved",
      title: `${kindText} · ${sf.orderRef}${trip ? ` on ${trip.vehicleId}` : ""}`,
      subtitle: trip
        ? `${trip.districtName} route · Trip ${trip.tripNo} · departs ${trip.plannedDepartAt}`
        : "Trip no longer on the plan",
      detail: [reasonLabel(sf.reasonCode), sf.note].filter(Boolean).join(" · ") || null,
      reportedBy: { name: sf.raisedBy.name, role: sf.raisedBy.role ?? "LOADER" },
      raisedAt: sf.raisedAt.toISOString(),
      ageMinutes: age(sf.raisedAt),
      resolvedAt: sf.resolvedAt?.toISOString() ?? null,
      vehicleId: trip?.vehicleId ?? null,
      tripId: sf.tripId,
      planId: trip?.planId ?? null,
      departsAt: trip?.plannedDepartAt ?? null,
      orderRefs: [sf.orderRef],
      affectedOutlets: [
        {
          outletId: sf.outletId,
          outletName: sf.outletName,
          stopSeq: stop?.seq ?? null,
          ordered: sf.orderUnits,
          delta: -sf.missingUnits,
        },
      ],
      quantities: { loaded, expected: sf.orderUnits, short: sf.missingUnits },
      acknowledgement: null,
      resolution: open
        ? null
        : {
            decision: sf.resolution,
            note: decision?.note ?? null,
            at: sf.resolvedAt?.toISOString() ?? null,
            byName: decision?.byName ?? sf.resolvedByName,
          },
      decisionOptions: shortfallOptions(sf, trip, inputs.trips, inputs.followUpDate),
      sortDepart: trip?.plannedDepartAt ?? NO_DEPARTURE,
    });
  }

  // --- CHILLER --------------------------------------------------------------
  // Only the *latest* reading per trip is considered, so a newer in-range
  // reading clears the exception without any state of its own. Judged against
  // the band stored on the row, not today's policy. Always critical: chilled
  // goods outside their band are a loss and a food-safety question. Before
  // departure it is a loading problem the dock can still fix; after, it is
  // the driver's.
  for (const reading of inputs.chiller) {
    const trip = tripById.get(reading.tripId);
    if (!trip) continue;
    if (isInRange(reading.tempC, { minC: reading.targetMinC, maxC: reading.targetMaxC })) continue;
    const id = `chiller:${reading.id}`;
    const departed = trip.status === "DEPARTED";
    const source = SOURCE_LABEL[reading.source];
    const stops = trip.status === "DEPARTED" ? pendingStops(trip) : trip.stops;
    items.push({
      id,
      kind: "CHILLER",
      severity: "critical",
      category: departed ? "on_the_road" : "loading",
      status: "open",
      title: `${trip.vehicleId} chiller read ${reading.tempC} °C — target ${formatBand(reading.targetMinC, reading.targetMaxC)}`,
      subtitle: `${trip.districtName} route · ${departed ? "on the road" : `departs ${trip.plannedDepartAt}`} · refrigerated`,
      // A reading is a person's, and says so (DOMAIN.md); never "sensor alert".
      detail: `Gauge reading entered by ${reading.recordedByName ?? `a ${source.who.split(" ")[0]}`} (${source.who}) at ${clockOfInstant(reading.recordedAt)}. A person's reading, not a live feed.`,
      reportedBy: { name: reading.recordedByName ?? "Unnamed", role: source.role },
      raisedAt: reading.recordedAt.toISOString(),
      ageMinutes: age(reading.recordedAt),
      resolvedAt: null,
      vehicleId: trip.vehicleId,
      tripId: trip.id,
      planId: trip.planId,
      departsAt: trip.plannedDepartAt,
      orderRefs: refsOf(stops, true),
      affectedOutlets: outletsOf(stops, true),
      quantities: null,
      acknowledgement: ack(inputs, id, "critical"),
      resolution: null,
      decisionOptions: ack(inputs, id, "critical") ? [] : [acknowledgeOption()],
      sortDepart: trip.plannedDepartAt,
    });
  }

  // --- LATE and LAMP --------------------------------------------------------
  for (const trip of inputs.trips) {
    if (trip.status !== "DEPARTED") continue;
    const pending = pendingStops(trip);

    // Lateness is the slip at the last stop the driver recorded arriving at
    // (positions.ts `lateMinutes`) — evidence the driver gave, not a position
    // we inferred. A trip with no arrival has no evidence and is not "late".
    const late = lateMinutes(
      trip.stops.map((s) => ({
        seq: s.seq,
        plannedArrivalAt: s.plannedArrivalAt,
        arrivedAt: s.arrivedAt,
        status: s.status,
      })),
    );
    const lateSev = lateSeverity(late);
    if (lateSev) {
      const id = `late:${trip.id}`;
      const lastArrived = [...trip.stops].filter((s) => s.arrivedAt).sort((a, b) => b.seq - a.seq)[0]!;
      items.push({
        id,
        kind: "LATE",
        severity: lateSev,
        category: "on_the_road",
        status: "open",
        title: `${trip.vehicleId} running ${late} min late`,
        subtitle: `${trip.districtName} route · stop ${lastArrived.seq} of ${trip.stops.length} · ${plural(pending.length, "outlet")} may be late`,
        detail: `Measured at stop ${lastArrived.seq}: planned ${lastArrived.plannedArrivalAt}, arrived ${clockOfInstant(lastArrived.arrivedAt!)}, as recorded by the driver.`,
        reportedBy: SYSTEM,
        raisedAt: lastArrived.arrivedAt!.toISOString(),
        ageMinutes: age(lastArrived.arrivedAt!),
        resolvedAt: null,
        vehicleId: trip.vehicleId,
        tripId: trip.id,
        planId: trip.planId,
        departsAt: trip.plannedDepartAt,
        orderRefs: refsOf(pending),
        affectedOutlets: outletsOf(pending),
        quantities: null,
        acknowledgement: ack(inputs, id, lateSev),
        resolution: null,
        decisionOptions: ack(inputs, id, lateSev) ? [] : [acknowledgeOption()],
        sortDepart: trip.plannedDepartAt,
      });
    }

    // Lamp Mode: the phone has stopped reporting. A ping from *before* this
    // trip departed says where the vehicle was at the dock, not that it is
    // reporting on the road, so it counts as no report since departure. A trip
    // that has never reported becomes a lamp ten minutes after departing —
    // the same patience a silent vehicle gets mid-route.
    const ping = inputs.pings.get(trip.vehicleId);
    const sinceDeparture = ping && (!trip.departedAt || ping.recordedAt >= trip.departedAt) ? ping : null;
    let silentFrom: Date | null = null;
    let silentMinutes = 0;
    if (sinceDeparture) {
      const seconds = ageSecondsOf(sinceDeparture.recordedAt, now);
      if (isLamp(seconds)) {
        silentFrom = new Date(sinceDeparture.recordedAt.getTime() + LAMP_AFTER_MINUTES * 60_000);
        silentMinutes = Math.floor(seconds / 60);
      }
    } else if (trip.departedAt) {
      const seconds = ageSecondsOf(trip.departedAt, now);
      if (seconds >= LAMP_AFTER_MINUTES * 60) {
        silentFrom = new Date(trip.departedAt.getTime() + LAMP_AFTER_MINUTES * 60_000);
        silentMinutes = Math.floor(seconds / 60);
      }
    }
    if (silentFrom) {
      const id = `lamp:${trip.id}`;
      items.push({
        id,
        kind: "LAMP",
        severity: "warning",
        category: "on_the_road",
        status: "open",
        title: `${trip.vehicleId} in Lamp Mode · no update ${silentMinutes} min`,
        subtitle: sinceDeparture
          ? `${trip.districtName} · last reliable update ${clockOfInstant(sinceDeparture.recordedAt)}`
          : `${trip.districtName} · no position reported since departure at ${clockOfInstant(trip.departedAt!)}`,
        detail: "Driver works offline; ETA is estimated",
        reportedBy: SYSTEM,
        raisedAt: silentFrom.toISOString(),
        ageMinutes: age(silentFrom),
        resolvedAt: null,
        vehicleId: trip.vehicleId,
        tripId: trip.id,
        planId: trip.planId,
        departsAt: trip.plannedDepartAt,
        orderRefs: refsOf(pending),
        affectedOutlets: outletsOf(pending),
        quantities: null,
        acknowledgement: ack(inputs, id, "warning"),
        resolution: null,
        decisionOptions: ack(inputs, id, "warning") ? [] : [acknowledgeOption()],
        sortDepart: trip.plannedDepartAt,
      });
    }
  }

  // --- PROBLEM ----------------------------------------------------------------
  for (const p of inputs.problems) {
    const fromStore = p.raisedBy.role === "STORE_MANAGER";
    const trip = p.tripId ? tripById.get(p.tripId) : undefined;
    const open = p.status !== "RESOLVED";
    const severity = problemSeverity(p.kind, fromStore, p.reasonCode);
    const outletLabel = p.outletName ?? p.outletId;
    items.push({
      id: `problem:${p.id}`,
      kind: "PROBLEM",
      severity,
      category: fromStore ? "store" : "on_the_road",
      status: open ? "open" : "resolved",
      title: fromStore
        ? `${storeIssueLabel(p.kind, p.reasonCode)} reported${p.orderRef ? ` · ${p.orderRef}` : ""}`
        : `${kindLabel(p.kind, false)}${p.vehicleId ? ` · ${p.vehicleId}` : ""}`,
      subtitle: [outletLabel, p.orderRef, fromStore && p.units ? `${plural(p.units, "unit")} affected` : null]
        .filter(Boolean)
        .join(" · "),
      detail: p.note,
      reportedBy: p.raisedBy,
      raisedAt: p.raisedAt.toISOString(),
      ageMinutes: age(p.raisedAt),
      resolvedAt: p.resolvedAt?.toISOString() ?? null,
      vehicleId: p.vehicleId,
      tripId: p.tripId,
      planId: trip?.planId ?? null,
      departsAt: trip?.plannedDepartAt ?? null,
      orderRefs: p.orderRef ? [p.orderRef] : [],
      affectedOutlets: p.outletId
        ? [
            {
              outletId: p.outletId,
              outletName: p.outletName,
              stopSeq: p.stopSeq,
              ordered: p.orderUnits,
              delta: fromStore && p.units ? -p.units : null,
            },
          ]
        : [],
      quantities: null,
      acknowledgement:
        p.acknowledgedAt && p.status !== "NEW"
          ? { at: p.acknowledgedAt.toISOString(), byName: p.acknowledgedByName ?? "Dispatcher" }
          : null,
      resolution: open ? null : { decision: "RESOLVE", note: p.resolution, at: p.resolvedAt?.toISOString() ?? null, byName: p.resolvedByName },
      decisionOptions: problemOptions(p, fromStore),
      // A store issue is about a delivery already made, so there is no
      // departure left to race.
      sortDepart: fromStore ? NO_DEPARTURE : (trip?.plannedDepartAt ?? NO_DEPARTURE),
    });
  }

  // --- PLANNING ---------------------------------------------------------------
  // The draft plan's own validation at the "publish" stage, surfaced here so
  // the dispatcher meets planning trouble in the same list. No decisions: the
  // fix is to change the plan, so each item links to it (`planId`).
  if (inputs.planning) {
    const plan = inputs.planning;
    const seen = new Map<string, number>();
    for (const v of plan.violations) {
      const n = seen.get(v.code) ?? 0;
      seen.set(v.code, n + 1);
      const depart = v.vehicleId && v.tripNo ? plan.departAtByTrip.get(`${v.vehicleId}|${v.tripNo}`) : undefined;
      items.push({
        id: `plan:${plan.planId}:${v.code}:${n}`,
        kind: "PLANNING",
        severity: v.severity === "error" ? "critical" : "warning",
        category: "planning",
        status: "open",
        title: RULE_LABELS[v.code] ?? v.code,
        subtitle: v.message,
        detail: v.metric
          ? `${v.metric.have} against a limit of ${v.metric.limit} ${v.metric.unit}`
          : null,
        reportedBy: SYSTEM,
        raisedAt: plan.createdAt.toISOString(),
        ageMinutes: age(plan.createdAt),
        resolvedAt: null,
        vehicleId: v.vehicleId ?? null,
        tripId: null,
        planId: plan.planId,
        departsAt: depart ?? null,
        orderRefs: v.orderRefs ?? [],
        affectedOutlets: (v.outletIds ?? []).map((outletId) => ({
          outletId,
          outletName: plan.outletNames.get(outletId) ?? null,
          stopSeq: null,
          ordered: null,
          delta: null,
        })),
        quantities: null,
        acknowledgement: null,
        resolution: null,
        decisionOptions: [],
        sortDepart: depart ?? NO_DEPARTURE,
      });
    }
  }

  items.sort(
    (a, b) =>
      Number(a.status === "resolved") - Number(b.status === "resolved") ||
      a.sortDepart.localeCompare(b.sortDepart) ||
      a.raisedAt.localeCompare(b.raisedAt) ||
      a.id.localeCompare(b.id),
  );
  return items.map(({ sortDepart: _sortDepart, ...item }) => item);
}

// ---------------------------------------------------------------------------
// Summary and filtering
// ---------------------------------------------------------------------------

export interface ExceptionSummary {
  open: number;
  critical: number;
  ordersAffected: number;
  outletsAffected: number;
  vehiclesAffected: number;
  resolvedToday: number;
  avgResolveMinutes: number | null;
  countsByCategory: Record<ExceptionCategory, number>;
  countsBySeverity: Record<ExceptionSeverity, number>;
}

/**
 * The four tiles and the tab counts.
 *
 * Always over the whole day, ignoring the list's filters, because a tab count
 * that shrinks when you search for a vehicle stops being a count of the tab.
 *
 * "Resolved today" is the resolved items belonging to the date being viewed —
 * "today" when the viewer is on today. Chiller, late and lamp items can never
 * be resolved (they clear), so only shortfalls and problems contribute.
 * `avgResolveMinutes` is the mean of resolvedAt - raisedAt over those that
 * record a resolution time, rounded to a minute, and null when none do — never
 * 0, which would read as "instant".
 */
export function summarise(items: readonly ExceptionItem[]): ExceptionSummary {
  const open = items.filter((i) => i.status === "open");
  const resolved = items.filter((i) => i.status === "resolved");
  const timed = resolved.filter((i) => i.resolvedAt).map((i) => (Date.parse(i.resolvedAt!) - Date.parse(i.raisedAt)) / 60_000);

  const countsByCategory: Record<ExceptionCategory, number> = { planning: 0, loading: 0, on_the_road: 0, store: 0 };
  const countsBySeverity: Record<ExceptionSeverity, number> = { critical: 0, warning: 0, info: 0 };
  for (const i of open) {
    countsByCategory[i.category]++;
    countsBySeverity[i.severity]++;
  }

  return {
    open: open.length,
    critical: countsBySeverity.critical,
    ordersAffected: new Set(open.flatMap((i) => i.orderRefs)).size,
    outletsAffected: new Set(open.flatMap((i) => i.affectedOutlets.map((o) => o.outletId))).size,
    vehiclesAffected: new Set(open.map((i) => i.vehicleId).filter(Boolean)).size,
    resolvedToday: resolved.length,
    avgResolveMinutes: timed.length > 0 ? Math.round(timed.reduce((a, b) => a + Math.max(0, b), 0) / timed.length) : null,
    countsByCategory,
    countsBySeverity,
  };
}

export interface ExceptionFilter {
  status?: "open" | "resolved" | "all";
  category?: ExceptionCategory;
  severity?: ExceptionSeverity;
  q?: string;
}

/** Search matches order ref, vehicle, outlet id or name, and the title — what the search box says it does. */
export function filterExceptions(items: readonly ExceptionItem[], f: ExceptionFilter): ExceptionItem[] {
  const status = f.status ?? "open";
  const q = f.q?.trim().toLowerCase();
  return items.filter((i) => {
    if (status !== "all" && i.status !== status) return false;
    if (f.category && i.category !== f.category) return false;
    if (f.severity && i.severity !== f.severity) return false;
    if (q) {
      const haystack = [
        i.title,
        i.subtitle,
        i.vehicleId,
        ...i.orderRefs,
        ...i.affectedOutlets.flatMap((o) => [o.outletId, o.outletName]),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });
}

// ---------------------------------------------------------------------------
// Activity (detail view)
// ---------------------------------------------------------------------------

export interface ActivityEvent {
  at: string;
  actorName: string | null;
  actorRole: Role | null;
  action: string;
  summary: string;
  note: string | null;
}

interface AuditRow {
  at: Date;
  action: string;
  actorRole: Role | null;
  actor: { name: string } | null;
  note: string | null;
  after: unknown;
}

const DECISION_LABEL: Record<string, string> = {
  SEND_SHORT: "send short",
  HOLD_ORDER: "hold the order",
  CANCEL_LINE: "cancel the order",
  MOVE_TO_TRIP_2: "move to the later trip",
  ACKNOWLEDGE: "acknowledge",
  RESOLVE: "resolve",
};

function describeAudit(row: AuditRow): string {
  const who = row.actor?.name ?? "Someone";
  const after = (row.after && typeof row.after === "object" ? row.after : {}) as Record<string, unknown>;
  switch (row.action) {
    case "shortfall.raise":
      return `${who} flagged the shortfall at the dock`;
    case "shortfall.resolve":
      return `${who} decided to ${DECISION_LABEL[String(after.decision)] ?? "resolve it"}`;
    case "problem.raise":
      return `${who} reported the problem`;
    case "problem.acknowledge":
      return `${who} acknowledged the problem`;
    case "problem.resolve":
      return `${who} resolved the problem`;
    case "exception.acknowledge":
      return `${who} acknowledged this exception`;
    default:
      return `${who} · ${row.action}`;
  }
}

/**
 * The log for one exception, oldest first (the design reads top to bottom).
 *
 * Shortfalls and problems already write their own "raised" row; everything
 * else is detected, not reported, so a synthetic raise event is prepended —
 * attributed to the person whose reading it was for a chiller, to "System"
 * otherwise. The decision log never gets a row for it, and this is not written
 * back.
 */
export async function activityFor(item: ExceptionItem): Promise<ActivityEvent[]> {
  let rows: AuditRow[] = [];
  const [prefix] = item.id.split(":");
  if (prefix === "shortfall" || prefix === "problem") {
    rows = (await historyFor(prefix === "shortfall" ? "Shortfall" : "Problem", item.id.slice(prefix.length + 1))) as AuditRow[];
  } else if ((prefix === "chiller" || prefix === "late" || prefix === "lamp") && item.tripId) {
    rows = ((await historyFor("Trip", item.tripId)) as AuditRow[]).filter(
      (r) =>
        r.action.startsWith("exception.") &&
        (r.after as { exceptionId?: string } | null)?.exceptionId === item.id,
    );
  }

  const events: ActivityEvent[] = rows.map((r) => ({
    at: r.at.toISOString(),
    actorName: r.actor?.name ?? null,
    actorRole: r.actorRole,
    action: r.action,
    summary: describeAudit(r),
    note: r.note,
  }));

  const hasRaise = rows.some((r) => r.action === "shortfall.raise" || r.action === "problem.raise");
  if (!hasRaise) {
    const byPerson = item.kind === "CHILLER" || item.kind === "SHORTFALL" || item.kind === "PROBLEM";
    events.push({
      at: item.raisedAt,
      actorName: byPerson ? item.reportedBy.name : null,
      actorRole: byPerson ? item.reportedBy.role : null,
      action: "exception.raise",
      summary: byPerson ? `${item.reportedBy.name} raised this` : "Detected by Katapatha from the plan and what the field has recorded",
      note: null,
    });
  }
  return events.sort((a, b) => a.at.localeCompare(b.at));
}

// ---------------------------------------------------------------------------
// Id handling
// ---------------------------------------------------------------------------

export type ParsedId =
  | { kind: "SHORTFALL"; key: string }
  | { kind: "PROBLEM"; key: string }
  | { kind: "CHILLER"; key: string }
  | { kind: "LATE"; key: string }
  | { kind: "LAMP"; key: string }
  | { kind: "PLANNING"; key: string };

const SIMPLE_ID = /^(shortfall|problem|chiller|late|lamp):([A-Za-z0-9_-]{1,64})$/;
const PLAN_ID = /^plan:([A-Za-z0-9_-]{1,64}):([A-Z_]{1,64}):(\d{1,6})$/;

export function parseExceptionId(id: string): ParsedId | null {
  const simple = SIMPLE_ID.exec(id);
  if (simple) return { kind: simple[1]!.toUpperCase() as ParsedId["kind"], key: simple[2]! };
  const plan = PLAN_ID.exec(id);
  if (plan) return { kind: "PLANNING", key: plan[1]! };
  return null;
}

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

type Source = "shortfall" | "chiller" | "lateLamp" | "problem" | "planning";
const ALL_SOURCES: readonly Source[] = ["shortfall", "chiller", "lateLamp", "problem", "planning"];

function personOf(
  userId: string | null,
  users: Map<string, { name: string; role: Role }>,
  fallbackName?: string | null,
  fallbackRole: Role | null = null,
): Person {
  const user = userId ? users.get(userId) : undefined;
  if (user) return { name: user.name, role: user.role };
  return { name: fallbackName ?? "Unknown", role: fallbackRole };
}

async function fetchProblemRows(depotCode: string, date: string) {
  const dayStart = colomboDayStart(date);
  const dayEnd = new Date(dayStart.getTime() + 24 * 3_600_000);
  const depotUsers = await prisma.user.findMany({ where: { depotCode }, select: { id: true } });
  return prisma.problem.findMany({
    where: {
      AND: [
        {
          OR: [
            { trip: { plan: { planningDay: { depotCode } } } },
            { order: { depotCode } },
            { raisedByUserId: { in: depotUsers.map((u) => u.id) } },
          ],
        },
        { occurredAt: { lt: dayEnd } },
        { OR: [{ occurredAt: { gte: dayStart } }, { status: { not: "RESOLVED" } }] },
      ],
    },
    include: {
      trip: { select: { vehicleId: true } },
      tripStop: { select: { seq: true, outletId: true, outlet: { select: { displayName: true } } } },
      order: { select: { ref: true, units: true, outletId: true, outlet: { select: { displayName: true } } } },
    },
    orderBy: { occurredAt: "asc" },
  });
}

/**
 * Gather everything `deriveExceptions` needs for one depot-day. Only the
 * sources in `sources` are loaded, so opening a single shortfall does not run
 * the plan validator.
 */
export async function loadExceptionInputs(
  depotCode: string,
  date: string,
  now: Date,
  sources: readonly Source[] = ALL_SOURCES,
): Promise<ExceptionInputs> {
  const want = new Set(sources);
  const day = asDate(date);
  const followUp = await nextOperatingDate(day);
  const inputs = emptyInputs(date, followUp ? isoDate(followUp) : date);

  const needTrips = want.has("shortfall") || want.has("chiller") || want.has("lateLamp") || want.has("problem");
  const tripRows = needTrips
    ? await prisma.trip.findMany({
        where: { plan: { status: "PUBLISHED", planningDay: { date: day, depotCode } } },
        include: {
          vehicle: { select: { temp: true, weightCapKg: true, volumeCapM3: true } },
          stops: {
            orderBy: { seq: "asc" },
            include: {
              outlet: { select: { displayName: true } },
              orders: {
                include: {
                  order: {
                    select: { id: true, ref: true, units: true, tempRequirement: true, weightKg: true, volumeM3: true },
                  },
                },
              },
            },
          },
        },
        orderBy: [{ plannedDepartAt: "asc" }, { vehicleId: "asc" }],
      })
    : [];
  inputs.trips = tripRows.map((t) => ({
    id: t.id,
    planId: t.planId,
    vehicleId: t.vehicleId,
    vehicleTemp: t.vehicle.temp,
    vehicleWeightCapKg: t.vehicle.weightCapKg,
    vehicleVolumeCapM3: t.vehicle.volumeCapM3,
    tripNo: t.tripNo,
    status: t.status,
    brand: t.brand,
    districtName: t.districtName,
    plannedDepartAt: t.plannedDepartAt,
    departedAt: t.departedAt,
    sumWeightKg: t.sumWeightKg,
    sumVolumeM3: t.sumVolumeM3,
    stops: t.stops.map((s) => ({
      id: s.id,
      seq: s.seq,
      outletId: s.outletId,
      outletName: s.outlet.displayName,
      status: s.status,
      plannedArrivalAt: s.plannedArrivalAt,
      arrivedAt: s.arrivedAt,
      orders: s.orders.map(({ order }) => ({
        id: order.id,
        ref: order.ref,
        units: order.units,
        tempRequirement: order.tempRequirement,
        weightKg: order.weightKg,
        volumeM3: order.volumeM3,
      })),
    })),
  }));
  const tripIds = inputs.trips.map((t) => t.id);

  const shortfallRows =
    want.has("shortfall") && tripIds.length > 0
      ? await prisma.shortfall.findMany({
          where: { tripId: { in: tripIds } },
          include: {
            order: {
              select: {
                ref: true,
                units: true,
                weightKg: true,
                volumeM3: true,
                outletId: true,
                outlet: { select: { displayName: true } },
              },
            },
          },
          orderBy: { raisedAt: "asc" },
        })
      : [];

  if (want.has("chiller")) {
    const reefers = inputs.trips.filter(
      (t) => t.vehicleTemp === "reefer" && t.status !== "COMPLETED" && t.status !== "CANCELLED",
    );
    if (reefers.length > 0) {
      const readings = await prisma.chillerReading.findMany({
        where: { tripId: { in: reefers.map((t) => t.id) } },
        orderBy: [{ tripId: "asc" }, { recordedAt: "desc" }],
        distinct: ["tripId"],
      });
      inputs.chiller = readings.map((r) => ({
        id: r.id,
        tripId: r.tripId!,
        tempC: r.tempC,
        targetMinC: r.targetMinC,
        targetMaxC: r.targetMaxC,
        source: r.source,
        recordedByName: r.recordedByName,
        recordedAt: r.recordedAt,
      }));
    }
  }

  if (want.has("lateLamp")) {
    const departedVehicles = [...new Set(inputs.trips.filter((t) => t.status === "DEPARTED").map((t) => t.vehicleId))];
    const positions = await latestPositions(departedVehicles, now);
    inputs.pings = new Map([...positions].map(([vehicleId, p]) => [vehicleId, { recordedAt: p.recordedAt }]));
  }

  // Problems belong to a date by when they were raised (device clock, Colombo),
  // and an unresolved one carries forward to later dates: a problem nobody has
  // dealt with does not stop being a problem at midnight. A resolved one stays
  // on the day it was raised. Depot scope is the same three routes
  // `requireDispatcherProblem` accepts.
  let problemRows: Awaited<ReturnType<typeof fetchProblemRows>> = [];
  const problemExtras = new Map<
    string,
    { orderRef: string | null; orderUnits: number | null; outletId: string | null; outletName: string | null; stopSeq: number | null; vehicleId: string | null }
  >();
  if (want.has("problem")) {
    problemRows = await fetchProblemRows(depotCode, date);
    for (const r of problemRows) {
      const outlet = r.tripStop
        ? { id: r.tripStop.outletId, name: r.tripStop.outlet.displayName }
        : r.order
          ? { id: r.order.outletId, name: r.order.outlet.displayName }
          : null;
      problemExtras.set(r.id, {
        orderRef: r.order?.ref ?? null,
        orderUnits: r.order?.units ?? null,
        outletId: outlet?.id ?? null,
        outletName: outlet?.name ?? null,
        stopSeq: r.tripStop?.seq ?? null,
        vehicleId: r.trip?.vehicleId ?? null,
      });
    }
  }

  // Names and roles for everyone who appears, in one query.
  const userIds = new Set<string>();
  for (const s of shortfallRows) {
    if (s.raisedByUserId) userIds.add(s.raisedByUserId);
    if (s.resolvedByUserId) userIds.add(s.resolvedByUserId);
  }
  for (const p of problemRows) {
    if (p.raisedByUserId) userIds.add(p.raisedByUserId);
    if (p.acknowledgedByUserId) userIds.add(p.acknowledgedByUserId);
  }
  const userRows = userIds.size > 0 ? await prisma.user.findMany({ where: { id: { in: [...userIds] } }, select: { id: true, name: true, role: true } }) : [];
  const users = new Map(userRows.map((u) => [u.id, { name: u.name, role: u.role }]));

  // The decision log supplies what the tables have no column for: which
  // acknowledgements exist for trip-derived items, when a problem was
  // resolved, how many units a store said were affected, and the dispatcher's
  // note on a shortfall.
  const shortfallIds = shortfallRows.map((s) => s.id);
  const problemIds = problemRows.map((p) => p.id);
  const auditOr = [
    ...(tripIds.length > 0 ? [{ entityType: "Trip", entityId: { in: tripIds }, action: "exception.acknowledge" }] : []),
    ...(shortfallIds.length > 0 ? [{ entityType: "Shortfall", entityId: { in: shortfallIds }, action: "shortfall.resolve" }] : []),
    ...(problemIds.length > 0 ? [{ entityType: "Problem", entityId: { in: problemIds }, action: { in: ["problem.raise", "problem.resolve"] } }] : []),
  ];
  const audit = auditOr.length > 0 ? await prisma.auditEvent.findMany({ where: { OR: auditOr }, orderBy: { at: "asc" }, include: { actor: { select: { name: true } } } }) : [];
  const problemResolved = new Map<string, { at: Date; byName: string | null }>();
  const issueUnits = new Map<string, number>();
  for (const row of audit) {
    const after = (row.after && typeof row.after === "object" ? row.after : {}) as Record<string, unknown>;
    if (row.action === "exception.acknowledge" && typeof after.exceptionId === "string") {
      inputs.acknowledgements.set(after.exceptionId, {
        at: row.at,
        byName: row.actor?.name ?? "Dispatcher",
        severity: (after.severity as ExceptionSeverity) ?? "info",
      });
    } else if (row.action === "shortfall.resolve") {
      inputs.shortfallDecisions.set(row.entityId, {
        at: row.at,
        byName: row.actor?.name ?? "Dispatcher",
        note: row.note,
        decision: String(after.decision ?? ""),
      });
    } else if (row.action === "problem.resolve") {
      problemResolved.set(row.entityId, { at: row.at, byName: row.actor?.name ?? null });
    } else if (row.action === "problem.raise" && typeof after.units === "number") {
      issueUnits.set(row.entityId, after.units);
    }
  }

  inputs.shortfalls = shortfallRows.map((s) => ({
    id: s.id,
    tripId: s.tripId,
    orderId: s.orderId,
    orderRef: s.order.ref,
    orderUnits: s.order.units,
    orderWeightKg: s.order.weightKg,
    orderVolumeM3: s.order.volumeM3,
    outletId: s.order.outletId,
    outletName: s.order.outlet.displayName,
    kind: s.kind,
    missingUnits: s.missingUnits,
    reasonCode: s.reasonCode,
    note: s.note,
    raisedBy: personOf(s.raisedByUserId, users, s.raisedByName, "LOADER"),
    raisedByUserId: s.raisedByUserId,
    raisedAt: s.raisedAt,
    status: s.status,
    resolution: s.resolution,
    resolvedAt: s.resolvedAt,
    resolvedByName: s.resolvedByUserId ? (users.get(s.resolvedByUserId)?.name ?? null) : null,
    blocksDeparture: s.blocksDeparture,
  }));

  inputs.problems = problemRows.map((p) => {
    const extra = problemExtras.get(p.id)!;
    const resolved = problemResolved.get(p.id);
    return {
      id: p.id,
      kind: p.kind,
      note: p.note,
      reasonCode: p.reasonCode,
      status: p.status,
      resolution: p.resolution,
      raisedBy: personOf(p.raisedByUserId, users),
      raisedAt: p.occurredAt,
      acknowledgedAt: p.acknowledgedAt,
      acknowledgedByName: p.acknowledgedByUserId ? (users.get(p.acknowledgedByUserId)?.name ?? null) : null,
      resolvedAt: p.status === "RESOLVED" ? (resolved?.at ?? null) : null,
      resolvedByName: resolved?.byName ?? null,
      units: issueUnits.get(p.id) ?? null,
      orderId: p.orderId,
      orderRef: extra.orderRef,
      orderUnits: extra.orderUnits,
      outletId: extra.outletId,
      outletName: extra.outletName,
      stopSeq: extra.stopSeq,
      tripId: p.tripId,
      vehicleId: extra.vehicleId,
    };
  });

  if (want.has("planning")) {
    const draft = await prisma.plan.findFirst({
      where: { status: "DRAFT", planningDay: { date: day, depotCode } },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });
    if (draft) {
      const [plan, ctx] = await Promise.all([loadPlan(draft.id), loadDayContext(day, depotCode as DepotCode)]);
      if (plan && ctx) {
        const violations = validatePlan(await snapshotFromPlan(plan, ctx), { stage: "publish" });
        const outletIds = [...new Set(violations.flatMap((v) => v.outletIds ?? []))];
        const outlets = outletIds.length > 0 ? await prisma.outlet.findMany({ where: { id: { in: outletIds } }, select: { id: true, displayName: true } }) : [];
        inputs.planning = {
          planId: plan.id,
          createdAt: plan.createdAt,
          violations,
          outletNames: new Map(outlets.map((o) => [o.id, o.displayName])),
          departAtByTrip: new Map(plan.trips.map((t) => [`${t.vehicleId}|${t.tripNo}`, t.plannedDepartAt])),
        };
      }
    }
  }

  return inputs;
}

/** The whole day's exceptions, for the list endpoint. */
export async function exceptionsForDay(depotCode: string, date: string, now: Date) {
  const inputs = await loadExceptionInputs(depotCode, date, now);
  return deriveExceptions(inputs, now);
}

export function sourcesFor(kind: ParsedId["kind"]): Source[] {
  switch (kind) {
    case "SHORTFALL":
      return ["shortfall"];
    case "PROBLEM":
      return ["problem"];
    case "CHILLER":
      return ["chiller"];
    case "LATE":
    case "LAMP":
      return ["lateLamp"];
    case "PLANNING":
      return ["planning"];
  }
}
