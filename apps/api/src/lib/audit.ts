

import type { Prisma } from "@prisma/client";
import { prisma } from "./db";
import type { SessionUser } from "./auth";

/**
 * The decision log.
 *
 * The brief's complaint is specific: "Deferrals lack a clear record. Decisions
 * made under pressure can leave the same outlet unserved on consecutive runs."
 * Every decision in this system therefore writes a row here with who, when,
 * what, and why — and an outlet's whole history is one indexed query.
 *
 * This is deliberately fire-and-forget at the call site but awaited, so a
 * failure to record is visible rather than swallowed: a decision we cannot
 * account for is worse than an error.
 */
export interface DecisionRecord {
  actor: SessionUser | null;
  action: string;
  entityType: string;
  entityId: string;
  reasonCode?: string;
  note?: string;
  before?: Prisma.InputJsonValue;
  after?: Prisma.InputJsonValue;
}

export async function recordDecision(record: DecisionRecord): Promise<void> {
  await prisma.auditEvent.create({
    data: {
      actorUserId: record.actor?.id ?? null,
      actorRole: record.actor?.role ?? null,
      action: record.action,
      entityType: record.entityType,
      entityId: record.entityId,
      reasonCode: record.reasonCode,
      note: record.note,
      before: record.before,
      after: record.after,
    },
  });
}

/** Everything ever decided about one entity, newest first. */
export async function historyFor(entityType: string, entityId: string) {
  return prisma.auditEvent.findMany({
    where: { entityType, entityId },
    orderBy: { at: "desc" },
    include: { actor: { select: { name: true, role: true } } },
  });
}
