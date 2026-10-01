import type { FastifyInstance } from "fastify";
import type { OrderStatus } from "@prisma/client";
import { prisma } from "../lib/db.js";
import type { SessionUser } from "../lib/auth.js";

/**
 * Owner: BE2
 *
 * Read side is live and backed by the real database. The two write endpoints
 * below (POST /orders, PUT /orders/{orderId}/receipt) are still stubs —
 * writing them means new service functions, Prisma transactions, and
 * idempotency work that belongs in a follow-up slice. The Prism mock on
 * :4010 keeps the web and mobile write paths unblocked in the meantime.
 */
const NOT_IMPLEMENTED = {
  error: {
    code: "NOT_IMPLEMENTED",
    message: "Not built yet. Use the Prism mock on :4010 for this endpoint.",
  },
} as const;

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

const ORDER_RESPONSE_ITEM = {
  type: "object",
  additionalProperties: false,
  required: [
    "id",
    "ref",
    "outletId",
    "brand",
    "districtName",
    "tempRequirement",
    "units",
    "weightKg",
    "volumeM3",
    "windowOpen",
    "windowClose",
    "requestedDate",
    "status",
    "storeState",
  ],
  properties: {
    id: { type: "string" },
    ref: { type: "string" },
    outletId: { type: "string" },
    brand: { type: "string", enum: ["Fresh", "Style", "Tech"] },
    districtName: { type: "string" },
    tempRequirement: { type: "string", enum: ["chilled", "ambient"] },
    units: { type: "integer" },
    weightKg: { type: "number" },
    volumeM3: { type: "number" },
    windowOpen: { type: "string", pattern: "^([01]\\d|2[0-3]):[0-5]\\d$" },
    windowClose: { type: "string", pattern: "^([01]\\d|2[0-3]):[0-5]\\d$" },
    requestedDate: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
    status: {
      type: "string",
      enum: [
        "DRAFT",
        "PLACED",
        "QUEUED",
        "PLANNED",
        "LOADED",
        "IN_TRANSIT",
        "DELIVERED",
        "PART_DELIVERED",
        "FAILED",
        "DEFERRED",
        "CANCELLED",
      ],
    },
    storeState: {
      type: "string",
      enum: ["queued", "planned", "on_the_way", "delivered", "deferred", "cancelled"],
    },
  },
} as const;

type StoreState = "queued" | "planned" | "on_the_way" | "delivered" | "deferred" | "cancelled";

// Mirrors services/store.ts' own stateOf() so a dispatcher querying this
// endpoint sees the same value a store manager would see on their phone —
// one truth per order, not two.
function storeStateOf(
  status: OrderStatus,
  hasPublishedTrip: boolean,
  departed: boolean,
): StoreState {
  if (status === "DEFERRED") return "deferred";
  if (status === "CANCELLED") return "cancelled";
  if (status === "DELIVERED" || status === "PART_DELIVERED") return "delivered";
  if (departed) return "on_the_way";
  if (hasPublishedTrip) return "planned";
  return "queued";
}

type OrderWithTripLinkage = Awaited<ReturnType<typeof fetchOrdersFor>>[number];

async function fetchOrdersFor(user: SessionUser, args: { date?: Date }) {
  const where: Record<string, unknown> = {};
  if (user.role === "STORE_MANAGER") {
    if (!user.outletId) return [];
    where.outletId = user.outletId;
  } else {
    if (!user.depotCode) return [];
    where.depotCode = user.depotCode;
  }
  if (args.date) where.requestedDate = args.date;

  return prisma.order.findMany({
    where,
    orderBy: [{ requestedDate: "desc" }, { ref: "asc" }],
    take: 100,
    include: {
      assignments: {
        select: {
          plan: { select: { status: true } },
          tripStop: { select: { trip: { select: { status: true } } } },
        },
      },
    },
  });
}

function toOrderResponse(order: OrderWithTripLinkage) {
  const published = order.assignments.find((a) => a.plan.status === "PUBLISHED");
  const tripStatus = published?.tripStop?.trip?.status ?? null;
  const departed = tripStatus === "DEPARTED" || tripStatus === "COMPLETED";
  return {
    id: order.id,
    ref: order.ref,
    outletId: order.outletId,
    brand: order.brand,
    districtName: order.districtName,
    tempRequirement: order.tempRequirement,
    units: order.units,
    weightKg: order.weightKg,
    volumeM3: order.volumeM3,
    windowOpen: order.windowOpen,
    windowClose: order.windowClose,
    requestedDate: order.requestedDate.toISOString().slice(0, 10),
    status: order.status,
    storeState: storeStateOf(order.status, Boolean(published), departed),
  };
}

function parseDate(value: unknown): Date | undefined {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  return new Date(`${value}T00:00:00.000Z`);
}

export default async function (fastify: FastifyInstance) {
  fastify.get(
    "/orders",
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
          200: { type: "array", items: ORDER_RESPONSE_ITEM },
        },
      },
    },
    async (request) => {
      const user = request.requireRole("STORE_MANAGER", "DISPATCHER");
      const query = request.query as { date?: string };
      const date = parseDate(query.date);
      const orders = await fetchOrdersFor(user, { date });
      return orders.map(toOrderResponse);
    },
  );

  fastify.get(
    "/orders/:orderId",
    {
      schema: {
        params: {
          type: "object",
          required: ["orderId"],
          properties: { orderId: { type: "string", minLength: 1 } },
        },
        response: {
          200: ORDER_RESPONSE_ITEM,
          404: ERROR_RESPONSE,
        },
      },
    },
    async (request, reply) => {
      const user = request.requireRole("STORE_MANAGER", "DISPATCHER");
      const { orderId } = request.params as { orderId: string };

      const where: Record<string, unknown> = { id: orderId };
      if (user.role === "STORE_MANAGER") {
        if (!user.outletId) return reply.status(404).send({ error: { code: "NOT_FOUND", message: "Order not found." } });
        where.outletId = user.outletId;
      } else {
        if (!user.depotCode) return reply.status(404).send({ error: { code: "NOT_FOUND", message: "Order not found." } });
        where.depotCode = user.depotCode;
      }

      const order = await prisma.order.findFirst({
        where,
        include: {
          assignments: {
            select: {
              plan: { select: { status: true } },
              tripStop: { select: { trip: { select: { status: true } } } },
            },
          },
        },
      });
      if (!order) {
        return reply.status(404).send({ error: { code: "NOT_FOUND", message: "Order not found." } });
      }
      return toOrderResponse(order);
    },
  );

  fastify.post("/orders", async (_req, reply) => reply.status(501).send(NOT_IMPLEMENTED));
  fastify.put("/orders/:orderId/receipt", async (_req, reply) => reply.status(501).send(NOT_IMPLEMENTED));
}
