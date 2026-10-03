import type { FastifyInstance } from "fastify";
import {
  DEFERRAL_REASONS,
  PROBLEM_REASONS,
  SHORTFALL_REASONS,
  STORE_ISSUE_REASONS,
  STORE_PROBLEM_KINDS,
} from "@katapatha/core/domain/reasons";
import { nextOperatingDate } from "../services/store.js";

const DATE_ONLY = "^\\d{4}-\\d{2}-\\d{2}$";

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
      },
    });

    return outlets.map(({ displayName, ...outlet }) => ({
      ...outlet,
      ...(displayName === null ? {} : { displayName }),
    }));
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
