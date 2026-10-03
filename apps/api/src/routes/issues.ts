import type { FastifyInstance } from "fastify";
import { STORE_ISSUE_REASONS, STORE_PROBLEM_KINDS } from "@katapatha/core/domain/reasons";
import { createIssue, listIssues, type IssueInput } from "../services/issues.js";

/**
 * Owner: BE2 (Phase 1, slice X)
 *
 * What a store manager reports about a delivery (Figma S-10). An issue is a
 * Problem row raised by the manager; the dispatcher meets it in the Exceptions
 * console under "Store". See `services/issues.ts` for how `units` and the
 * idempotency key are stored without a schema change.
 */

const ERROR_RESPONSE = {
  type: "object",
  required: ["error"],
  properties: {
    error: {
      type: "object",
      required: ["code", "message"],
      properties: { code: { type: "string" }, message: { type: "string" }, details: { type: "object", additionalProperties: true } },
    },
  },
} as const;

const NULLABLE_STRING = { oneOf: [{ type: "string" }, { type: "null" }] } as const;

const ISSUE = {
  type: "object",
  additionalProperties: false,
  required: ["id", "orderId", "orderRef", "kind", "reasonCode", "units", "note", "status", "resolution", "createdAt", "resolvedAt"],
  properties: {
    id: { type: "string" },
    orderId: { type: "string" },
    orderRef: { type: "string" },
    kind: { type: "string", enum: STORE_PROBLEM_KINDS.map((k) => k.code) },
    reasonCode: { oneOf: [{ type: "string", enum: STORE_ISSUE_REASONS.map((r) => r.code) }, { type: "null" }] },
    units: { oneOf: [{ type: "integer" }, { type: "null" }] },
    note: NULLABLE_STRING,
    status: { type: "string", enum: ["NEW", "ACKNOWLEDGED", "RESOLVED"] },
    resolution: NULLABLE_STRING,
    createdAt: { type: "string", format: "date-time" },
    resolvedAt: { oneOf: [{ type: "string", format: "date-time" }, { type: "null" }] },
  },
} as const;

export default async function (fastify: FastifyInstance) {
  fastify.post(
    "/issues",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["orderId", "kind"],
          properties: {
            orderId: { type: "string", minLength: 1 },
            kind: { type: "string", enum: STORE_PROBLEM_KINDS.map((k) => k.code) },
            reasonCode: { type: "string", enum: STORE_ISSUE_REASONS.map((r) => r.code) },
            units: { type: "integer", minimum: 1 },
            note: { type: "string", maxLength: 500 },
            clientRequestId: { type: "string", format: "uuid" },
          },
        },
        response: { 200: ISSUE, 201: ISSUE, 403: ERROR_RESPONSE, 409: ERROR_RESPONSE, 422: ERROR_RESPONSE },
      },
    },
    async (request, reply) => {
      const user = request.requireRole("STORE_MANAGER");
      const result = await createIssue(user, request.body as IssueInput);
      if (!result.ok) {
        return reply.status(result.status).send({ error: { code: result.code, message: result.message } });
      }
      return reply.status(result.replayed ? 200 : 201).send(result.issue);
    },
  );

  fastify.get(
    "/issues",
    {
      schema: { response: { 200: { type: "array", items: ISSUE }, 403: ERROR_RESPONSE } },
    },
    async (request) => {
      const user = request.requireRole("STORE_MANAGER");
      return listIssues(user);
    },
  );
}
