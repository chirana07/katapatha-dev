import type { Prisma } from "@prisma/client";
import { clockMinutes, clockOf } from "./positions";
import { prisma } from "../lib/db";
import { recordDecisions, type DecisionRecord } from "../lib/audit";
import type { SessionUser } from "../lib/auth";
import {
  requireDispatcherPlan,
  requireDispatcherProblem,
  requireDispatcherShortfall,
} from "../lib/authorization";
import { AuthError } from "../lib/auth";
import { asDate, isoDate } from "./plans";
import { createFollowUpOrder } from "./followUp";
import {
  activityFor,
  colomboDateOf,
  deriveExceptions,
  loadExceptionInputs,
  moveTarget,
  parseExceptionId,
  problemConsequences,
  shortfallConsequences,
  sourcesFor,
  type ActivityEvent,
  type Consequence,
  type DecisionCode,
  type ExceptionInputs,
  type ExceptionItem,
  type ParsedId,
  type ShortfallDecisionContext,
} from "./exceptions";

/**
 * Looking one exception up, and deciding it.
 *
 * Every decision here is a write the dispatcher can see the effects of in the
 * rest of the app, and `consequences` is the list of those effects — built from
 * what was actually done, not from what the screen would like to promise (see
 * `shortfallConsequences`). The rules, since DOMAIN.md only names the four
 * resolutions and what two of them do to an order:
 *
 * SEND_SHORT   The shortfall closes and the departure block lifts. The order is
 *              left exactly as it was — still PLANNED, still on its stop, still
 *              `units` as ordered — because rewriting the order would erase the
 *              fact that the store ordered 20. It is delivered, and recorded,
 *              as a part-delivery. `followUp` adds the missing units to the next
 *              operating day as a new order.
 * HOLD_ORDER   DOMAIN.md: the order becomes DEFERRED. It also comes off the
 *              trip (the stop link goes, the stop is SKIPPED if empty, the
 *              trip's totals shrink) and gets a Deferral to the next operating
 *              day, the same record the publish path writes, so the store's
 *              screen already knows how to show it.
 * CANCEL_LINE  DOMAIN.md: the order becomes CANCELLED. Same removal from the
 *              trip; no Deferral, because nothing moves.
 * MOVE_TO_TRIP_2  The whole order (orders travel whole — rule 1 forbids a split)
 *              moves to the vehicle's later trip: relinked to a stop there
 *              (merged into the outlet's stop if it has one, otherwise a new
 *              last stop), recorded as a StopReassignment, the order stays
 *              PLANNED.
 *
 * For HOLD, CANCEL and MOVE the order's Assignment on the published plan is
 * rewritten to DEFERRED with no stop (the plan no longer serves it), so plan
 * statistics agree with the order's status.
 *
 * Replays: deciding the same way twice returns 200 with the same body and does
 * nothing the second time; deciding differently on a decided exception is 409
 * ALREADY_DECIDED. 200 rather than 409 for the identical case because a retry
 * after a lost response is the common case and must be safe to just repeat.
 * Identical means the same decision and, for SEND_SHORT, the same `followUp`.
 */

export type DecisionResult =
  | { ok: true; replayed: boolean; exception: ExceptionItem; consequences: Consequence[] }
  | { ok: false; status: 404 | 409 | 422; code: string; message: string; details?: Record<string, unknown> };

function fail(
  status: 404 | 409 | 422,
  code: string,
  message: string,
  details?: Record<string, unknown>,
): DecisionResult {
  return { ok: false, status, code, message, details };
}

function deny(): never {
  throw new AuthError("You do not have access to this record", 403);
}

function requireDepot(user: SessionUser): string {
  if (user.role !== "DISPATCHER" || !user.depotCode) return deny();
  return user.depotCode;
}

/**
 * Who may see this exception, and which depot-day it belongs to.
 *
 * Authorisation is the existing per-record predicates where they exist
 * (shortfall, problem, plan); chiller readings and trips have none, so they
 * are scoped by the depot of the plan their trip sits on — the same test the
 * history endpoint applies to a Trip. A record the caller may not see answers
 * 403, exactly as one that does not exist.
 */
export async function locateException(
  user: SessionUser,
  parsed: ParsedId,
): Promise<{ depotCode: string; date: string }> {
  const depotCode = requireDepot(user);
  switch (parsed.kind) {
    case "SHORTFALL": {
      const sf = await requireDispatcherShortfall(user, parsed.key);
      const trip = await prisma.trip.findUnique({
        where: { id: sf.tripId },
        select: { plan: { select: { planningDay: { select: { date: true } } } } },
      });
      if (!trip) return deny();
      return { depotCode, date: isoDate(trip.plan.planningDay.date) };
    }
    case "PROBLEM": {
      const problem = await requireDispatcherProblem(user, parsed.key);
      return { depotCode, date: colomboDateOf(problem.occurredAt) };
    }
    case "PLANNING": {
      const plan = await requireDispatcherPlan(user, parsed.key);
      return { depotCode, date: isoDate(plan.planningDay.date) };
    }
    case "CHILLER": {
      const reading = await prisma.chillerReading.findFirst({
        where: { id: parsed.key, trip: { plan: { planningDay: { depotCode } } } },
        select: { trip: { select: { plan: { select: { planningDay: { select: { date: true } } } } } } },
      });
      if (!reading?.trip) return deny();
      return { depotCode, date: isoDate(reading.trip.plan.planningDay.date) };
    }
    case "LATE":
    case "LAMP": {
      const trip = await prisma.trip.findFirst({
        where: { id: parsed.key, plan: { planningDay: { depotCode } } },
        select: { plan: { select: { planningDay: { select: { date: true } } } } },
      });
      if (!trip) return deny();
      return { depotCode, date: isoDate(trip.plan.planningDay.date) };
    }
  }
}

/** One exception with its activity, or null when it is not (or no longer) in the console. */
export async function getException(
  user: SessionUser,
  id: string,
  now: Date,
): Promise<{ exception: ExceptionItem; activity: ActivityEvent[] } | { notFound: true; code: string; message: string }> {
  const parsed = parseExceptionId(id);
  if (!parsed) return { notFound: true, code: "NOT_FOUND", message: "No such exception." };
  const { depotCode, date } = await locateException(user, parsed);
  const inputs = await loadExceptionInputs(depotCode, date, now, sourcesFor(parsed.kind));
  const exception = deriveExceptions(inputs, now).find((i) => i.id === id);
  if (!exception) return notActive(parsed);
  return { exception, activity: await activityFor(exception) };
}

function notActive(parsed: ParsedId): { notFound: true; code: string; message: string } {
  return parsed.kind === "SHORTFALL" || parsed.kind === "PROBLEM"
    ? { notFound: true, code: "NOT_FOUND", message: "No such exception." }
    : {
        notFound: true,
        code: "EXCEPTION_NOT_ACTIVE",
        message: "This condition has cleared or changed since the list was loaded.",
      };
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === "P2002";
}

const MAX_ATTEMPTS = 3;

export interface DecisionBody {
  decision: DecisionCode;
  note?: string;
  followUp?: boolean;
}

function shortDay(date: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" }).format(
    new Date(`${date}T00:00:00Z`),
  );
}

export async function decideException(
  user: SessionUser,
  id: string,
  body: DecisionBody,
  now: Date,
  /** Internal: set when re-entering after losing a race, so it cannot loop. */
  retried = false,
): Promise<DecisionResult> {
  const parsed = parseExceptionId(id);
  if (!parsed) return fail(404, "NOT_FOUND", "No such exception.");
  const { depotCode, date } = await locateException(user, parsed);

  if (parsed.kind === "PLANNING") {
    return fail(
      409,
      "NO_DECISION_AVAILABLE",
      "Planning exceptions have no decision here. Change the plan; the item clears when the violation does.",
    );
  }

  const inputs = await loadExceptionInputs(depotCode, date, now, sourcesFor(parsed.kind));
  const item = deriveExceptions(inputs, now).find((i) => i.id === id);
  if (!item) {
    const n = notActive(parsed);
    return fail(404, n.code as "NOT_FOUND", n.message);
  }

  if (body.followUp && body.decision !== "SEND_SHORT") {
    return fail(422, "FOLLOW_UP_NOT_APPLICABLE", "A follow-up order only applies to SEND_SHORT.");
  }

  switch (parsed.kind) {
    case "SHORTFALL":
      return decideShortfall(user, parsed.key, item, inputs, body, now, retried);
    case "PROBLEM":
      return decideProblem(user, parsed.key, item, inputs, body, now, retried);
    default:
      return acknowledgeTripItem(user, parsed, item, depotCode, date, body, now);
  }
}

async function reload(depotCode: string, date: string, parsed: ParsedId, id: string, now: Date, fallback: ExceptionItem) {
  const inputs = await loadExceptionInputs(depotCode, date, now, sourcesFor(parsed.kind));
  return deriveExceptions(inputs, now).find((i) => i.id === id) ?? fallback;
}

// ---------------------------------------------------------------------------
// Chiller / late / lamp: acknowledge only
// ---------------------------------------------------------------------------

/**
 * These three describe a condition, not a record, so there is nothing to
 * resolve — the item clears when the evidence changes (an in-range reading, the
 * trip catching up, a ping arriving). The only decision is "I have seen this",
 * kept as an audit row against the trip with the exception id and the severity
 * at the time, and read back as the item's `acknowledgement`.
 */
async function acknowledgeTripItem(
  user: SessionUser,
  parsed: ParsedId,
  item: ExceptionItem,
  depotCode: string,
  date: string,
  body: DecisionBody,
  now: Date,
): Promise<DecisionResult> {
  if (body.decision !== "ACKNOWLEDGE") {
    return fail(409, "DECISION_NOT_AVAILABLE", "Only ACKNOWLEDGE is available for this exception.", {
      offered: ["ACKNOWLEDGE"],
    });
  }
  const consequences: Consequence[] = [
    {
      audience: "record",
      title: "Decision record",
      detail: `Acknowledged by ${user.name}. The exception stays open for as long as the condition lasts.`,
    },
  ];
  if (item.acknowledgement) {
    return { ok: true, replayed: true, exception: item, consequences };
  }
  await recordDecisions([
    {
      actor: user,
      action: "exception.acknowledge",
      entityType: "Trip",
      entityId: item.tripId!,
      after: { exceptionId: item.id, kind: item.kind, severity: item.severity },
    },
  ]);
  return { ok: true, replayed: false, exception: await reload(depotCode, date, parsed, item.id, now, item), consequences };
}

// ---------------------------------------------------------------------------
// Problems
// ---------------------------------------------------------------------------

async function decideProblem(
  user: SessionUser,
  problemId: string,
  item: ExceptionItem,
  inputs: ExceptionInputs,
  body: DecisionBody,
  now: Date,
  retried: boolean,
): Promise<DecisionResult> {
  const problem = inputs.problems.find((p) => p.id === problemId)!;
  const fromStore = problem.raisedBy.role === "STORE_MANAGER";
  if (body.decision !== "ACKNOWLEDGE" && body.decision !== "RESOLVE") {
    return fail(409, "DECISION_NOT_AVAILABLE", "Only ACKNOWLEDGE and RESOLVE are available for a problem.", {
      offered: ["ACKNOWLEDGE", "RESOLVE"],
    });
  }
  const consequences = problemConsequences(body.decision, fromStore, problem.outletName ?? problem.outletId, user.name);

  // Replays and conflicts, decided from the state we just read.
  if (body.decision === "ACKNOWLEDGE") {
    if (problem.status === "ACKNOWLEDGED") return { ok: true, replayed: true, exception: item, consequences };
    if (problem.status === "RESOLVED") return alreadyDecided(item, "problem is already resolved");
  } else if (problem.status === "RESOLVED") {
    return { ok: true, replayed: true, exception: item, consequences };
  }

  const note = body.note?.trim();
  if (body.decision === "RESOLVE" && !note) {
    return fail(422, "NOTE_REQUIRED", "Resolving a problem needs a note: it is kept as the resolution.");
  }

  const outletId = problem.outletId;
  const claimed = await prisma.$transaction(async (tx) => {
    const result =
      body.decision === "ACKNOWLEDGE"
        ? await tx.problem.updateMany({
            where: { id: problemId, status: "NEW" },
            data: { status: "ACKNOWLEDGED", acknowledgedByUserId: user.id, acknowledgedAt: now },
          })
        : await tx.problem.updateMany({
            where: { id: problemId, status: { in: ["NEW", "ACKNOWLEDGED"] } },
            data: {
              status: "RESOLVED",
              resolution: note,
              // Resolving implies having seen it; keep the first
              // acknowledgement if there was one.
              ...(problem.acknowledgedAt ? {} : { acknowledgedByUserId: user.id, acknowledgedAt: now }),
            },
          });
    if (result.count === 0) return false;

    // The store is told, because the issue it raised is the one thing it has
    // no other way to watch. Driver-raised problems notify nobody here.
    if (fromStore && outletId) {
      await tx.notification.create({
        data: {
          outletId,
          kind: body.decision === "ACKNOWLEDGE" ? "issue.acknowledged" : "issue.resolved",
          title:
            body.decision === "ACKNOWLEDGE"
              ? `Dispatch has seen your report${problem.orderRef ? ` on ${problem.orderRef}` : ""}`
              : `Your report${problem.orderRef ? ` on ${problem.orderRef}` : ""} is resolved`,
          body: body.decision === "ACKNOWLEDGE" ? "Dispatch will follow up. You will see the outcome in My orders." : note!,
          payload: { problemId, orderId: problem.orderId },
        },
      });
    }
    return true;
  });

  if (!claimed) {
    // Somebody else decided between our read and our write. Classify again
    // from the new state; a second loss is reported rather than looped on.
    if (retried) return fail(409, "RACE_LOST", "Another dispatcher decided this just now.");
    return decideException(user, `problem:${problemId}`, body, now, true);
  }

  const action = body.decision === "ACKNOWLEDGE" ? "problem.acknowledge" : "problem.resolve";
  const records: DecisionRecord[] = [
    { actor: user, action, entityType: "Problem", entityId: problemId, note, before: { status: problem.status }, after: { status: body.decision === "ACKNOWLEDGE" ? "ACKNOWLEDGED" : "RESOLVED" } },
  ];
  if (problem.orderId) {
    records.push({
      actor: user,
      action: body.decision === "ACKNOWLEDGE" ? "issue.acknowledge" : "issue.resolve",
      entityType: "Order",
      entityId: problem.orderId,
      note,
      after: { problemId },
    });
  }
  await recordDecisions(records);

  const date = colomboDateOf(problem.raisedAt);
  const depotCode = user.depotCode!;
  const updated = await reload(depotCode, date, { kind: "PROBLEM", key: problemId }, item.id, now, item);
  return { ok: true, replayed: false, exception: updated, consequences };
}

function alreadyDecided(item: ExceptionItem, why: string): DecisionResult {
  return fail(409, "ALREADY_DECIDED", `This exception has already been decided: ${why}.`, {
    resolution: item.resolution?.decision ?? null,
    decidedBy: item.resolution?.byName ?? null,
    decidedAt: item.resolution?.at ?? null,
  });
}

// ---------------------------------------------------------------------------
// Shortfalls
// ---------------------------------------------------------------------------

function round(value: number, places: number): number {
  const f = 10 ** places;
  return Math.round(value * f) / f;
}

async function decideShortfall(
  user: SessionUser,
  shortfallId: string,
  item: ExceptionItem,
  inputs: ExceptionInputs,
  body: DecisionBody,
  now: Date,
  retried: boolean,
): Promise<DecisionResult> {
  const sf = inputs.shortfalls.find((s) => s.id === shortfallId)!;
  const trip = inputs.trips.find((t) => t.id === sf.tripId)!;
  const decision = body.decision;
  const followUpKey = `followup:${sf.id}`;

  if (!["SEND_SHORT", "HOLD_ORDER", "CANCEL_LINE", "MOVE_TO_TRIP_2"].includes(decision)) {
    return fail(409, "DECISION_NOT_AVAILABLE", "ACKNOWLEDGE and RESOLVE do not apply to a shortfall.", {
      offered: item.decisionOptions.map((o) => o.decision),
    });
  }

  const moveTo = moveTarget(sf, trip, inputs.trips);
  const ctx: ShortfallDecisionContext = { sf, trip, followUpDate: inputs.followUpDate, moveTo };

  if (sf.status === "RESOLVED") {
    const fact = inputs.shortfallDecisions.get(sf.id);
    const existingFollowUp = await prisma.order.findUnique({ where: { clientRequestId: followUpKey }, select: { ref: true } });
    const sameDecision = fact?.decision === decision && Boolean(body.followUp) === Boolean(existingFollowUp);
    if (sameDecision) {
      return {
        ok: true,
        replayed: true,
        exception: item,
        consequences: shortfallConsequences(ctx, decision, {
          followUp: Boolean(existingFollowUp),
          followUpRef: existingFollowUp?.ref,
          actorName: fact?.byName,
        }),
      };
    }
    return alreadyDecided(
      item,
      fact
        ? `it was resolved as ${item.resolution?.decision ?? "another decision"}`
        : "the loader corrected the load check, which closed it",
    );
  }

  if (!item.decisionOptions.some((o) => o.decision === decision)) {
    return fail(409, "DECISION_NOT_AVAILABLE", "That decision is not available for this shortfall.", {
      offered: item.decisionOptions.map((o) => o.decision),
    });
  }

  const stop = trip.stops.find((s) => s.orders.some((o) => o.id === sf.orderId))!;
  const note = body.note?.trim() || undefined;
  const outcome: { followUpRef?: string; followUpOrderId?: string; arrivalAt?: string } = {};

  for (let attempt = 1; ; attempt++) {
    try {
      const claimed = await prisma.$transaction(async (tx) => {
        const result = await tx.shortfall.updateMany({
          where: { id: sf.id, status: "OPEN" },
          data: { status: "RESOLVED", resolution: decision as never, resolvedByUserId: user.id, resolvedAt: now, blocksDeparture: false },
        });
        if (result.count === 0) return false;

        const order = await tx.order.findUnique({ where: { id: sf.orderId } });
        if (!order) throw new Error("Order vanished under a shortfall");

        if (decision === "SEND_SHORT") {
          if (body.followUp) {
            // Keyed on the shortfall, not the request: a retried decision (or
            // two dispatchers) must land on the same row. The unique index on
            // clientRequestId is the backstop; the claim above is why we are
            // normally the only writer here.
            const prior = await tx.order.findUnique({ where: { clientRequestId: followUpKey } });
            const created =
              prior ??
              (await createFollowUpOrder(tx, order, sf.missingUnits, inputs.followUpDate, user.id, followUpKey));
            outcome.followUpRef = created.ref;
            outcome.followUpOrderId = created.id;
          }
          await tx.notification.create({
            data: {
              outletId: sf.outletId,
              kind: "shortfall.send_short",
              title: `Order ${sf.orderRef} is leaving ${sf.missingUnits} short`,
              body:
                `${trip.vehicleId} leaves with ${sf.orderUnits - sf.missingUnits} of ${sf.orderUnits} units.` +
                (outcome.followUpRef
                  ? ` The missing ${sf.missingUnits} are queued for ${shortDay(inputs.followUpDate)} as ${outcome.followUpRef}.`
                  : " Contact dispatch if you need the rest sent."),
              payload: { orderId: sf.orderId, shortfallId: sf.id, missingUnits: sf.missingUnits, followUpOrderId: outcome.followUpOrderId ?? null },
            },
          });
          return true;
        }

        // HOLD, CANCEL and MOVE all take the order off this trip's stop.
        await tx.tripStopOrder.deleteMany({ where: { orderId: sf.orderId, tripStopId: stop.id } });
        if (stop.orders.length === 1) {
          // A stop with nothing left to deliver is passed over, not deleted:
          // the row is referenced by the plan's assignments and by history.
          await tx.tripStop.update({ where: { id: stop.id }, data: { status: "SKIPPED" } });
        }
        await tx.trip.update({
          where: { id: trip.id },
          data: { sumWeightKg: { decrement: sf.orderWeightKg }, sumVolumeM3: { decrement: sf.orderVolumeM3 } },
        });

        if (decision === "MOVE_TO_TRIP_2") {
          const target = moveTarget(sf, trip, inputs.trips)!;
          const existing = target.stops.find((s) => s.outletId === sf.outletId);
          let targetStopId = existing?.id;
          const brand = target.brand as never;
          const outlet = await tx.outlet.findUnique({ where: { id: sf.outletId }, select: { dockType: true } });
          const allowance = outlet
            ? await tx.serviceAllowance.findUnique({ where: { brand_dockType: { brand, dockType: outlet.dockType } } })
            : null;
          let addedMinutes = allowance?.minutes ?? 0;
          if (!existing) {
            // The new stop goes last. Its planned arrival follows the booklet's
            // own arithmetic: the previous stop's arrival, plus handling every
            // order there, plus the inter-stop leg. An estimate, labelled as a
            // plan like every other planned time.
            const last = [...target.stops].sort((a, b) => b.seq - a.seq)[0];
            const district = await tx.district.findUnique({ where: { name: target.districtName }, select: { interStopFreeflowMin: true } });
            const lastOutlet = last ? await tx.outlet.findUnique({ where: { id: last.outletId }, select: { dockType: true } }) : null;
            const lastAllowance = lastOutlet
              ? await tx.serviceAllowance.findUnique({ where: { brand_dockType: { brand, dockType: lastOutlet.dockType } } })
              : null;
            const interStop = district?.interStopFreeflowMin ?? 0;
            const arrival = last
              ? clockOf(clockMinutes(last.plannedArrivalAt) + (lastAllowance?.minutes ?? 0) * last.orders.length + interStop)
              : target.plannedDepartAt;
            const created = await tx.tripStop.create({
              data: { tripId: target.id, seq: (last?.seq ?? 0) + 1, outletId: sf.outletId, plannedArrivalAt: arrival },
            });
            targetStopId = created.id;
            outcome.arrivalAt = arrival;
            addedMinutes += interStop;
          } else {
            outcome.arrivalAt = existing.plannedArrivalAt;
          }
          await tx.tripStopOrder.create({ data: { tripStopId: targetStopId!, orderId: sf.orderId } });
          await tx.assignment.updateMany({
            where: { planId: trip.planId, orderId: sf.orderId },
            data: { tripStopId: targetStopId! },
          });
          await tx.trip.update({
            where: { id: target.id },
            data: {
              sumWeightKg: { increment: sf.orderWeightKg },
              sumVolumeM3: { increment: sf.orderVolumeM3 },
              plannedMinutes: { increment: addedMinutes },
            },
          });
          await tx.stopReassignment.create({
            data: {
              tripStopId: targetStopId!,
              fromTripId: trip.id,
              toTripId: target.id,
              byUserId: user.id,
              reasonCode: "SHORTFALL",
              note: note ?? null,
            },
          });
          await tx.notification.create({
            data: {
              outletId: sf.outletId,
              kind: "shortfall.moved",
              title: `Order ${sf.orderRef} moves to the vehicle's second run`,
              body: `${sf.orderRef} was not fully loaded and will arrive on ${trip.vehicleId}'s second run, planned for around ${outcome.arrivalAt}.`,
              payload: { orderId: sf.orderId, shortfallId: sf.id, plannedArrivalAt: outcome.arrivalAt },
            },
          });
          return true;
        }

        // HOLD and CANCEL: the plan no longer serves the order.
        await tx.assignment.updateMany({
          where: { planId: trip.planId, orderId: sf.orderId },
          data: {
            decision: "DEFERRED",
            tripStopId: null,
            note: `${decision === "HOLD_ORDER" ? "Held" : "Cancelled"} after a loading shortfall${note ? `: ${note}` : ""}`,
          },
        });
        if (decision === "HOLD_ORDER") {
          await tx.order.update({ where: { id: sf.orderId }, data: { status: "DEFERRED" } });
          await tx.deferral.upsert({
            where: { planId_orderId: { planId: trip.planId, orderId: sf.orderId } },
            create: {
              planId: trip.planId,
              orderId: sf.orderId,
              reasonCode: sf.reasonCode ?? sf.kind,
              note: note ?? null,
              rolledToDate: asDate(inputs.followUpDate),
              decidedByUserId: user.id,
              storeNotifiedAt: now,
            },
            update: {
              reasonCode: sf.reasonCode ?? sf.kind,
              note: note ?? null,
              rolledToDate: asDate(inputs.followUpDate),
              decidedByUserId: user.id,
              decidedAt: now,
              storeNotifiedAt: now,
            },
          });
          await tx.notification.create({
            data: {
              outletId: sf.outletId,
              kind: "deferred",
              title: `Order ${sf.orderRef} moves to ${shortDay(inputs.followUpDate)}`,
              body: `Order ${sf.orderRef} could not be fully loaded and has been held. It moves to ${shortDay(inputs.followUpDate)}.`,
              payload: { orderId: sf.orderId, shortfallId: sf.id, rolledToDate: inputs.followUpDate },
            },
          });
        } else {
          await tx.order.update({ where: { id: sf.orderId }, data: { status: "CANCELLED" } });
          await tx.notification.create({
            data: {
              outletId: sf.outletId,
              kind: "cancelled",
              title: `Order ${sf.orderRef} is cancelled`,
              body: `Order ${sf.orderRef} could not be fully loaded and has been cancelled.${note ? ` ${note}` : ""}`,
              payload: { orderId: sf.orderId, shortfallId: sf.id },
            },
          });
        }
        return true;
      });

      if (!claimed) {
        if (retried) return fail(409, "RACE_LOST", "Another dispatcher decided this just now.");
        return decideException(user, `shortfall:${sf.id}`, body, now, true);
      }
      break;
    } catch (error) {
      // Two outlets can take the same ORD- number in the same instant (the
      // (ref, requestedDate) index); the transaction rolled back, so allocate
      // again from the new maximum. Anything else is a real failure.
      if (!isUniqueViolation(error) || attempt >= MAX_ATTEMPTS) throw error;
    }
  }

  const records: DecisionRecord[] = [
    {
      actor: user,
      action: "shortfall.resolve",
      entityType: "Shortfall",
      entityId: sf.id,
      reasonCode: sf.reasonCode ?? undefined,
      note,
      before: { status: "OPEN", blocksDeparture: sf.blocksDeparture },
      after: { decision, followUp: Boolean(outcome.followUpRef), followUpOrderId: outcome.followUpOrderId ?? null, tripId: trip.id, orderId: sf.orderId },
    },
  ];
  const orderAction: Record<string, string> = {
    SEND_SHORT: "order.ship_short",
    HOLD_ORDER: "order.defer",
    CANCEL_LINE: "order.cancel",
    MOVE_TO_TRIP_2: "order.reassign",
  };
  records.push({
    actor: user,
    action: orderAction[decision]!,
    entityType: "Order",
    entityId: sf.orderId,
    reasonCode: sf.reasonCode ?? undefined,
    note,
    after: { shortfallId: sf.id, tripId: trip.id, missingUnits: sf.missingUnits },
  });
  if (outcome.followUpOrderId) {
    records.push({
      actor: user,
      action: "order.place",
      entityType: "Order",
      entityId: outcome.followUpOrderId,
      after: { ref: outcome.followUpRef!, units: sf.missingUnits, forDate: inputs.followUpDate, rolledFromOrderId: sf.orderId, shortfallId: sf.id },
    });
  }
  await recordDecisions(records);

  const consequences = shortfallConsequences(ctx, decision, {
    followUp: Boolean(outcome.followUpRef),
    followUpRef: outcome.followUpRef,
    actorName: user.name,
  });
  const updated = await reload(user.depotCode!, inputs.date, { kind: "SHORTFALL", key: sf.id }, item.id, now, item);
  return { ok: true, replayed: false, exception: updated, consequences };
}
