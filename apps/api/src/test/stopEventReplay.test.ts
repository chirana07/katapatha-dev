import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionUser } from "../lib/auth.js";
import { CONTRACT_AJV } from "../lib/ajv.js";
import { recordDecision } from "../lib/audit.js";
import { prisma } from "../lib/db.js";
import errorsPlugin from "../plugins/errors.js";
import stopRoutes from "../routes/stops.js";
import syncRoutes from "../routes/sync.js";

/**
 * Replay, end to end through the real applier and the real state machine.
 *
 * stopsAndSync.test.ts mocks services/delivery, so it can prove the applier
 * *decides* a replay is a duplicate but not that nothing happens as a result.
 * This file keeps delivery.ts real and replaces only the database with a small
 * in-memory one that has what the claim depends on: a primary key that refuses a
 * second row, and transactions that roll back whole. Then "a replay changes
 * nothing" is checked by counting rows and side effects, not by asserting that a
 * mock was not called.
 */

type Row = Record<string, any>;

const db = vi.hoisted(() => {
  const state = {
    stopEvents: [] as Row[],
    podPages: [] as Row[],
    orders: new Map<string, Row>(),
    notifications: [] as Row[],
    stop: {} as Row,
    trip: {} as Row,
    /** When set, tripStop reads return this frozen view: a request that read before another committed. */
    staleStop: null as Row | null,
  };
  return { state };
});

vi.mock("../lib/audit.js", () => ({ recordDecision: vi.fn(), recordDecisions: vi.fn() }));

vi.mock("../lib/authorization.js", () => ({
  requireDriverStop: vi.fn(async () => ({ id: "STP001", status: db.state.stop.status })),
}));

vi.mock("../lib/db.js", () => makeDb());

function makeDb() {
  const { state } = db;

  const unique = (what: string) =>
    Object.assign(new Error(`Unique constraint failed on ${what}`), { code: "P2002" });

  // Prisma's queries are lazy: they run when awaited or handed to $transaction.
  // The state machine builds one, branches, then either awaits it or batches it,
  // so a fake that ran eagerly would not behave like the real client.
  const lazy = <T>(run: () => Promise<T> | T) => ({
    then: (resolve: (v: T) => unknown, reject: (e: unknown) => unknown) =>
      Promise.resolve().then(run).then(resolve, reject),
  });

  const snapshot = () => ({
    stopEvents: structuredClone(state.stopEvents),
    podPages: structuredClone(state.podPages),
    orders: structuredClone([...state.orders]),
    notifications: structuredClone(state.notifications),
    stop: structuredClone(state.stop),
    trip: structuredClone(state.trip),
  });
  const restore = (saved: ReturnType<typeof snapshot>) => {
    state.stopEvents = saved.stopEvents;
    state.podPages = saved.podPages;
    state.orders = new Map(saved.orders);
    state.notifications = saved.notifications;
    state.stop = saved.stop;
    state.trip = saved.trip;
  };

  const stopView = () => {
    const stop = state.staleStop ?? state.stop;
    return {
      ...stop,
      trip: { ...state.trip },
      outlet: { id: "OUT074" },
      orders: [...state.orders.values()].map((order) => ({ order })),
    };
  };

  const client: any = {
    stopEvent: {
      findFirst: vi.fn(async () => null),
      findMany: vi.fn(async ({ where }: any) =>
        state.stopEvents.filter((row) => where.id.in.includes(row.id)),
      ),
      create: ({ data }: any) =>
        lazy(() => {
          if (state.stopEvents.some((row) => row.id === data.id)) throw unique("StopEvent.id");
          const { podPages, ...row } = data;
          state.stopEvents.push({ conflictState: "NONE", ...row });
          for (const [seq, page] of (podPages?.create ?? []).entries()) {
            if (state.podPages.some((p) => p.id === page.id)) throw unique("PodPage.id");
            state.podPages.push({ ...page, stopEventId: data.id, seq });
          }
          return row;
        }),
    },
    tripStop: {
      findUnique: vi.fn(async () => stopView()),
      findMany: vi.fn(async ({ where }: any) =>
        where.id.in.map((id: string) => ({
          id,
          trip: { vehicleId: "VEH043" },
          reassignments: [],
          stopEvents: state.stopEvents
            .filter(
              (e) =>
                ["DELIVERED", "PART_DELIVERED", "POD_CAPTURED", "FAILED", "SKIPPED"].includes(e.type) &&
                e.conflictState === "NONE",
            )
            .map((e) => ({ deviceId: e.deviceId, actorUserId: e.actorUserId })),
        })),
      ),
      update: ({ data }: any) =>
        lazy(() => {
          Object.assign(state.stop, data);
        }),
      count: vi.fn(async () => 0),
    },
    tripStopOrder: {
      findMany: vi.fn(async () => [...state.orders.values()].map((order) => ({ tripStopId: "STP001", order }))),
    },
    trip: {
      update: ({ data }: any) =>
        lazy(() => {
          Object.assign(state.trip, data);
        }),
    },
    order: {
      update: vi.fn(async ({ where, data }: any) => {
        Object.assign(state.orders.get(where.id)!, data);
      }),
    },
    notification: {
      create: vi.fn(async ({ data }: any) => {
        state.notifications.push(data);
      }),
    },
    stopReassignment: { findFirst: vi.fn(async () => null) },
    syncLog: { create: vi.fn(async () => ({})) },
    $transaction: async (arg: any) => {
      const saved = snapshot();
      try {
        if (typeof arg === "function") return await arg(client);
        const out = [];
        for (const query of arg) out.push(await query);
        return out;
      } catch (error) {
        restore(saved);
        throw error;
      }
    },
  };
  return { prisma: client };
}

const DEVICE = "device-7f3a91";
const STOP = "STP001";
const ids = {
  arrived: "01JB2X8Q9K7YC4V3M0ZQ5T6RWE",
  unload: "01JB2X8Q9K7YC4V3M0ZQ5T6RWF",
  line: "01JB2X8Q9K7YC4V3M0ZQ5T6RWG",
  pod: "01JB2X8Q9K7YC4V3M0ZQ5T6RWH",
  pageA: "01JB2X8Q9K7YC4V3M0ZQ5T6PG1",
  pageB: "01JB2X8Q9K7YC4V3M0ZQ5T6PG2",
};

const driver: SessionUser = {
  id: "USR012",
  email: "ruwan@waypoint.lk",
  name: "Ruwan Silva",
  role: "DRIVER",
  depotCode: "Peliyagoda",
  outletId: null,
  defaultVehicleId: "VEH043",
};

const png = "data:image/png;base64,iVBORw0KGgo=";
const delivery = (pod: Record<string, unknown> = {}) => [
  { id: ids.arrived, type: "ARRIVED", occurredAt: "2026-04-09T04:42:00.000Z", tripStopId: STOP },
  { id: ids.unload, type: "UNLOAD_START", occurredAt: "2026-04-09T04:45:00.000Z", tripStopId: STOP },
  {
    id: ids.line,
    type: "DELIVERED",
    occurredAt: "2026-04-09T04:55:00.000Z",
    tripStopId: STOP,
    orderId: "ORD1",
    deliveredUnits: 10,
  },
  {
    id: ids.pod,
    type: "POD_CAPTURED",
    occurredAt: "2026-04-09T04:56:00.000Z",
    tripStopId: STOP,
    recipientName: "K. Jayasuriya",
    ...pod,
  },
];

describe("replaying a stop event", () => {
  const servers: ReturnType<typeof Fastify>[] = [];

  beforeEach(() => {
    vi.clearAllMocks();
    db.state.stopEvents = [];
    db.state.podPages = [];
    db.state.orders = new Map([["ORD1", { id: "ORD1", units: 10, status: "LOADED" }]]);
    db.state.notifications = [];
    db.state.staleStop = null;
    db.state.stop = { id: STOP, tripId: "TRP1", outletId: "OUT074", status: "PENDING" };
    db.state.trip = { id: "TRP1", vehicleId: "VEH043", status: "LOADED", departedAt: null };
  });

  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => server.close()));
  });

  async function server() {
    const app = Fastify({ logger: false, ajv: CONTRACT_AJV });
    servers.push(app);
    app.decorateRequest("requireRole", function () {
      return driver;
    });
    await app.register(errorsPlugin);
    await app.register(stopRoutes, { prefix: "/v1" });
    await app.register(syncRoutes, { prefix: "/v1" });
    return app;
  }

  const drain = (events: unknown[]) => ({
    method: "POST" as const,
    url: "/v1/sync/stop-events",
    payload: { deviceId: DEVICE, clientClockAt: "2026-04-09T06:02:11.000Z", events },
  });

  /** Everything a replay could wrongly repeat, measured rather than mocked. */
  function footprint() {
    return {
      events: db.state.stopEvents.length,
      pages: db.state.podPages.length,
      notifications: db.state.notifications.length,
      decisions: vi.mocked(recordDecision).mock.calls.length,
      orderStatus: db.state.orders.get("ORD1")!.status,
      stopStatus: db.state.stop.status,
    };
  }

  it("stores the client's ULID as the row's primary key", async () => {
    const app = await server();

    await app.inject(drain(delivery()));

    expect(db.state.stopEvents.map((row) => row.id).sort()).toEqual(
      [ids.arrived, ids.unload, ids.line, ids.pod].sort(),
    );
  });

  it("applies a delivery once and a replay of the same batch changes nothing", async () => {
    const app = await server();

    const first = await app.inject(drain(delivery({ pages: [] })));
    const afterFirst = footprint();
    const replay = await app.inject(drain(delivery({ pages: [] })));

    expect(first.json()).toMatchObject({ accepted: 4, duplicates: 0, rejected: [] });
    expect(afterFirst).toEqual({
      events: 4,
      pages: 0,
      notifications: 1,
      decisions: 1,
      orderStatus: "DELIVERED",
      stopStatus: "DONE",
    });
    expect(replay.json()).toMatchObject({ accepted: 0, duplicates: 4, rejected: [] });
    // One row per event, one notification to the store, one decision: the replay
    // produced no second copy of anything.
    expect(footprint()).toEqual(afterFirst);
  });

  it("treats the same id arriving on the online route after the sync route as a duplicate", async () => {
    const app = await server();
    await app.inject(drain(delivery()));
    const before = footprint();

    const online = await app.inject({
      method: "POST",
      url: `/v1/stops/${STOP}/events`,
      payload: { deviceId: DEVICE, events: delivery().map(({ tripStopId: _t, ...event }) => event) },
    });

    expect(online.json()).toMatchObject({ accepted: 0, duplicates: 4 });
    expect(footprint()).toEqual(before);
  });

  it("does not re-run side effects when a racing copy passes the dedup check", async () => {
    const app = await server();
    await app.inject(drain(delivery()));
    const before = footprint();

    // A second request read the stop and the dedup table before the first
    // committed: it sees an open stop and no stored ids, so only the primary key
    // stands between it and a second delivery. Its transaction must fail on the
    // first insert and unwind, leaving no second notification or decision.
    const staleStop = { id: STOP, tripId: "TRP1", outletId: "OUT074", status: "UNLOADING" };
    db.state.staleStop = staleStop;
    const realFindMany = vi.mocked(prisma.stopEvent.findMany).getMockImplementation()!;
    vi.mocked(prisma.stopEvent.findMany).mockImplementationOnce((async () => []) as never);

    const raced = await app.inject(drain(delivery().slice(2)));
    db.state.staleStop = null;
    vi.mocked(prisma.stopEvent.findMany).mockImplementation(realFindMany);

    expect(raced.statusCode).toBe(200);
    expect(raced.json()).toMatchObject({ accepted: 0, duplicates: 2, rejected: [] });
    expect(footprint()).toEqual(before);
  });

  it("answers a second, different delivery for a completed stop with a rejection, not an acceptance", async () => {
    const app = await server();
    await app.inject(drain(delivery()));
    const before = footprint();

    const again = await app.inject(
      drain([
        { ...delivery()[2], id: "01JB2X8Q9K7YC4V3M0ZQ5T6RXA" },
        { ...delivery()[3], id: "01JB2X8Q9K7YC4V3M0ZQ5T6RXB" },
      ]),
    );

    // Before: reported accepted and written nowhere, so every retry was "accepted".
    expect(again.json()).toMatchObject({
      accepted: 0,
      rejected: [
        { id: "01JB2X8Q9K7YC4V3M0ZQ5T6RXA", code: "STOP_ALREADY_CLOSED" },
        { id: "01JB2X8Q9K7YC4V3M0ZQ5T6RXB", code: "STOP_ALREADY_CLOSED" },
      ],
    });
    expect(footprint()).toEqual(before);
  });

  it("stores a late ARRIVED as a fact without moving the stop backwards", async () => {
    const app = await server();
    db.state.stop.status = "UNLOADING";

    const response = await app.inject(drain(delivery().slice(0, 1)));

    expect(response.json()).toMatchObject({ accepted: 1 });
    expect(db.state.stopEvents.map((row) => row.id)).toEqual([ids.arrived]);
    expect(db.state.stop.status).toBe("UNLOADING");

    const replay = await app.inject(drain(delivery().slice(0, 1)));
    expect(replay.json()).toMatchObject({ accepted: 0, duplicates: 1 });
    expect(db.state.stopEvents).toHaveLength(1);
  });

  describe("pages", () => {
    const pages = [
      { id: ids.pageA, kind: "RECEIPT", data: png, qualityFlags: ["CROPPED"], capturedAt: "2026-04-09T04:55:20.000Z" },
      { id: ids.pageB, kind: "SIGNATURE", data: png, capturedAt: "2026-04-09T04:55:40.000Z" },
    ];

    it("writes the pages with the POD, in array order, and a replay does not add more", async () => {
      const app = await server();

      await app.inject(drain(delivery({ pages })));
      const afterFirst = footprint();
      await app.inject(drain(delivery({ pages })));

      expect(afterFirst).toMatchObject({ events: 4, pages: 2 });
      expect(db.state.podPages).toMatchObject([
        { id: ids.pageA, stopEventId: ids.pod, seq: 0, kind: "RECEIPT", qualityFlags: ["CROPPED"] },
        { id: ids.pageB, stopEventId: ids.pod, seq: 1, kind: "SIGNATURE", qualityFlags: [] },
      ]);
      expect(db.state.podPages[0]!.capturedAt).toEqual(new Date("2026-04-09T04:55:20.000Z"));
      expect(footprint()).toEqual(afterFirst);
    });

    it("stores no legacy copy of a picture that is already a page", async () => {
      const app = await server();

      await app.inject(drain(delivery({ pages, signatureData: "data:image/png;base64,LEGACY" })));

      const podRow = db.state.stopEvents.find((row) => row.id === ids.pod)!;
      expect(podRow.signatureData).toBeUndefined();
      expect(db.state.podPages).toHaveLength(2);
    });

    it("keeps writing the legacy columns for a client that sends no pages", async () => {
      const app = await server();

      await app.inject(
        drain(delivery({ signatureData: "data:image/png;base64,AAA", photoData: "data:image/jpeg;base64,BBB" })),
      );

      const podRow = db.state.stopEvents.find((row) => row.id === ids.pod)!;
      expect(podRow).toMatchObject({
        signatureData: "data:image/png;base64,AAA",
        photoData: "data:image/jpeg;base64,BBB",
      });
      expect(db.state.podPages).toHaveLength(0);
    });

    it("writes nothing at all if a page id is already taken: the POD and its lines roll back together", async () => {
      const app = await server();
      db.state.podPages.push({ id: ids.pageB, stopEventId: "SOME-OTHER-EVENT", seq: 0 });

      const response = await app.inject(drain(delivery({ pages })));

      expect(response.json()).toMatchObject({
        accepted: 2,
        rejected: [
          { id: ids.line, code: "ID_COLLISION" },
          { id: ids.pod, code: "ID_COLLISION" },
        ],
      });
      // The two events that did not collide (ARRIVED, UNLOAD_START) landed; the
      // delivery did not, and left no order status, notification or page behind.
      expect(db.state.stopEvents.map((row) => row.id).sort()).toEqual([ids.arrived, ids.unload].sort());
      expect(db.state.podPages).toHaveLength(1);
      expect(db.state.notifications).toHaveLength(0);
      expect(db.state.orders.get("ORD1")!.status).toBe("LOADED");
    });
  });
});
