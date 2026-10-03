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
  StopStateError,
} from "../services/delivery.js";
import { CONTRACT_AJV } from "../lib/ajv.js";
import { MAX_POD_PAGE_CHARS } from "../services/stopEvents.js";

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

// The state machine is mocked; StopStateError and recordConflictedFact stay
// real, the first because the applier matches on it and the second because it
// is the write the conflict tests assert on.
vi.mock("../services/delivery.js", async (importActual) => ({
  ...(await importActual<typeof import("../services/delivery.js")>()),
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

/** A StopEvent row as the dedup query reads it back. */
function stored(id: string, conflictState = "NONE", stopId = STOP) {
  return { id, conflictState, tripStopId: stopId, actorUserId: "USR012" };
}

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
    const server = Fastify({ logger: false, ajv: CONTRACT_AJV });
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
      vi.mocked(prisma.stopEvent.findMany).mockResolvedValue([stored(ARRIVED_ID)] as never);

      const response = await server.inject(post([arrived]));

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        accepted: 0,
        duplicates: 1,
        conflicts: 0,
        results: [{ id: ARRIVED_ID, status: "duplicate", conflictState: "NONE" }],
        rejected: [],
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
          pages: undefined,
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
        rejected: [],
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
        stored(ARRIVED_ID, "STALE_ASSIGNMENT"),
      ] as never);

      const response = await server.inject(post([arrived]));

      expect(response.json()).toEqual({
        accepted: 0,
        duplicates: 1,
        conflicts: 0,
        results: [
          { id: ARRIVED_ID, status: "conflict", conflictState: "STALE_ASSIGNMENT" },
        ],
        rejected: [],
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
        batch.map((event) => stored(event.id, "NONE", event.tripStopId)) as never,
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

    it("rejects an event that does not say which stop it belongs to, and applies the rest", async () => {
      const server = await serverFor();

      const response = await server.inject(
        drain([arrived, { ...unloadStart, tripStopId: STOP }]),
      );

      // One event with no routing is that event's problem, not the batch's.
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        accepted: 1,
        rejected: [{ id: ARRIVED_ID, code: "MISSING_TRIP_STOP_ID" }],
        results: [{ id: UNLOAD_ID, status: "accepted" }],
      });
      expect(arriveAtStop).not.toHaveBeenCalled();
      expect(startUnloading).toHaveBeenCalledOnce();
    });

    it("reports an event for a stop the driver cannot see as rejected, without failing the batch", async () => {
      const server = await serverFor();
      // STP002 is somebody else's; STP001 is theirs.
      requireDriverStopMock.mockImplementation((async (_user: SessionUser, stopId: string) => {
        if (stopId === OTHER_STOP) throw new Error("denied");
        return {};
      }) as never);

      const response = await server.inject(drain(batch));

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        accepted: 2,
        duplicates: 0,
        conflicts: 0,
        results: [
          { id: ARRIVED_ID, status: "accepted" },
          { id: UNLOAD_ID, status: "accepted" },
        ],
        rejected: [{ id: DELIVERED_ID, code: "STOP_NOT_ON_RUN" }],
      });
      expect(arriveAtStop).toHaveBeenCalledOnce();
      expect(reportProblem).not.toHaveBeenCalled();
      // Nothing is written for the refused stop, and its existence is not
      // distinguishable from a stop that was never there.
      expect(prisma.stopEvent.create).not.toHaveBeenCalled();
      expect(vi.mocked(prisma.syncLog.create).mock.calls[0]![0]).toMatchObject({
        data: { batchSize: 3, accepted: 2 },
      });
    });

    it("rejects every event when no stop in the batch is on the run, and still answers 200", async () => {
      const server = await serverFor();
      requireDriverStopMock.mockRejectedValue(new Error("denied"));

      const response = await server.inject(drain(batch));

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ accepted: 0, results: [] });
      expect(response.json().rejected).toHaveLength(3);
      expect(arriveAtStop).not.toHaveBeenCalled();
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
          tripStopId: STOP,
          podPages: [],
        },
      ] as never);

      const response = await server.inject({
        method: "GET",
        url: "/v1/sync/stop-events?sinceSeq=1775000000000",
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        serverSeq: new Date("2026-04-09T04:42:09.000Z").getTime(),
        events: [
          {
            id: ARRIVED_ID,
            tripStopId: STOP,
            type: "ARRIVED",
            occurredAt: "2026-04-09T04:42:00.000Z",
            pages: [],
          },
        ],
      });
      expect(vi.mocked(prisma.stopEvent.findMany).mock.calls[0]![0]).toMatchObject({
        where: {
          recordedAt: { gt: new Date(1_775_000_000_000) },
          tripStop: { trip: { vehicleId: "VEH043" } },
        },
      });
    });

    it("lists a POD's pages in capture order without their image data", async () => {
      const server = await serverFor();
      vi.mocked(prisma.stopEvent.findMany).mockResolvedValue([
        {
          id: POD_ID,
          type: "POD_CAPTURED",
          occurredAt: new Date("2026-04-09T04:56:00.000Z"),
          recordedAt: new Date("2026-04-09T04:56:09.000Z"),
          orderId: null,
          deliveredUnits: null,
          recipientName: "K. Jayasuriya",
          signatureData: null,
          photoData: null,
          tripStopId: STOP,
          podPages: [
            {
              id: ulid("PG1"),
              seq: 0,
              kind: "RECEIPT",
              qualityFlags: [],
              capturedAt: new Date("2026-04-09T04:55:30.000Z"),
              // A stray column must never reach the wire: this is a list endpoint.
              data: "data:image/png;base64,AAAA",
            },
            {
              id: ulid("PG2"),
              seq: 1,
              kind: "PHOTO",
              qualityFlags: ["BLURRY"],
              capturedAt: new Date("2026-04-09T04:55:50.000Z"),
            },
          ],
        },
      ] as never);

      const response = await server.inject({ method: "GET", url: "/v1/sync/stop-events?sinceSeq=0" });

      const [event] = response.json().events;
      expect(event.pages).toEqual([
        { id: ulid("PG1"), seq: 0, kind: "RECEIPT", qualityFlags: [], capturedAt: "2026-04-09T04:55:30.000Z" },
        { id: ulid("PG2"), seq: 1, kind: "PHOTO", qualityFlags: ["BLURRY"], capturedAt: "2026-04-09T04:55:50.000Z" },
      ]);
      expect(JSON.stringify(response.json())).not.toContain("base64");
      expect(vi.mocked(prisma.stopEvent.findMany).mock.calls[0]![0]).toMatchObject({
        include: { podPages: { orderBy: { seq: "asc" } } },
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

    it("caches what each order contains, so the driver can see it with no signal", async () => {
      const server = await serverFor();
      vi.mocked(loadRun).mockResolvedValue([
        {
          id: "TRP001",
          tripNo: 1,
          wave: "PREDAWN",
          stops: [
            {
              id: "STP001",
              seq: 1,
              outletId: "OUT074",
              outlet: { displayName: null, dockType: "rear_dock", parkingConstraint: "normal", windowOpen: "06:00", windowClose: "11:00" },
              status: "PENDING",
              plannedArrivalAt: "04:40",
              orders: [
                {
                  order: {
                    id: "ORD1",
                    ref: "ORD-004312",
                    units: 30,
                    lines: [{ sku: "FA001", productName: "White Rice 5 kg", unitLabel: "bag", quantity: 30 }],
                  },
                },
                { order: { id: "ORD2", ref: "ORD-004313", units: 5 } },
              ],
            },
          ],
        },
      ] as never);

      const response = await server.inject({ method: "GET", url: "/v1/sync/bootstrap?date=2026-04-09" });

      expect(response.statusCode).toBe(200);
      const orders = response.json().run.trips[0].stops[0].orders;
      expect(orders[0].items).toEqual([{ sku: "FA001", name: "White Rice 5 kg", quantity: 30, unitLabel: "bag" }]);
      // An order read without lines (or placed as units only) still serialises.
      expect(orders[1]).toEqual({ orderId: "ORD2", orderRef: "ORD-004313", expectedUnits: 5, items: [] });
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
  describe("one batch, many events", () => {
    const at = (time: string) => `2026-04-09T${time}.000Z`;
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

    it("applies each stop's events in device-clock order, not arrival order", async () => {
      const server = await serverFor();

      // The outbox queued these in tap order but a retry can reorder rows; the
      // device clock is the truth about what happened first.
      await server.inject(
        drain([
          { ...unloadStart, tripStopId: STOP, occurredAt: at("04:45:00") },
          { ...arrived, tripStopId: STOP, occurredAt: at("04:42:00") },
        ]),
      );

      const arriveOrder = vi.mocked(arriveAtStop).mock.invocationCallOrder[0]!;
      const unloadOrder = vi.mocked(startUnloading).mock.invocationCallOrder[0]!;
      expect(arriveOrder).toBeLessThan(unloadOrder);
    });

    it("breaks a timestamp tie by the position in the batch", async () => {
      const server = await serverFor();
      const tied = at("04:42:00");

      const response = await server.inject(
        drain([
          { ...arrived, tripStopId: STOP, occurredAt: tied },
          { ...unloadStart, tripStopId: STOP, occurredAt: tied },
        ]),
      );

      expect(response.json().results.map((r: { id: string }) => r.id)).toEqual([
        ARRIVED_ID,
        UNLOAD_ID,
      ]);
      expect(vi.mocked(arriveAtStop).mock.invocationCallOrder[0]!).toBeLessThan(
        vi.mocked(startUnloading).mock.invocationCallOrder[0]!,
      );
    });

    it("closes a stop once, after its arrival, however the events were listed", async () => {
      const server = await serverFor();

      await server.inject(
        drain([
          {
            id: POD_ID,
            type: "POD_CAPTURED",
            occurredAt: at("04:56:00"),
            tripStopId: STOP,
            recipientName: "K. Jayasuriya",
          },
          {
            id: DELIVERED_ID,
            type: "DELIVERED",
            occurredAt: at("04:55:00"),
            tripStopId: STOP,
            orderId: "ORD1",
            deliveredUnits: 120,
          },
          { ...arrived, tripStopId: STOP },
        ]),
      );

      expect(completeStop).toHaveBeenCalledOnce();
      expect(vi.mocked(arriveAtStop).mock.invocationCallOrder[0]!).toBeLessThan(
        vi.mocked(completeStop).mock.invocationCallOrder[0]!,
      );
    });

    it("lets a poisoned event fail alone", async () => {
      const server = await serverFor();

      const response = await server.inject(
        drain([
          { ...arrived, tripStopId: STOP },
          // Valid to the schema, wrong to the domain: a delivery with no quantity.
          {
            id: DELIVERED_ID,
            type: "DELIVERED",
            occurredAt: at("05:00:00"),
            tripStopId: OTHER_STOP,
            orderId: "ORD2",
          },
          { ...unloadStart, tripStopId: STOP },
        ]),
      );

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        accepted: 2,
        rejected: [{ id: DELIVERED_ID, code: "DELIVERED_INCOMPLETE" }],
      });
      expect(arriveAtStop).toHaveBeenCalledOnce();
      expect(startUnloading).toHaveBeenCalledOnce();
    });

    it("reports a transition the stop refuses as rejected, and carries on", async () => {
      const server = await serverFor();
      vi.mocked(startUnloading).mockRejectedValue(
        new StopStateError("STATE_MISMATCH", "Unloading cannot start at a stop that is PENDING."),
      );

      const response = await server.inject(drain(batch));

      expect(response.json()).toMatchObject({
        accepted: 2,
        rejected: [{ id: UNLOAD_ID, code: "STATE_MISMATCH" }],
      });
    });

    it("leaves an event that failed unexpectedly out of every list, so the device retries it", async () => {
      const server = await serverFor();
      vi.mocked(reportProblem).mockRejectedValue(new Error("connection reset"));

      const response = await server.inject(drain(batch));

      // Not rejected (that is final), not accepted: absent, which an outbox reads
      // as "did not land, send again". The other stop's events are unaffected.
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body).toMatchObject({ accepted: 2, rejected: [] });
      expect(body.results.map((r: { id: string }) => r.id)).toEqual([ARRIVED_ID, UNLOAD_ID]);
    });

    it("treats a second copy of an id within one batch as a duplicate and applies it once", async () => {
      const server = await serverFor();

      const response = await server.inject(
        drain([
          { ...arrived, tripStopId: STOP },
          { ...arrived, tripStopId: STOP },
        ]),
      );

      expect(response.json()).toMatchObject({ accepted: 1, duplicates: 1 });
      expect(arriveAtStop).toHaveBeenCalledOnce();
    });

    it("recognises a lost-response replay even though the stop has since left the run", async () => {
      const server = await serverFor();
      requireDriverStopMock.mockRejectedValue(new Error("denied"));
      vi.mocked(prisma.stopEvent.findMany).mockResolvedValue([stored(ARRIVED_ID)] as never);

      const response = await server.inject(drain([{ ...arrived, tripStopId: STOP }]));

      // The driver's own record, replayed. Calling it forbidden would leave the
      // device holding a row the server already has.
      expect(response.json()).toMatchObject({
        accepted: 0,
        duplicates: 1,
        rejected: [],
        results: [{ id: ARRIVED_ID, status: "duplicate" }],
      });
    });

    it("will not call an id reused for a different stop a duplicate", async () => {
      const server = await serverFor();
      vi.mocked(prisma.stopEvent.findMany).mockResolvedValue([
        stored(ARRIVED_ID, "NONE", OTHER_STOP),
      ] as never);

      const response = await server.inject(drain([{ ...arrived, tripStopId: STOP }]));

      expect(response.json()).toMatchObject({
        duplicates: 0,
        rejected: [{ id: ARRIVED_ID, code: "ID_REUSED" }],
      });
      expect(arriveAtStop).not.toHaveBeenCalled();
    });

    it("reads a unique-violation race as a duplicate, not a failure", async () => {
      const server = await serverFor();
      // Another request with the same id got past the dedup query first; this
      // one's transaction rolled back whole, so nothing here ran twice.
      vi.mocked(arriveAtStop).mockRejectedValue(Object.assign(new Error("unique"), { code: "P2002" }));
      vi.mocked(prisma.stopEvent.findMany)
        .mockResolvedValueOnce([] as never)
        .mockResolvedValueOnce([stored(ARRIVED_ID)] as never);

      const response = await server.inject(drain([{ ...arrived, tripStopId: STOP }]));

      expect(response.json()).toMatchObject({ accepted: 0, duplicates: 1, rejected: [] });
    });

    it("keeps the two routes' answers identical for the same events", async () => {
      const server = await serverFor();

      const online = await server.inject(post([arrived, unloadStart]));
      vi.mocked(arriveAtStop).mockClear();
      const offline = await server.inject(
        drain([
          { ...arrived, tripStopId: STOP },
          { ...unloadStart, tripStopId: STOP },
        ]),
      );

      const { clockSkewMs: _skew, serverSeq: _seq, ...batch } = offline.json();
      expect(batch).toEqual(online.json());
    });

    it("accepts a tripStopId on the per-stop route and ignores it in favour of the URL", async () => {
      const server = await serverFor();

      const response = await server.inject(post([{ ...arrived, tripStopId: OTHER_STOP }]));

      expect(response.statusCode).toBe(200);
      expect(arriveAtStop).toHaveBeenCalledWith(STOP, driver, expect.anything());
    });

    it("answers a stop-state refusal on the online route as rejected, not as an error", async () => {
      const server = await serverFor();
      vi.mocked(completeStop).mockRejectedValue(
        new StopStateError("STOP_ALREADY_CLOSED", "This stop has already been completed."),
      );

      const response = await server.inject(
        post([
          {
            id: DELIVERED_ID,
            type: "DELIVERED",
            occurredAt: at("04:55:00"),
            orderId: "ORD1",
            deliveredUnits: 120,
            recipientName: "K. Jayasuriya",
          },
        ]),
      );

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        accepted: 0,
        rejected: [{ id: DELIVERED_ID, code: "STOP_ALREADY_CLOSED" }],
      });
    });

    it("refuses a POD with no delivered lines: it has nothing to close", async () => {
      const server = await serverFor();

      const offline = await server.inject(
        drain([
          {
            id: POD_ID,
            type: "POD_CAPTURED",
            occurredAt: at("04:56:00"),
            tripStopId: STOP,
            recipientName: "K. Jayasuriya",
          },
        ]),
      );
      const online = await server.inject(
        post([
          {
            id: POD_ID,
            type: "POD_CAPTURED",
            occurredAt: at("04:56:00"),
            recipientName: "K. Jayasuriya",
          },
        ]),
      );

      expect(offline.json()).toMatchObject({
        accepted: 0,
        rejected: [{ id: POD_ID, code: "POD_WITHOUT_DELIVERY" }],
      });
      expect(online.statusCode).toBe(422);
      expect(online.json().error.code).toBe("POD_WITHOUT_DELIVERY");
      expect(completeStop).not.toHaveBeenCalled();
    });

    it("still sends the whole batch's other stops through when one completion is rejected", async () => {
      const server = await serverFor();

      const response = await server.inject(
        drain([
          // No recipient anywhere: not a delivery.
          {
            id: DELIVERED_ID,
            type: "DELIVERED",
            occurredAt: at("04:55:00"),
            tripStopId: STOP,
            orderId: "ORD1",
            deliveredUnits: 120,
          },
          { ...arrived, id: ulid("RWJ"), tripStopId: OTHER_STOP },
        ]),
      );

      expect(response.json()).toMatchObject({
        accepted: 1,
        rejected: [{ id: DELIVERED_ID, code: "RECIPIENT_REQUIRED" }],
      });
    });
  });

  describe("multi-page proof of delivery", () => {
    const PAGE_A = ulid("PG1");
    const PAGE_B = ulid("PG2");
    const png = "data:image/png;base64,iVBORw0KGgo=";
    const jpeg = "data:image/jpeg;base64,/9j/4AAQSkZJRg==";
    const page = (id: string, extra: Record<string, unknown> = {}) => ({
      id,
      kind: "RECEIPT",
      data: png,
      capturedAt: "2026-04-09T04:55:30.000Z",
      ...extra,
    });
    const lines = {
      id: DELIVERED_ID,
      type: "DELIVERED",
      occurredAt: "2026-04-09T04:55:00.000Z",
      orderId: "ORD1",
      deliveredUnits: 120,
    };
    const pod = (pages: unknown[], extra: Record<string, unknown> = {}) => ({
      id: POD_ID,
      type: "POD_CAPTURED",
      occurredAt: "2026-04-09T04:56:00.000Z",
      recipientName: "K. Jayasuriya",
      pages,
      ...extra,
    });

    it("hands the pages to the completion in capture order", async () => {
      const server = await serverFor();

      const response = await server.inject(
        post([
          lines,
          pod([
            page(PAGE_A, { qualityFlags: ["BLURRY"] }),
            page(PAGE_B, { kind: "SIGNATURE", data: jpeg }),
          ]),
        ]),
      );

      expect(response.statusCode).toBe(200);
      const input = vi.mocked(completeStop).mock.calls[0]![2];
      expect(input.pages).toEqual([
        {
          id: PAGE_A,
          kind: "RECEIPT",
          data: png,
          qualityFlags: ["BLURRY"],
          capturedAt: new Date("2026-04-09T04:55:30.000Z"),
        },
        {
          id: PAGE_B,
          kind: "SIGNATURE",
          data: jpeg,
          qualityFlags: [],
          capturedAt: new Date("2026-04-09T04:55:30.000Z"),
        },
      ]);
    });

    it("lets pages win when a client sends them alongside the legacy fields", async () => {
      const server = await serverFor();

      await server.inject(
        post([
          lines,
          pod([page(PAGE_A)], { signatureData: "data:image/png;base64,LEGACY" }),
        ]),
      );

      const input = vi.mocked(completeStop).mock.calls[0]![2];
      // The same picture is not stored twice.
      expect(input.signatureData).toBeUndefined();
      expect(input.photoData).toBeUndefined();
      expect(input.pages).toHaveLength(1);
    });

    it("still takes the legacy fields when no pages are sent", async () => {
      const server = await serverFor();

      await server.inject(
        post([
          lines,
          {
            id: POD_ID,
            type: "POD_CAPTURED",
            occurredAt: "2026-04-09T04:56:00.000Z",
            recipientName: "K. Jayasuriya",
            signatureData: "data:image/png;base64,AAA",
            photoData: "data:image/jpeg;base64,BBB",
          },
        ]),
      );

      expect(vi.mocked(completeStop).mock.calls[0]![2]).toMatchObject({
        signatureData: "data:image/png;base64,AAA",
        photoData: "data:image/jpeg;base64,BBB",
        pages: undefined,
      });
    });

    it("refuses a ninth page at the schema, on both routes", async () => {
      const server = await serverFor();
      const nine = Array.from({ length: 9 }, (_, i) => page(ulid(`P${i}A`)));

      const online = await server.inject(post([lines, pod(nine)]));
      const offline = await server.inject(
        drain([
          { ...lines, tripStopId: STOP },
          { ...pod(nine), tripStopId: STOP },
        ]),
      );

      expect(online.statusCode).toBe(422);
      expect(offline.statusCode).toBe(422);
      expect(completeStop).not.toHaveBeenCalled();
    });

    it("accepts exactly eight pages", async () => {
      const server = await serverFor();
      const eight = Array.from({ length: 8 }, (_, i) => page(ulid(`P${i}A`)));

      const response = await server.inject(post([lines, pod(eight)]));

      expect(response.statusCode).toBe(200);
      expect(vi.mocked(completeStop).mock.calls[0]![2].pages).toHaveLength(8);
    });

    it.each([
      ["a plain https URL", "https://example.com/receipt.png"],
      ["a non-image data URL", "data:text/html;base64,PGgxPg=="],
      ["a data URL that is not base64", "data:image/png,rawbytes"],
      ["an empty string", ""],
    ])("refuses page data that is %s", async (_label, data) => {
      const server = await serverFor();

      const response = await server.inject(post([lines, pod([page(PAGE_A, { data })])]));

      expect(response.statusCode).toBe(422);
      expect(completeStop).not.toHaveBeenCalled();
    });

    it("refuses a page that is over the size cap", async () => {
      const server = await serverFor();
      const huge = `data:image/png;base64,${"A".repeat(MAX_POD_PAGE_CHARS)}`;

      const response = await server.inject(post([lines, pod([page(PAGE_A, { data: huge })])]));

      expect(response.statusCode).toBe(422);
    });

    it("refuses a page whose body is not base64 even though its prefix is right", async () => {
      const server = await serverFor();
      const bad = page(PAGE_A, { data: "data:image/png;base64,not base64 !!" });

      const online = await server.inject(post([lines, pod([bad])]));
      const offline = await server.inject(
        drain([
          { ...arrived, tripStopId: OTHER_STOP },
          { ...lines, tripStopId: STOP },
          { ...pod([bad]), tripStopId: STOP },
        ]),
      );

      expect(online.statusCode).toBe(422);
      expect(online.json().error.code).toBe("PAGE_DATA_INVALID");
      // Offline, the bad POD costs its own delivery, not the other stop's arrival.
      expect(offline.json()).toMatchObject({
        accepted: 1,
        rejected: [
          { id: DELIVERED_ID, code: "POD_REJECTED" },
          { id: POD_ID, code: "PAGE_DATA_INVALID" },
        ],
      });
    });

    it("refuses an unknown page kind, a malformed id and an undeclared field", async () => {
      const server = await serverFor();

      const kind = await server.inject(post([lines, pod([page(PAGE_A, { kind: "VIDEO" })])]));
      const id = await server.inject(post([lines, pod([page("not-a-ulid")])]));
      const extra = await server.inject(post([lines, pod([page(PAGE_A, { caption: "x" })])]));

      expect(kind.statusCode).toBe(422);
      expect(id.statusCode).toBe(422);
      expect(extra.statusCode).toBe(422);
    });

    it("refuses quality flags that are not short codes", async () => {
      const server = await serverFor();

      const response = await server.inject(
        post([lines, pod([page(PAGE_A, { qualityFlags: ["the text is a bit blurry"] })])]),
      );

      expect(response.statusCode).toBe(422);
    });

    it("refuses two pages that share an id", async () => {
      const server = await serverFor();

      const response = await server.inject(post([lines, pod([page(PAGE_A), page(PAGE_A)])]));

      expect(response.statusCode).toBe(422);
      expect(response.json().error.code).toBe("DUPLICATE_PAGE_ID");
    });

    it("refuses pages on an event that is not a POD", async () => {
      const server = await serverFor();

      const response = await server.inject(post([{ ...arrived, pages: [page(PAGE_A)] }]));

      expect(response.statusCode).toBe(422);
      expect(response.json().error.code).toBe("PAGES_ON_NON_POD");
    });

    it("reports a page id already used elsewhere as a collision, not a duplicate", async () => {
      const server = await serverFor();
      vi.mocked(completeStop).mockRejectedValue(
        Object.assign(new Error("unique"), { code: "P2002" }),
      );

      const response = await server.inject(
        drain([
          { ...lines, tripStopId: STOP },
          { ...pod([page(PAGE_A)]), tripStopId: STOP },
        ]),
      );

      // The event ids are NOT in the table, so the unique violation was the page's.
      expect(response.json()).toMatchObject({
        duplicates: 0,
        rejected: [
          { id: DELIVERED_ID, code: "ID_COLLISION" },
          { id: POD_ID, code: "ID_COLLISION" },
        ],
      });
    });

    it("stores a conflicted POD's pages with it, nested in the same insert", async () => {
      const server = await serverFor();
      requireDriverStopMock.mockRejectedValue(new Error("denied"));
      vi.mocked(prisma.stopReassignment.findFirst).mockResolvedValue({ id: "RA1" } as never);

      await server.inject(
        post([pod([page(PAGE_A), page(PAGE_B, { kind: "SIGNATURE" })], { signatureData: "LEGACY" })]),
      );

      const data = vi.mocked(prisma.stopEvent.create).mock.calls[0]![0].data as Record<string, unknown>;
      expect(data).toMatchObject({
        id: POD_ID,
        conflictState: "STALE_ASSIGNMENT",
        // Alternatives, as on an applied event.
        signatureData: null,
        photoData: null,
        podPages: {
          create: [
            { id: PAGE_A, seq: 0, kind: "RECEIPT" },
            { id: PAGE_B, seq: 1, kind: "SIGNATURE" },
          ],
        },
      });
    });
  });
});
