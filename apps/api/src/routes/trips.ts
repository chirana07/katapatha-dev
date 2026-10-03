import type { FastifyInstance } from "fastify";
import type { LoadCondition, TripStatus } from "@prisma/client";
import { prisma } from "../lib/db.js";
import { requireLoaderTrip, requireOrderOnTrip } from "../lib/authorization.js";
import { recordDecisions } from "../lib/audit.js";

/**
 * Owner: BE3
 *
 * The loader's dock surface. Trips are published PLANNED, each line is
 * recorded with a LoadCheck (and a Shortfall when non-OK), and marking
 * ready is gated: every line must be checked AND no shortfall may still
 * block departure. DOMAIN.md calls the gate out explicitly, so the 409
 * on the readiness endpoint carries the exact blocking reason.
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

const TRIP = {
  type: "object",
  additionalProperties: false,
  required: ["id", "vehicleId", "tripNo", "brand", "districtName", "wave", "status"],
  properties: {
    id: { type: "string" },
    vehicleId: { type: "string" },
    tripNo: { type: "integer", enum: [1, 2] },
    brand: { type: "string", enum: ["Fresh", "Style", "Tech"] },
    districtName: { type: "string" },
    wave: { type: "string", enum: ["PREDAWN", "DAYTIME"] },
    status: {
      type: "string",
      enum: ["PLANNED", "LOADING", "READY", "DEPARTED", "COMPLETED", "CANCELLED"],
    },
    plannedDepartAt: { type: "string", pattern: "^([01]\\d|2[0-3]):[0-5]\\d$" },
    plannedMinutes: { type: "integer" },
    sumWeightKg: { type: "number" },
    sumVolumeM3: { type: "number" },
  },
} as const;

const LOAD_LIST = {
  type: "object",
  additionalProperties: false,
  required: ["tripId", "status", "lines"],
  properties: {
    tripId: { type: "string" },
    status: {
      type: "string",
      enum: ["PLANNED", "LOADING", "READY", "DEPARTED", "COMPLETED", "CANCELLED"],
    },
    lines: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["orderId", "orderRef", "outletId", "seq", "expectedUnits"],
        properties: {
          orderId: { type: "string" },
          orderRef: { type: "string" },
          outletId: { type: "string" },
          seq: { type: "integer" },
          expectedUnits: { type: "integer" },
          loadedUnits: { oneOf: [{ type: "integer" }, { type: "null" }] },
          condition: {
            oneOf: [
              { type: "string", enum: ["OK", "SHORT", "DAMAGED", "MISSING"] },
              { type: "null" },
            ],
          },
        },
      },
    },
  },
} as const;

const LOAD_CHECK_RESPONSE = {
  type: "object",
  additionalProperties: false,
  required: ["tripId", "orderId", "expectedUnits", "loadedUnits", "condition"],
  properties: {
    tripId: { type: "string" },
    orderId: { type: "string" },
    expectedUnits: { type: "integer" },
    loadedUnits: { type: "integer" },
    condition: { type: "string", enum: ["OK", "SHORT", "DAMAGED", "MISSING"] },
    shortfallId: { oneOf: [{ type: "string" }, { type: "null" }] },
  },
} as const;

function parseDate(value: unknown): Date | undefined {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  return new Date(`${value}T00:00:00.000Z`);
}

export default async function (fastify: FastifyInstance) {
  fastify.get(
    "/trips",
    {
      schema: {
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: {
            date: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
            status: {
              type: "string",
              enum: ["PLANNED", "LOADING", "READY", "DEPARTED", "COMPLETED", "CANCELLED"],
            },
          },
        },
        response: {
          200: { type: "array", items: TRIP },
        },
      },
    },
    async (request) => {
      const user = request.requireRole("LOADER", "DISPATCHER");
      if (!user.depotCode) return [];
      const query = request.query as { date?: string; status?: TripStatus };
      const date = parseDate(query.date);

      const trips = await prisma.trip.findMany({
        where: {
          plan: {
            status: "PUBLISHED",
            planningDay: {
              depotCode: user.depotCode,
              ...(date ? { date } : {}),
            },
          },
          ...(query.status ? { status: query.status } : {}),
        },
        orderBy: [{ wave: "asc" }, { plannedDepartAt: "asc" }, { vehicleId: "asc" }],
        take: 100,
      });

      return trips.map((trip) => ({
        id: trip.id,
        vehicleId: trip.vehicleId,
        tripNo: trip.tripNo as 1 | 2,
        brand: trip.brand,
        districtName: trip.districtName,
        wave: trip.wave,
        status: trip.status,
        plannedDepartAt: trip.plannedDepartAt,
        plannedMinutes: Math.round(trip.plannedMinutes),
        sumWeightKg: trip.sumWeightKg,
        sumVolumeM3: trip.sumVolumeM3,
      }));
    },
  );

  fastify.get(
    "/trips/:tripId/load-list",
    {
      schema: {
        params: {
          type: "object",
          required: ["tripId"],
          properties: { tripId: { type: "string", minLength: 1 } },
        },
        response: {
          200: LOAD_LIST,
          403: ERROR_RESPONSE,
          404: ERROR_RESPONSE,
        },
      },
    },
    async (request, reply) => {
      const user = request.requireRole("LOADER", "DISPATCHER");
      const { tripId } = request.params as { tripId: string };

      try {
        await requireLoaderTrip(user, tripId);
      } catch {
        return reply
          .status(404)
          .send({ error: { code: "NOT_FOUND", message: "Trip not found at this depot." } });
      }

      const trip = await prisma.trip.findUnique({
        where: { id: tripId },
        select: {
          id: true,
          status: true,
          stops: {
            // The brief: lines come back in REVERSE delivery order because the
            // driver unloads from the back. The dock loads the last stop first.
            orderBy: { seq: "desc" },
            select: {
              seq: true,
              outletId: true,
              orders: { select: { order: { select: { id: true, ref: true, units: true } } } },
            },
          },
          loadChecks: {
            select: {
              orderId: true,
              loadedUnits: true,
              condition: true,
            },
          },
        },
      });
      if (!trip) {
        return reply
          .status(404)
          .send({ error: { code: "NOT_FOUND", message: "Trip not found." } });
      }

      const checkByOrderId = new Map(trip.loadChecks.map((c) => [c.orderId, c]));
      const lines = trip.stops.flatMap((stop) =>
        stop.orders.map(({ order }) => {
          const check = checkByOrderId.get(order.id);
          return {
            orderId: order.id,
            orderRef: order.ref,
            outletId: stop.outletId,
            seq: stop.seq,
            expectedUnits: order.units,
            loadedUnits: check?.loadedUnits ?? null,
            condition: check?.condition ?? null,
          };
        }),
      );

      return { tripId: trip.id, status: trip.status, lines };
    },
  );

  fastify.put(
    "/trips/:tripId/load-checks/:orderId",
    {
      schema: {
        params: {
          type: "object",
          required: ["tripId", "orderId"],
          properties: {
            tripId: { type: "string", minLength: 1 },
            orderId: { type: "string", minLength: 1 },
          },
        },
        body: {
          type: "object",
          additionalProperties: false,
          required: ["loadedUnits", "condition", "checkedByName"],
          properties: {
            loadedUnits: { type: "integer", minimum: 0 },
            condition: { type: "string", enum: ["OK", "SHORT", "DAMAGED", "MISSING"] },
            checkedByName: { type: "string", minLength: 2 },
            reasonCode: { oneOf: [{ type: "string" }, { type: "null" }] },
            clientRequestId: {
              oneOf: [{ type: "string", format: "uuid" }, { type: "null" }],
            },
          },
        },
        response: {
          200: LOAD_CHECK_RESPONSE,
          403: ERROR_RESPONSE,
          404: ERROR_RESPONSE,
          422: ERROR_RESPONSE,
        },
      },
    },
    async (request, reply) => {
      const user = request.requireRole("LOADER", "DISPATCHER");
      const { tripId, orderId } = request.params as { tripId: string; orderId: string };
      const body = request.body as {
        loadedUnits: number;
        condition: LoadCondition;
        checkedByName: string;
        reasonCode?: string | null;
        clientRequestId?: string | null;
      };

      try {
        await requireLoaderTrip(user, tripId);
      } catch {
        return reply
          .status(404)
          .send({ error: { code: "NOT_FOUND", message: "Trip not found at this depot." } });
      }
      const order = await requireOrderOnTrip(user, tripId, orderId).catch(() => null);
      if (!order) {
        return reply
          .status(404)
          .send({ error: { code: "NOT_FOUND", message: "Order not on this trip." } });
      }

      if (body.condition !== "OK" && !body.reasonCode) {
        return reply.status(422).send({
          error: {
            code: "REASON_REQUIRED",
            message: "A non-OK condition opens a shortfall and must carry a reason code.",
          },
        });
      }

      const missing = Math.max(order.units - body.loadedUnits, 0);

      const result = await prisma.$transaction(async (tx) => {
        // Upsert the LoadCheck so a correction replaces the earlier line
        // rather than opening a second one.
        const loadCheck = await tx.loadCheck.upsert({
          where: { tripId_orderId: { tripId, orderId } },
          create: {
            tripId,
            orderId,
            expectedUnits: order.units,
            loadedUnits: body.loadedUnits,
            condition: body.condition,
            checkedByName: body.checkedByName.trim(),
            checkedByUserId: user.id,
            clientRequestId: body.clientRequestId ?? null,
          },
          update: {
            loadedUnits: body.loadedUnits,
            condition: body.condition,
            checkedByName: body.checkedByName.trim(),
            checkedByUserId: user.id,
            checkedAt: new Date(),
          },
        });

        // Shortfalls follow the LoadCheck: close any open ones when the line
        // is now OK, create or update one when it isn't.
        let shortfallId: string | null = null;
        if (body.condition === "OK") {
          await tx.shortfall.updateMany({
            where: { tripId, orderId, status: "OPEN" },
            data: {
              status: "RESOLVED",
              resolvedAt: new Date(),
              resolvedByUserId: user.id,
              resolution: "SEND_SHORT",
              blocksDeparture: false,
            },
          });
        } else {
          const existing = await tx.shortfall.findFirst({
            where: { tripId, orderId, status: "OPEN" },
            select: { id: true },
          });
          if (existing) {
            const updated = await tx.shortfall.update({
              where: { id: existing.id },
              data: {
                kind: body.condition,
                missingUnits: missing,
                reasonCode: body.reasonCode ?? null,
                loadCheckId: loadCheck.id,
                raisedByUserId: user.id,
                raisedByName: body.checkedByName.trim(),
              },
            });
            shortfallId = updated.id;
          } else {
            const created = await tx.shortfall.create({
              data: {
                tripId,
                orderId,
                loadCheckId: loadCheck.id,
                kind: body.condition,
                missingUnits: missing,
                raisedByUserId: user.id,
                raisedByName: body.checkedByName.trim(),
                reasonCode: body.reasonCode ?? null,
              },
            });
            shortfallId = created.id;
          }
        }

        // Trip is officially loading as soon as the first check lands.
        await tx.trip.updateMany({
          where: { id: tripId, status: "PLANNED" },
          data: { status: "LOADING" },
        });

        return { loadCheck, shortfallId };
      });

      await recordDecisions([
        {
          actor: user,
          action: "load.check",
          entityType: "Order",
          entityId: orderId,
          reasonCode: body.reasonCode ?? undefined,
          after: {
            tripId,
            expectedUnits: order.units,
            loadedUnits: result.loadCheck.loadedUnits,
            condition: result.loadCheck.condition,
          },
        },
        ...(result.shortfallId
          ? [
              {
                actor: user,
                action: "shortfall.raise",
                entityType: "Shortfall",
                entityId: result.shortfallId,
                reasonCode: body.reasonCode ?? undefined,
                after: { tripId, orderId, kind: body.condition, missingUnits: missing },
              },
            ]
          : []),
      ]);

      return {
        tripId,
        orderId,
        expectedUnits: order.units,
        loadedUnits: result.loadCheck.loadedUnits,
        condition: result.loadCheck.condition,
        shortfallId: result.shortfallId,
      };
    },
  );

  fastify.post(
    "/trips/:tripId/readiness",
    {
      schema: {
        params: {
          type: "object",
          required: ["tripId"],
          properties: { tripId: { type: "string", minLength: 1 } },
        },
        response: {
          200: {
            type: "object",
            additionalProperties: false,
            required: ["tripId", "status"],
            properties: {
              tripId: { type: "string" },
              status: {
                type: "string",
                enum: ["PLANNED", "LOADING", "READY", "DEPARTED", "COMPLETED", "CANCELLED"],
              },
              releasedAt: { type: "string", format: "date-time" },
            },
          },
          403: ERROR_RESPONSE,
          404: ERROR_RESPONSE,
          409: ERROR_RESPONSE,
        },
      },
    },
    async (request, reply) => {
      const user = request.requireRole("LOADER", "DISPATCHER");
      const { tripId } = request.params as { tripId: string };

      try {
        await requireLoaderTrip(user, tripId);
      } catch {
        return reply
          .status(404)
          .send({ error: { code: "NOT_FOUND", message: "Trip not found at this depot." } });
      }

      const trip = await prisma.trip.findUnique({
        where: { id: tripId },
        select: {
          id: true,
          status: true,
          stops: { select: { orders: { select: { orderId: true } } } },
          loadChecks: { select: { orderId: true } },
          shortfalls: {
            where: { status: "OPEN", blocksDeparture: true },
            select: { id: true, kind: true, orderId: true },
          },
        },
      });
      if (!trip) {
        return reply
          .status(404)
          .send({ error: { code: "NOT_FOUND", message: "Trip not found." } });
      }
      if (trip.status === "READY" || trip.status === "DEPARTED" || trip.status === "COMPLETED") {
        return reply.status(409).send({
          error: {
            code: "ALREADY_READY",
            message: `Trip is already ${trip.status.toLowerCase()}.`,
          },
        });
      }

      const expectedOrderIds = new Set(trip.stops.flatMap((s) => s.orders.map((o) => o.orderId)));
      const checkedOrderIds = new Set(trip.loadChecks.map((c) => c.orderId));
      const unchecked = [...expectedOrderIds].filter((id) => !checkedOrderIds.has(id));

      if (unchecked.length > 0) {
        return reply.status(409).send({
          error: {
            code: "LOAD_INCOMPLETE",
            message: `${unchecked.length} of ${expectedOrderIds.size} lines are still unchecked.`,
            details: { checked: checkedOrderIds.size, expected: expectedOrderIds.size },
          },
        });
      }
      if (trip.shortfalls.length > 0) {
        return reply.status(409).send({
          error: {
            code: "SHORTFALL_BLOCKING",
            message: `${trip.shortfalls.length} open shortfall${trip.shortfalls.length === 1 ? "" : "s"} still blocks departure.`,
            details: { shortfallIds: trip.shortfalls.map((s) => s.id) },
          },
        });
      }

      // Atomic one-time claim: PLANNED/LOADING -> READY. A second attempt
      // updates zero rows and we return 409 instead of silently flipping.
      const now = new Date();
      const claimed = await prisma.trip.updateMany({
        where: { id: tripId, status: { in: ["PLANNED", "LOADING"] } },
        data: { status: "READY", loadConfirmedAt: now },
      });
      if (claimed.count === 0) {
        return reply.status(409).send({
          error: {
            code: "RACE_LOST",
            message: "Another dock terminal released this trip just now.",
          },
        });
      }

      await recordDecisions([
        {
          actor: user,
          action: "trip.ready",
          entityType: "Trip",
          entityId: tripId,
          before: { status: trip.status },
          after: { status: "READY" },
        },
      ]);

      return { tripId, status: "READY" as const, releasedAt: now.toISOString() };
    },
  );
}
