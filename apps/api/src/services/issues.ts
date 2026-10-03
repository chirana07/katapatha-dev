import type { ProblemKind } from "@prisma/client";
import { STORE_ISSUE_REASONS, STORE_PROBLEM_KINDS } from "@katapatha/core/domain/reasons";
import { ulid } from "@katapatha/core/offline/ulid";
import { prisma } from "../lib/db";
import { recordDecisions } from "../lib/audit";
import { AuthError, type SessionUser } from "../lib/auth";

/**
 * What a store manager raises when a delivery went wrong, and what they can
 * read back about it.
 *
 * An issue IS a `Problem` row — the dispatcher's Exceptions console already
 * reads those — distinguished from a driver's problem only by who raised it.
 * Two things the table has no column for, and how each is handled:
 *
 * - `units` (how many were affected) is kept in the decision log, on the
 *   `problem.raise` row, and read back from there. It is also what the console
 *   shows beside the issue.
 * - `clientRequestId` (so a retried submit from a flaky phone cannot raise two
 *   issues) is turned into the Problem's own primary key. A UUID is 128 bits
 *   and a ULID is 26 Crockford characters carrying 130, so the UUID maps onto a
 *   valid ULID with nothing lost, and the same request id always produces the
 *   same row id. The primary key is then the idempotency key, and a duplicate
 *   insert is the replay.
 */

const ENCODING = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** The 128 bits of a UUID, written as a 26-character ULID. Stable: same UUID, same id. */
export function uuidToUlid(uuid: string): string {
  let n = BigInt(`0x${uuid.replace(/-/g, "")}`);
  let out = "";
  for (let i = 0; i < 26; i++) {
    out = ENCODING[Number(n & 31n)] + out;
    n >>= 5n;
  }
  return out;
}

export interface IssueInput {
  orderId: string;
  kind: (typeof STORE_PROBLEM_KINDS)[number]["code"];
  reasonCode?: (typeof STORE_ISSUE_REASONS)[number]["code"];
  units?: number;
  note?: string;
  clientRequestId?: string;
}

export interface IssueView {
  id: string;
  orderId: string;
  orderRef: string;
  kind: string;
  reasonCode: string | null;
  units: number | null;
  note: string | null;
  status: "NEW" | "ACKNOWLEDGED" | "RESOLVED";
  resolution: string | null;
  createdAt: string;
  resolvedAt: string | null;
}

type IssueRow = {
  id: string;
  kind: string;
  note: string | null;
  reasonCode: string | null;
  status: "NEW" | "ACKNOWLEDGED" | "RESOLVED";
  resolution: string | null;
  occurredAt: Date;
  orderId: string | null;
  raisedByUserId?: string | null;
  tripId?: string | null;
};

/** Units and resolution time, from the decision log (the table has neither column). */
async function loadFacts(ids: string[]) {
  const facts = new Map<string, { units: number | null; resolvedAt: Date | null }>();
  if (ids.length === 0) return facts;
  const rows = await prisma.auditEvent.findMany({
    where: { entityType: "Problem", entityId: { in: ids }, action: { in: ["problem.raise", "problem.resolve"] } },
    orderBy: { at: "asc" },
  });
  for (const row of rows) {
    const fact = facts.get(row.entityId) ?? { units: null, resolvedAt: null };
    const after = (row.after && typeof row.after === "object" ? row.after : {}) as Record<string, unknown>;
    if (row.action === "problem.raise" && typeof after.units === "number") fact.units = after.units;
    if (row.action === "problem.resolve") fact.resolvedAt = row.at;
    facts.set(row.entityId, fact);
  }
  return facts;
}

function toView(row: IssueRow, orderRef: string, fact?: { units: number | null; resolvedAt: Date | null }): IssueView {
  return {
    id: row.id,
    orderId: row.orderId ?? "",
    orderRef,
    kind: row.kind,
    reasonCode: row.reasonCode,
    units: fact?.units ?? null,
    note: row.note,
    status: row.status,
    resolution: row.resolution,
    createdAt: row.occurredAt.toISOString(),
    resolvedAt: row.status === "RESOLVED" ? (fact?.resolvedAt?.toISOString() ?? null) : null,
  };
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === "P2002";
}

export type CreateIssueResult =
  | { ok: true; replayed: boolean; issue: IssueView }
  | { ok: false; status: 409 | 422; code: string; message: string };

export async function createIssue(user: SessionUser, input: IssueInput, now: Date = new Date()): Promise<CreateIssueResult> {
  // Only the manager's own outlet's orders. A record the caller cannot see
  // answers 403, the same as one that does not exist.
  if (user.role !== "STORE_MANAGER" || !user.outletId) throw new AuthError("You do not have access to this record", 403);
  const order = await prisma.order.findFirst({
    where: { id: input.orderId, outletId: user.outletId },
    select: { id: true, ref: true, units: true, depotCode: true, outlet: { select: { displayName: true } } },
  });
  if (!order) throw new AuthError("You do not have access to this record", 403);

  const id = input.clientRequestId ? uuidToUlid(input.clientRequestId) : ulid();

  const replay = async (): Promise<CreateIssueResult | null> => {
    const existing = await prisma.problem.findUnique({ where: { id } });
    if (!existing) return null;
    // The id is derived from the request id alone, so it is the *same request*
    // only if it also came from this user about this order and kind. Anything
    // else is a reused key, and answering with the other row would hand one
    // manager another's report.
    if (existing.raisedByUserId !== user.id || existing.orderId !== input.orderId || existing.kind !== input.kind) {
      return { ok: false, status: 409, code: "IDEMPOTENCY_KEY_REUSED", message: "That request id was already used for a different issue." };
    }
    const facts = await loadFacts([id]);
    return { ok: true, replayed: true, issue: toView(existing, order.ref, facts.get(id)) };
  };

  if (input.clientRequestId) {
    const prior = await replay();
    if (prior) return prior;
  }

  if (input.units !== undefined && input.units > order.units) {
    return {
      ok: false,
      status: 422,
      code: "UNITS_EXCEED_ORDER",
      message: `The order was for ${order.units} units, so ${input.units} cannot be affected.`,
    };
  }

  // The stop the order was on, if any, so the dispatcher lands on the right
  // trip. Orders that were never planned have none.
  const link = await prisma.tripStopOrder.findFirst({
    where: { orderId: order.id, tripStop: { trip: { plan: { status: "PUBLISHED" } } } },
    select: { tripStopId: true, tripStop: { select: { tripId: true } } },
  });
  const dispatchers = await prisma.user.findMany({
    where: { role: "DISPATCHER", depotCode: order.depotCode },
    select: { id: true },
  });

  const outletName = order.outlet.displayName ?? user.outletId;
  const label = [...STORE_PROBLEM_KINDS, ...STORE_ISSUE_REASONS].find((k) => k.code === (input.reasonCode ?? input.kind))?.label ?? input.kind;

  try {
    await prisma.$transaction(async (tx) => {
      await tx.problem.create({
        data: {
          id,
          kind: input.kind as ProblemKind,
          tripId: link?.tripStop.tripId ?? null,
          tripStopId: link?.tripStopId ?? null,
          orderId: order.id,
          note: input.note ?? null,
          raisedByUserId: user.id,
          occurredAt: now,
          reasonCode: input.reasonCode ?? null,
        },
      });
      if (dispatchers.length > 0) {
        await tx.notification.createMany({
          data: dispatchers.map((d) => ({
            userId: d.id,
            kind: "issue.raised",
            title: `${label} reported at ${outletName}`,
            body: `${user.name} reported an issue on ${order.ref}${input.units ? ` (${input.units} units)` : ""}.${input.note ? ` ${input.note}` : ""}`,
            payload: { problemId: id, exceptionId: `problem:${id}`, orderId: order.id, outletId: user.outletId },
          })),
        });
      }
    });
  } catch (error) {
    // Two identical submits racing: the primary key did its job, and the loser
    // gets the winner's row, as a sequential retry would have.
    if (isUniqueViolation(error)) {
      const raced = await replay();
      if (raced) return raced;
    }
    throw error;
  }

  // After the commit, as everywhere: a log row for a write that rolled back
  // would record something that did not happen.
  await recordDecisions([
    {
      actor: user,
      action: "problem.raise",
      entityType: "Problem",
      entityId: id,
      reasonCode: input.reasonCode ?? input.kind,
      note: input.note,
      after: { orderId: order.id, kind: input.kind, reasonCode: input.reasonCode ?? null, units: input.units ?? null, outletId: user.outletId },
    },
    { actor: user, action: "issue.raise", entityType: "Order", entityId: order.id, reasonCode: input.reasonCode ?? input.kind, note: input.note, after: { problemId: id } },
  ]);

  return {
    ok: true,
    replayed: false,
    issue: toView(
      { id, kind: input.kind, note: input.note ?? null, reasonCode: input.reasonCode ?? null, status: "NEW", resolution: null, occurredAt: now, orderId: order.id },
      order.ref,
      { units: input.units ?? null, resolvedAt: null },
    ),
  };
}

/** The outlet's own issues, newest first. */
export async function listIssues(user: SessionUser): Promise<IssueView[]> {
  if (user.role !== "STORE_MANAGER" || !user.outletId) throw new AuthError("You do not have access to this record", 403);
  // Issues raised by *this outlet's managers*. An order at this outlet that a
  // driver reported a problem on is not the store's issue, and is not listed.
  const managers = await prisma.user.findMany({
    where: { role: "STORE_MANAGER", outletId: user.outletId },
    select: { id: true },
  });
  const rows = await prisma.problem.findMany({
    where: { raisedByUserId: { in: managers.map((m) => m.id) }, orderId: { not: null } },
    include: { order: { select: { ref: true } } },
    orderBy: { occurredAt: "desc" },
    take: 100,
  });
  const facts = await loadFacts(rows.map((r) => r.id));
  return rows.map((r) => toView(r, r.order?.ref ?? "", facts.get(r.id)));
}
