import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SessionUser } from "../lib/auth.js";
import errorsPlugin from "../plugins/errors.js";
import { loadIncomingDelivery, loadStoreOrders } from "../services/store.js";
import { getWeather } from "../services/weather.js";
import storeRoutes from "../routes/store.js";
import { CONTRACT_AJV } from "../lib/ajv.js";

// accessNoteFor is pure and already covered by its own behaviour, so it is the
// one export here that is NOT mocked — the test asserts the real sentence.
vi.mock("../services/store.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/store.js")>();
  return {
    ...actual,
    loadStoreOrders: vi.fn(),
    loadIncomingDelivery: vi.fn(),
  };
});

vi.mock("../services/weather.js", () => ({ getWeather: vi.fn() }));

const loadStoreOrdersMock = vi.mocked(loadStoreOrders);
const loadIncomingDeliveryMock = vi.mocked(loadIncomingDelivery);
const getWeatherMock = vi.mocked(getWeather);

const storeManager: SessionUser = {
  id: "USR004",
  email: "fathima@waypoint.lk",
  name: "Fathima Rizvi",
  role: "STORE_MANAGER",
  depotCode: null,
  outletId: "OUT074",
  defaultVehicleId: null,
};

const outlet = {
  id: "OUT074",
  displayName: "Fresh Puttalam",
  brand: "Fresh" as const,
  districtName: "Puttalam",
  dockType: "rear_dock" as const,
  parkingConstraint: "mall_dock" as const,
  windowOpen: "05:30",
  windowClose: "08:00",
  // Widened so a test can override them; 108 of the 120 outlets are not in malls.
  mallWindowOpen: null as string | null,
  mallWindowClose: null as string | null,
};

function order(over: Partial<Awaited<ReturnType<typeof loadStoreOrders>>[number]> = {}) {
  return {
    id: "ord-1",
    ref: "S1-082",
    brand: "Fresh" as const,
    tempRequirement: "ambient" as const,
    units: 69,
    volumeM3: 2.1,
    weightKg: 320,
    requestedDate: "2026-09-29",
    state: "on_the_way" as const,
    etaAt: "07:21",
    vehicleId: "VEH025",
    stopsBefore: 1,
    tripStopId: "tst-1",
    deliveredUnits: null,
    receiptConfirmed: false,
    deferral: null,
    ...over,
  };
}

async function build(prismaStub: Record<string, unknown>, user: SessionUser = storeManager) {
  // Same AJV options as production, or this is not testing the contract.
  const server = Fastify({ ajv: CONTRACT_AJV });
  server.decorate("prisma", prismaStub as never);
  server.decorateRequest("requireRole", function () {
    return user;
  });
  await server.register(errorsPlugin);
  await server.register(storeRoutes, { prefix: "/v1" });
  return server;
}

function prismaWith(found: typeof outlet | null) {
  return {
    outlet: { findUnique: vi.fn().mockResolvedValue(found) },
    calendarDay: { findUnique: vi.fn().mockResolvedValue({ monsoon: false }) },
  };
}

describe("GET /v1/store/today", () => {
  const servers: FastifyInstance[] = [];

  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => server.close()));
    vi.clearAllMocks();
  });

  it("returns only the requested day's orders for the caller's own outlet", async () => {
    loadStoreOrdersMock.mockResolvedValue([
      order(),
      order({ id: "ord-2", ref: "S1-070", requestedDate: "2026-09-28", state: "delivered" }),
    ]);
    loadIncomingDeliveryMock.mockResolvedValue(null);
    getWeatherMock.mockResolvedValue({
      place: "Puttalam", temperatureC: 28, label: "Light rain", kind: "rain", live: true, observedAt: null,
    });

    const prisma = prismaWith(outlet);
    const server = await build(prisma);
    servers.push(server);

    const response = await server.inject({ method: "GET", url: "/v1/store/today?date=2026-09-29" });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.orders).toHaveLength(1);
    expect(body.orders[0].ref).toBe("S1-082");
    // The scope is the session, never a query parameter.
    expect(prisma.outlet.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "OUT074" } }),
    );
    expect(loadStoreOrdersMock).toHaveBeenCalledWith("OUT074");
  });

  it("counts a delivered but unconfirmed order as the outlet's own pending action", async () => {
    loadStoreOrdersMock.mockResolvedValue([
      order({ state: "delivered", receiptConfirmed: false, deliveredUnits: 69 }),
      order({ id: "ord-2", ref: "S1-081", state: "delivered", receiptConfirmed: true, deliveredUnits: 40 }),
      order({ id: "ord-3", ref: "S1-083", state: "planned" }),
    ]);
    loadIncomingDeliveryMock.mockResolvedValue(null);
    getWeatherMock.mockResolvedValue(null as never);

    const server = await build(prismaWith(outlet));
    servers.push(server);

    const body = (await server.inject({ method: "GET", url: "/v1/store/today?date=2026-09-29" })).json();

    expect(body.counts).toEqual({ expected: 1, confirmed: 1, pending: 1, issues: 1 });
  });

  it("tracks the order that is on the road ahead of one merely planned", async () => {
    const planned = order({ id: "ord-3", ref: "S1-083", state: "planned" });
    const moving = order({ id: "ord-1", ref: "S1-082", state: "on_the_way" });
    loadStoreOrdersMock.mockResolvedValue([planned, moving]);
    loadIncomingDeliveryMock.mockResolvedValue(null);
    getWeatherMock.mockResolvedValue(null as never);

    const server = await build(prismaWith(outlet));
    servers.push(server);

    await server.inject({ method: "GET", url: "/v1/store/today?date=2026-09-29" });

    expect(loadIncomingDeliveryMock).toHaveBeenCalledWith(expect.objectContaining({ ref: "S1-082" }));
  });

  it("prefers the mall window, which binds over the outlet's own hours", async () => {
    loadStoreOrdersMock.mockResolvedValue([]);
    loadIncomingDeliveryMock.mockResolvedValue(null);
    getWeatherMock.mockResolvedValue(null as never);

    const server = await build(
      prismaWith({ ...outlet, mallWindowOpen: "09:00", mallWindowClose: "11:00" }),
    );
    servers.push(server);

    const body = (await server.inject({ method: "GET", url: "/v1/store/today?date=2026-09-29" })).json();

    expect(body.receivingWindowOpen).toBe("09:00");
    expect(body.receivingWindowClose).toBe("11:00");
    expect(body.accessNote).toContain("rear dock");
    expect(body.accessNote).toContain("Security check");
  });

  it("refuses an account with no outlet rather than guessing one", async () => {
    loadStoreOrdersMock.mockResolvedValue([]);
    const server = await build(prismaWith(null), { ...storeManager, outletId: null });
    servers.push(server);

    const response = await server.inject({ method: "GET", url: "/v1/store/today" });

    expect(response.statusCode).toBe(403);
    expect(loadStoreOrdersMock).not.toHaveBeenCalled();
  });

  it("rejects a query parameter the contract does not declare", async () => {
    loadStoreOrdersMock.mockResolvedValue([]);
    const server = await build(prismaWith(outlet));
    servers.push(server);

    const response = await server.inject({ method: "GET", url: "/v1/store/today?outletId=OUT001" });

    // 422 REQUEST_DOES_NOT_MATCH_CONTRACT, not 400: plugins/errors.ts reports a
    // schema violation as what it is. A store manager cannot read another
    // outlet by asking for one, and the refusal happens before the handler.
    expect(response.statusCode).toBe(422);
    expect(response.json().error.code).toBe("REQUEST_DOES_NOT_MATCH_CONTRACT");
  });
});
