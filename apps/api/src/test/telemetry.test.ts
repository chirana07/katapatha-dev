import Fastify from "fastify";
import { Prisma } from "@prisma/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CONTRACT_AJV } from "../lib/ajv.js";
import { AuthError, type SessionUser } from "../lib/auth.js";
import { requireLoaderTrip } from "../lib/authorization.js";
import { prisma } from "../lib/db.js";
import errorsPlugin from "../plugins/errors.js";
import telemetryRoutes from "../routes/telemetry.js";
import { chillerSourceAllowed, isTooFarAhead } from "../services/vehicles.js";

/**
 * What the field reports back.
 *
 * The things worth proving: who may write which reading, that a replay never
 * makes a second row, that a clock gone wrong is refused rather than shown as
 * "just now", and that the target band is copied onto the reading.
 */

vi.mock("../lib/db.js", () => ({
  prisma: {
    trip: { findMany: vi.fn(), findFirst: vi.fn() },
    vehiclePing: { createMany: vi.fn() },
    vehicle: { findUnique: vi.fn() },
    tripStop: { findFirst: vi.fn() },
    chillerReading: { create: vi.fn(), findUnique: vi.fn() },
    auditEvent: { create: vi.fn() },
  },
}));

vi.mock("../lib/authorization.js", () => ({
  requireLoaderTrip: vi.fn(),
}));

const requireLoaderTripMock = vi.mocked(requireLoaderTrip);

const NOW = new Date("2026-04-09T01:20:00.000Z");

const base: SessionUser = {
  id: "USR1",
  email: "x@waypoint.lk",
  name: "Someone",
  role: "DRIVER",
  depotCode: "Peliyagoda",
  outletId: null,
  defaultVehicleId: "VEH014",
};
const driver: SessionUser = { ...base, id: "USR5", name: "Sunil Fernando" };
const loader: SessionUser = { ...base, id: "USR2", name: "Ranjith Silva", role: "LOADER", defaultVehicleId: null };
const dispatcher: SessionUser = { ...base, id: "USR3", name: "Nimal Perera", role: "DISPATCHER", defaultVehicleId: null };
const store: SessionUser = { ...base, id: "USR4", role: "STORE_MANAGER", depotCode: null, outletId: "OUT074", defaultVehicleId: null };

describe("pure rules", () => {
  it("allows bay readings from a loader or dispatcher and arrival readings from a driver only", () => {
    expect(chillerSourceAllowed("LOADER", "LOADER_AT_BAY")).toBe(true);
    expect(chillerSourceAllowed("DISPATCHER", "LOADER_AT_BAY")).toBe(true);
    expect(chillerSourceAllowed("DRIVER", "LOADER_AT_BAY")).toBe(false);
    expect(chillerSourceAllowed("DRIVER", "DRIVER_ON_ARRIVAL")).toBe(true);
    expect(chillerSourceAllowed("LOADER", "DRIVER_ON_ARRIVAL")).toBe(false);
    expect(chillerSourceAllowed("DISPATCHER", "DRIVER_ON_ARRIVAL")).toBe(false);
    expect(chillerSourceAllowed("STORE_MANAGER", "LOADER_AT_BAY")).toBe(false);
  });

  it("tolerates five minutes of clock drift and no more", () => {
    expect(isTooFarAhead(new Date(NOW.getTime() + 5 * 60_000), NOW)).toBe(false);
    expect(isTooFarAhead(new Date(NOW.getTime() + 5 * 60_000 + 1), NOW)).toBe(true);
    expect(isTooFarAhead(new Date(NOW.getTime() - 3_600_000), NOW)).toBe(false);
  });
});

describe("telemetry routes", () => {
  const servers: ReturnType<typeof Fastify>[] = [];

  beforeEach(() => {
    vi.resetAllMocks();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
  });

  afterEach(async () => {
    vi.useRealTimers();
    await Promise.all(servers.splice(0).map((server) => server.close()));
  });

  async function serverFor(user: SessionUser) {
    const server = Fastify({ logger: false, ajv: CONTRACT_AJV });
    servers.push(server);
    server.decorateRequest("requireRole", function (...roles: string[]) {
      if (roles.length && !roles.includes(user.role)) throw new AuthError("Forbidden", 403);
      return user;
    });
    await server.register(errorsPlugin);
    await server.register(telemetryRoutes, { prefix: "/v1" });
    return server;
  }

  describe("POST /v1/drivers/me/pings", () => {
    const ping = (n: number, over: Record<string, unknown> = {}) => ({
      clientPingId: `ping-000${n}`,
      lat: 7.62,
      lng: 79.84,
      recordedAt: "2026-04-09T01:19:00.000Z",
      ...over,
    });
    const post = (server: Awaited<ReturnType<typeof serverFor>>, pings: unknown[]) =>
      server.inject({ method: "POST", url: "/v1/drivers/me/pings", payload: { pings } });
    const planDay = { planningDay: { date: new Date("2026-04-09T00:00:00.000Z") } };

    beforeEach(() => {
      vi.mocked(prisma.trip.findMany).mockResolvedValue([] as never);
      vi.mocked(prisma.vehiclePing.createMany).mockResolvedValue({ count: 1 } as never);
    });

    it("is for drivers", async () => {
      const server = await serverFor(loader);
      expect((await post(server, [ping(1)])).statusCode).toBe(403);
      expect(prisma.vehiclePing.createMany).not.toHaveBeenCalled();
    });

    it("tells a driver with no vehicle to pick one, rather than guessing", async () => {
      const server = await serverFor({ ...driver, defaultVehicleId: null });
      const response = await post(server, [ping(1)]);
      expect(response.statusCode).toBe(403);
      expect(response.json().error.message).toMatch(/pick a vehicle/i);
      expect(prisma.vehiclePing.createMany).not.toHaveBeenCalled();
    });

    it("stores the reports against the driver's vehicle, with the phone's clock", async () => {
      const server = await serverFor(driver);

      const response = await post(server, [ping(1, { accuracyM: 12 }), ping(2)]);

      expect(response.statusCode).toBe(200);
      const args = vi.mocked(prisma.vehiclePing.createMany).mock.calls[0]![0] as {
        data: Record<string, unknown>[];
        skipDuplicates: boolean;
      };
      expect(args.skipDuplicates).toBe(true);
      expect(args.data).toEqual([
        {
          vehicleId: "VEH014",
          tripId: null,
          lat: 7.62,
          lng: 79.84,
          accuracyM: 12,
          recordedAt: new Date("2026-04-09T01:19:00.000Z"),
          reportedByUserId: "USR5",
          clientPingId: "ping-0001",
        },
        expect.objectContaining({ clientPingId: "ping-0002", accuracyM: null }),
      ]);
    });

    it("counts a replayed batch as duplicates, not as new reports", async () => {
      vi.mocked(prisma.vehiclePing.createMany).mockResolvedValue({ count: 1 } as never);
      const server = await serverFor(driver);
      const response = await post(server, [ping(1), ping(2)]);
      expect(response.json()).toEqual({ accepted: 1, duplicates: 1 });

      vi.mocked(prisma.vehiclePing.createMany).mockResolvedValue({ count: 0 } as never);
      expect((await post(server, [ping(1), ping(2)])).json()).toEqual({ accepted: 0, duplicates: 2 });
    });

    it("files reports against the departed trip, else the ready or loading one, on a published plan", async () => {
      vi.mocked(prisma.trip.findMany).mockResolvedValue([
        { id: "TRP2", status: "LOADING", plan: planDay },
        { id: "TRP1", status: "DEPARTED", plan: planDay },
      ] as never);
      const server = await serverFor(driver);

      await post(server, [ping(1)]);

      expect(vi.mocked(prisma.trip.findMany).mock.calls[0]![0]).toMatchObject({
        where: { vehicleId: "VEH014", plan: { status: "PUBLISHED" } },
      });
      const first = vi.mocked(prisma.vehiclePing.createMany).mock.calls[0]![0] as { data: { tripId: string }[] };
      expect(first.data[0]!.tripId).toBe("TRP1");

      vi.mocked(prisma.trip.findMany).mockResolvedValue([{ id: "TRP2", status: "LOADING", plan: planDay }] as never);
      await post(server, [ping(2)]);
      const second = vi.mocked(prisma.vehiclePing.createMany).mock.calls[1]![0] as { data: { tripId: string }[] };
      expect(second.data[0]!.tripId).toBe("TRP2");
    });

    it("still stores a report from a vehicle with no live trip, against no trip", async () => {
      const server = await serverFor(driver);
      expect((await post(server, [ping(1)])).statusCode).toBe(200);
      const args = vi.mocked(prisma.vehiclePing.createMany).mock.calls[0]![0] as { data: { tripId: string | null }[] };
      expect(args.data[0]!.tripId).toBeNull();
    });

    it("refuses the whole batch when any report is dated more than five minutes ahead", async () => {
      const server = await serverFor(driver);

      const response = await post(server, [ping(1), ping(2, { recordedAt: "2026-04-09T01:26:00.000Z" })]);

      expect(response.statusCode).toBe(422);
      expect(response.json().error).toMatchObject({ code: "PING_IN_FUTURE", details: { clientPingId: "ping-0002" } });
      expect(prisma.vehiclePing.createMany).not.toHaveBeenCalled();
    });

    it("accepts a phone clock a few minutes ahead", async () => {
      const server = await serverFor(driver);
      expect((await post(server, [ping(1, { recordedAt: "2026-04-09T01:24:00.000Z" })])).statusCode).toBe(200);
    });

    it.each([
      ["no pings", []],
      ["too many pings", Array.from({ length: 51 }, (_, i) => ping(i + 10))],
      ["a short clientPingId", [ping(1, { clientPingId: "short" })]],
      ["a latitude off the globe", [ping(1, { lat: 91 })]],
      ["a longitude off the globe", [ping(1, { lng: -181 })]],
      ["a negative accuracy", [ping(1, { accuracyM: -1 })]],
      ["an undeclared field", [ping(1, { speedKmh: 40 })]],
      ["a recordedAt that is not a timestamp", [ping(1, { recordedAt: "yesterday" })]],
    ])("rejects %s against the contract", async (_label, pings) => {
      const server = await serverFor(driver);
      const response = await post(server, pings as unknown[]);
      expect(response.statusCode).toBe(422);
      expect(prisma.vehiclePing.createMany).not.toHaveBeenCalled();
    });

    it("accepts the full 50", async () => {
      vi.mocked(prisma.vehiclePing.createMany).mockResolvedValue({ count: 50 } as never);
      const server = await serverFor(driver);
      const response = await post(server, Array.from({ length: 50 }, (_, i) => ping(i + 10)));
      expect(response.json()).toEqual({ accepted: 50, duplicates: 0 });
    });
  });

  describe("POST /v1/trips/:tripId/chiller-readings", () => {
    const post = (server: Awaited<ReturnType<typeof serverFor>>, payload: unknown, tripId = "TRP1") =>
      server.inject({ method: "POST", url: `/v1/trips/${tripId}/chiller-readings`, payload: payload as never });

    const created = (over: Record<string, unknown> = {}) => ({
      id: "CHR1",
      vehicleId: "VEH014",
      tripId: "TRP1",
      tempC: 3.8,
      targetMinC: 2,
      targetMaxC: 5,
      source: "LOADER_AT_BAY",
      recordedAt: NOW,
      recordedByName: "Ranjith Silva",
      ...over,
    });

    beforeEach(() => {
      requireLoaderTripMock.mockResolvedValue({ id: "TRP1", vehicleId: "VEH014" } as never);
      vi.mocked(prisma.trip.findFirst).mockResolvedValue({ vehicleId: "VEH014" } as never);
      vi.mocked(prisma.vehicle.findUnique).mockResolvedValue({ temp: "reefer" } as never);
      vi.mocked(prisma.chillerReading.findUnique).mockResolvedValue(null as never);
      vi.mocked(prisma.chillerReading.create).mockImplementation((async ({ data }: { data: Record<string, unknown> }) =>
        created({ tempC: data.tempC, source: data.source, recordedAt: data.recordedAt, recordedByName: data.recordedByName })) as never);
      vi.mocked(prisma.auditEvent.create).mockResolvedValue({} as never);
    });

    describe("who may record", () => {
      it("lets a loader record a bay reading for a trip at their depot", async () => {
        const server = await serverFor(loader);
        const response = await post(server, { tempC: 3.8, source: "LOADER_AT_BAY" });
        expect(response.statusCode).toBe(201);
        expect(requireLoaderTripMock).toHaveBeenCalledWith(loader, "TRP1");
      });

      it("lets a dispatcher stand in at the bay", async () => {
        const server = await serverFor(dispatcher);
        expect((await post(server, { tempC: 3.8, source: "LOADER_AT_BAY" })).statusCode).toBe(201);
      });

      it("answers 403 for a loader whose trip is at another depot", async () => {
        requireLoaderTripMock.mockRejectedValue(new AuthError("You do not have access to this record", 403));
        const server = await serverFor(loader);
        const response = await post(server, { tempC: 3.8, source: "LOADER_AT_BAY" });
        expect(response.statusCode).toBe(403);
        expect(prisma.chillerReading.create).not.toHaveBeenCalled();
      });

      it("lets a driver read on arrival, but only for a published trip on their own vehicle at their depot", async () => {
        const server = await serverFor(driver);

        const response = await post(server, { tempC: 4.1, source: "DRIVER_ON_ARRIVAL" });

        expect(response.statusCode).toBe(201);
        expect(vi.mocked(prisma.trip.findFirst).mock.calls[0]![0]).toMatchObject({
          where: {
            id: "TRP1",
            vehicleId: "VEH014",
            plan: { status: "PUBLISHED", planningDay: { depotCode: "Peliyagoda" } },
          },
        });
        // The driver does not go through the loader's depot-wide check.
        expect(requireLoaderTripMock).not.toHaveBeenCalled();
      });

      it("answers 403 for a driver on someone else's trip", async () => {
        vi.mocked(prisma.trip.findFirst).mockResolvedValue(null as never);
        const server = await serverFor(driver);
        const response = await post(server, { tempC: 4.1, source: "DRIVER_ON_ARRIVAL" });
        expect(response.statusCode).toBe(403);
        expect(prisma.chillerReading.create).not.toHaveBeenCalled();
      });

      it("answers 403 for a driver who has not picked a vehicle", async () => {
        const server = await serverFor({ ...driver, defaultVehicleId: null });
        expect((await post(server, { tempC: 4.1, source: "DRIVER_ON_ARRIVAL" })).statusCode).toBe(403);
        expect(prisma.trip.findFirst).not.toHaveBeenCalled();
      });

      it("refuses a store manager", async () => {
        const server = await serverFor(store);
        expect((await post(server, { tempC: 4.1, source: "DRIVER_ON_ARRIVAL" })).statusCode).toBe(403);
      });
    });

    describe("role and source must agree", () => {
      it("refuses a bay reading from a driver", async () => {
        const server = await serverFor(driver);
        const response = await post(server, { tempC: 3.8, source: "LOADER_AT_BAY" });
        expect(response.statusCode).toBe(422);
        expect(response.json().error.code).toBe("SOURCE_NOT_ALLOWED_FOR_ROLE");
        expect(prisma.chillerReading.create).not.toHaveBeenCalled();
      });

      it("refuses an arrival reading from a loader or dispatcher", async () => {
        for (const user of [loader, dispatcher]) {
          const server = await serverFor(user);
          const response = await post(server, { tempC: 3.8, source: "DRIVER_ON_ARRIVAL" });
          expect(response.statusCode).toBe(422);
          expect(response.json().error.code).toBe("SOURCE_NOT_ALLOWED_FOR_ROLE");
        }
        expect(prisma.chillerReading.create).not.toHaveBeenCalled();
      });
    });

    describe("what is recorded", () => {
      it("stores the band, the reader and the trim of the note", async () => {
        vi.mocked(prisma.tripStop.findFirst).mockResolvedValue({ id: "STP1" } as never);
        const server = await serverFor(loader);

        const response = await post(server, {
          tempC: 3.8,
          source: "LOADER_AT_BAY",
          note: "  Gauge steady ",
          tripStopId: "STP1",
          clientReadingId: "reading-0001",
          recordedAt: "2026-04-09T01:15:00.000Z",
        });

        expect(response.statusCode).toBe(201);
        expect(vi.mocked(prisma.chillerReading.create).mock.calls[0]![0]!.data).toEqual({
          vehicleId: "VEH014",
          tripId: "TRP1",
          tripStopId: "STP1",
          tempC: 3.8,
          targetMinC: 2,
          targetMaxC: 5,
          source: "LOADER_AT_BAY",
          recordedByUserId: "USR2",
          recordedByName: "Ranjith Silva",
          recordedAt: new Date("2026-04-09T01:15:00.000Z"),
          note: "Gauge steady",
          clientReadingId: "reading-0001",
        });
        expect(response.json()).toEqual({
          id: "CHR1",
          tripId: "TRP1",
          vehicleId: "VEH014",
          tempC: 3.8,
          targetMinC: 2,
          targetMaxC: 5,
          inRange: true,
          source: "LOADER_AT_BAY",
          recordedAt: "2026-04-09T01:15:00.000Z",
          recordedByName: "Ranjith Silva",
        });
      });

      it("defaults the time to now", async () => {
        const server = await serverFor(loader);
        const response = await post(server, { tempC: 3.8, source: "LOADER_AT_BAY" });
        expect(response.json().recordedAt).toBe("2026-04-09T01:20:00.000Z");
      });

      it.each([
        [2, true],
        [5, true],
        [1.9, false],
        [5.1, false],
        [6.2, false],
      ])("%s degrees is in range: %s", async (tempC, inRange) => {
        const server = await serverFor(loader);
        const response = await post(server, { tempC, source: "LOADER_AT_BAY" });
        expect(response.statusCode).toBe(201);
        expect(response.json().inRange).toBe(inRange);
      });

      it("refuses a stop that is not on this trip", async () => {
        vi.mocked(prisma.tripStop.findFirst).mockResolvedValue(null as never);
        const server = await serverFor(driver);
        const response = await post(server, { tempC: 4, source: "DRIVER_ON_ARRIVAL", tripStopId: "STP9" });
        expect(response.statusCode).toBe(422);
        expect(response.json().error.code).toBe("STOP_NOT_ON_TRIP");
        expect(vi.mocked(prisma.tripStop.findFirst).mock.calls[0]![0]).toMatchObject({
          where: { id: "STP9", tripId: "TRP1" },
        });
        expect(prisma.chillerReading.create).not.toHaveBeenCalled();
      });
    });

    describe("only refrigerated vehicles take readings", () => {
      it("refuses an ambient vehicle and stores nothing", async () => {
        vi.mocked(prisma.vehicle.findUnique).mockResolvedValue({ temp: "ambient" } as never);
        const server = await serverFor(loader);

        const response = await post(server, { tempC: 20, source: "LOADER_AT_BAY" });

        expect(response.statusCode).toBe(422);
        expect(response.json().error.code).toBe("CHILLER_NOT_APPLICABLE");
        expect(prisma.chillerReading.create).not.toHaveBeenCalled();
        expect(prisma.auditEvent.create).not.toHaveBeenCalled();
      });
    });

    describe("idempotency", () => {
      const existing = created({ id: "CHR0", tempC: 6.5 });

      it("returns the existing reading with 200 and writes nothing", async () => {
        vi.mocked(prisma.chillerReading.findUnique).mockResolvedValue(existing as never);
        const server = await serverFor(loader);

        const response = await post(server, { tempC: 3.8, source: "LOADER_AT_BAY", clientReadingId: "reading-0001" });

        expect(response.statusCode).toBe(200);
        expect(response.json()).toMatchObject({ id: "CHR0", tempC: 6.5, inRange: false });
        expect(vi.mocked(prisma.chillerReading.findUnique).mock.calls[0]![0]).toEqual({
          where: { clientReadingId: "reading-0001" },
        });
        expect(prisma.chillerReading.create).not.toHaveBeenCalled();
        expect(prisma.auditEvent.create).not.toHaveBeenCalled();
      });

      it("does not hand back another trip's reading for a reused id", async () => {
        vi.mocked(prisma.chillerReading.findUnique).mockResolvedValue(created({ tripId: "TRP9" }) as never);
        const server = await serverFor(loader);

        const response = await post(server, { tempC: 3.8, source: "LOADER_AT_BAY", clientReadingId: "reading-0001" });

        expect(response.statusCode).toBe(409);
        expect(response.json().error.code).toBe("CLIENT_ID_REUSED");
      });

      it("resolves a race between two sends in favour of the first", async () => {
        vi.mocked(prisma.chillerReading.findUnique)
          .mockResolvedValueOnce(null as never)
          .mockResolvedValueOnce(existing as never);
        vi.mocked(prisma.chillerReading.create).mockRejectedValue(
          new Prisma.PrismaClientKnownRequestError("unique", { code: "P2002", clientVersion: "test" }),
        );
        const server = await serverFor(loader);

        const response = await post(server, { tempC: 3.8, source: "LOADER_AT_BAY", clientReadingId: "reading-0001" });

        expect(response.statusCode).toBe(200);
        expect(response.json().id).toBe("CHR0");
        expect(prisma.auditEvent.create).not.toHaveBeenCalled();
      });

      it("does not look anything up when the client sent no id", async () => {
        const server = await serverFor(loader);
        await post(server, { tempC: 3.8, source: "LOADER_AT_BAY" });
        expect(prisma.chillerReading.findUnique).not.toHaveBeenCalled();
      });
    });

    describe("the decision log", () => {
      it("records an in-range reading on the trip", async () => {
        const server = await serverFor(loader);
        await post(server, { tempC: 3.8, source: "LOADER_AT_BAY" });

        const record = vi.mocked(prisma.auditEvent.create).mock.calls[0]![0]!.data;
        expect(record).toMatchObject({
          action: "chiller.read",
          entityType: "Trip",
          entityId: "TRP1",
          actorUserId: "USR2",
          actorRole: "LOADER",
          after: { readingId: "CHR1", vehicleId: "VEH014", tempC: 3.8, inRange: true, source: "LOADER_AT_BAY" },
        });
      });

      it("flags an out-of-range reading, which blocks nothing", async () => {
        const server = await serverFor(loader);

        const response = await post(server, { tempC: 6.2, source: "LOADER_AT_BAY", note: "Door left open" });

        expect(response.statusCode).toBe(201);
        const record = vi.mocked(prisma.auditEvent.create).mock.calls[0]![0]!.data;
        expect(record).toMatchObject({ note: "Door left open", after: { tempC: 6.2, inRange: false } });
      });
    });

    describe("the clock and the contract", () => {
      it("refuses a reading dated more than five minutes ahead", async () => {
        const server = await serverFor(loader);
        const response = await post(server, {
          tempC: 3.8,
          source: "LOADER_AT_BAY",
          recordedAt: "2026-04-09T01:26:00.000Z",
        });
        expect(response.statusCode).toBe(422);
        expect(response.json().error.code).toBe("READING_IN_FUTURE");
        expect(prisma.chillerReading.create).not.toHaveBeenCalled();
      });

      it.each([
        ["a reading hotter than the gauge goes", { tempC: 41 }],
        ["a reading colder than the gauge goes", { tempC: -31 }],
        ["an unknown source", { source: "SENSOR" }],
        ["a note that is too long", { note: "x".repeat(201) }],
        ["a short clientReadingId", { clientReadingId: "short" }],
        ["a string temperature", { tempC: "3.8" }],
        ["an undeclared field", { sensorId: "S1" }],
      ])("rejects %s against the contract", async (_label, over) => {
        const server = await serverFor(loader);
        const response = await post(server, { tempC: 3.8, source: "LOADER_AT_BAY", ...over });
        expect(response.statusCode).toBe(422);
        expect(prisma.chillerReading.create).not.toHaveBeenCalled();
      });

      it("requires tempC and source", async () => {
        const server = await serverFor(loader);
        expect((await post(server, { source: "LOADER_AT_BAY" })).statusCode).toBe(422);
        expect((await post(server, { tempC: 3.8 })).statusCode).toBe(422);
      });
    });
  });
});
