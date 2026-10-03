import type { FastifyInstance } from "fastify";
import { Prisma, type ChillerSource } from "@prisma/client";
import { CHILLED_TARGET, isInRange } from "@katapatha/core/domain/chiller";
import { prisma } from "../lib/db.js";
import { recordDecision } from "../lib/audit.js";
import { AuthError } from "../lib/auth.js";
import { requireLoaderTrip } from "../lib/authorization.js";
import {
  FUTURE_TOLERANCE_MINUTES,
  chillerSourceAllowed,
  isTooFarAhead,
  pickPingTrip,
} from "../services/vehicles.js";

/**
 * Owner: Slice V
 *
 * What the field reports back. Two writes, both honest about what they are:
 *
 *  - A ping is whatever position a driver's phone managed to send. It is
 *    stored with the phone's own clock, and shown with its age, never as a
 *    live dot.
 *  - A chiller reading is a person looking at a gauge — a loader at the bay or
 *    a driver on arrival — stored with who read it and when. It is not a
 *    sensor feed, and an out-of-range reading blocks nothing by itself; the
 *    exceptions console decides what to do with it.
 *
 * Both are replay-safe: the phone mints an id and a resend returns the same
 * result instead of a second row.
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

const nullable = (schema: object) => ({ oneOf: [schema, { type: "null" }] });

const PING_BODY = {
  type: "object",
  additionalProperties: false,
  required: ["pings"],
  properties: {
    pings: {
      type: "array",
      minItems: 1,
      maxItems: 50,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["clientPingId", "lat", "lng", "recordedAt"],
        properties: {
          clientPingId: { type: "string", minLength: 8, maxLength: 64 },
          lat: { type: "number", minimum: -90, maximum: 90 },
          lng: { type: "number", minimum: -180, maximum: 180 },
          accuracyM: { type: "number", minimum: 0 },
          recordedAt: { type: "string", format: "date-time" },
        },
      },
    },
  },
} as const;

const PING_RESULT = {
  type: "object",
  additionalProperties: false,
  required: ["accepted", "duplicates"],
  properties: { accepted: { type: "integer" }, duplicates: { type: "integer" } },
} as const;

const READING_BODY = {
  type: "object",
  additionalProperties: false,
  required: ["tempC", "source"],
  properties: {
    tempC: { type: "number", minimum: -30, maximum: 40 },
    source: { type: "string", enum: ["LOADER_AT_BAY", "DRIVER_ON_ARRIVAL"] },
    tripStopId: { type: "string", minLength: 1 },
    note: { type: "string", maxLength: 200 },
    clientReadingId: { type: "string", minLength: 8, maxLength: 64 },
    recordedAt: { type: "string", format: "date-time" },
  },
} as const;

const READING_RESPONSE = {
  type: "object",
  additionalProperties: false,
  required: [
    "id",
    "tripId",
    "vehicleId",
    "tempC",
    "targetMinC",
    "targetMaxC",
    "inRange",
    "source",
    "recordedAt",
    "recordedByName",
  ],
  properties: {
    id: { type: "string" },
    tripId: { type: "string" },
    vehicleId: { type: "string" },
    tempC: { type: "number" },
    targetMinC: { type: "number" },
    targetMaxC: { type: "number" },
    inRange: { type: "boolean" },
    source: { type: "string", enum: ["LOADER_AT_BAY", "DRIVER_ON_ARRIVAL"] },
    recordedAt: { type: "string" },
    recordedByName: nullable({ type: "string" }),
  },
} as const;

interface ReadingRow {
  id: string;
  tripId: string | null;
  vehicleId: string;
  tempC: number;
  targetMinC: number;
  targetMaxC: number;
  source: ChillerSource;
  recordedAt: Date;
  recordedByName: string | null;
}

function readingResponse(row: ReadingRow, tripId: string) {
  return {
    id: row.id,
    tripId,
    vehicleId: row.vehicleId,
    tempC: row.tempC,
    targetMinC: row.targetMinC,
    targetMaxC: row.targetMaxC,
    // Judged against the band stored on the row, so a replayed response says
    // the same thing it said the first time even if the policy has moved.
    inRange: isInRange(row.tempC, { minC: row.targetMinC, maxC: row.targetMaxC }),
    source: row.source,
    recordedAt: row.recordedAt.toISOString(),
    recordedByName: row.recordedByName,
  };
}

export default async function (fastify: FastifyInstance) {
  fastify.post(
    "/drivers/me/pings",
    {
      schema: {
        body: PING_BODY,
        response: { 200: PING_RESULT, 403: ERROR_RESPONSE, 422: ERROR_RESPONSE },
      },
    },
    async (request, reply) => {
      const user = request.requireRole("DRIVER");
      if (!user.defaultVehicleId) {
        throw new AuthError("Pick a vehicle at the dock before reporting a position.", 403);
      }
      const vehicleId = user.defaultVehicleId;
      const { pings } = request.body as {
        pings: { clientPingId: string; lat: number; lng: number; accuracyM?: number; recordedAt: string }[];
      };

      const now = new Date();
      const future = pings.find((p) => isTooFarAhead(new Date(p.recordedAt), now));
      if (future) {
        // The whole batch is refused: a clock this far ahead is wrong for every
        // ping the phone took, and a future timestamp would read as "just now".
        return reply.status(422).send({
          error: {
            code: "PING_IN_FUTURE",
            message: `A report is dated more than ${FUTURE_TOLERANCE_MINUTES} minutes ahead of the server clock. Check the phone's date and time.`,
            details: { clientPingId: future.clientPingId },
          },
        });
      }

      // The trip is whatever the vehicle is doing now. A phone reporting from
      // a vehicle with no live trip still gets its position stored — a ping
      // with no trip is still the vehicle's last reported position.
      const candidates = await prisma.trip.findMany({
        where: {
          vehicleId,
          status: { in: ["DEPARTED", "READY", "LOADING"] },
          plan: { status: "PUBLISHED" },
        },
        select: { id: true, status: true, plan: { select: { planningDay: { select: { date: true } } } } },
      });
      const trip = pickPingTrip(
        candidates.map((c) => ({
          id: c.id,
          status: c.status,
          planDate: c.plan.planningDay.date.toISOString().slice(0, 10),
        })),
      );

      const result = await prisma.vehiclePing.createMany({
        data: pings.map((p) => ({
          vehicleId,
          tripId: trip?.id ?? null,
          lat: p.lat,
          lng: p.lng,
          accuracyM: p.accuracyM ?? null,
          recordedAt: new Date(p.recordedAt),
          reportedByUserId: user.id,
          clientPingId: p.clientPingId,
        })),
        // A replayed outbox batch must not double-count; the unique
        // clientPingId turns a repeat into a no-op rather than an error.
        skipDuplicates: true,
      });
      return { accepted: result.count, duplicates: pings.length - result.count };
    },
  );

  fastify.post(
    "/trips/:tripId/chiller-readings",
    {
      schema: {
        params: {
          type: "object",
          required: ["tripId"],
          properties: { tripId: { type: "string", minLength: 1 } },
        },
        body: READING_BODY,
        response: {
          200: READING_RESPONSE,
          201: READING_RESPONSE,
          403: ERROR_RESPONSE,
          409: ERROR_RESPONSE,
          422: ERROR_RESPONSE,
        },
      },
    },
    async (request, reply) => {
      const user = request.requireRole("LOADER", "DRIVER", "DISPATCHER");
      const { tripId } = request.params as { tripId: string };
      const body = request.body as {
        tempC: number;
        source: ChillerSource;
        tripStopId?: string;
        note?: string;
        clientReadingId?: string;
        recordedAt?: string;
      };

      // Ownership first, so a trip the caller cannot see answers 403 whatever
      // else is wrong with the request. A driver is bound to a vehicle, not a
      // depot dock: only a published trip on their own vehicle counts.
      let vehicleId: string;
      if (user.role === "DRIVER") {
        if (!user.defaultVehicleId || !user.depotCode) {
          throw new AuthError("You do not have access to this record", 403);
        }
        const own = await prisma.trip.findFirst({
          where: {
            id: tripId,
            vehicleId: user.defaultVehicleId,
            plan: { status: "PUBLISHED", planningDay: { depotCode: user.depotCode } },
          },
          select: { vehicleId: true },
        });
        if (!own) throw new AuthError("You do not have access to this record", 403);
        vehicleId = own.vehicleId;
      } else {
        vehicleId = (await requireLoaderTrip(user, tripId)).vehicleId;
      }

      if (!chillerSourceAllowed(user.role, body.source)) {
        return reply.status(422).send({
          error: {
            code: "SOURCE_NOT_ALLOWED_FOR_ROLE",
            message:
              body.source === "LOADER_AT_BAY"
                ? "A bay reading is recorded by a loader or dispatcher."
                : "An on-arrival reading is recorded by the driver.",
          },
        });
      }

      const now = new Date();
      const recordedAt = body.recordedAt ? new Date(body.recordedAt) : now;
      if (isTooFarAhead(recordedAt, now)) {
        return reply.status(422).send({
          error: {
            code: "READING_IN_FUTURE",
            message: `The reading is dated more than ${FUTURE_TOLERANCE_MINUTES} minutes ahead of the server clock.`,
          },
        });
      }

      // A resend returns the row it already made. The same id on a different
      // trip is a client bug, not a replay, and must not hand back (or quietly
      // overwrite) another trip's reading.
      if (body.clientReadingId) {
        const existing = await prisma.chillerReading.findUnique({ where: { clientReadingId: body.clientReadingId } });
        if (existing) {
          if (existing.tripId !== tripId) return reuseConflict(reply);
          return reply.status(200).send(readingResponse(existing, tripId));
        }
      }

      const vehicle = await prisma.vehicle.findUnique({ where: { id: vehicleId }, select: { temp: true } });
      if (vehicle?.temp !== "reefer") {
        return reply.status(422).send({
          error: {
            code: "CHILLER_NOT_APPLICABLE",
            message: "Only refrigerated vehicles take chiller readings.",
          },
        });
      }

      if (body.tripStopId) {
        const stop = await prisma.tripStop.findFirst({ where: { id: body.tripStopId, tripId }, select: { id: true } });
        if (!stop) {
          return reply.status(422).send({
            error: { code: "STOP_NOT_ON_TRIP", message: "That stop is not part of this trip." },
          });
        }
      }

      let row: ReadingRow;
      try {
        row = await prisma.chillerReading.create({
          data: {
            vehicleId,
            tripId,
            tripStopId: body.tripStopId ?? null,
            tempC: body.tempC,
            // Copied, not referenced: whether this reading was in range must
            // not change if the policy does.
            targetMinC: CHILLED_TARGET.minC,
            targetMaxC: CHILLED_TARGET.maxC,
            source: body.source,
            recordedByUserId: user.id,
            recordedByName: user.name,
            recordedAt,
            note: body.note?.trim() ? body.note.trim() : null,
            clientReadingId: body.clientReadingId ?? null,
          },
        });
      } catch (err) {
        // Two sends of the same reading raced past the lookup above; the
        // unique index decided, and the loser reports the winner's row.
        if (body.clientReadingId && err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
          const winner = await prisma.chillerReading.findUnique({ where: { clientReadingId: body.clientReadingId } });
          if (winner && winner.tripId === tripId) return reply.status(200).send(readingResponse(winner, tripId));
          return reuseConflict(reply);
        }
        throw err;
      }

      const view = readingResponse(row, tripId);
      await recordDecision({
        actor: user,
        action: "chiller.read",
        entityType: "Trip",
        entityId: tripId,
        note: body.note?.trim() ? body.note.trim() : undefined,
        after: {
          readingId: row.id,
          vehicleId,
          tempC: row.tempC,
          inRange: view.inRange,
          source: row.source,
        },
      });
      return reply.status(201).send(view);
    },
  );
}

function reuseConflict(reply: { status(code: number): { send(body: unknown): unknown } }) {
  return reply.status(409).send({
    error: {
      code: "CLIENT_ID_REUSED",
      message: "That clientReadingId was already used for a different trip.",
    },
  });
}
