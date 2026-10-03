import type { FastifyInstance } from "fastify";
import { listNotifications, markNotificationRead } from "../services/notifications.js";

/**
 * Owner: BE2 (Phase 1, slice X)
 *
 * The bell. A store manager reads their outlet's notifications, a dispatcher
 * their own; every other role is refused, because nothing is written for them.
 */

const ERROR_RESPONSE = {
  type: "object",
  required: ["error"],
  properties: {
    error: {
      type: "object",
      required: ["code", "message"],
      properties: { code: { type: "string" }, message: { type: "string" } },
    },
  },
} as const;

const NOTIFICATION = {
  type: "object",
  additionalProperties: false,
  required: ["id", "kind", "title", "body", "payload", "createdAt", "readAt"],
  properties: {
    id: { type: "string" },
    kind: { type: "string" },
    title: { type: "string" },
    body: { type: "string" },
    payload: { oneOf: [{ type: "object", additionalProperties: true }, { type: "null" }] },
    createdAt: { type: "string", format: "date-time" },
    readAt: { oneOf: [{ type: "string", format: "date-time" }, { type: "null" }] },
  },
} as const;

export default async function (fastify: FastifyInstance) {
  fastify.get(
    "/notifications",
    {
      schema: {
        querystring: {
          type: "object",
          additionalProperties: false,
          // A string enum, not a boolean: query values arrive as text and the
          // contract AJV does not coerce.
          properties: { unread: { type: "string", enum: ["true", "false"] } },
        },
        response: {
          200: {
            type: "object",
            additionalProperties: false,
            required: ["unreadCount", "items"],
            properties: { unreadCount: { type: "integer" }, items: { type: "array", items: NOTIFICATION } },
          },
          403: ERROR_RESPONSE,
        },
      },
    },
    async (request) => {
      const user = request.requireRole("STORE_MANAGER", "DISPATCHER");
      const { unread } = request.query as { unread?: "true" | "false" };
      return listNotifications(user, unread === "true");
    },
  );

  fastify.post(
    "/notifications/:notificationId/read",
    {
      schema: {
        params: {
          type: "object",
          required: ["notificationId"],
          properties: { notificationId: { type: "string", minLength: 1 } },
        },
        response: {
          200: {
            type: "object",
            additionalProperties: false,
            required: ["notification", "unreadCount"],
            properties: { notification: NOTIFICATION, unreadCount: { type: "integer" } },
          },
          403: ERROR_RESPONSE,
        },
      },
    },
    async (request) => {
      const user = request.requireRole("STORE_MANAGER", "DISPATCHER");
      const { notificationId } = request.params as { notificationId: string };
      return markNotificationRead(user, notificationId);
    },
  );
}
