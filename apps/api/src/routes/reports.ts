import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { AuthError, type SessionUser } from "../lib/auth.js";
import { loadCapacityForecast } from "../services/capacity.js";
import { addDays, parseIsoDate } from "../services/forecast.js";
import {
  MAX_RANGE_DAYS,
  buildDeliveries,
  buildExceptions,
  buildFleet,
  buildOutlets,
  buildOverview,
  loadProvenance,
  loadReportContext,
  loadWindowData,
  previousWindow,
  resolveRange,
  windowOf,
  type OutletSort,
} from "../services/reports.js";

/**
 * Owner: BE3
 *
 * Reports for the dispatcher's own depot. The design shows every depot; a
 * dispatcher is scoped to one, so these answer for that depot only, and a
 * `depot` parameter naming any other is a 403, not a wider answer.
 *
 * Not built, deliberately: "scheduled reports" (there is no scheduler) and an
 * export endpoint (the client builds a CSV from this JSON, which is already
 * everything on screen).
 *
 * How live and historical days merge, what "on time" means, and which figures
 * are null with a note rather than a guess are documented in
 * `services/reports.ts`; the contract descriptions repeat the parts a client
 * needs.
 */

const DATE_ONLY = "^\\d{4}-\\d{2}-\\d{2}$";

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
const NULLABLE_NUMBER = { oneOf: [{ type: "number" }, { type: "null" }] } as const;
const NULLABLE_INTEGER = { oneOf: [{ type: "integer" }, { type: "null" }] } as const;
const BRAND = { type: "string", enum: ["Fresh", "Style", "Tech"] } as const;
const NULLABLE_BRAND = { oneOf: [BRAND, { type: "null" }] } as const;
const DATE = { type: "string", pattern: DATE_ONLY } as const;
const SOURCE = { type: "string", enum: ["live", "history"] } as const;
const DAY_SOURCE = { type: "string", enum: ["live", "history", "none"] } as const;

const obj = (required: string[], properties: Record<string, unknown>) =>
  ({ type: "object", additionalProperties: false, required, properties }) as const;

const HEADER = {
  depotCode: { type: "string" },
  from: DATE,
  to: DATE,
  historySource: obj(["kind", "label"], {
    kind: { type: "string", enum: ["synthetic", "competition", "unknown"] },
    label: { type: "string" },
  }),
  coverage: obj(["liveDays", "historyDays", "emptyDays"], {
    liveDays: { type: "integer" },
    historyDays: { type: "integer" },
    emptyDays: { type: "integer" },
  }),
};
const HEADER_REQUIRED = ["depotCode", "from", "to", "historySource", "coverage"];

const NOTES = { type: "array", items: { type: "string" } } as const;

const EXCEPTION_COUNT = obj(["kind", "label", "count"], {
  kind: { type: "string" },
  label: { type: "string" },
  count: { type: "integer" },
});

const OUTLET_ROW = obj(
  ["outletId", "displayName", "districtName", "brand", "stops", "orders", "onTimePct", "late", "discrepancies", "avgArrivalDeltaMin"],
  {
    outletId: { type: "string" },
    displayName: NULLABLE_STRING,
    districtName: NULLABLE_STRING,
    brand: NULLABLE_BRAND,
    stops: { type: "integer" },
    orders: NULLABLE_INTEGER,
    onTimePct: NULLABLE_NUMBER,
    late: { type: "integer" },
    discrepancies: NULLABLE_INTEGER,
    avgArrivalDeltaMin: NULLABLE_INTEGER,
  },
);

const OVERVIEW = obj(
  [...HEADER_REQUIRED, "onTime", "orders", "utilisation", "discrepancies", "onTimeSeries", "utilisationByDepot", "topOutlets", "totalOutlets", "topExceptions"],
  {
    ...HEADER,
    onTime: obj(["pct", "onTime", "total", "targetPct", "vsPreviousPts", "note"], {
      pct: NULLABLE_NUMBER,
      onTime: { type: "integer" },
      total: { type: "integer" },
      targetPct: { type: "number" },
      vsPreviousPts: NULLABLE_NUMBER,
      note: NULLABLE_STRING,
    }),
    orders: obj(["planned", "delivered", "deferred", "undelivered", "note"], {
      planned: { type: "integer" },
      delivered: { type: "integer" },
      deferred: { type: "integer" },
      undelivered: { type: "integer" },
      note: NULLABLE_STRING,
    }),
    utilisation: obj(["pct", "targetPct", "vehicles", "trips", "note"], {
      pct: NULLABLE_INTEGER,
      targetPct: { type: "number" },
      vehicles: { type: "integer" },
      trips: { type: "integer" },
      note: NULLABLE_STRING,
    }),
    discrepancies: obj(["count", "pctOfOrders", "vsPrevious", "note"], {
      count: NULLABLE_INTEGER,
      pctOfOrders: NULLABLE_NUMBER,
      vsPrevious: NULLABLE_INTEGER,
      note: NULLABLE_STRING,
    }),
    onTimeSeries: {
      type: "array",
      items: obj(["date", "source", "onTimePct", "onTime", "total"], {
        date: DATE,
        source: DAY_SOURCE,
        onTimePct: NULLABLE_NUMBER,
        onTime: { type: "integer" },
        total: { type: "integer" },
      }),
    },
    utilisationByDepot: {
      type: "array",
      items: obj(["depotCode", "vehicles", "utilisationPct", "targetPct"], {
        depotCode: { type: "string" },
        vehicles: { type: "integer" },
        utilisationPct: NULLABLE_INTEGER,
        targetPct: { type: "number" },
      }),
    },
    topOutlets: { type: "array", items: OUTLET_ROW },
    totalOutlets: { type: "integer" },
    topExceptions: obj(["total", "items"], {
      total: { type: "integer" },
      items: { type: "array", items: EXCEPTION_COUNT },
    }),
  },
);

const DEMAND_COUNTS = {
  planned: { type: "integer" },
  delivered: { type: "integer" },
  deferred: { type: "integer" },
  undelivered: { type: "integer" },
};

const DELIVERIES = obj([...HEADER_REQUIRED, "totals", "days", "byBrand", "notes"], {
  ...HEADER,
  totals: obj(["planned", "delivered", "deferred", "undelivered", "stops", "onTimePct", "avgArrivalDeltaMin"], {
    ...DEMAND_COUNTS,
    stops: { type: "integer" },
    onTimePct: NULLABLE_NUMBER,
    avgArrivalDeltaMin: NULLABLE_INTEGER,
  }),
  days: {
    type: "array",
    items: obj(["date", "source", "planned", "delivered", "deferred", "undelivered", "stops", "onTime", "onTimePct"], {
      date: DATE,
      source: DAY_SOURCE,
      ...DEMAND_COUNTS,
      stops: { type: "integer" },
      onTime: { type: "integer" },
      onTimePct: NULLABLE_NUMBER,
    }),
  },
  byBrand: {
    type: "array",
    items: obj(["brand", "planned", "delivered", "deferred", "undelivered", "stops", "onTimePct", "avgArrivalDeltaMin"], {
      brand: BRAND,
      ...DEMAND_COUNTS,
      stops: { type: "integer" },
      onTimePct: NULLABLE_NUMBER,
      avgArrivalDeltaMin: NULLABLE_INTEGER,
    }),
  },
  notes: NOTES,
});

const FLEET = obj([...HEADER_REQUIRED, "utilisation", "vehicles", "byTemp", "notes"], {
  ...HEADER,
  utilisation: obj(["pct", "targetPct", "note"], { pct: NULLABLE_INTEGER, targetPct: { type: "number" }, note: NULLABLE_STRING }),
  vehicles: {
    type: "array",
    items: obj(["vehicleId", "type", "temp", "volumeCapM3", "trips", "stops", "onTimePct", "avgLoadPct", "workshopDays"], {
      vehicleId: { type: "string" },
      type: { type: "string", enum: ["truck", "van"] },
      temp: { type: "string", enum: ["reefer", "ambient"] },
      volumeCapM3: { type: "number" },
      trips: { type: "integer" },
      stops: { type: "integer" },
      onTimePct: NULLABLE_NUMBER,
      avgLoadPct: NULLABLE_INTEGER,
      workshopDays: { type: "integer" },
    }),
  },
  byTemp: {
    type: "array",
    items: obj(["temp", "vehicles", "trips", "avgLoadPct"], {
      temp: { type: "string", enum: ["reefer", "ambient"] },
      vehicles: { type: "integer" },
      trips: { type: "integer" },
      avgLoadPct: NULLABLE_INTEGER,
    }),
  },
  notes: NOTES,
});

const OUTLETS = obj([...HEADER_REQUIRED, "sort", "outlets", "notes"], {
  ...HEADER,
  sort: { type: "string", enum: ["stops", "onTime", "discrepancies"] },
  outlets: { type: "array", items: OUTLET_ROW },
  notes: NOTES,
});

const EXCEPTIONS = obj([...HEADER_REQUIRED, "total", "byKind", "byDay", "recent", "notes"], {
  ...HEADER,
  total: { type: "integer" },
  byKind: { type: "array", items: EXCEPTION_COUNT },
  byDay: { type: "array", items: obj(["date", "count"], { date: DATE, count: { type: "integer" } }) },
  recent: {
    type: "array",
    items: obj(["kind", "label", "date", "source", "at", "orderRef", "outletId", "note"], {
      kind: { type: "string" },
      label: { type: "string" },
      date: DATE,
      source: SOURCE,
      at: NULLABLE_STRING,
      orderRef: NULLABLE_STRING,
      outletId: NULLABLE_STRING,
      note: NULLABLE_STRING,
    }),
  },
  notes: NOTES,
});

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
    brand: NULLABLE_BRAND,
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
    appliesFromDate: { oneOf: [DATE, { type: "null" }] },
    createdAt: { type: "string" },
  },
);

const WEEK_REF = {
  isoYear: { type: "integer" },
  isoWeek: { type: "integer" },
  startDate: DATE,
  endDate: DATE,
};

const CAPACITY_FORECAST = obj(
  [
    "depotCode", "brand", "from", "to", "forecastMethod", "forecastGeneratedAt", "historySource", "weeks", "reeferCount",
    "fleetCapacityM3", "reeferCapacityM3", "loadPerReeferTripM3", "peakWeek", "chilledPeak", "reeferShortfallWeeks",
    "forecastError", "forecastErrorPct", "recommendedActions", "assumptions",
  ],
  {
    depotCode: { type: "string" },
    brand: NULLABLE_BRAND,
    from: { oneOf: [DATE, { type: "null" }] },
    to: { oneOf: [DATE, { type: "null" }] },
    forecastMethod: NULLABLE_STRING,
    forecastGeneratedAt: NULLABLE_STRING,
    historySource: HEADER.historySource,
    weeks: {
      type: "array",
      items: obj(
        [
          "isoYear", "isoWeek", "startDate", "endDate", "kind", "signals", "operatingDays", "totalM3", "chilledM3", "ambientM3",
          "reeferTripsPerDay", "reefersInWorkshop", "chilledCapacityM3", "fleetCapacityM3", "level", "action", "actions",
        ],
        {
          ...WEEK_REF,
          kind: { type: "string", enum: ["actual", "forecast"] },
          signals: { type: "array", items: { type: "string" } },
          operatingDays: { type: "integer" },
          totalM3: { type: "number" },
          chilledM3: { type: "number" },
          ambientM3: { type: "number" },
          reeferTripsPerDay: obj(["needed", "capacity", "shortfall"], {
            needed: { type: "integer" },
            capacity: { type: "integer" },
            shortfall: { type: "integer" },
          }),
          reefersInWorkshop: { type: "integer" },
          chilledCapacityM3: { type: "number" },
          fleetCapacityM3: { type: "number" },
          level: { type: "string", enum: ["ok", "near", "over"] },
          action: { type: "string" },
          actions: {
            type: "array",
            items: obj(["id", "kind", "status"], {
              id: { type: "string" },
              kind: { type: "string" },
              status: { type: "string", enum: ["PROPOSED", "APPROVED", "APPLIED", "REJECTED"] },
            }),
          },
        },
      ),
    },
    reeferCount: { type: "integer" },
    fleetCapacityM3: { type: "number" },
    reeferCapacityM3: { type: "number" },
    loadPerReeferTripM3: { type: "number" },
    peakWeek: {
      oneOf: [
        obj(["isoYear", "isoWeek", "startDate", "endDate", "totalM3", "signals", "vsRecentPct"], {
          ...WEEK_REF,
          totalM3: { type: "number" },
          signals: { type: "array", items: { type: "string" } },
          vsRecentPct: NULLABLE_INTEGER,
        }),
        { type: "null" },
      ],
    },
    chilledPeak: {
      oneOf: [
        obj(["isoYear", "isoWeek", "startDate", "endDate", "chilledM3", "vsRecentPct"], {
          ...WEEK_REF,
          chilledM3: { type: "number" },
          vsRecentPct: NULLABLE_INTEGER,
        }),
        { type: "null" },
      ],
    },
    reeferShortfallWeeks: obj(["count", "of", "maxTripsPerDayShort"], {
      count: { type: "integer" },
      of: { type: "integer" },
      maxTripsPerDayShort: { type: "integer" },
    }),
    forecastError: obj(["mapePct", "chilledMapePct", "weeksTested", "leadWeeks", "note"], {
      mapePct: NULLABLE_NUMBER,
      chilledMapePct: NULLABLE_NUMBER,
      weeksTested: { type: "integer" },
      leadWeeks: { type: "integer" },
      note: { type: "string" },
    }),
    forecastErrorPct: NULLABLE_NUMBER,
    recommendedActions: { type: "array", items: ACTION_ITEM },
    assumptions: { type: "array", items: { type: "string" } },
  },
);

const RANGE_QUERY = {
  from: DATE,
  to: DATE,
  depot: { type: "string", minLength: 1 },
};

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

const isRealDate = (d: string): boolean => !Number.isNaN(parseIsoDate(d).getTime()) && parseIsoDate(d).toISOString().slice(0, 10) === d;

function invalid(reply: FastifyReply, message: string) {
  return reply.status(422).send({ error: { code: "VALIDATION_FAILED", message } });
}

/**
 * The depot a caller may ask about: their own. A `depot` parameter is accepted
 * so a client written for "all depots" gets a clear 403 rather than a quietly
 * narrower answer.
 */
function scopeOf(request: FastifyRequest): { user: SessionUser; depotCode: string; depot?: string } {
  const user = request.requireRole("DISPATCHER");
  const { depot } = request.query as { depot?: string };
  if (!user.depotCode || (depot !== undefined && depot !== user.depotCode)) {
    throw new AuthError("You can only see reports for your own depot", 403);
  }
  return { user, depotCode: user.depotCode, depot };
}

/** Resolve and validate the range; null means a 422 was already sent. */
async function rangeOf(request: FastifyRequest, reply: FastifyReply, depotCode: string) {
  const { from, to } = request.query as { from?: string; to?: string };
  if ((from && !isRealDate(from)) || (to && !isRealDate(to))) {
    invalid(reply, "from and to must be real calendar dates (YYYY-MM-DD).");
    return null;
  }
  const range = await resolveRange(depotCode, todayInColombo(), from, to);
  if (range.from > range.to) {
    invalid(reply, "from must not be after to.");
    return null;
  }
  const days = Math.round((parseIsoDate(range.to).getTime() - parseIsoDate(range.from).getTime()) / 86_400_000) + 1;
  if (days > MAX_RANGE_DAYS) {
    invalid(reply, `A report covers at most ${MAX_RANGE_DAYS} days.`);
    return null;
  }
  return range;
}

export default async function (fastify: FastifyInstance) {
  fastify.get(
    "/reports/overview",
    {
      schema: {
        querystring: obj([], RANGE_QUERY),
        response: { 200: OVERVIEW, 403: ERROR_RESPONSE, 422: ERROR_RESPONSE },
      },
    },
    async (request, reply) => {
      const { depotCode } = scopeOf(request);
      const range = await rangeOf(request, reply, depotCode);
      if (!range) return reply;
      const window = windowOf(range.from, range.to);
      const [cur, prev, ctx] = await Promise.all([
        loadWindowData(depotCode, window),
        loadWindowData(depotCode, previousWindow(window)),
        loadReportContext(depotCode, window),
      ]);
      return buildOverview(cur, prev, ctx);
    },
  );

  fastify.get(
    "/reports/deliveries",
    {
      schema: { querystring: obj([], RANGE_QUERY), response: { 200: DELIVERIES, 403: ERROR_RESPONSE, 422: ERROR_RESPONSE } },
    },
    async (request, reply) => {
      const { depotCode } = scopeOf(request);
      const range = await rangeOf(request, reply, depotCode);
      if (!range) return reply;
      const window = windowOf(range.from, range.to);
      const [data, ctx] = await Promise.all([loadWindowData(depotCode, window), loadReportContext(depotCode, window)]);
      return buildDeliveries(data, ctx);
    },
  );

  fastify.get(
    "/reports/fleet",
    {
      schema: { querystring: obj([], RANGE_QUERY), response: { 200: FLEET, 403: ERROR_RESPONSE, 422: ERROR_RESPONSE } },
    },
    async (request, reply) => {
      const { depotCode } = scopeOf(request);
      const range = await rangeOf(request, reply, depotCode);
      if (!range) return reply;
      const window = windowOf(range.from, range.to);
      const [data, ctx] = await Promise.all([loadWindowData(depotCode, window), loadReportContext(depotCode, window)]);
      return buildFleet(data, ctx);
    },
  );

  fastify.get(
    "/reports/outlets",
    {
      schema: {
        querystring: obj([], { ...RANGE_QUERY, sort: { type: "string", enum: ["stops", "onTime", "discrepancies"] } }),
        response: { 200: OUTLETS, 403: ERROR_RESPONSE, 422: ERROR_RESPONSE },
      },
    },
    async (request, reply) => {
      const { depotCode } = scopeOf(request);
      const range = await rangeOf(request, reply, depotCode);
      if (!range) return reply;
      const sort = ((request.query as { sort?: OutletSort }).sort ?? "stops") as OutletSort;
      const window = windowOf(range.from, range.to);
      const [data, ctx] = await Promise.all([loadWindowData(depotCode, window), loadReportContext(depotCode, window)]);
      return buildOutlets(data, ctx, sort);
    },
  );

  fastify.get(
    "/reports/exceptions",
    {
      schema: { querystring: obj([], RANGE_QUERY), response: { 200: EXCEPTIONS, 403: ERROR_RESPONSE, 422: ERROR_RESPONSE } },
    },
    async (request, reply) => {
      const { depotCode } = scopeOf(request);
      const range = await rangeOf(request, reply, depotCode);
      if (!range) return reply;
      const window = windowOf(range.from, range.to);
      const [data, ctx] = await Promise.all([loadWindowData(depotCode, window), loadReportContext(depotCode, window)]);
      return buildExceptions(data, ctx);
    },
  );

  fastify.get(
    "/reports/capacity-forecast",
    {
      schema: {
        querystring: obj([], { ...RANGE_QUERY, brand: BRAND }),
        response: { 200: CAPACITY_FORECAST, 403: ERROR_RESPONSE, 422: ERROR_RESPONSE },
      },
    },
    async (request, reply) => {
      const { depotCode } = scopeOf(request);
      const { from, to, brand } = request.query as { from?: string; to?: string; brand?: "Fresh" | "Style" | "Tech" };
      if ((from && !isRealDate(from)) || (to && !isRealDate(to))) {
        return invalid(reply, "from and to must be real calendar dates (YYYY-MM-DD).");
      }
      if (from && to) {
        if (from > to) return invalid(reply, "from must not be after to.");
        if (addDays(from, 53 * 7) < to) return invalid(reply, "A capacity forecast covers at most 53 weeks.");
      }
      const [forecast, provenance] = await Promise.all([
        loadCapacityForecast(depotCode, { from, to, brand: brand ?? null }),
        loadProvenance(),
      ]);
      return { ...forecast, historySource: provenance };
    },
  );
}
