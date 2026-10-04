import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CONTRACT_AJV } from "../lib/ajv.js";
import { requireRoleOf, type SessionUser } from "../lib/auth.js";
import { recordDecision } from "../lib/audit.js";
import errorsPlugin from "../plugins/errors.js";
import referenceRoutes from "../routes/reference.js";
import { nearest } from "../services/routing.js";

/**
 * Correcting an outlet's pin. The role gate is the real `requireRoleOf`; Prisma,
 * the road network and the audit log are mocked, because what matters is who may
 * move which outlet, where it may go, and that every move leaves a record.
 */

vi.mock("../lib/audit.js", () => ({ recordDecision: vi.fn() }));
vi.mock("../services/routing.js", () => ({ nearest: vi.fn() }));
vi.mock("../services/store.js", () => ({ nextOperatingDate: vi.fn() }));

const dispatcher: SessionUser = {
  id: "USR001",
  email: "nimal@waypoint.lk",
  name: "Nimal",
  role: "DISPATCHER",
  depotCode: "Peliyagoda",
  outletId: null,
  defaultVehicleId: null,
};
const manager: SessionUser = { ...dispatcher, id: "USR004", role: "STORE_MANAGER", depotCode: null, outletId: "OUT010" };

const existing = { id: "OUT010", districtName: "Colombo", lat: 6.94131, lng: 79.87615, geoSource: "SYNTHETIC" };

describe("PATCH /v1/reference/outlets/:outletId/location", () => {
  const servers: ReturnType<typeof Fastify>[] = [];
  const findFirst = vi.fn();
  const update = vi.fn();

  beforeEach(() => {
    vi.resetAllMocks();
    findFirst.mockResolvedValue(existing);
    update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
      id: "OUT010",
      lat: data.lat,
      lng: data.lng,
      geoSource: data.geoSource,
      geoSnapped: data.geoSnapped,
    }));
    vi.mocked(nearest).mockImplementation(async (p) => ({ ...p, live: false }));
  });

  afterEach(async () => {
    await Promise.all(servers.splice(0).map((s) => s.close()));
  });

  async function serverFor(user: SessionUser | null = dispatcher) {
    // The contract's AJV options, or an undeclared field would be stripped, not refused.
    const server = Fastify({ logger: false, ajv: CONTRACT_AJV });
    servers.push(server);
    server.decorate("prisma", { outlet: { findFirst, update } } as never);
    server.decorateRequest("requireRole", function (...roles: never[]) {
      return requireRoleOf(user, ...roles);
    });
    await server.register(errorsPlugin);
    await server.register(referenceRoutes, { prefix: "/v1" });
    return server;
  }

  const patch = (server: Awaited<ReturnType<typeof serverFor>>, payload: unknown, id = "OUT010") =>
    server.inject({ method: "PATCH", url: `/v1/reference/outlets/${id}/location`, payload: payload as never });

  it("is the dispatcher's alone", async () => {
    for (const user of [manager, null]) {
      const server = await serverFor(user);
      expect((await patch(server, { lat: 6.93, lng: 79.86 })).statusCode).toBeGreaterThanOrEqual(401);
    }
    expect(update).not.toHaveBeenCalled();
  });

  it("looks the outlet up within the dispatcher's own depot, and says not found otherwise", async () => {
    findFirst.mockResolvedValue(null);
    const server = await serverFor();

    const response = await patch(server, { lat: 6.93, lng: 79.86 }, "OUT900");

    expect(response.statusCode).toBe(404);
    expect(findFirst.mock.calls[0]![0].where).toEqual({ id: "OUT900", depotCode: "Peliyagoda" });
    expect(update).not.toHaveBeenCalled();
  });

  it("refuses a position outside Sri Lanka, such as swapped coordinates", async () => {
    const server = await serverFor();

    const response = await patch(server, { lat: 79.86, lng: 6.93 });

    expect(response.statusCode).toBe(422);
    expect(update).not.toHaveBeenCalled();
    expect(recordDecision).not.toHaveBeenCalled();
  });

  it("refuses a body that names anything else", async () => {
    const server = await serverFor();
    expect((await patch(server, { lat: 6.93, lng: 79.86, geoSource: "CSV" })).statusCode).toBe(422);
    expect((await patch(server, { lat: 6.93 })).statusCode).toBe(422);
  });

  it("stores the pin as the dispatcher's, unsnapped when the road network cannot be reached", async () => {
    const server = await serverFor();

    const response = await patch(server, { lat: 6.93, lng: 79.86 });

    expect(response.statusCode).toBe(200);
    expect(update.mock.calls[0]![0].data).toMatchObject({
      lat: 6.93,
      lng: 79.86,
      geoSource: "DISPATCHER",
      geoSnapped: false,
      geoUpdatedByUserId: "USR001",
    });
    expect(response.json()).toMatchObject({ geoSource: "DISPATCHER", geoSnapped: false });
  });

  it("moves the pin onto the nearest road when the network answers", async () => {
    vi.mocked(nearest).mockResolvedValue({ lat: 6.9302, lng: 79.8605, live: true });
    const server = await serverFor();

    const response = await patch(server, { lat: 6.93, lng: 79.86 });

    expect(response.json()).toMatchObject({ lat: 6.9302, lng: 79.8605, geoSnapped: true });
  });

  it("keeps the exact pin when asked not to snap, without asking the network", async () => {
    vi.mocked(nearest).mockResolvedValue({ lat: 1, lng: 1, live: true });
    const server = await serverFor();

    const response = await patch(server, { lat: 6.93, lng: 79.86, snap: false });

    expect(nearest).not.toHaveBeenCalled();
    expect(response.json()).toMatchObject({ lat: 6.93, lng: 79.86, geoSnapped: false });
  });

  it("warns, but accepts, a pin far from its district", async () => {
    const server = await serverFor();

    // Kandy, for a Colombo outlet.
    const response = await patch(server, { lat: 7.29, lng: 80.63 });

    expect(response.statusCode).toBe(200);
    expect(response.json().warning).toMatch(/more than 40 km from the centre of Colombo/);
    expect(update).toHaveBeenCalled();
  });

  it("leaves no warning for a pin in its district", async () => {
    const server = await serverFor();
    expect((await patch(server, { lat: 6.93, lng: 79.86 })).json().warning).toBeUndefined();
  });

  it("records who moved it, from where to where", async () => {
    const server = await serverFor();

    await patch(server, { lat: 6.93, lng: 79.86 });

    expect(recordDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: dispatcher,
        action: "outlet.relocate",
        entityType: "Outlet",
        entityId: "OUT010",
        before: { lat: 6.94131, lng: 79.87615, geoSource: "SYNTHETIC" },
        after: { lat: 6.93, lng: 79.86, snapped: false },
      }),
    );
  });
});
