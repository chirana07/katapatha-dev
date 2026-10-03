import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFERRAL_REASONS,
  PROBLEM_REASONS,
  SHORTFALL_REASONS,
} from "@katapatha/core/domain/reasons";
import type { SessionUser } from "../lib/auth.js";
import { requireDriverStop } from "../lib/authorization.js";
import { prisma } from "../lib/db.js";
import errorsPlugin from "../plugins/errors.js";
import stopRoutes from "../routes/stops.js";
import syncRoutes from "../routes/sync.js";
import {
  arriveAtStop,
  completeStop,
  loadRun,
  reportProblem,
  startUnloading,
} from "../services/delivery.js";

/**
 * The stop-event applier, on both of its paths.
 *
 * `services/delivery` is mocked because what is under test here is the
 * applier's decisions — is this a duplicate, a conflict, or new work, and does
 * the client's ULID and device clock survive the trip — not the state machine
 * it delegates to. `services/conflicts` is deliberately NOT mocked: the
 * conflict rules are the new behaviour and they run for real against a mocked
 * client, so the ownership history the rules read is spelled out in each test.
 */

vi.mock("../lib/db.js", () => ({
  prisma: {
    stopEvent: { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn() },
    tripStop: { findMany: vi.fn() },
    tripStopOrder: { findMany: vi.fn() },
    stopReassignment: { findFirst: vi.fn() },
    syncLog: { create: vi.fn() },
  },
}));

vi.mock("../lib/authorization.js", () => ({ requireDriverStop: vi.fn() }));

vi.mock("../services/delivery.js", () => ({
  arriveAtStop: vi.fn(),
  startUnloading: vi.fn(),
  completeStop: vi.fn(),
  reportProblem: vi.fn(),
  loadRun: vi.fn(),
}));

const requireDriverStopMock = vi.mocked(requireDriverStop);

const DEVICE = "device-7f3a91";
const STOP = "STP001";
const OTHER_STOP = "STP002";

/** A valid Crockford ULID, which the request schema insists on. */
function ulid(suffix: string): string {
  return `01JB2X8Q9K7YC4V3M0ZQ5T6${suffix}`;
}
const ARRIVED_ID = ulid("RWE");
const UNLOAD_ID = ulid("RWF");
const DELIVERED_ID = ulid("RWG");
const POD_ID = ulid("RWH");

const driver: SessionUser = {
  id: "USR012",
  email: "ruwan@waypoint.lk",
  name: "Ruwan Silva",
  role: "DRIVER",
  depotCode: "Peliyagoda",
  outletId: null,
  defaultVehicleId: "VEH043",
};

/** A stop that is on the driver's run and that nobody else has touched. */
function cleanStop(id = STOP) {
  return { id, trip: { vehicleId: "VEH043" }, reassignments: [], stopEvents: [] };
}

describe("the stop-event applier", () => {
  const servers: ReturnType<typeof Fastify>[] = [];

  beforeEach(() => {
    // Reset, not clear: a test that makes the applier throw must not leave that
    // implementation standing for the next one.
    vi.resetAllMocks();
    requireDriverStopMock.mockResolvedValue({} as never);
    vi.mocked(prisma.stopEvent.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.stopEvent.findFirst).mockResolvedValue(null as never);
    vi.mocked(prisma.stopEvent.create).mockResolvedValue({} as never);
    vi.mocked(prisma.stopReassignment.findFirst).mockResolvedValue(null as never);
    vi.mocked(prisma.tripStop.findMany).mockResolvedValue([
      cleanStop(STOP),
      cleanStop(OTHER_STOP),
    ] as never);
    vi.mocked(prisma.tripStopOrder.findMany).mockResolvedValue([
      { tripStopId: STOP, order: { id: "ORD1", units: 120 } },
      { tripStopId: OTHER_STOP, order: { id: "ORD2", units: 40 } },
    ] as never);
    vi.mocked(prisma.syncLog.create).mockResolvedValue({} as never);
  });

  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => server.close()));
  });

  async function serverFor(user: SessionUser = driver) {
    const server = Fastify({ logger: false });
    servers.push(server);
    server.decorateRequest("requireRole", function () {
      return user;
    });
    await server.register(errorsPlugin);
    await server.register(stopRoutes, { prefix: "/v1" });
    await server.register(syncRoutes, { prefix: "/v1" });
    return server;
  }

  function post(events: Array<Record<string, unknown>>, stopId = STOP) {
    return {
      method: "POST" as const,
      url: `/v1/stops/${stopId}/events`,
      payload: { deviceId: DEVICE, events },
    };
  }

  function drain(
    events: Array<Record<string, unknown>>,
    clientClockAt = "2026-04-09T06:02:11.000Z",
  ) {
    return {
      method: "POST" as const,
      url: "/v1/sync/stop-events",
      payload: { deviceId: DEVICE, clientClockAt, events },
    };
  }

  const arrived = {
    id: ARRIVED_ID,
    type: "ARRIVED",
    occurredAt: "2026-04-09T04:42:00.000Z",
  };
  const unloadStart = {
    id: UNLOAD_ID,
    type: "UNLOAD_START",
    occurredAt: "2026-04-09T04:45:00.000Z",
  };

  describe("POST /v1/stops/:stopId/events", () => {
    it("reports a replayed ULID as a duplicate and does not apply it again", async () => {
      const server = await serverFor();
      vi.mocked(prisma.stopEvent.findMany).mockResolvedValue([
        { id: ARRIVED_ID, conflictState: "NONE" },
      ] as never);

      const response = await server.inject(post([arrived]));

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        accepted: 0,
        duplicates: 1,
        conflicts: 0,
        results: [{ id: ARRIVED_ID, status: "duplicate", conflictState: "NONE" }],
      });
      expect(arriveAtStop).not.toHaveBeenCalled();
    });

    it("applies arrival and unloading with the client's own id and device clock", async () => {
      const server = await serverFor();

      const response = await server.inject(post([arrived, unloadStart]));

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ accepted: 2, duplicates: 0, conflicts: 0 });
      expect(arriveAtStop).toHaveBeenCalledWith(STOP, driver, {
        id: ARRIVED_ID,
        occurredAt: new Date("2026-04-09T04:42:00.000Z"),
        deviceId: DEVICE,
      });
      expect(startUnloading).toHaveBeenCalledWith(STOP, driver, {
        id: UNLOAD_ID,
        occurredAt: new Date("2026-04-09T04:45:00.000Z"),
        deviceId: DEVICE,
      });
    });

    it("groups a delivered line and its POD into one completion", async () => {
      const server = await serverFor();

      const response = await server.inject(
        post([
          {
            id: DELIVERED_ID,
            type: "DELIVERED",
            occurredAt: "2026-04-09T04:55:00.000Z",
            orderId: "ORD1",
            deliveredUnits: 120,
          },
          {
            id: POD_ID,
            type: "POD_CAPTURED",
            occurredAt: "2026-04-09T04:56:00.000Z",
            recipientName: "K. Jayasuriya",
            signatureData: "data:image/png;base64,AAA",
          },
        ]),
      );

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ accepted: 2, duplicates: 0, conflicts: 0 });
      expect(completeStop).toHaveBeenCalledTimes(1);
      expect(completeStop).toHaveBeenCalledWith(
        STOP,
        driver,
        {
          recipientName: "K. Jayasuriya",
          // `expected` comes from the stop's own order, not from the device, so
          // a short delivery is measured against the plan.
          delivered: [
            { orderId: "ORD1", units: 120, expected: 120, eventId: DELIVERED_ID },
          ],
          signatureData: "data:image/png;base64,AAA",
          photoData: undefined,
          podEventId: POD_ID,
        },
        // The POD's clock stands for the whole completion: a delivery is one
        // act even though it produces several events.
        { occurredAt: new Date("2026-04-09T04:56:00.000Z"), deviceId: DEVICE },
      );
    });

    it("refuses a completion with no recipient on the POD", async () => {
      const server = await serverFor();

      const response = await server.inject(
        post([
          {
            id: DELIVERED_ID,
            type: "DELIVERED",
            occurredAt: "2026-04-09T04:55:00.000Z",
            orderId: "ORD1",
            deliveredUnits: 120,
          },
        ]),
      );

      expect(response.statusCode).toBe(422);
      expect(response.json().error.code).toBe("RECIPIENT_REQUIRED");
      expect(completeStop).not.toHaveBeenCalled();
    });

    it("refuses a delivery for an order that is not on the stop", async () => {
      const server = await serverFor();

      const response = await server.inject(
        post([
          {
            id: DELIVERED_ID,
            type: "DELIVERED",
            occurredAt: "2026-04-09T04:55:00.000Z",
            orderId: "ORD-elsewhere",
            deliveredUnits: 10,
          },
        ]),
      );

      expect(response.statusCode).toBe(422);
      expect(response.json().error.code).toBe("ORDER_NOT_ON_STOP");
    });

    it("keeps SKIPPED distinct from FAILED when recording a problem", async () => {
      const server = await serverFor();

      await server.inject(
        post([
          {
            id: ARRIVED_ID,
            type: "SKIPPED",
            occurredAt: "2026-04-09T05:10:00.000Z",
            reasonCode: "OUTLET_CLOSED",
          },
        ]),
      );

      expect(reportProblem).toHaveBeenCalledWith(
        driver,
        {
          kind: "OUTLET_CLOSED",
          note: "OUTLET_CLOSED",
          tripStopId: STOP,
          outcome: "SKIPPED",
        },
        expect.objectContaining({ id: ARRIVED_ID }),
      );
    });

    it("falls back to OTHER for a reason code outside the vocabulary", async () => {
      const server = await serverFor();

      await server.inject(
        post([
          {
            id: ARRIVED_ID,
            type: "FAILED",
            occurredAt: "2026-04-09T05:10:00.000Z",
            reasonCode: "SOMETHING_NEW",
          },
        ]),
      );

      expect(reportProblem).toHaveBeenCalledWith(
        driver,
        expect.objectContaining({ kind: "OTHER", outcome: "FAILED" }),
        expect.anything(),
      );
    });

    it("answers 404 for a stop that was never on this driver's run", async () => {
      const server = await serverFor();
      requireDriverStopMock.mockRejectedValue(new Error("denied"));

      const response = await server.inject(post([arrived]));

      expect(response.statusCode).toBe(404);
      expect(response.json()).toEqual({
        error: { code: "NOT_FOUND", message: "Stop not on this driver's run." },
      });
      expect(prisma.stopEvent.create).not.toHaveBeenCalled();
    });

    it("surfaces an applier failure as a 409 rather than a 500", async () => {
      const server = await serverFor();
      vi.mocked(arriveAtStop).mockRejectedValue(new Error("stop is already done"));

      const response = await server.inject(post([arrived]));

      expect(response.statusCode).toBe(409);
      expect(response.json()).toEqual({
        error: { code: "APPLY_FAILED", message: "stop is already done" },
      });
    });
  });

  describe("conflict detection", () => {
    /** The stop has moved to another vehicle and is no longer on this run. */
    function reassignedAway() {
      requireDriverStopMock.mockRejectedValue(new Error("denied"));
      vi.mocked(prisma.stopReassignment.findFirst).mockResolvedValue({ id: "RA1" } as never);
    }

    it("records an event on a reassigned stop as a STALE_ASSIGNMENT conflict", async () => {
      const server = await serverFor();
      reassignedAway();

      const response = await server.inject(post([arrived]));

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        accepted: 0,
        duplicates: 0,
        conflicts: 1,
        results: [
          { id: ARRIVED_ID, status: "conflict", conflictState: "STALE_ASSIGNMENT" },
        ],
      });
      // The driver's claim is kept — the dispatcher has to be able to see it —
      // but nothing is applied to a stop that is now somebody else's.
      expect(vi.mocked(prisma.stopEvent.create).mock.calls[0]![0]).toMatchObject({
        data: {
          id: ARRIVED_ID,
          tripStopId: STOP,
          type: "ARRIVED",
          conflictState: "STALE_ASSIGNMENT",
          deviceId: DEVICE,
          actorUserId: "USR012",
          occurredAt: new Date("2026-04-09T04:42:00.000Z"),
        },
      });
      expect(arriveAtStop).not.toHaveBeenCalled();
    });

    it("keeps the proof of delivery on a conflicted POD, since the device drops its copy", async () => {
      const server = await serverFor();
      reassignedAway();

      await server.inject(
        post([
          {
            id: POD_ID,
            type: "POD_CAPTURED",
            occurredAt: "2026-04-09T04:56:00.000Z",
            recipientName: "K. Jayasuriya",
            signatureData: "data:image/png;base64,AAA",
          },
        ]),
      );

      expect(vi.mocked(prisma.stopEvent.create).mock.calls[0]![0]).toMatchObject({
        data: {
          recipientName: "K. Jayasuriya",
          signatureData: "data:image/png;base64,AAA",
          conflictState: "STALE_ASSIGNMENT",
        },
      });
      expect(completeStop).not.toHaveBeenCalled();
    });

    it("links a conflicted delivery to its order only when the order is on the stop", async () => {
      const server = await serverFor();
      reassignedAway();

      await server.inject(
        post([
          {
            id: DELIVERED_ID,
            type: "DELIVERED",
            occurredAt: "2026-04-09T04:55:00.000Z",
            orderId: "ORD-elsewhere",
            deliveredUnits: 10,
          },
        ]),
      );

      // orderId is a foreign key: storing an order that is not on the stop
      // would fail the insert and lose the record entirely.
      expect(vi.mocked(prisma.stopEvent.create).mock.calls[0]![0]).toMatchObject({
        data: { orderId: null, deliveredUnits: 10 },
      });
    });

    it("reports a replayed conflict as a conflict without counting it twice", async () => {
      const server = await serverFor();
      vi.mocked(prisma.stopEvent.findMany).mockResolvedValue([
        { id: ARRIVED_ID, conflictState: "STALE_ASSIGNMENT" },
      ] as never);

      const response = await server.inject(post([arrived]));

      expect(response.json()).toEqual({
        accepted: 0,
        duplicates: 1,
        conflicts: 0,
        results: [
          { id: ARRIVED_ID, status: "conflict", conflictState: "STALE_ASSIGNMENT" },
        ],
      });
      // The device needs the reason again to settle the row terminally, but the
      // conflict itself was already counted when it was first detected.
      expect(prisma.stopEvent.create).not.toHaveBeenCalled();
    });

    it("flags an event recorded during a window when the stop belonged to another vehicle", async () => {
      const server = await serverFor();
      vi.mocked(prisma.tripStop.findMany).mockResolvedValue([
        {
          id: STOP,
          trip: { vehicleId: "VEH043" },
          reassignments: [
            {
              at: new Date("2026-04-09T04:30:00.000Z"),
              fromTrip: { vehicleId: "VEH043" },
              toTrip: { vehicleId: "VEH099" },
            },
            {
              at: new Date("2026-04-09T05:30:00.000Z"),
              fromTrip: { vehicleId: "VEH099" },
              toTrip: { vehicleId: "VEH043" },
            },
          ],
          stopEvents: [],
        },
      ] as never);

      const response = await server.inject(post([arrived]));

      expect(response.json()).toMatchObject({
        conflicts: 1,
        results: [{ status: "conflict", conflictState: "STALE_ASSIGNMENT" }],
      });
      expect(arriveAtStop).not.toHaveBeenCalled();
    });

    it("applies an event recorded before the stop was reassigned", async () => {
      const server = await serverFor();
      vi.mocked(prisma.tripStop.findMany).mockResolvedValue([
        {
          id: STOP,
          trip: { vehicleId: "VEH043" },
          reassignments: [
            {
              at: new Date("2026-04-09T05:30:00.000Z"),
              fromTrip: { vehicleId: "VEH043" },
              toTrip: { vehicleId: "VEH099" },
            },
          ],
          stopEvents: [],
        },
      ] as never);

      const response = await server.inject(post([arrived]));

      // The driver was the rightful owner at 04:42, which is the moment the
      // event describes. A later reassignment cannot make that untrue.
      expect(response.json()).toMatchObject({ accepted: 1, conflicts: 0 });
      expect(arriveAtStop).toHaveBeenCalledOnce();
    });

    it("marks an event SUPERSEDED when another driver has already closed the stop", async () => {
      const server = await serverFor();
      vi.mocked(prisma.tripStop.findMany).mockResolvedValue([
        {
          id: STOP,
          trip: { vehicleId: "VEH043" },
          reassignments: [],
          stopEvents: [{ deviceId: "device-other", actorUserId: "USR099" }],
        },
      ] as never);

      const response = await server.inject(
        post([
          {
            id: DELIVERED_ID,
            type: "DELIVERED",
            occurredAt: "2026-04-09T04:55:00.000Z",
            orderId: "ORD1",
            deliveredUnits: 120,
            recipientName: "K. Jayasuriya",
          },
        ]),
      );

      expect(response.json()).toMatchObject({
        accepted: 0,
        conflicts: 1,
        results: [{ status: "conflict", conflictState: "SUPERSEDED" }],
      });
      expect(completeStop).not.toHaveBeenCalled();
    });

    it("does not treat the driver's own earlier close as a supersession", async () => {
      const server = await serverFor();
      vi.mocked(prisma.tripStop.findMany).mockResolvedValue([
        {
          id: STOP,
          trip: { vehicleId: "VEH043" },
          reassignments: [],
          stopEvents: [{ deviceId: DEVICE, actorUserId: "USR012" }],
        },
      ] as never);

      const response = await server.inject(post([arrived]));

      expect(response.json()).toMatchObject({ accepted: 1, conflicts: 0 });
    });
  });

  describe("POST /v1/sync/stop-events", () => {
    const batch = [
      { ...arrived, tripStopId: STOP },
      { ...unloadStart, tripStopId: STOP },
      {
        id: DELIVERED_ID,
        type: "FAILED",
        occurredAt: "2026-04-09T05:20:00.000Z",
        tripStopId: OTHER_STOP,
        reasonCode: "ROAD_BLOCKED",
      },
    ];

    it("accepts every event in a fresh batch and logs the drain", async () => {
      const server = await serverFor();

      const response = await server.inject(drain(batch));

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        accepted: 3,
        duplicates: 0,
        conflicts: 0,
        results: [
          { id: ARRIVED_ID, status: "accepted", conflictState: "NONE" },
          { id: UNLOAD_ID, status: "accepted", conflictState: "NONE" },
          { id: DELIVERED_ID, status: "accepted", conflictState: "NONE" },
        ],
      });
      expect(vi.mocked(prisma.syncLog.create).mock.calls[0]![0]).toMatchObject({
        data: {
          deviceId: DEVICE,
          userId: "USR012",
          batchSize: 3,
          accepted: 3,
          duplicates: 0,
          conflicts: 0,
        },
      });
    });

    it("reports an identical replay as all duplicates and changes nothing", async () => {
      const server = await serverFor();
      vi.mocked(prisma.stopEvent.findMany).mockResolvedValue(
        batch.map((event) => ({ id: event.id, conflictState: "NONE" })) as never,
      );

      const response = await server.inject(drain(batch));

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ accepted: 0, duplicates: 3, conflicts: 0 });
      expect(arriveAtStop).not.toHaveBeenCalled();
      expect(startUnloading).not.toHaveBeenCalled();
      expect(reportProblem).not.toHaveBeenCalled();
      // Nothing would be applied, so the ownership history is not even read.
      // This is the batch the outbox sends most often.
      expect(prisma.tripStop.findMany).not.toHaveBeenCalled();
      expect(vi.mocked(prisma.syncLog.create).mock.calls[0]![0]).toMatchObject({
        data: { batchSize: 3, accepted: 0, duplicates: 3 },
      });
    });

    it("routes each event in the batch to its own stop", async () => {
      const server = await serverFor();

      await server.inject(drain(batch));

      expect(arriveAtStop).toHaveBeenCalledWith(STOP, driver, expect.anything());
      expect(reportProblem).toHaveBeenCalledWith(
        driver,
        expect.objectContaining({ tripStopId: OTHER_STOP, kind: "ROAD_BLOCKED" }),
        expect.anything(),
      );
    });

    it("refuses a batch whose events do not say which stop they belong to", async () => {
      const server = await serverFor();

      const response = await server.inject(drain([arrived]));

      expect(response.statusCode).toBe(422);
      expect(response.json().error.code).toBe("MISSING_TRIP_STOP_ID");
      expect(arriveAtStop).not.toHaveBeenCalled();
    });

    it("rejects the whole batch, with no partial writes, if any stop is not on the run", async () => {
      const server = await serverFor();
      requireDriverStopMock.mockRejectedValue(new Error("denied"));

      const response = await server.inject(drain(batch));

      expect(response.statusCode).toBe(403);
      expect(response.json().error.code).toBe("STOP_NOT_ON_RUN");
      expect(arriveAtStop).not.toHaveBeenCalled();
      expect(prisma.syncLog.create).not.toHaveBeenCalled();
    });

    it("clamps a wildly wrong device clock instead of overflowing SyncLog", async () => {
      const server = await serverFor();

      // A handset whose clock reset to the epoch after a flat battery. The
      // outbox retries 5xx forever, so an INT4 overflow here would mean this
      // phone could never drain a single event.
      const response = await server.inject(drain(batch, "1970-01-01T00:00:00.000Z"));

      expect(response.statusCode).toBe(200);
      expect(response.json().clockSkewMs).toBe(2_147_483_647);
      expect(vi.mocked(prisma.syncLog.create).mock.calls[0]![0]).toMatchObject({
        data: { clockSkewMs: 2_147_483_647 },
      });
    });

    it("clamps a clock set far into the future too", async () => {
      const server = await serverFor();

      const response = await server.inject(drain(batch, "2200-01-01T00:00:00.000Z"));

      expect(response.json().clockSkewMs).toBe(-2_147_483_648);
    });

    it("measures a plausible skew as it is, rather than clamping it", async () => {
      const server = await serverFor();

      const response = await server.inject(
        drain(batch, new Date(Date.now() - 842).toISOString()),
      );

      const skew = response.json().clockSkewMs;
      expect(skew).toBeGreaterThanOrEqual(842);
      expect(skew).toBeLessThan(10_000);
    });

    it("counts a conflicted event into both the response and SyncLog", async () => {
      const server = await serverFor();
      vi.mocked(prisma.tripStop.findMany).mockResolvedValue([
        {
          id: STOP,
          trip: { vehicleId: "VEH043" },
          reassignments: [
            {
              at: new Date("2026-04-09T04:30:00.000Z"),
              fromTrip: { vehicleId: "VEH043" },
              toTrip: { vehicleId: "VEH099" },
            },
            {
              at: new Date("2026-04-09T05:30:00.000Z"),
              fromTrip: { vehicleId: "VEH099" },
              toTrip: { vehicleId: "VEH043" },
            },
          ],
          stopEvents: [],
        },
        cleanStop(OTHER_STOP),
      ] as never);

      const response = await server.inject(drain(batch));

      // The two events on the reassigned stop conflict; the one on the other
      // stop applies normally. A conflict in a batch is not a failed batch.
      expect(response.json()).toMatchObject({
        accepted: 1,
        duplicates: 0,
        conflicts: 2,
      });
      expect(vi.mocked(prisma.syncLog.create).mock.calls[0]![0]).toMatchObject({
        data: { batchSize: 3, accepted: 1, duplicates: 0, conflicts: 2 },
      });
    });

    it("returns the server's own sequence cursor for the next pull", async () => {
      const server = await serverFor();
      vi.mocked(prisma.stopEvent.findFirst).mockResolvedValue({
        recordedAt: new Date("2026-04-09T06:02:12.000Z"),
      } as never);

      const response = await server.inject(drain(batch));

      expect(response.json().serverSeq).toBe(
        new Date("2026-04-09T06:02:12.000Z").getTime(),
      );
    });
  });

  describe("GET /v1/sync/stop-events", () => {
    it("scopes the server tail to the driver's claimed vehicle", async () => {
      const server = await serverFor();
      vi.mocked(prisma.stopEvent.findMany).mockResolvedValue([
        {
          id: ARRIVED_ID,
          type: "ARRIVED",
          occurredAt: new Date("2026-04-09T04:42:00.000Z"),
          recordedAt: new Date("2026-04-09T04:42:09.000Z"),
          orderId: null,
          deliveredUnits: null,
          recipientName: null,
          signatureData: null,
          photoData: null,
        },
      ] as never);

      const response = await server.inject({
        method: "GET",
        url: "/v1/sync/stop-events?sinceSeq=1775000000000",
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        serverSeq: new Date("2026-04-09T04:42:09.000Z").getTime(),
        events: [{ id: ARRIVED_ID, type: "ARRIVED", occurredAt: "2026-04-09T04:42:00.000Z" }],
      });
      expect(vi.mocked(prisma.stopEvent.findMany).mock.calls[0]![0]).toMatchObject({
        where: {
          recordedAt: { gt: new Date(1_775_000_000_000) },
          tripStop: { trip: { vehicleId: "VEH043" } },
        },
      });
    });

    it("will not pull a tail for a driver who has claimed no vehicle", async () => {
      const server = await serverFor({ ...driver, defaultVehicleId: null });

      const response = await server.inject({
        method: "GET",
        url: "/v1/sync/stop-events?sinceSeq=0",
      });

      expect(response.statusCode).toBe(403);
      expect(response.json().error.code).toBe("NO_VEHICLE_CLAIMED");
    });
  });

  describe("GET /v1/sync/bootstrap", () => {
    it("caches the run and the reason vocabularies as codes a picker can use", async () => {
      const server = await serverFor();
      vi.mocked(loadRun).mockResolvedValue([] as never);

      const response = await server.inject({
        method: "GET",
        url: "/v1/sync/bootstrap?date=2026-04-09",
      });

      expect(response.statusCode).toBe(200);
      expect(loadRun).toHaveBeenCalledWith("VEH043", new Date("2026-04-09T00:00:00.000Z"));
      expect(response.json()).toMatchObject({
        run: { date: "2026-04-09", vehicleId: "VEH043", trips: [] },
        vocabularies: {
          deferralReasons: DEFERRAL_REASONS.map(({ code }) => code),
          shortfallReasons: SHORTFALL_REASONS.map(({ code }) => code),
          problemReasons: PROBLEM_REASONS.map(({ code }) => code),
        },
      });
    });

    it("refuses to bootstrap before a vehicle is claimed", async () => {
      const server = await serverFor({ ...driver, defaultVehicleId: null });

      const response = await server.inject({
        method: "GET",
        url: "/v1/sync/bootstrap?date=2026-04-09",
      });

      expect(response.statusCode).toBe(403);
      expect(response.json().error.code).toBe("NO_VEHICLE_CLAIMED");
      expect(loadRun).not.toHaveBeenCalled();
    });
  });
});
