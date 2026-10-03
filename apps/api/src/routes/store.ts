import type { FastifyInstance } from "fastify";
import { positionFor } from "@katapatha/core/domain/geography";
import {
  accessNoteFor,
  loadIncomingDelivery,
  loadStoreOrders,
  type StoreOrderView,
} from "../services/store.js";
import { ORDER_ITEMS_SCHEMA } from "../services/products.js";
import { getWeather } from "../services/weather.js";

const CLOCK_TIME = "^([01]\\d|2[0-3]):[0-5]\\d$";
const DATE_ONLY = "^\\d{4}-\\d{2}-\\d{2}$";

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

const NULLABLE_CLOCK = { type: ["string", "null"], pattern: CLOCK_TIME } as const;

const STORE_ORDER = {
  type: "object",
  additionalProperties: false,
  required: ["id", "ref", "brand", "tempRequirement", "units", "requestedDate", "state", "receiptConfirmed"],
  properties: {
    id: { type: "string" },
    ref: { type: "string" },
    brand: { type: "string", enum: ["Fresh", "Style", "Tech"] },
    tempRequirement: { type: "string", enum: ["chilled", "ambient"] },
    units: { type: "integer" },
    volumeM3: { type: "number" },
    weightKg: { type: "number" },
    items: ORDER_ITEMS_SCHEMA,
    requestedDate: { type: "string", pattern: DATE_ONLY },
    state: {
      type: "string",
      enum: ["queued", "planned", "on_the_way", "delivered", "deferred", "cancelled"],
    },
    etaAt: NULLABLE_CLOCK,
    vehicleId: { type: ["string", "null"] },
    stopsBefore: { type: ["integer", "null"] },
    tripStopId: { type: ["string", "null"] },
    deliveredUnits: { type: ["integer", "null"] },
    receiptConfirmed: { type: "boolean" },
    deferral: {
      type: ["object", "null"],
      additionalProperties: false,
      required: ["reasonCode", "acknowledged"],
      properties: {
        reasonCode: { type: "string" },
        rolledToDate: { type: ["string", "null"], pattern: DATE_ONLY },
        acknowledged: { type: "boolean" },
      },
    },
  },
} as const;

const INCOMING_DELIVERY = {
  type: ["object", "null"],
  additionalProperties: false,
  required: [
    "orderId", "ref", "brand", "tempRequirement", "units", "vehicleId",
    "districtName", "depotCode", "stopsBefore", "legMinutes", "departed", "arrival", "steps",
  ],
  properties: {
    orderId: { type: "string" },
    ref: { type: "string" },
    brand: { type: "string", enum: ["Fresh", "Style", "Tech"] },
    tempRequirement: { type: "string", enum: ["chilled", "ambient"] },
    units: { type: "integer" },
    items: ORDER_ITEMS_SCHEMA,
    etaAt: NULLABLE_CLOCK,
    vehicleId: { type: "string" },
    districtName: { type: "string" },
    depotCode: { type: "string" },
    stopsBefore: { type: "integer" },
    legMinutes: { type: "integer" },
    minutesAway: { type: ["integer", "null"] },
    departed: { type: "boolean" },
    report: {
      type: ["object", "null"],
      additionalProperties: false,
      required: ["reportedAt", "ageSeconds", "lamp"],
      properties: {
        reportedAt: { type: "string" },
        ageSeconds: { type: "integer" },
        lamp: { type: "boolean" },
      },
    },
    arrival: {
      type: "object",
      additionalProperties: false,
      required: ["basis", "at", "from", "to"],
      properties: {
        basis: { type: "string", enum: ["plan", "report", "estimate"] },
        at: NULLABLE_CLOCK,
        from: NULLABLE_CLOCK,
        to: NULLABLE_CLOCK,
      },
    },
    steps: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["key", "label", "state"],
        properties: {
          key: { type: "string" },
          label: { type: "string" },
          detail: { type: ["string", "null"] },
          state: { type: "string", enum: ["done", "current", "todo"] },
        },
      },
    },
  },
} as const;

const STORE_TODAY = {
  type: "object",
  additionalProperties: false,
  required: [
    "outletId", "date", "receivingWindowOpen", "receivingWindowClose",
    "accessNote", "orders", "counts",
  ],
  properties: {
    outletId: { type: "string" },
    outletName: { type: "string" },
    brand: { type: "string", enum: ["Fresh", "Style", "Tech"] },
    date: { type: "string", pattern: DATE_ONLY },
    receivingWindowOpen: { type: "string", pattern: CLOCK_TIME },
    receivingWindowClose: { type: "string", pattern: CLOCK_TIME },
    accessNote: { type: "string" },
    incoming: INCOMING_DELIVERY,
    orders: { type: "array", items: STORE_ORDER },
    counts: {
      type: "object",
      additionalProperties: false,
      required: ["expected", "confirmed", "pending", "issues"],
      properties: {
        expected: { type: "integer" },
        confirmed: { type: "integer" },
        pending: { type: "integer" },
        issues: { type: "integer" },
      },
    },
    weather: {
      type: ["object", "null"],
      additionalProperties: false,
      required: ["place", "label", "kind", "live"],
      properties: {
        place: { type: "string" },
        temperatureC: { type: ["number", "null"] },
        label: { type: "string" },
        kind: { type: "string", enum: ["clear", "cloudy", "rain", "storm", "fog"] },
        live: { type: "boolean" },
        observedAt: { type: ["string", "null"] },
      },
    },
  },
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

/**
 * Owner: BE2
 *
 * The outlet's view of its own day.
 *
 * `loadStoreOrders` and `loadIncomingDelivery` in services/store.ts have
 * existed since the port and were never routed — the store console was
 * re-deriving a thinner version of both from GET /orders. This endpoint is
 * that read model, served.
 *
 * It is one request rather than four on purpose. The five-step tracker, "how
 * many stops before mine" and the countdown all derive from the same trip, so
 * fetching them separately lets a client render a delivery that is two stops
 * away and already delivered at the same time.
 */
export default async function (fastify: FastifyInstance) {
  fastify.get("/store/today", {
    schema: {
      querystring: {
        type: "object",
        additionalProperties: false,
        properties: { date: { type: "string", pattern: DATE_ONLY } },
      },
      response: { 200: STORE_TODAY, 401: ERROR_RESPONSE, 403: ERROR_RESPONSE },
    },
  }, async (request) => {
    const user = request.requireRole("STORE_MANAGER");
    const { date } = request.query as { date?: string };
    const day = date ?? todayInColombo();

    // A store manager is scoped to exactly one outlet, so there is no outlet
    // parameter to validate — the session is the scope.
    const outletId = user.outletId ?? "";
    const outlet = await fastify.prisma.outlet.findUnique({
      where: { id: outletId },
      select: {
        id: true,
        displayName: true,
        brand: true,
        districtName: true,
        dockType: true,
        parkingConstraint: true,
        windowOpen: true,
        windowClose: true,
        mallWindowOpen: true,
        mallWindowClose: true,
      },
    });

    if (!outlet) {
      // Not a 404: the caller is authenticated, their account is simply not
      // attached to an outlet, which is an operations problem rather than a
      // missing record.
      throw Object.assign(new Error("Your account is not assigned to an outlet."), { statusCode: 403 });
    }

    const all = await loadStoreOrders(outlet.id);
    const orders = all.filter((order) => order.requestedDate === day);

    const incoming = await firstIncoming(orders);
    const weather = await weatherFor(fastify, outlet.districtName, day);

    return {
      outletId: outlet.id,
      // A name the outlet has been given, else the brand and district — never
      // absent, so a client does not have to invent a heading.
      outletName: outlet.displayName ?? `${outlet.brand} ${outlet.districtName}`,
      brand: outlet.brand,
      date: day,
      // The mall window, where there is one, is the binding constraint: a mall
      // outlet cannot receive outside it however wide its own hours are.
      receivingWindowOpen: outlet.mallWindowOpen ?? outlet.windowOpen,
      receivingWindowClose: outlet.mallWindowClose ?? outlet.windowClose,
      accessNote: accessNoteFor(outlet),
      incoming,
      orders,
      counts: countsFor(orders, await openIssueOrderIds(fastify, orders)),
      weather,
    };
  });
}

/**
 * The delivery the outlet is waiting on right now.
 *
 * The first order that is on the road, else the first one planned. Deferred
 * and delivered orders are not "incoming" — they are outcomes, and the Today
 * screen shows them in the list below rather than in the tracker.
 */
async function firstIncoming(orders: StoreOrderView[]) {
  const candidate =
    orders.find((order) => order.state === "on_the_way") ??
    orders.find((order) => order.state === "planned");

  return candidate ? await loadIncomingDelivery(candidate) : null;
}

/**
 * Orders with a problem still open against them. The count was only "delivered
 * short" before, so an outlet that had reported damage saw zero issues.
 */
async function openIssueOrderIds(fastify: FastifyInstance, orders: StoreOrderView[]): Promise<Set<string>> {
  if (orders.length === 0) return new Set();
  const rows = await fastify.prisma.problem.findMany({
    where: { orderId: { in: orders.map((o) => o.id) }, status: { not: "RESOLVED" } },
    select: { orderId: true },
  });
  return new Set(rows.flatMap((r) => (r.orderId ? [r.orderId] : [])));
}

function countsFor(orders: StoreOrderView[], withOpenIssue: Set<string> = new Set()) {
  return {
    expected: orders.filter((order) => order.state === "planned" || order.state === "on_the_way").length,
    confirmed: orders.filter((order) => order.receiptConfirmed).length,
    // Delivered but not yet confirmed by the outlet — the one thing on this
    // screen that is the store manager's own action to take.
    pending: orders.filter((order) => order.state === "delivered" && !order.receiptConfirmed).length,
    issues: orders.filter(
      (order) =>
        withOpenIssue.has(order.id) ||
        (order.deliveredUnits !== null && order.deliveredUnits < order.units),
    ).length,
  };
}

/**
 * Weather is context, never input: nothing in the allocator reads it, and a
 * failed fetch falls back to the seeded calendar's monsoon flag with
 * `live: false` so the UI can say which it is showing.
 */
async function weatherFor(fastify: FastifyInstance, districtName: string, day: string) {
  const position = positionFor(districtName);
  if (!position) return null;

  const calendar = await fastify.prisma.calendarDay.findUnique({
    where: { date: new Date(`${day}T00:00:00.000Z`) },
    select: { monsoon: true },
  });

  return await getWeather(districtName, position.lat, position.lng, calendar?.monsoon ?? false);
}
