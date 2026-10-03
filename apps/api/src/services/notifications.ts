import type { Prisma } from "@prisma/client";
import { prisma } from "../lib/db";
import { AuthError, type SessionUser } from "../lib/auth";

/**
 * Notifications, read and acknowledged by the people they were written for.
 *
 * A store manager's notifications belong to the outlet (the whole counter
 * team sees them — a delivery warning is not one person's business) and a
 * dispatcher's to the user. Loaders and drivers have none here: no endpoint
 * would show them, so nothing is written for them.
 */

export const NOTIFICATION_LIMIT = 50;

export interface NotificationView {
  id: string;
  kind: string;
  title: string;
  body: string;
  payload: Record<string, unknown> | null;
  createdAt: string;
  readAt: string | null;
}

function scopeOf(user: SessionUser): Prisma.NotificationWhereInput {
  if (user.role === "STORE_MANAGER" && user.outletId) return { outletId: user.outletId };
  if (user.role === "DISPATCHER") return { userId: user.id };
  throw new AuthError("You do not have access to this record", 403);
}

function view(row: {
  id: string;
  kind: string;
  title: string;
  body: string;
  payload: Prisma.JsonValue | null;
  createdAt: Date;
  readAt: Date | null;
}): NotificationView {
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    body: row.body,
    payload: row.payload && typeof row.payload === "object" && !Array.isArray(row.payload) ? (row.payload as Record<string, unknown>) : null,
    createdAt: row.createdAt.toISOString(),
    readAt: row.readAt?.toISOString() ?? null,
  };
}

/**
 * Newest first, at most 50. `unreadCount` counts every unread notification,
 * not just those returned: a badge that stops at 50 would be wrong exactly
 * when it matters.
 */
export async function listNotifications(user: SessionUser, unreadOnly: boolean) {
  const scope = scopeOf(user);
  const [rows, unreadCount] = await Promise.all([
    prisma.notification.findMany({
      where: { ...scope, ...(unreadOnly ? { readAt: null } : {}) },
      orderBy: { createdAt: "desc" },
      take: NOTIFICATION_LIMIT,
    }),
    prisma.notification.count({ where: { ...scope, readAt: null } }),
  ]);
  return { unreadCount, items: rows.map(view) };
}

/**
 * Mark one read. A notification the caller does not own answers 403, the same
 * as one that does not exist. Idempotent: the update only touches an unread
 * row, so reading twice keeps the first time.
 */
export async function markNotificationRead(user: SessionUser, id: string, now: Date = new Date()) {
  const scope = scopeOf(user);
  const owned = await prisma.notification.findFirst({ where: { id, ...scope } });
  if (!owned) throw new AuthError("You do not have access to this record", 403);
  if (!owned.readAt) {
    await prisma.notification.updateMany({ where: { id, readAt: null }, data: { readAt: now } });
  }
  const fresh = (await prisma.notification.findUnique({ where: { id } })) ?? owned;
  const unreadCount = await prisma.notification.count({ where: { ...scope, readAt: null } });
  return { notification: view(fresh), unreadCount };
}
