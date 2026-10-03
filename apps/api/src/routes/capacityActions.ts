import type { FastifyInstance } from "fastify";
import { AuthError } from "../lib/auth.js";
import {
  CapacityActionConflict,
  decideAction,
  forecastWeeksOf,
  loadCapacityData,
  proposalsFor,
  toActionItems,
  type Decision,
} from "../services/capacity.js";

/**
 * Owner: BE3
 *
 * Capacity actions: what the forecast says to do about a reefer shortfall, and
 * the dispatcher's decision on each.
 *
 * Proposals are derived from the forecast and written the first time a week is
 * read, so every proposal has an id a decision can name. Reading again returns
 * the same rows; it never creates a second (see `ensureProposals`).
 *
 * A decision follows PROPOSED -> APPROVED -> APPLIED, or REJECTED from either
 * of the first two. APPLY does only what the system can truly do: clear a
 * reefer's workshop days, or raise a week's fuel quota. Hiring a vehicle,
 * moving a delivery day and asking stores to order early are recorded, and the
 * response says in plain words that nothing else changed.
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

const NULLABLE_STRING = { oneOf: [{ type: "string" }, { type: "null" }] } as const;
const DATE_ONLY = "^\\d{4}-\\d{2}-\\d{2}$";

const obj = (required: string[], properties: Record<string, unknown>) =>
  ({ type: "object", additionalProperties: false, required, properties }) as const;

const ACTION_ITEM = obj(
  [
    "id", "isoYear", "isoWeek", "depotCode", "brand", "kind", "title", "detail", "params", "expectedRelief",
    "status", "stale", "availableDecisions", "decidedBy", "decidedAt", "reasonCode", "note", "appliesFromDate", "createdAt",
  ],
  {
    id: { type: "string" },
    isoYear: { type: "integer" },
    isoWeek: { type: "integer" },
    depotCode: { type: "string" },
    brand: { oneOf: [{ type: "string", enum: ["Fresh", "Style", "Tech"] }, { type: "null" }] },
    kind: {
      type: "string",
      enum: ["RECALL_FROM_WORKSHOP", "HIRE_RELIEF_VEHICLE", "SHIFT_BRAND_DAY", "RAISE_FUEL_QUOTA", "PRE_BUILD_ORDERS", "SPLIT_LARGE_ORDER"],
    },
    title: { type: "string" },
    detail: { type: "string" },
    params: { type: "object", additionalProperties: true },
    expectedRelief: { type: "object", additionalProperties: true },
    status: { type: "string", enum: ["PROPOSED", "APPROVED", "APPLIED", "REJECTED"] },
    stale: { type: "boolean" },
    availableDecisions: { type: "array", items: { type: "string", enum: ["APPROVE", "REJECT", "APPLY"] } },
    decidedBy: NULLABLE_STRING,
    decidedAt: NULLABLE_STRING,
    reasonCode: NULLABLE_STRING,
    note: NULLABLE_STRING,
    appliesFromDate: { oneOf: [{ type: "string", pattern: DATE_ONLY }, { type: "null" }] },
    createdAt: { type: "string" },
  },
);

const LIST = obj(["depotCode", "isoYear", "isoWeek", "items"], {
  depotCode: { type: "string" },
  isoYear: { oneOf: [{ type: "integer" }, { type: "null" }] },
  isoWeek: { oneOf: [{ type: "integer" }, { type: "null" }] },
  items: { type: "array", items: ACTION_ITEM },
});

const DECISION_RESULT = obj(["action", "consequences"], {
  action: ACTION_ITEM,
  consequences: { type: "array", items: { type: "string" } },
});

export default async function (fastify: FastifyInstance) {
  fastify.get(
    "/capacity-actions",
    {
      schema: {
        querystring: obj([], {
          // Strings, not integers: the contract's AJV does not coerce query values.
          isoYear: { type: "string", pattern: "^20\\d{2}$" },
          isoWeek: { type: "string", pattern: "^([1-9]|[1-4]\\d|5[0-3])$" },
        }),
        response: { 200: LIST, 403: ERROR_RESPONSE, 422: ERROR_RESPONSE },
      },
    },
    async (request, reply) => {
      const user = request.requireRole("DISPATCHER");
      if (!user.depotCode) throw new AuthError("You do not have access to this record", 403);
      const q = request.query as { isoYear?: string; isoWeek?: string };
      const isoYear = q.isoYear === undefined ? undefined : Number(q.isoYear);
      const isoWeek = q.isoWeek === undefined ? undefined : Number(q.isoWeek);
      if ((isoYear === undefined) !== (isoWeek === undefined)) {
        return reply.status(422).send({
          error: { code: "VALIDATION_FAILED", message: "Give both isoYear and isoWeek, or neither." },
        });
      }

      const depotCode = user.depotCode;
      const { data, weeks } = await loadCapacityData(depotCode, (d) =>
        isoYear !== undefined && isoWeek !== undefined ? [{ isoYear, isoWeek }] : forecastWeeksOf(d),
      );
      const { rows, currentKeys } = await proposalsFor(depotCode, data, weeks);
      return { depotCode, isoYear: isoYear ?? null, isoWeek: isoWeek ?? null, items: await toActionItems(rows, currentKeys) };
    },
  );

  fastify.post(
    "/capacity-actions/:id/decision",
    {
      schema: {
        params: obj(["id"], { id: { type: "string", minLength: 1 } }),
        body: obj(["decision"], {
          decision: { type: "string", enum: ["APPROVE", "REJECT", "APPLY"] },
          reasonCode: { type: "string", minLength: 1, maxLength: 40, pattern: "^[A-Z][A-Z0-9_]*$" },
          note: { type: "string", maxLength: 500 },
        }),
        response: { 200: DECISION_RESULT, 403: ERROR_RESPONSE, 409: ERROR_RESPONSE, 422: ERROR_RESPONSE },
      },
    },
    async (request, reply) => {
      const user = request.requireRole("DISPATCHER");
      const { id } = request.params as { id: string };
      const body = request.body as { decision: Decision; reasonCode?: string; note?: string };

      try {
        const { row, consequences } = await decideAction(user, id, body.decision, {
          reasonCode: body.reasonCode,
          note: body.note,
        });
        const [action] = await toActionItems([row]);
        return { action, consequences };
      } catch (err) {
        if (err instanceof CapacityActionConflict) {
          return reply.status(409).send({ error: { code: err.code, message: err.message } });
        }
        throw err;
      }
    },
  );
}
