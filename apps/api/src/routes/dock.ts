import type { FastifyInstance } from "fastify";
import { dockShift, saveHandover } from "../services/dock.js";

/**
 * Owner: BE3 (dock)
 *
 * The dock's shift view — bays, timeline, pace, the last seven nights — and
 * the handover note. Both are scoped to the signed-in user's depot.
 */

const DATE = { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" } as const;
const NULLABLE_STRING = { oneOf: [{ type: "string" }, { type: "null" }] } as const;
const NULLABLE_INT = { oneOf: [{ type: "integer" }, { type: "null" }] } as const;
const NULLABLE_BOOL = { oneOf: [{ type: "boolean" }, { type: "null" }] } as const;

const ERROR_RESPONSE = {
  type: "object",
  required: ["error"],
  properties: {
    error: { type: "object", required: ["code", "message"], properties: { code: { type: "string" }, message: { type: "string" } } },
  },
} as const;

const BAY_TRIP = {
  oneOf: [
    { type: "null" },
    {
      type: "object",
      additionalProperties: false,
      required: ["tripId", "vehicleId", "tripNo", "plannedDepartAt", "loadedUnits", "expectedUnits"],
      properties: {
        tripId: { type: "string" },
        vehicleId: { type: "string" },
        tripNo: { type: "integer" },
        plannedDepartAt: NULLABLE_STRING,
        loadedUnits: { type: "integer" },
        expectedUnits: { type: "integer" },
      },
    },
  ],
} as const;

const HANDOVER = {
  type: "object",
  additionalProperties: false,
  required: ["body", "authorName", "updatedAt"],
  properties: { body: { type: "string" }, authorName: { type: "string" }, updatedAt: { type: "string" } },
} as const;

const SHIFT = {
  type: "object",
  additionalProperties: false,
  required: [
    "date", "depotCode", "dockBays", "loadTargetMinutes", "nowClock", "dispatcherName", "bays", "trips",
    "averageLoadMinutes", "unitsPerQuarterHour", "history", "handover",
  ],
  properties: {
    date: DATE,
    depotCode: { type: "string" },
    dockBays: { type: "integer" },
    loadTargetMinutes: { type: "integer" },
    nowClock: NULLABLE_STRING,
    dispatcherName: NULLABLE_STRING,
    bays: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["bay", "current", "next"],
        properties: { bay: { type: "integer" }, current: BAY_TRIP, next: BAY_TRIP },
      },
    },
    trips: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "tripId", "vehicleId", "tripNo", "status", "plannedDepartAt", "dockBay", "loadStartedAt", "sealedAt",
          "loadMinutes", "sealedOnTime", "lateMinutes", "loadedUnits", "expectedUnits", "minutesBehind",
        ],
        properties: {
          tripId: { type: "string" },
          vehicleId: { type: "string" },
          tripNo: { type: "integer" },
          status: { type: "string", enum: ["PLANNED", "LOADING", "READY", "DEPARTED", "COMPLETED", "CANCELLED"] },
          plannedDepartAt: NULLABLE_STRING,
          dockBay: NULLABLE_INT,
          loadStartedAt: NULLABLE_STRING,
          sealedAt: NULLABLE_STRING,
          loadMinutes: NULLABLE_INT,
          sealedOnTime: NULLABLE_BOOL,
          lateMinutes: NULLABLE_INT,
          loadedUnits: { type: "integer" },
          expectedUnits: { type: "integer" },
          minutesBehind: NULLABLE_INT,
        },
      },
    },
    averageLoadMinutes: NULLABLE_INT,
    unitsPerQuarterHour: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["start", "units"],
        properties: { start: { type: "string" }, units: { type: "integer" } },
      },
    },
    history: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["date", "vehicles", "sealed", "sealedOnTime"],
        properties: {
          date: DATE,
          vehicles: { type: "integer" },
          sealed: { type: "integer" },
          sealedOnTime: { type: "integer" },
        },
      },
    },
    handover: { oneOf: [{ type: "null" }, HANDOVER] },
  },
} as const;

function todayInColombo(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Colombo" }).format(now);
}

export default async function (fastify: FastifyInstance) {
  fastify.get(
    "/dock/shift",
    {
      schema: {
        querystring: { type: "object", additionalProperties: false, properties: { date: DATE } },
        response: { 200: SHIFT, 403: ERROR_RESPONSE },
      },
    },
    async (request, reply) => {
      const user = request.requireRole("LOADER", "DISPATCHER");
      if (!user.depotCode) {
        return reply.status(403).send({ error: { code: "FORBIDDEN", message: "This account is not at a depot." } });
      }
      const { date } = request.query as { date?: string };
      return dockShift({ ...user, depotCode: user.depotCode }, date ?? todayInColombo());
    },
  );

  fastify.put(
    "/dock/handover",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["date", "body", "authorName"],
          properties: {
            date: DATE,
            body: { type: "string", minLength: 1, maxLength: 2000 },
            authorName: { type: "string", minLength: 2, maxLength: 80 },
          },
        },
        response: { 200: HANDOVER, 403: ERROR_RESPONSE },
      },
    },
    async (request, reply) => {
      const user = request.requireRole("LOADER", "DISPATCHER");
      if (!user.depotCode) {
        return reply.status(403).send({ error: { code: "FORBIDDEN", message: "This account is not at a depot." } });
      }
      return saveHandover({ ...user, depotCode: user.depotCode }, request.body as { date: string; body: string; authorName: string });
    },
  );
}
