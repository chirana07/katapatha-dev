import type { FastifyInstance } from "fastify";
import { requireDispatcherVehicle } from "../lib/authorization.js";
import { loadFleetDay, loadFleetPositions, loadVehicleDetail } from "../services/vehicles.js";

/**
 * Owner: Slice V
 *
 * The dispatcher's view of the fleet: the day's vehicle list, one vehicle, and
 * the schematic map. A dispatcher is scoped to their own depot — the Vehicles
 * design shows both depots in its filter, but the product's rule is one
 * dispatcher, one depot, so another depot's vehicles are simply not here.
 *
 * Everything position-shaped is "last reported by the driver's phone, with its
 * age"; nothing here is a live feed (DOMAIN.md, "What the product may claim,
 * and how"). The existing availability write surface stays in routes/fleet.ts.
 */

const DATE_ONLY = "^\\d{4}-\\d{2}-\\d{2}$";
const CLOCK = "^([01]\\d|2[0-3]):[0-5]\\d$";

const nullable = (schema: object) => ({ oneOf: [schema, { type: "null" }] });

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

const DATE_QUERY = {
  type: "object",
  additionalProperties: false,
  properties: { date: { type: "string", pattern: DATE_ONLY } },
} as const;

const VEHICLE_STATE = { type: "string", enum: ["AVAILABLE", "LOADING", "ON_ROUTE", "RETURNED", "IN_WORKSHOP"] } as const;

const VEHICLE_ROW_PROPERTIES = {
  vehicleId: { type: "string" },
  type: { type: "string", enum: ["truck", "van"] },
  temp: { type: "string", enum: ["reefer", "ambient"] },
  depotCode: { type: "string" },
  volumeCapM3: { type: "number" },
  weightCapKg: { type: "number" },
  driverName: nullable({ type: "string" }),
  tripsToday: { type: "integer", minimum: 0 },
  utilisationPct: { type: "integer", minimum: 0, maximum: 100 },
  status: VEHICLE_STATE,
  note: nullable({ type: "string" }),
} as const;

const VEHICLE_ROW_REQUIRED = [
  "vehicleId",
  "type",
  "temp",
  "depotCode",
  "volumeCapM3",
  "weightCapKg",
  "driverName",
  "tripsToday",
  "utilisationPct",
  "status",
  "note",
] as const;

const VEHICLE_ROW = {
  type: "object",
  additionalProperties: false,
  required: VEHICLE_ROW_REQUIRED,
  properties: VEHICLE_ROW_PROPERTIES,
} as const;

const FLEET_SUMMARY = {
  type: "object",
  additionalProperties: false,
  required: ["total", "refrigerated", "ambient", "available", "idle", "onRoute", "loading", "returned", "inWorkshop"],
  properties: {
    total: { type: "integer" },
    refrigerated: { type: "integer" },
    ambient: { type: "integer" },
    available: { type: "integer" },
    idle: { type: "integer" },
    onRoute: { type: "integer" },
    loading: { type: "integer" },
    returned: { type: "integer" },
    inWorkshop: { type: "integer" },
  },
} as const;

const VEHICLE_LIST = {
  type: "object",
  additionalProperties: false,
  required: ["date", "depotCode", "summary", "vehicles"],
  properties: {
    date: { type: "string", pattern: DATE_ONLY },
    depotCode: { type: "string" },
    summary: FLEET_SUMMARY,
    vehicles: { type: "array", items: VEHICLE_ROW },
  },
} as const;

const POSITION = {
  type: "object",
  additionalProperties: false,
  required: ["lat", "lng", "accuracyM", "recordedAt", "ageSeconds", "lamp"],
  properties: {
    lat: { type: "number" },
    lng: { type: "number" },
    accuracyM: nullable({ type: "number" }),
    recordedAt: { type: "string" },
    ageSeconds: { type: "integer", minimum: 0 },
    lamp: { type: "boolean" },
  },
} as const;

const CHILLER = {
  type: "object",
  additionalProperties: false,
  required: ["tempC", "targetMinC", "targetMaxC", "inRange", "source", "recordedByName", "recordedAt", "ageSeconds"],
  properties: {
    tempC: { type: "number" },
    targetMinC: { type: "number" },
    targetMaxC: { type: "number" },
    inRange: { type: "boolean" },
    source: { type: "string", enum: ["LOADER_AT_BAY", "DRIVER_ON_ARRIVAL"] },
    recordedByName: nullable({ type: "string" }),
    recordedAt: { type: "string" },
    ageSeconds: { type: "integer", minimum: 0 },
  },
} as const;

const VEHICLE_TRIP = {
  type: "object",
  additionalProperties: false,
  required: ["tripId", "tripNo", "route", "plannedDepartAt", "stops", "orders", "status", "wave"],
  properties: {
    tripId: { type: "string" },
    tripNo: { type: "integer" },
    route: { type: "string" },
    plannedDepartAt: { type: "string", pattern: CLOCK },
    stops: { type: "integer" },
    orders: { type: "integer" },
    status: { type: "string", enum: ["PLANNED", "LOADING", "READY", "DEPARTED", "COMPLETED", "CANCELLED"] },
    wave: { type: "string", enum: ["PREDAWN", "DAYTIME"] },
  },
} as const;

const VEHICLE_DETAIL = {
  type: "object",
  additionalProperties: false,
  required: ["date", ...VEHICLE_ROW_REQUIRED, "trips", "chiller", "position"],
  properties: {
    date: { type: "string", pattern: DATE_ONLY },
    ...VEHICLE_ROW_PROPERTIES,
    trips: { type: "array", items: VEHICLE_TRIP },
    chiller: nullable(CHILLER),
    position: nullable(POSITION),
  },
} as const;

const NEXT_STOP = {
  type: "object",
  additionalProperties: false,
  required: [
    "outletId",
    "outletName",
    "stopNumber",
    "totalStops",
    "deliveredStops",
    "eta",
    "windowOpen",
    "windowClose",
  ],
  properties: {
    outletId: { type: "string" },
    outletName: { type: "string" },
    stopNumber: { type: "integer", minimum: 1 },
    totalStops: { type: "integer", minimum: 1 },
    deliveredStops: { type: "integer", minimum: 0 },
    eta: { type: "string", pattern: CLOCK },
    windowOpen: { type: "string", pattern: CLOCK },
    windowClose: { type: "string", pattern: CLOCK },
  },
} as const;

const MAP_VEHICLE = {
  type: "object",
  additionalProperties: false,
  required: ["vehicleId", "driverName", "state", "lateMinutes", "trip", "position", "nextStop"],
  properties: {
    vehicleId: { type: "string" },
    driverName: nullable({ type: "string" }),
    state: { type: "string", enum: ["ON_TIME", "LATE", "RETURNING", "LAMP", "NOT_STARTED"] },
    lateMinutes: { type: "integer", minimum: 0 },
    trip: {
      type: "object",
      additionalProperties: false,
      required: ["tripId", "tripNo", "districtName"],
      properties: {
        tripId: { type: "string" },
        tripNo: { type: "integer" },
        districtName: { type: "string" },
      },
    },
    position: nullable(POSITION),
    nextStop: nullable(NEXT_STOP),
  },
} as const;

const FLEET_POSITIONS = {
  type: "object",
  additionalProperties: false,
  required: ["date", "depotCode", "updatedAt", "summary", "vehicles"],
  properties: {
    date: { type: "string", pattern: DATE_ONLY },
    depotCode: { type: "string" },
    updatedAt: { type: "string" },
    summary: {
      type: "object",
      additionalProperties: false,
      required: ["all", "late", "lamp"],
      properties: { all: { type: "integer" }, late: { type: "integer" }, lamp: { type: "integer" } },
    },
    vehicles: { type: "array", items: MAP_VEHICLE },
  },
} as const;

/** "Today" is the Colombo calendar day, whatever the server's own clock says. */
function todayInColombo(now: Date): string {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: "Asia/Colombo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const value = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${value.year}-${value.month}-${value.day}`;
}

function asDate(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

export default async function (fastify: FastifyInstance) {
  fastify.get(
    "/vehicles",
    {
      schema: {
        querystring: DATE_QUERY,
        response: { 200: VEHICLE_LIST, 403: ERROR_RESPONSE },
      },
    },
    async (request) => {
      const user = request.requireRole("DISPATCHER");
      const { date } = request.query as { date?: string };
      const day = date ?? todayInColombo(new Date());
      const fleet = await loadFleetDay(user.depotCode ?? "", asDate(day));
      return { date: day, ...fleet };
    },
  );

  fastify.get(
    "/vehicles/:vehicleId",
    {
      schema: {
        params: {
          type: "object",
          required: ["vehicleId"],
          properties: { vehicleId: { type: "string", minLength: 1 } },
        },
        querystring: DATE_QUERY,
        response: { 200: VEHICLE_DETAIL, 403: ERROR_RESPONSE },
      },
    },
    async (request) => {
      const user = request.requireRole("DISPATCHER");
      const { vehicleId } = request.params as { vehicleId: string };
      const { date } = request.query as { date?: string };
      // A vehicle at another depot answers 403 exactly as one that does not
      // exist, so the endpoint cannot be used to probe the other depot's fleet.
      const vehicle = await requireDispatcherVehicle(user, vehicleId);
      const now = new Date();
      const day = date ?? todayInColombo(now);
      return { date: day, ...(await loadVehicleDetail(vehicle, asDate(day), now)) };
    },
  );

  fastify.get(
    "/fleet/positions",
    {
      schema: {
        querystring: DATE_QUERY,
        response: { 200: FLEET_POSITIONS, 403: ERROR_RESPONSE },
      },
    },
    async (request) => {
      const user = request.requireRole("DISPATCHER");
      const { date } = request.query as { date?: string };
      const now = new Date();
      return loadFleetPositions(user.depotCode ?? "", asDate(date ?? todayInColombo(now)), now);
    },
  );
}
