import type { FastifyInstance } from "fastify";
import {
  DEFERRAL_REASONS,
  PROBLEM_REASONS,
  SHORTFALL_REASONS,
  STORE_ISSUE_REASONS,
  STORE_PROBLEM_KINDS,
} from "@katapatha/core/domain/reasons";
import { DISTRICT_POSITIONS, haversineKm, withinSriLanka } from "@katapatha/core/domain/geography";
import { recordDecision } from "../lib/audit.js";
import { nearest } from "../services/routing.js";
import { nextOperatingDate } from "../services/store.js";

const DATE_ONLY = "^\\d{4}-\\d{2}-\\d{2}$";

/** A pin this far from its district centre is probably a typo; it is accepted, with a warning. */
const FAR_FROM_DISTRICT_KM = 40;

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

const GEO_SOURCES = ["SYNTHETIC", "CSV", "DISPATCHER"];

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

function fromDateOnly(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

function toDateOnly(value: Date): string {
  return value.toISOString().slice(0, 10);
}

/** Authenticated reference data. Owner: BE1. */
export default async function (fastify: FastifyInstance) {
  fastify.get("/reference/outlets", {
    schema: {
      response: {
        200: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: [
              "id",
              "brand",
              "districtName",
              "depotCode",
              "dockType",
              "windowOpen",
              "windowClose",
            ],
            properties: {
              id: { type: "string" },
              displayName: { type: "string" },
              brand: { type: "string", enum: ["Fresh", "Style", "Tech"] },
              districtName: { type: "string" },
              depotCode: { type: "string" },
              dockType: { type: "string", enum: ["rear_dock", "street", "mall_bay"] },
              parkingConstraint: {
                type: "string",
                enum: ["normal", "van_only", "mall_dock"],
              },
              windowOpen: { type: "string", pattern: "^([01]\\d|2[0-3]):[0-5]\\d$" },
              windowClose: { type: "string", pattern: "^([01]\\d|2[0-3]):[0-5]\\d$" },
              mallWindowOpen: {
                oneOf: [
                  { type: "string", pattern: "^([01]\\d|2[0-3]):[0-5]\\d$" },
                  { type: "null" },
                ],
              },
              mallWindowClose: {
                oneOf: [
                  { type: "string", pattern: "^([01]\\d|2[0-3]):[0-5]\\d$" },
                  { type: "null" },
                ],
              },
              lat: { type: ["number", "null"] },
              lng: { type: ["number", "null"] },
              geoSource: { type: ["string", "null"], enum: [...GEO_SOURCES, null] },
              geoSnapped: { type: "boolean" },
            },
          },
        },
      },
    },
  }, async (request) => {
    const user = request.requireRole();
    const scope = user.depotCode
      ? { depotCode: user.depotCode }
      : user.outletId
        ? { id: user.outletId }
        : { id: { in: [] as string[] } };

    const outlets = await fastify.prisma.outlet.findMany({
      where: scope,
      orderBy: { id: "asc" },
      select: {
        id: true,
        displayName: true,
        brand: true,
        districtName: true,
        depotCode: true,
        dockType: true,
        parkingConstraint: true,
        windowOpen: true,
        windowClose: true,
        mallWindowOpen: true,
        mallWindowClose: true,
        lat: true,
        lng: true,
        geoSource: true,
        geoSnapped: true,
      },
    });

    return outlets.map(({ displayName, ...outlet }) => ({
      ...outlet,
      ...(displayName === null ? {} : { displayName }),
    }));
  });

  /**
   * Correct where an outlet is. The seeded positions are approximate, and the
   * dispatcher knows the real address; this is how the map gets fixed without
   * a deploy. The position is snapped to the nearest road unless asked not to,
   * because a delivery has to start from one. Plans already built keep the
   * route they were built with: re-run the allocator to use the new position.
   */
  fastify.patch("/reference/outlets/:outletId/location", {
    schema: {
      params: {
        type: "object",
        required: ["outletId"],
        properties: { outletId: { type: "string", minLength: 1 } },
      },
      body: {
        type: "object",
        additionalProperties: false,
        required: ["lat", "lng"],
        properties: {
          lat: { type: "number" },
          lng: { type: "number" },
          snap: { type: "boolean" },
        },
      },
      response: {
        200: {
          type: "object",
          additionalProperties: false,
          required: ["id", "lat", "lng", "geoSource", "geoSnapped"],
          properties: {
            id: { type: "string" },
            lat: { type: "number" },
            lng: { type: "number" },
            geoSource: { type: "string", enum: GEO_SOURCES },
            geoSnapped: { type: "boolean" },
            warning: { type: "string" },
          },
        },
        404: ERROR_RESPONSE,
        422: ERROR_RESPONSE,
      },
    },
  }, async (request, reply) => {
    const user = request.requireRole("DISPATCHER");
    const { outletId } = request.params as { outletId: string };
    const body = request.body as { lat: number; lng: number; snap?: boolean };

    // Scoped to the dispatcher's own depot. Another depot's outlet is "not
    // found", the same as every other scoped read, rather than "forbidden".
    const outlet = user.depotCode
      ? await fastify.prisma.outlet.findFirst({
          where: { id: outletId, depotCode: user.depotCode },
          select: { id: true, districtName: true, lat: true, lng: true, geoSource: true },
        })
      : null;
    if (!outlet) return reply.status(404).send({ error: { code: "NOT_FOUND", message: "Outlet not found." } });

    const requested = { lat: body.lat, lng: body.lng };
    if (!withinSriLanka(requested)) {
      return reply.status(422).send({
        error: {
          code: "VALIDATION_FAILED",
          message: "That position is outside Sri Lanka. Check the latitude and longitude are not swapped.",
        },
      });
    }

    const snapped = body.snap === false ? null : await nearest(requested);
    const placed = snapped?.live ? { lat: snapped.lat, lng: snapped.lng } : requested;

    const centre = DISTRICT_POSITIONS[outlet.districtName];
    const far = centre ? haversineKm(centre, placed) > FAR_FROM_DISTRICT_KM : false;

    const updated = await fastify.prisma.outlet.update({
      where: { id: outlet.id },
      data: {
        lat: placed.lat,
        lng: placed.lng,
        geoSource: "DISPATCHER",
        geoSnapped: Boolean(snapped?.live),
        geoUpdatedAt: new Date(),
        geoUpdatedByUserId: user.id,
      },
      select: { id: true, lat: true, lng: true, geoSource: true, geoSnapped: true },
    });

    await recordDecision({
      actor: user,
      action: "outlet.relocate",
      entityType: "Outlet",
      entityId: outlet.id,
      before: { lat: outlet.lat, lng: outlet.lng, geoSource: outlet.geoSource },
      after: { lat: placed.lat, lng: placed.lng, snapped: Boolean(snapped?.live) },
    });

    return {
      id: updated.id,
      lat: updated.lat!,
      lng: updated.lng!,
      geoSource: updated.geoSource!,
      geoSnapped: updated.geoSnapped,
      ...(far
        ? { warning: `This is more than ${FAR_FROM_DISTRICT_KM} km from the centre of ${outlet.districtName}. Check it is the right place.` }
        : {}),
    };
  });

  fastify.get("/reference/vehicles", {
    schema: {
      response: {
        200: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["id", "type", "temp", "weightCapKg", "volumeCapM3", "depotCode"],
            properties: {
              id: { type: "string" },
              type: { type: "string", enum: ["truck", "van"] },
              temp: { type: "string", enum: ["reefer", "ambient"] },
              weightCapKg: { type: "number" },
              volumeCapM3: { type: "number" },
              kmPerL: { type: "number" },
              weeklyFuelQuotaL: { type: "number" },
              depotCode: { type: "string" },
            },
          },
        },
      },
    },
  }, async (request) => {
    const user = request.requireRole();
    if (!user.depotCode) return [];

    return fastify.prisma.vehicle.findMany({
      where: { depotCode: user.depotCode },
      orderBy: { id: "asc" },
      select: {
        id: true,
        type: true,
        temp: true,
        weightCapKg: true,
        volumeCapM3: true,
        kmPerL: true,
        weeklyFuelQuotaL: true,
        depotCode: true,
      },
    });
  });

  fastify.get("/reference/vocabularies", {
    schema: {
      response: {
        200: {
          type: "object",
          additionalProperties: false,
          required: ["deferralReasons", "shortfallReasons", "problemReasons"],
          properties: {
            deferralReasons: { type: "array", items: { type: "string" } },
            shortfallReasons: { type: "array", items: { type: "string" } },
            problemReasons: { type: "array", items: { type: "string" } },
            storeProblemKinds: { type: "array", items: { type: "string" } },
            storeIssueReasons: { type: "array", items: { type: "string" } },
          },
        },
      },
    },
  }, async (request) => {
    request.requireRole();

    return {
      deferralReasons: DEFERRAL_REASONS.map(({ code }) => code),
      shortfallReasons: SHORTFALL_REASONS.map(({ code }) => code),
      problemReasons: PROBLEM_REASONS.map(({ code }) => code),
      storeProblemKinds: STORE_PROBLEM_KINDS.map(({ code }) => code),
      storeIssueReasons: STORE_ISSUE_REASONS.map(({ code }) => code),
    };
  });

  fastify.get("/reference/calendar/next-operating-day", {
    schema: {
      querystring: {
        type: "object",
        additionalProperties: false,
        properties: {
          after: { type: "string", format: "date", pattern: DATE_ONLY },
        },
      },
      response: {
        200: {
          type: "object",
          additionalProperties: false,
          required: ["date"],
          properties: {
            date: { type: "string", format: "date", pattern: DATE_ONLY },
          },
        },
      },
    },
  }, async (request) => {
    request.requireRole();
    const { after } = request.query as { after?: string };
    const date = await nextOperatingDate(fromDateOnly(after ?? todayInColombo()));

    if (!date) {
      throw new Error("No future operating day is present in the calendar.");
    }

    return { date: toDateOnly(date) };
  });
}
