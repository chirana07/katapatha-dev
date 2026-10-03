import type { FastifyInstance } from "fastify";
import { AuthError } from "../lib/auth.js";
import {
  exceptionsForDay,
  filterExceptions,
  summarise,
  type ExceptionCategory,
  type ExceptionSeverity,
} from "../services/exceptions.js";
import { decideException, getException, type DecisionBody } from "../services/exceptionDecisions.js";

/**
 * Owner: BE2 (Phase 1, slice X)
 *
 * The dispatcher's Exceptions console (Figma D-10, D-11): one list over
 * shortfalls, chiller readings, planning violations, late trips, Lamp Mode and
 * reported problems, plus the decision that clears the ones a person can clear.
 * The rules, the id scheme and the meaning of each decision live in
 * `services/exceptions.ts` and `services/exceptionDecisions.ts`; this file only
 * states the contract and passes through.
 */

const ERROR_RESPONSE = {
  type: "object",
  required: ["error"],
  properties: {
    error: {
      type: "object",
      required: ["code", "message"],
      properties: {
        code: { type: "string" },
        message: { type: "string" },
        details: { type: "object", additionalProperties: true },
      },
    },
  },
} as const;

const NULLABLE_STRING = { oneOf: [{ type: "string" }, { type: "null" }] } as const;
const NULLABLE_INT = { oneOf: [{ type: "integer" }, { type: "null" }] } as const;
const CLOCK = { type: "string", pattern: "^([01]\\d|2[0-3]):[0-5]\\d$" } as const;
const NULLABLE_CLOCK = { oneOf: [CLOCK, { type: "null" }] } as const;
const DATE = { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" } as const;
const NULLABLE_DATETIME = { oneOf: [{ type: "string", format: "date-time" }, { type: "null" }] } as const;
const ROLE = { type: "string", enum: ["DISPATCHER", "LOADER", "DRIVER", "STORE_MANAGER"] } as const;

const SEVERITY = { type: "string", enum: ["critical", "warning", "info"] } as const;
const CATEGORY = { type: "string", enum: ["planning", "loading", "on_the_road", "store"] } as const;
const DECISION = {
  type: "string",
  enum: ["SEND_SHORT", "HOLD_ORDER", "CANCEL_LINE", "MOVE_TO_TRIP_2", "ACKNOWLEDGE", "RESOLVE"],
} as const;

const CONSEQUENCE = {
  type: "object",
  additionalProperties: false,
  required: ["audience", "title", "detail"],
  properties: {
    audience: { type: "string", enum: ["loader", "driver", "store", "order", "trip", "record"] },
    title: { type: "string" },
    detail: { type: "string" },
  },
} as const;

const DECISION_OPTION = {
  type: "object",
  additionalProperties: false,
  required: ["decision", "label", "description", "recommended", "requiresNote", "followUp", "consequences"],
  properties: {
    decision: DECISION,
    label: { type: "string" },
    description: { type: "string" },
    recommended: { type: "boolean" },
    requiresNote: { type: "boolean" },
    followUp: {
      oneOf: [
        {
          type: "object",
          additionalProperties: false,
          required: ["forDate", "units", "label"],
          properties: { forDate: DATE, units: { type: "integer" }, label: { type: "string" } },
        },
        { type: "null" },
      ],
    },
    consequences: { type: "array", items: CONSEQUENCE },
  },
} as const;

const EXCEPTION = {
  type: "object",
  additionalProperties: false,
  required: [
    "id",
    "kind",
    "severity",
    "category",
    "status",
    "title",
    "subtitle",
    "detail",
    "reportedBy",
    "raisedAt",
    "ageMinutes",
    "resolvedAt",
    "vehicleId",
    "tripId",
    "planId",
    "departsAt",
    "orderRefs",
    "affectedOutlets",
    "quantities",
    "acknowledgement",
    "resolution",
    "decisionOptions",
  ],
  properties: {
    id: { type: "string" },
    kind: { type: "string", enum: ["SHORTFALL", "CHILLER", "PLANNING", "LATE", "LAMP", "PROBLEM"] },
    severity: SEVERITY,
    category: CATEGORY,
    status: { type: "string", enum: ["open", "resolved"] },
    title: { type: "string" },
    subtitle: { type: "string" },
    detail: NULLABLE_STRING,
    reportedBy: {
      type: "object",
      additionalProperties: false,
      required: ["name", "role"],
      properties: { name: { type: "string" }, role: { oneOf: [ROLE, { type: "null" }] } },
    },
    raisedAt: { type: "string", format: "date-time" },
    ageMinutes: { type: "integer" },
    resolvedAt: NULLABLE_DATETIME,
    vehicleId: NULLABLE_STRING,
    tripId: NULLABLE_STRING,
    planId: NULLABLE_STRING,
    departsAt: NULLABLE_CLOCK,
    orderRefs: { type: "array", items: { type: "string" } },
    affectedOutlets: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["outletId", "outletName", "stopSeq", "ordered", "delta"],
        properties: {
          outletId: { type: "string" },
          outletName: NULLABLE_STRING,
          stopSeq: NULLABLE_INT,
          ordered: NULLABLE_INT,
          delta: NULLABLE_INT,
        },
      },
    },
    quantities: {
      oneOf: [
        {
          type: "object",
          additionalProperties: false,
          required: ["loaded", "expected", "short"],
          properties: { loaded: { type: "integer" }, expected: { type: "integer" }, short: { type: "integer" } },
        },
        { type: "null" },
      ],
    },
    acknowledgement: {
      oneOf: [
        {
          type: "object",
          additionalProperties: false,
          required: ["at", "byName"],
          properties: { at: { type: "string", format: "date-time" }, byName: { type: "string" } },
        },
        { type: "null" },
      ],
    },
    resolution: {
      oneOf: [
        {
          type: "object",
          additionalProperties: false,
          required: ["decision", "note", "at", "byName"],
          properties: {
            decision: NULLABLE_STRING,
            note: NULLABLE_STRING,
            at: NULLABLE_DATETIME,
            byName: NULLABLE_STRING,
          },
        },
        { type: "null" },
      ],
    },
    decisionOptions: { type: "array", items: DECISION_OPTION },
  },
} as const;

const SUMMARY = {
  type: "object",
  additionalProperties: false,
  required: [
    "open",
    "critical",
    "ordersAffected",
    "outletsAffected",
    "vehiclesAffected",
    "resolvedToday",
    "avgResolveMinutes",
    "countsByCategory",
    "countsBySeverity",
  ],
  properties: {
    open: { type: "integer" },
    critical: { type: "integer" },
    ordersAffected: { type: "integer" },
    outletsAffected: { type: "integer" },
    vehiclesAffected: { type: "integer" },
    resolvedToday: { type: "integer" },
    avgResolveMinutes: NULLABLE_INT,
    countsByCategory: {
      type: "object",
      additionalProperties: false,
      required: ["planning", "loading", "on_the_road", "store"],
      properties: {
        planning: { type: "integer" },
        loading: { type: "integer" },
        on_the_road: { type: "integer" },
        store: { type: "integer" },
      },
    },
    countsBySeverity: {
      type: "object",
      additionalProperties: false,
      required: ["critical", "warning", "info"],
      properties: { critical: { type: "integer" }, warning: { type: "integer" }, info: { type: "integer" } },
    },
  },
} as const;

const LIST = {
  type: "object",
  additionalProperties: false,
  required: ["date", "summary", "exceptions"],
  properties: {
    date: DATE,
    summary: SUMMARY,
    exceptions: { type: "array", items: EXCEPTION },
  },
} as const;

const DETAIL = {
  ...EXCEPTION,
  required: [...EXCEPTION.required, "activity"],
  properties: {
    ...EXCEPTION.properties,
    activity: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["at", "actorName", "actorRole", "action", "summary", "note"],
        properties: {
          at: { type: "string", format: "date-time" },
          actorName: NULLABLE_STRING,
          actorRole: { oneOf: [ROLE, { type: "null" }] },
          action: { type: "string" },
          summary: { type: "string" },
          note: NULLABLE_STRING,
        },
      },
    },
  },
} as const;

const DECISION_RESPONSE = {
  type: "object",
  additionalProperties: false,
  required: ["exception", "consequences", "replayed"],
  properties: {
    exception: EXCEPTION,
    consequences: { type: "array", items: CONSEQUENCE },
    replayed: { type: "boolean" },
  },
} as const;

const ID_PARAMS = {
  type: "object",
  required: ["exceptionId"],
  properties: { exceptionId: { type: "string", minLength: 1, maxLength: 200 } },
} as const;

function todayInColombo(): string {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: "Asia/Colombo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const value = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${value.year}-${value.month}-${value.day}`;
}

export default async function (fastify: FastifyInstance) {
  fastify.get(
    "/exceptions",
    {
      schema: {
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: {
            date: DATE,
            status: { type: "string", enum: ["open", "resolved", "all"] },
            category: CATEGORY,
            severity: SEVERITY,
            q: { type: "string", maxLength: 100 },
          },
        },
        response: { 200: LIST, 403: ERROR_RESPONSE },
      },
    },
    async (request) => {
      const user = request.requireRole("DISPATCHER");
      if (!user.depotCode) throw new AuthError("You do not have access to this record", 403);
      const query = request.query as {
        date?: string;
        status?: "open" | "resolved" | "all";
        category?: ExceptionCategory;
        severity?: ExceptionSeverity;
        q?: string;
      };
      const date = query.date ?? todayInColombo();
      const all = await exceptionsForDay(user.depotCode, date, new Date());
      return {
        date,
        // The tiles and tab counts describe the whole day, whatever is filtered.
        summary: summarise(all),
        exceptions: filterExceptions(all, query),
      };
    },
  );

  fastify.get(
    "/exceptions/:exceptionId",
    {
      schema: {
        params: ID_PARAMS,
        response: { 200: DETAIL, 403: ERROR_RESPONSE, 404: ERROR_RESPONSE },
      },
    },
    async (request, reply) => {
      const user = request.requireRole("DISPATCHER");
      const { exceptionId } = request.params as { exceptionId: string };
      const found = await getException(user, exceptionId, new Date());
      if ("notFound" in found) {
        return reply.status(404).send({ error: { code: found.code, message: found.message } });
      }
      return { ...found.exception, activity: found.activity };
    },
  );

  fastify.post(
    "/exceptions/:exceptionId/decision",
    {
      schema: {
        params: ID_PARAMS,
        body: {
          type: "object",
          additionalProperties: false,
          required: ["decision"],
          properties: {
            decision: DECISION,
            note: { type: "string", maxLength: 500 },
            followUp: { type: "boolean" },
          },
        },
        response: {
          200: DECISION_RESPONSE,
          403: ERROR_RESPONSE,
          404: ERROR_RESPONSE,
          409: ERROR_RESPONSE,
          422: ERROR_RESPONSE,
        },
      },
    },
    async (request, reply) => {
      const user = request.requireRole("DISPATCHER");
      const { exceptionId } = request.params as { exceptionId: string };
      const body = request.body as DecisionBody;
      const result = await decideException(user, exceptionId, body, new Date());
      if (!result.ok) {
        return reply
          .status(result.status)
          .send({ error: { code: result.code, message: result.message, ...(result.details ? { details: result.details } : {}) } });
      }
      return { exception: result.exception, consequences: result.consequences, replayed: result.replayed };
    },
  );
}
