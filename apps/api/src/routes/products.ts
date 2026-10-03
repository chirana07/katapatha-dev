import type { FastifyInstance } from "fastify";
import type { Brand, Prisma, TempRequirement } from "@prisma/client";
import { prisma } from "../lib/db.js";
import { recordDecision } from "../lib/audit.js";
import { productSnapshot, toProductView, type ProductRow } from "../services/products.js";

/**
 * Owner: BE2
 *
 * The product catalogue. Anyone signed in may read it, shaped to what they may
 * order; only a dispatcher writes it. It is Waypoint-wide, not per depot, so
 * a dispatcher's depot plays no part here.
 *
 * Products are deactivated, never deleted: placed orders keep pointing at them.
 * There is no stock or price anywhere in this resource, on purpose.
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

const SKU_PATTERN = "^[A-Z0-9][A-Z0-9_-]{1,31}$";
const NULLABLE_BRAND = {
  oneOf: [{ type: "string", enum: ["Fresh", "Style", "Tech"] }, { type: "null" }],
} as const;
const TEMP = { type: "string", enum: ["chilled", "ambient"] } as const;

const PRODUCT = {
  type: "object",
  additionalProperties: false,
  required: [
    "id",
    "sku",
    "name",
    "brand",
    "tempRequirement",
    "unitLabel",
    "kgPerUnit",
    "m3PerUnit",
    "active",
    "sortOrder",
    "createdAt",
    "updatedAt",
  ],
  properties: {
    id: { type: "string" },
    sku: { type: "string" },
    name: { type: "string" },
    brand: NULLABLE_BRAND,
    tempRequirement: TEMP,
    unitLabel: { type: "string" },
    kgPerUnit: { type: "number" },
    m3PerUnit: { type: "number" },
    active: { type: "boolean" },
    sortOrder: { type: "integer" },
    createdAt: { type: "string", format: "date-time" },
    updatedAt: { type: "string", format: "date-time" },
  },
} as const;

const NAME = { type: "string", minLength: 2, maxLength: 120 } as const;
const UNIT_LABEL = { type: "string", minLength: 1, maxLength: 24 } as const;
const KG = { type: "number", exclusiveMinimum: 0, maximum: 1000 } as const;
const M3 = { type: "number", exclusiveMinimum: 0, maximum: 100 } as const;
const SORT_ORDER = { type: "integer", minimum: 0, maximum: 1000000 } as const;

const CREATE_BODY = {
  type: "object",
  additionalProperties: false,
  required: ["sku", "name", "tempRequirement", "unitLabel", "kgPerUnit", "m3PerUnit"],
  properties: {
    sku: { type: "string", pattern: SKU_PATTERN },
    name: NAME,
    brand: NULLABLE_BRAND,
    tempRequirement: TEMP,
    unitLabel: UNIT_LABEL,
    kgPerUnit: KG,
    m3PerUnit: M3,
    active: { type: "boolean" },
    sortOrder: SORT_ORDER,
  },
} as const;

// No `sku`, and additionalProperties:false: an attempt to change it is refused
// as a contract violation rather than ignored, so it cannot look like it worked.
const UPDATE_BODY = {
  type: "object",
  additionalProperties: false,
  minProperties: 1,
  properties: {
    name: NAME,
    brand: NULLABLE_BRAND,
    tempRequirement: TEMP,
    unitLabel: UNIT_LABEL,
    kgPerUnit: KG,
    m3PerUnit: M3,
    active: { type: "boolean" },
    sortOrder: SORT_ORDER,
  },
} as const;

type CreateBody = {
  sku: string;
  name: string;
  brand?: Brand | null;
  tempRequirement: TempRequirement;
  unitLabel: string;
  kgPerUnit: number;
  m3PerUnit: number;
  active?: boolean;
  sortOrder?: number;
};

type UpdateBody = Partial<Omit<CreateBody, "sku">>;

/** Prisma's unique-constraint error, matched on its code like the orders route does. */
function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === "P2002";
}

function invalid(message: string) {
  return { error: { code: "VALIDATION_FAILED", message } };
}

/** A SKU's stated step between neighbours when none is given: room to slot one in later. */
const SORT_STEP = 10;

export default async function (fastify: FastifyInstance) {
  fastify.get(
    "/products",
    {
      schema: {
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: {
            temp: TEMP,
            brand: { type: "string", enum: ["Fresh", "Style", "Tech"] },
            q: { type: "string", minLength: 1, maxLength: 80 },
            // A string, like every boolean query parameter here: coercion is off.
            includeInactive: { type: "string", enum: ["true", "false"] },
          },
        },
        response: {
          200: { type: "array", items: PRODUCT },
          401: ERROR_RESPONSE,
          403: ERROR_RESPONSE,
        },
      },
    },
    async (request, reply) => {
      const user = request.requireRole();
      const query = request.query as {
        temp?: TempRequirement;
        brand?: Brand;
        q?: string;
        includeInactive?: "true" | "false";
      };

      const includeInactive = query.includeInactive === "true";
      // Inactive products are the dispatcher's to manage. Refused rather than
      // quietly dropped, so a client that asks knows it is not being told.
      if (includeInactive && user.role !== "DISPATCHER") {
        return reply.status(403).send({
          error: { code: "FORBIDDEN", message: "Only a dispatcher can list inactive products." },
        });
      }

      const and: Prisma.ProductWhereInput[] = [];
      if (user.role === "STORE_MANAGER") {
        // The scope comes from the session's outlet, never the request: a store
        // sees its own brand's products and the every-brand ones, nothing else.
        const outlet = user.outletId
          ? await prisma.outlet.findUnique({ where: { id: user.outletId }, select: { brand: true } })
          : null;
        if (!outlet) {
          return reply.status(403).send({
            error: { code: "FORBIDDEN", message: "This account is not bound to an outlet." },
          });
        }
        and.push({ OR: [{ brand: null }, { brand: outlet.brand }] });
      }
      if (query.brand) and.push({ OR: [{ brand: null }, { brand: query.brand }] });
      if (query.q) {
        and.push({
          OR: [
            { name: { contains: query.q, mode: "insensitive" } },
            { sku: { contains: query.q, mode: "insensitive" } },
          ],
        });
      }

      const rows = await prisma.product.findMany({
        where: {
          ...(includeInactive ? {} : { active: true }),
          ...(query.temp ? { tempRequirement: query.temp } : {}),
          ...(and.length > 0 ? { AND: and } : {}),
        },
        orderBy: [{ sortOrder: "asc" }, { sku: "asc" }],
      });
      return rows.map(toProductView);
    },
  );

  fastify.post(
    "/products",
    {
      schema: {
        body: CREATE_BODY,
        response: {
          201: PRODUCT,
          401: ERROR_RESPONSE,
          403: ERROR_RESPONSE,
          409: ERROR_RESPONSE,
          422: ERROR_RESPONSE,
        },
      },
    },
    async (request, reply) => {
      const user = request.requireRole("DISPATCHER");
      const body = request.body as CreateBody;

      const name = body.name.trim();
      const unitLabel = body.unitLabel.trim();
      // The schema counts characters as sent; a name of spaces passes it.
      if (name.length < 2) return reply.status(422).send(invalid("A product name needs at least two characters."));
      if (unitLabel.length < 1) return reply.status(422).send(invalid("A product needs a unit label, such as bag or carton."));

      const taken = () =>
        reply.status(409).send({ error: { code: "SKU_TAKEN", message: `SKU ${body.sku} is already in use.` } });
      // A deactivated product still holds its SKU: order lines and people both refer to it.
      if (await prisma.product.findUnique({ where: { sku: body.sku }, select: { id: true } })) return taken();

      const sortOrder =
        body.sortOrder ??
        ((await prisma.product.aggregate({ _max: { sortOrder: true } }))._max.sortOrder ?? 0) + SORT_STEP;

      let created: ProductRow;
      try {
        created = await prisma.product.create({
          data: {
            sku: body.sku,
            name,
            brand: body.brand ?? null,
            tempRequirement: body.tempRequirement,
            unitLabel,
            kgPerUnit: body.kgPerUnit,
            m3PerUnit: body.m3PerUnit,
            active: body.active ?? true,
            sortOrder,
            createdByUserId: user.id,
          },
        });
      } catch (error) {
        // Two dispatchers adding the same SKU at once: the index decides.
        if (isUniqueViolation(error)) return taken();
        throw error;
      }

      await recordDecision({
        actor: user,
        action: "product.create",
        entityType: "Product",
        entityId: created.id,
        after: productSnapshot(created),
      });
      return reply.status(201).send(toProductView(created));
    },
  );

  fastify.patch(
    "/products/:productId",
    {
      schema: {
        params: {
          type: "object",
          required: ["productId"],
          properties: { productId: { type: "string", minLength: 1 } },
        },
        body: UPDATE_BODY,
        response: {
          200: PRODUCT,
          401: ERROR_RESPONSE,
          403: ERROR_RESPONSE,
          404: ERROR_RESPONSE,
          422: ERROR_RESPONSE,
        },
      },
    },
    async (request, reply) => {
      const user = request.requireRole("DISPATCHER");
      const { productId } = request.params as { productId: string };
      const body = request.body as UpdateBody;

      const existing = await prisma.product.findUnique({ where: { id: productId } });
      if (!existing) {
        return reply.status(404).send({ error: { code: "NOT_FOUND", message: "Product not found." } });
      }

      const data: Prisma.ProductUpdateInput = {};
      if (body.name !== undefined) {
        const name = body.name.trim();
        if (name.length < 2) return reply.status(422).send(invalid("A product name needs at least two characters."));
        data.name = name;
      }
      if (body.unitLabel !== undefined) {
        const unitLabel = body.unitLabel.trim();
        if (unitLabel.length < 1) return reply.status(422).send(invalid("A product needs a unit label, such as bag or carton."));
        data.unitLabel = unitLabel;
      }
      if (body.brand !== undefined) data.brand = body.brand;
      if (body.tempRequirement !== undefined) data.tempRequirement = body.tempRequirement;
      if (body.kgPerUnit !== undefined) data.kgPerUnit = body.kgPerUnit;
      if (body.m3PerUnit !== undefined) data.m3PerUnit = body.m3PerUnit;
      if (body.active !== undefined) data.active = body.active;
      if (body.sortOrder !== undefined) data.sortOrder = body.sortOrder;

      // Only what actually differs is written and logged, so repeating a PATCH
      // (a retry, a form saved unchanged) leaves no phantom entry in the history.
      const before = productSnapshot(existing) as Record<string, unknown>;
      const changed = Object.keys(data).filter((key) => data[key as keyof typeof data] !== before[key]);
      if (changed.length === 0) return toProductView(existing);

      const updated = await prisma.product.update({ where: { id: productId }, data });
      const after = productSnapshot(updated) as Record<string, unknown>;

      await recordDecision({
        actor: user,
        action: "product.update",
        entityType: "Product",
        entityId: updated.id,
        before: Object.fromEntries(changed.map((key) => [key, before[key]])) as Prisma.InputJsonValue,
        after: Object.fromEntries(changed.map((key) => [key, after[key]])) as Prisma.InputJsonValue,
      });
      return toProductView(updated);
    },
  );
}
