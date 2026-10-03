import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CONTRACT_AJV } from "../lib/ajv.js";
import { requireRoleOf, type SessionUser } from "../lib/auth.js";
import { prisma } from "../lib/db.js";
import errorsPlugin from "../plugins/errors.js";
import productRoutes from "../routes/products.js";
import { blendedUnitSize, groupBasket, itemsOf, orderableBy, type BasketProduct } from "../services/products.js";

/**
 * The catalogue: who may read it (and how much of it), who may write it, and
 * the rules a product has to satisfy.
 *
 * The role gate is the real `requireRoleOf`, so "who may" is tested, not
 * assumed. Prisma is mocked at the module boundary; what is asserted is the
 * query shape (the brand scope comes from the session's outlet, never the
 * request), the refusals, and the decision-log rows a write leaves behind.
 */

vi.mock("../lib/db.js", () => ({
  prisma: {
    product: { findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), aggregate: vi.fn() },
    outlet: { findUnique: vi.fn() },
    auditEvent: { create: vi.fn() },
  },
}));

const user = (role: SessionUser["role"], over: Partial<SessionUser> = {}): SessionUser => ({
  id: `USR-${role}`,
  email: `${role.toLowerCase()}@waypoint.lk`,
  name: role,
  role,
  depotCode: role === "STORE_MANAGER" ? null : "Peliyagoda",
  outletId: role === "STORE_MANAGER" ? "OUT074" : null,
  defaultVehicleId: null,
  ...over,
});

const dispatcher = user("DISPATCHER");
const loader = user("LOADER");
const driver = user("DRIVER");
const manager = user("STORE_MANAGER");

function productRow(over: Record<string, unknown> = {}) {
  return {
    id: "PRD1",
    sku: "FA001",
    name: "White Rice 5 kg",
    brand: "Fresh",
    tempRequirement: "ambient",
    unitLabel: "bag",
    kgPerUnit: 5.1,
    m3PerUnit: 0.007,
    active: true,
    sortOrder: 10,
    createdAt: new Date("2026-10-04T02:10:00.000Z"),
    updatedAt: new Date("2026-10-04T02:10:00.000Z"),
    createdByUserId: null,
    ...over,
  };
}

const NEW_PRODUCT = {
  sku: "FA009",
  name: "Samba Rice 5 kg",
  brand: "Fresh",
  tempRequirement: "ambient",
  unitLabel: "bag",
  kgPerUnit: 5.1,
  m3PerUnit: 0.007,
};

describe("products routes", () => {
  const servers: ReturnType<typeof Fastify>[] = [];

  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(prisma.product.findMany).mockResolvedValue([productRow()] as never);
    vi.mocked(prisma.outlet.findUnique).mockResolvedValue({ brand: "Fresh" } as never);
  });

  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => server.close()));
  });

  async function serverFor(who: SessionUser | null) {
    // The contract's AJV options, or undeclared fields would be stripped, not refused.
    const server = Fastify({ logger: false, ajv: CONTRACT_AJV });
    servers.push(server);
    server.decorateRequest("requireRole", function (...roles: never[]) {
      return requireRoleOf(who, ...roles);
    });
    await server.register(errorsPlugin);
    await server.register(productRoutes, { prefix: "/v1" });
    return server;
  }

  const whereOf = () => vi.mocked(prisma.product.findMany).mock.calls[0]![0]!.where as Record<string, unknown>;

  describe("GET /v1/products", () => {
    it("needs a session", async () => {
      const server = await serverFor(null);
      const response = await server.inject({ method: "GET", url: "/v1/products" });
      expect(response.statusCode).toBe(401);
    });

    it.each([
      ["dispatcher", dispatcher],
      ["loader", loader],
      ["driver", driver],
      ["store manager", manager],
    ])("lets the %s read the active catalogue, in display order", async (_name, who) => {
      const server = await serverFor(who);

      const response = await server.inject({ method: "GET", url: "/v1/products" });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual([
        {
          id: "PRD1",
          sku: "FA001",
          name: "White Rice 5 kg",
          brand: "Fresh",
          tempRequirement: "ambient",
          unitLabel: "bag",
          kgPerUnit: 5.1,
          m3PerUnit: 0.007,
          active: true,
          sortOrder: 10,
          createdAt: "2026-10-04T02:10:00.000Z",
          updatedAt: "2026-10-04T02:10:00.000Z",
        },
      ]);
      expect(whereOf()).toMatchObject({ active: true });
      expect(vi.mocked(prisma.product.findMany).mock.calls[0]![0]!.orderBy).toEqual([
        { sortOrder: "asc" },
        { sku: "asc" },
      ]);
    });

    it("shows a store manager only their own outlet's brand and the every-brand products", async () => {
      const server = await serverFor(manager);
      vi.mocked(prisma.outlet.findUnique).mockResolvedValue({ brand: "Style" } as never);

      await server.inject({ method: "GET", url: "/v1/products" });

      expect(prisma.outlet.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "OUT074" } }));
      expect(whereOf()).toMatchObject({ AND: [{ OR: [{ brand: null }, { brand: "Style" }] }] });
    });

    it("never lets a store manager widen past their brand with the brand filter", async () => {
      const server = await serverFor(manager);

      await server.inject({ method: "GET", url: "/v1/products?brand=Tech" });

      // Both conditions apply together: own brand AND (Tech or none).
      expect(whereOf()).toMatchObject({
        AND: [{ OR: [{ brand: null }, { brand: "Fresh" }] }, { OR: [{ brand: null }, { brand: "Tech" }] }],
      });
    });

    it("gives a loader, driver or dispatcher the whole catalogue, with no brand scope", async () => {
      const server = await serverFor(loader);

      await server.inject({ method: "GET", url: "/v1/products" });

      expect(whereOf()).not.toHaveProperty("AND");
      expect(prisma.outlet.findUnique).not.toHaveBeenCalled();
    });

    it("refuses a store manager with no outlet rather than showing the lot", async () => {
      const server = await serverFor({ ...manager, outletId: null });

      const response = await server.inject({ method: "GET", url: "/v1/products" });

      expect(response.statusCode).toBe(403);
      expect(prisma.product.findMany).not.toHaveBeenCalled();
    });

    it("narrows by temperature and by name or SKU, case-insensitively", async () => {
      const server = await serverFor(dispatcher);

      await server.inject({ method: "GET", url: "/v1/products?temp=chilled&q=milk" });

      expect(whereOf()).toMatchObject({
        tempRequirement: "chilled",
        AND: [
          {
            OR: [
              { name: { contains: "milk", mode: "insensitive" } },
              { sku: { contains: "milk", mode: "insensitive" } },
            ],
          },
        ],
      });
    });

    it("lists inactive products for a dispatcher only", async () => {
      const dispatcherServer = await serverFor(dispatcher);
      const allowed = await dispatcherServer.inject({ method: "GET", url: "/v1/products?includeInactive=true" });
      expect(allowed.statusCode).toBe(200);
      expect(whereOf()).not.toHaveProperty("active");

      vi.mocked(prisma.product.findMany).mockClear();
      for (const who of [manager, loader, driver]) {
        const server = await serverFor(who);
        const refused = await server.inject({ method: "GET", url: "/v1/products?includeInactive=true" });
        expect(refused.statusCode, who.role).toBe(403);
      }
      expect(prisma.product.findMany).not.toHaveBeenCalled();
    });

    it("treats includeInactive=false as the default for anyone", async () => {
      const server = await serverFor(manager);
      const response = await server.inject({ method: "GET", url: "/v1/products?includeInactive=false" });
      expect(response.statusCode).toBe(200);
      expect(whereOf()).toMatchObject({ active: true });
    });

    it("rejects parameters the contract does not declare", async () => {
      const server = await serverFor(dispatcher);
      const response = await server.inject({ method: "GET", url: "/v1/products?includeInactive=yes" });
      expect(response.statusCode).toBe(422);
      const other = await server.inject({ method: "GET", url: "/v1/products?stock=true" });
      expect(other.statusCode).toBe(422);
    });
  });

  describe("POST /v1/products", () => {
    beforeEach(() => {
      vi.mocked(prisma.product.findUnique).mockResolvedValue(null);
      vi.mocked(prisma.product.aggregate).mockResolvedValue({ _max: { sortOrder: 200 } } as never);
      vi.mocked(prisma.product.create).mockImplementation((async ({ data }: { data: Record<string, unknown> }) =>
        productRow({ id: "PRD9", ...data })) as never);
    });

    it.each([
      ["store manager", manager],
      ["loader", loader],
      ["driver", driver],
    ])("is not for the %s", async (_name, who) => {
      const server = await serverFor(who);
      const response = await server.inject({ method: "POST", url: "/v1/products", payload: NEW_PRODUCT });
      expect(response.statusCode).toBe(403);
      expect(prisma.product.create).not.toHaveBeenCalled();
    });

    it("creates a product at the end of the list, records who made it, and logs it", async () => {
      const server = await serverFor(dispatcher);

      const response = await server.inject({ method: "POST", url: "/v1/products", payload: NEW_PRODUCT });

      expect(response.statusCode).toBe(201);
      expect(response.json()).toMatchObject({ id: "PRD9", sku: "FA009", active: true, sortOrder: 210 });
      expect(prisma.product.create).toHaveBeenCalledWith({
        data: { ...NEW_PRODUCT, active: true, sortOrder: 210, createdByUserId: "USR-DISPATCHER" },
      });
      const audit = vi.mocked(prisma.auditEvent.create).mock.calls[0]![0]!.data;
      expect(audit).toMatchObject({
        action: "product.create",
        entityType: "Product",
        entityId: "PRD9",
        actorUserId: "USR-DISPATCHER",
      });
      expect(audit.after).toMatchObject({ sku: "FA009", name: "Samba Rice 5 kg" });
    });

    it("defaults the brand to every brand", async () => {
      const server = await serverFor(dispatcher);
      const { brand: _brand, ...noBrand } = NEW_PRODUCT;

      const response = await server.inject({ method: "POST", url: "/v1/products", payload: noBrand });

      expect(response.statusCode).toBe(201);
      expect(vi.mocked(prisma.product.create).mock.calls[0]![0]!.data.brand).toBeNull();
    });

    it("refuses a SKU that is taken, deactivated products included", async () => {
      const server = await serverFor(dispatcher);
      vi.mocked(prisma.product.findUnique).mockResolvedValue({ id: "PRD1" } as never);

      const response = await server.inject({ method: "POST", url: "/v1/products", payload: NEW_PRODUCT });

      expect(response.statusCode).toBe(409);
      expect(response.json().error.code).toBe("SKU_TAKEN");
      expect(prisma.product.create).not.toHaveBeenCalled();
      expect(prisma.auditEvent.create).not.toHaveBeenCalled();
    });

    it("answers SKU_TAKEN too when two dispatchers race and the index decides", async () => {
      const server = await serverFor(dispatcher);
      vi.mocked(prisma.product.create).mockRejectedValue(Object.assign(new Error("unique"), { code: "P2002" }));

      const response = await server.inject({ method: "POST", url: "/v1/products", payload: NEW_PRODUCT });

      expect(response.statusCode).toBe(409);
      expect(response.json().error.code).toBe("SKU_TAKEN");
    });

    it.each([
      ["a lower-case SKU", { sku: "fa009" }],
      ["a SKU with spaces", { sku: "FA 009" }],
      ["a one-character name", { name: "R" }],
      ["a name over 120 characters", { name: "x".repeat(121) }],
      ["an empty unit label", { unitLabel: "" }],
      ["a zero weight", { kgPerUnit: 0 }],
      ["a negative volume", { m3PerUnit: -0.1 }],
      ["a temperature that is not an order's", { tempRequirement: "reefer" }],
      ["an unknown brand", { brand: "Mega" }],
      ["a field the contract does not have", { stock: 12 }],
    ])("rejects %s", async (_name, change) => {
      const server = await serverFor(dispatcher);
      const response = await server.inject({
        method: "POST",
        url: "/v1/products",
        payload: { ...NEW_PRODUCT, ...change },
      });
      expect(response.statusCode).toBe(422);
      expect(prisma.product.create).not.toHaveBeenCalled();
    });

    it("rejects a name that is only spaces, which the schema alone lets through", async () => {
      const server = await serverFor(dispatcher);
      const response = await server.inject({
        method: "POST",
        url: "/v1/products",
        payload: { ...NEW_PRODUCT, name: "   " },
      });
      expect(response.statusCode).toBe(422);
      expect(response.json().error.code).toBe("VALIDATION_FAILED");
    });
  });

  describe("PATCH /v1/products/:productId", () => {
    beforeEach(() => {
      vi.mocked(prisma.product.findUnique).mockResolvedValue(productRow() as never);
      vi.mocked(prisma.product.update).mockImplementation((async ({ data }: { data: Record<string, unknown> }) =>
        productRow({ ...data, updatedAt: new Date("2026-10-04T03:20:00.000Z") })) as never);
    });

    const patch = (body: unknown, id = "PRD1") => ({ method: "PATCH" as const, url: `/v1/products/${id}`, payload: body as object });

    it.each([
      ["store manager", manager],
      ["loader", loader],
      ["driver", driver],
    ])("is not for the %s", async (_name, who) => {
      const server = await serverFor(who);
      const response = await server.inject(patch({ active: false }));
      expect(response.statusCode).toBe(403);
      expect(prisma.product.update).not.toHaveBeenCalled();
    });

    it("edits what was sent and logs only what changed, before and after", async () => {
      const server = await serverFor(dispatcher);

      const response = await server.inject(patch({ name: "White Rice 5 kg (new pack)", kgPerUnit: 5.2, sortOrder: 10 }));

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ name: "White Rice 5 kg (new pack)", kgPerUnit: 5.2 });
      const audit = vi.mocked(prisma.auditEvent.create).mock.calls[0]![0]!.data;
      expect(audit).toMatchObject({ action: "product.update", entityType: "Product", entityId: "PRD1" });
      // sortOrder was sent but equal, so it is not a change.
      expect(audit.before).toEqual({ name: "White Rice 5 kg", kgPerUnit: 5.1 });
      expect(audit.after).toEqual({ name: "White Rice 5 kg (new pack)", kgPerUnit: 5.2 });
    });

    it("deactivates without deleting", async () => {
      const server = await serverFor(dispatcher);

      const response = await server.inject(patch({ active: false }));

      expect(response.statusCode).toBe(200);
      expect(response.json().active).toBe(false);
      expect(vi.mocked(prisma.product.update).mock.calls[0]![0]).toEqual({
        where: { id: "PRD1" },
        data: { active: false },
      });
    });

    it("can clear the brand back to every brand", async () => {
      const server = await serverFor(dispatcher);
      const response = await server.inject(patch({ brand: null }));
      expect(response.statusCode).toBe(200);
      expect(vi.mocked(prisma.product.update).mock.calls[0]![0]!.data).toEqual({ brand: null });
    });

    it("writes nothing and logs nothing for a PATCH that changes nothing", async () => {
      const server = await serverFor(dispatcher);

      const response = await server.inject(patch({ name: "White Rice 5 kg", active: true }));

      expect(response.statusCode).toBe(200);
      expect(prisma.product.update).not.toHaveBeenCalled();
      expect(prisma.auditEvent.create).not.toHaveBeenCalled();
    });

    it("keeps the SKU immutable by refusing it, not by ignoring it", async () => {
      const server = await serverFor(dispatcher);
      const response = await server.inject(patch({ sku: "FA999" }));
      expect(response.statusCode).toBe(422);
      expect(prisma.product.update).not.toHaveBeenCalled();
    });

    it("rejects an empty edit and bad values", async () => {
      const server = await serverFor(dispatcher);
      for (const body of [{}, { kgPerUnit: 0 }, { m3PerUnit: -1 }, { name: "x" }, { unitLabel: "" }, { sortOrder: -1 }]) {
        const response = await server.inject(patch(body));
        expect(response.statusCode, JSON.stringify(body)).toBe(422);
      }
      expect(prisma.product.update).not.toHaveBeenCalled();
    });

    it("answers 404 for a product that does not exist", async () => {
      const server = await serverFor(dispatcher);
      vi.mocked(prisma.product.findUnique).mockResolvedValue(null);

      const response = await server.inject(patch({ active: false }, "NOPE"));

      expect(response.statusCode).toBe(404);
    });
  });
});

describe("the catalogue's pure pieces", () => {
  const products = new Map<string, BasketProduct>([
    ["milk", { id: "milk", sku: "FC001", name: "Fresh Milk", unitLabel: "crate", kgPerUnit: 12.6, m3PerUnit: 0.02, tempRequirement: "chilled" }],
    ["rice", { id: "rice", sku: "FA001", name: "White Rice", unitLabel: "bag", kgPerUnit: 5.1, m3PerUnit: 0.007, tempRequirement: "ambient" }],
    ["flour", { id: "flour", sku: "FA003", name: "Wheat Flour", unitLabel: "carton", kgPerUnit: 12.4, m3PerUnit: 0.018, tempRequirement: "ambient" }],
  ]);

  it("splits a mixed basket into one order per temperature, chilled first", () => {
    const orders = groupBasket(
      [
        { productId: "rice", quantity: 20 },
        { productId: "milk", quantity: 10 },
        { productId: "flour", quantity: 3 },
      ],
      products,
    );

    expect(orders.map((o) => o.tempRequirement)).toEqual(["chilled", "ambient"]);
    expect(orders[0]).toMatchObject({ units: 10, weightKg: 126, volumeM3: 0.2 });
    // 20 x 5.1 + 3 x 12.4 = 139.2 kg; 20 x 0.007 + 3 x 0.018 = 0.194 m3.
    expect(orders[1]).toMatchObject({ units: 23, weightKg: 139.2, volumeM3: 0.194 });
    expect(orders[1]!.lines.map((l) => [l.sku, l.quantity])).toEqual([["FA001", 20], ["FA003", 3]]);
  });

  it("snapshots the product's name, unit and size onto each line", () => {
    const [order] = groupBasket([{ productId: "rice", quantity: 2 }], products);
    expect(order!.lines[0]).toEqual({
      productId: "rice", sku: "FA001", productName: "White Rice", unitLabel: "bag", kgPerUnit: 5.1, m3PerUnit: 0.007, quantity: 2,
    });
  });

  it("does not round small volumes away", () => {
    // Three 0.007 m3 bags is 0.021, which two decimals would turn into 0.02.
    const [order] = groupBasket([{ productId: "rice", quantity: 3 }], products);
    expect(order!.volumeM3).toBe(0.021);
  });

  it("gives an order's blended size per unit, for the Rule 5 check", () => {
    const [, ambient] = groupBasket(
      [{ productId: "milk", quantity: 1 }, { productId: "rice", quantity: 20 }, { productId: "flour", quantity: 3 }],
      products,
    );
    const size = blendedUnitSize(ambient!);
    expect(size.kgPerUnit * ambient!.units).toBeCloseTo(139.2, 6);
    expect(size.m3PerUnit * ambient!.units).toBeCloseTo(0.194, 6);
  });

  it("reads contents from lines, and an order with none has an empty list", () => {
    expect(itemsOf([{ sku: "FA001", productName: "White Rice", unitLabel: "bag", quantity: 2 }])).toEqual([
      { sku: "FA001", name: "White Rice", quantity: 2, unitLabel: "bag" },
    ]);
    expect(itemsOf([])).toEqual([]);
    expect(itemsOf(undefined)).toEqual([]);
  });

  it("lets a store order its own brand's products and the every-brand ones", () => {
    expect(orderableBy({ brand: "Fresh" }, "Fresh")).toBe(true);
    expect(orderableBy({ brand: null }, "Tech")).toBe(true);
    expect(orderableBy({ brand: "Style" }, "Fresh")).toBe(false);
  });
});
