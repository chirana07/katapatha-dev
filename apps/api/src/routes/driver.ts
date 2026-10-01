import type { FastifyInstance } from "fastify";
import { prisma } from "../lib/db.js";
import { loadRun } from "../services/delivery.js";
import { accessNoteFor } from "../services/store.js";

/**
 * Owner: BE3
 *
 * The driver claims a vehicle at the dock; the claim is persisted on the
 * user row so a reconnect from the same account on a different device
 * resumes against the same run. Release clears it. Run reads today's trips
 * for the claimed vehicle via services/delivery.loadRun().
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

const STOP_ITEM = {
  type: "object",
  additionalProperties: false,
  required: ["id", "seq", "outletId", "status"],
  properties: {
    id: { type: "string" },
    seq: { type: "integer" },
    outletId: { type: "string" },
    outletName: { type: "string" },
    status: {
      type: "string",
      enum: ["PENDING", "ARRIVED", "UNLOADING", "DONE", "SKIPPED", "FAILED"],
    },
    plannedArrivalAt: { type: "string", pattern: "^([01]\\d|2[0-3]):[0-5]\\d$" },
    windowOpen: { type: "string", pattern: "^([01]\\d|2[0-3]):[0-5]\\d$" },
    windowClose: { type: "string", pattern: "^([01]\\d|2[0-3]):[0-5]\\d$" },
    accessNote: { oneOf: [{ type: "string" }, { type: "null" }] },
    orders: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["orderId", "orderRef", "expectedUnits"],
        properties: {
          orderId: { type: "string" },
          orderRef: { type: "string" },
          expectedUnits: { type: "integer" },
        },
      },
    },
  },
} as const;

const RUN_RESPONSE = {
  type: "object",
  additionalProperties: false,
  required: ["date", "vehicleId", "trips"],
  properties: {
    date: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
    vehicleId: { type: "string" },
    trips: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["tripId", "tripNo", "wave", "stops"],
        properties: {
          tripId: { type: "string" },
          tripNo: { type: "integer" },
          wave: { type: "string", enum: ["PREDAWN", "DAYTIME"] },
          stops: { type: "array", items: STOP_ITEM },
        },
      },
    },
  },
} as const;

function parseDate(value: unknown): Date | undefined {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  return new Date(`${value}T00:00:00.000Z`);
}

export default async function (fastify: FastifyInstance) {
  fastify.put(
    "/drivers/me/vehicle",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["vehicleId"],
          properties: { vehicleId: { type: "string", minLength: 1 } },
        },
        response: {
          200: {
            type: "object",
            additionalProperties: false,
            required: ["vehicleId"],
            properties: { vehicleId: { type: "string" } },
          },
          403: ERROR_RESPONSE,
          404: ERROR_RESPONSE,
        },
      },
    },
    async (request, reply) => {
      const user = request.requireRole("DRIVER");
      if (!user.depotCode) {
        return reply.status(403).send({
          error: { code: "FORBIDDEN", message: "This account is not bound to a depot." },
        });
      }
      const { vehicleId } = request.body as { vehicleId: string };

      // Vehicle must exist and belong to the driver's depot — a driver
      // claiming a vehicle on the wrong depot would be an operational error
      // the dispatcher would have to unpick, so stop it at the server.
      const vehicle = await prisma.vehicle.findFirst({
        where: { id: vehicleId, depotCode: user.depotCode },
        select: { id: true },
      });
      if (!vehicle) {
        return reply.status(404).send({
          error: { code: "VEHICLE_NOT_AT_DEPOT", message: "Vehicle not found at this depot." },
        });
      }

      await prisma.user.update({
        where: { id: user.id },
        data: { defaultVehicleId: vehicle.id },
      });
      return { vehicleId: vehicle.id };
    },
  );

  fastify.delete(
    "/drivers/me/vehicle",
    { schema: { response: { 204: { type: "null" } } } },
    async (request, reply) => {
      const user = request.requireRole("DRIVER");
      await prisma.user.update({
        where: { id: user.id },
        data: { defaultVehicleId: null },
      });
      return reply.status(204).send();
    },
  );

  fastify.get(
    "/drivers/me/run",
    {
      schema: {
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: {
            date: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
          },
        },
        response: {
          200: RUN_RESPONSE,
          403: ERROR_RESPONSE,
        },
      },
    },
    async (request, reply) => {
      const user = request.requireRole("DRIVER");
      if (!user.defaultVehicleId) {
        return reply.status(403).send({
          error: {
            code: "NO_VEHICLE_CLAIMED",
            message:
              "Claim a vehicle before loading today's run. The dock card has the id.",
          },
        });
      }

      const query = request.query as { date?: string };
      const date = parseDate(query.date);
      if (!date) {
        return reply.status(403).send({
          error: { code: "DATE_REQUIRED", message: "date=YYYY-MM-DD is required." },
        });
      }

      const trips = await loadRun(user.defaultVehicleId, date);
      return {
        date: date.toISOString().slice(0, 10),
        vehicleId: user.defaultVehicleId,
        trips: trips.map((trip) => ({
          tripId: trip.id,
          tripNo: trip.tripNo,
          wave: trip.wave,
          stops: trip.stops.map((stop) => ({
            id: stop.id,
            seq: stop.seq,
            outletId: stop.outletId,
            outletName: stop.outlet.displayName ?? undefined,
            status: stop.status,
            plannedArrivalAt: stop.plannedArrivalAt,
            windowOpen: stop.outlet.windowOpen,
            windowClose: stop.outlet.windowClose,
            accessNote: accessNoteFor(stop.outlet) || null,
            orders: stop.orders.map(({ order }) => ({
              orderId: order.id,
              orderRef: order.ref,
              expectedUnits: order.units,
            })),
          })),
        })),
      };
    },
  );
}
