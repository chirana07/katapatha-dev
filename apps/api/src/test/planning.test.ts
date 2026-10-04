import Fastify from "fastify";
import { validatePlan } from "@katapatha/core/validation/rules";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CONTRACT_AJV } from "../lib/ajv.js";
import { requireRoleOf, type SessionUser } from "../lib/auth.js";
import { prisma } from "../lib/db.js";
import errorsPlugin from "../plugins/errors.js";
import planningRoutes from "../routes/planning.js";
import { describeDeferrals, laneAlternatives, nextRunDate } from "../services/deferrals.js";
import { loadDayContext, loadPlan, runAutoPlan } from "../services/plans.js";
import { snapshotFromPlan } from "../services/snapshot.js";
import { isOperatingDay } from "../services/calendar.js";
import { commitPlanFuel } from "../services/fuel.js";
import { derivePriorityInputs } from "../services/priority.js";
import { rollDeferredOrders } from "../services/rollover.js";

/**
 * The dispatcher's desk: planning days, plans, deferral confirmation, and the
 * publication transaction.
 *
 * The role gate is the real `requireRoleOf`. The allocator, the validator and
 * the deferral explainer are mocked at their module boundaries: this file is
 * about what the routes decide with their answers — whose depot, which status,
 * what is written and in what order — not about the allocator's arithmetic.
 * The deferral wording, by contrast, is the real `@katapatha/core` text,
 * because what the store reads is the point of the notification assertions.
 */

vi.mock("../lib/db.js", () => ({
  prisma: {
    planningDay: { findMany: vi.fn(), findFirst: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    plan: { findMany: vi.fn(), findFirst: vi.fn(), findUnique: vi.fn(), updateMany: vi.fn() },
    assignment: { findMany: vi.fn(), updateMany: vi.fn() },
    order: { count: vi.fn(), updateMany: vi.fn() },
    deferral: { upsert: vi.fn() },
    notification: { create: vi.fn() },
    auditEvent: { create: vi.fn(), createMany: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock("../services/plans.js", () => ({
  loadPlan: vi.fn(),
  loadDayContext: vi.fn(),
  runAutoPlan: vi.fn(),
}));

vi.mock("../services/deferrals.js", () => ({
  describeDeferrals: vi.fn(),
  laneAlternatives: vi.fn(),
  nextRunDate: vi.fn(),
}));

vi.mock("../services/snapshot.js", () => ({ snapshotFromPlan: vi.fn() }));
vi.mock("../services/calendar.js", () => ({ isOperatingDay: vi.fn() }));
vi.mock("../services/fuel.js", () => ({ commitPlanFuel: vi.fn() }));
vi.mock("../services/priority.js", () => ({ derivePriorityInputs: vi.fn() }));
vi.mock("../services/rollover.js", () => ({ rollDeferredOrders: vi.fn() }));
vi.mock("@katapatha/core/validation/rules", () => ({ validatePlan: vi.fn() }));

const dispatcher: SessionUser = {
  id: "USR001",
  email: "nimal@waypoint.lk",
  name: "Nimal Perera",
  role: "DISPATCHER",
  depotCode: "Peliyagoda",
  outletId: null,
  defaultVehicleId: null,
};
const manager: SessionUser = { ...dispatcher, id: "USR004", role: "STORE_MANAGER", depotCode: null, outletId: "OUT074" };
const loader: SessionUser = { ...dispatcher, id: "USR007", role: "LOADER" };

const DAY = new Date("2026-10-03T00:00:00.000Z");

function planningDay(over: Record<string, unknown> = {}) {
  return { id: "PD1", date: DAY, depotCode: "Peliyagoda", status: "OPEN", cutoffAt: "16:00", ...over };
}

const meter = {
  vehicleId: "VEH043",
  tripsUsed: 2,
  predawnUsedMin: 212,
  predawnBudgetMin: 270,
  daytimeUsedMin: 188.5,
  daytimeBudgetMin: 480,
  fuelCommittedL: 212.4,
  fuelQuotaL: 300,
};

describe("planning routes", () => {
  const servers: ReturnType<typeof Fastify>[] = [];

  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(prisma.$transaction).mockImplementation(
      ((fn: (tx: typeof prisma) => unknown) => fn(prisma)) as never,
    );
    vi.mocked(nextRunDate).mockResolvedValue("2026-10-05");
    vi.mocked(isOperatingDay).mockResolvedValue(true);
    vi.mocked(commitPlanFuel).mockResolvedValue({ trips: 0, litres: 0 });
    vi.mocked(derivePriorityInputs).mockResolvedValue(0);
    vi.mocked(rollDeferredOrders).mockResolvedValue([]);
  });

  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => server.close()));
  });

  async function serverFor(user: SessionUser | null = dispatcher) {
    const server = Fastify({ logger: false, ajv: CONTRACT_AJV });
    servers.push(server);
    server.decorateRequest("requireRole", function (...roles: never[]) {
      return requireRoleOf(user, ...roles);
    });
    await server.register(errorsPlugin);
    await server.register(planningRoutes, { prefix: "/v1" });
    return server;
  }

  type TestServer = Awaited<ReturnType<typeof serverFor>>;

  /** Every decision-log row written, whether through `recordDecision` or `recordDecisions`. */
  function auditRows(): Array<Record<string, unknown>> {
    return [
      ...vi.mocked(prisma.auditEvent.create).mock.calls.map((call) => (call[0] as { data: Record<string, unknown> }).data),
      ...vi.mocked(prisma.auditEvent.createMany).mock.calls.flatMap(
        (call) => (call[0] as { data: Array<Record<string, unknown>> }).data,
      ),
    ];
  }

  describe("GET /v1/planning-days", () => {
    it("scopes to the dispatcher's depot even when the query names another", async () => {
      vi.mocked(prisma.planningDay.findMany).mockResolvedValue([planningDay()] as never);
      const server = await serverFor();

      const response = await server.inject({ method: "GET", url: "/v1/planning-days?depotCode=Kandy&date=2026-10-03" });

      expect(response.statusCode).toBe(200);
      const args = vi.mocked(prisma.planningDay.findMany).mock.calls[0]![0]!;
      expect(args.where).toEqual({ depotCode: "Peliyagoda", date: DAY });
      expect(args).toMatchObject({ orderBy: [{ date: "desc" }], take: 30 });
      expect(response.json()).toEqual([
        { id: "PD1", date: "2026-10-03", depotCode: "Peliyagoda", status: "OPEN", cutoffAt: "16:00" },
      ]);
    });

    it("lists the depot's recent days when no date is given", async () => {
      vi.mocked(prisma.planningDay.findMany).mockResolvedValue([] as never);
      const server = await serverFor();

      await server.inject({ method: "GET", url: "/v1/planning-days" });

      expect(vi.mocked(prisma.planningDay.findMany).mock.calls[0]![0]!.where).toEqual({ depotCode: "Peliyagoda" });
    });

    it("is the dispatcher's alone, and an account with no depot sees nothing", async () => {
      for (const user of [manager, loader]) {
        const server = await serverFor(user);
        expect((await server.inject({ method: "GET", url: "/v1/planning-days" })).statusCode).toBe(403);
      }
      const noDepot = await serverFor({ ...dispatcher, depotCode: null });
      expect((await noDepot.inject({ method: "GET", url: "/v1/planning-days" })).json()).toEqual([]);
      expect(prisma.planningDay.findMany).not.toHaveBeenCalled();
    });

    it("refuses a date that is not on the calendar instead of failing in the database", async () => {
      const server = await serverFor();

      const response = await server.inject({ method: "GET", url: "/v1/planning-days?date=2026-02-30" });

      expect(response.statusCode).toBe(422);
      expect(prisma.planningDay.findMany).not.toHaveBeenCalled();
    });
  });

  describe("GET /v1/plans", () => {
    it("lists the depot's plans with stats counted from their assignments", async () => {
      vi.mocked(prisma.plan.findMany).mockResolvedValue([
        {
          id: "PLN1",
          status: "DRAFT",
          allocatorVersion: "a3f9c1e70b4d2856",
          trips: [{ id: "T1" }, { id: "T2" }],
          assignments: [
            { decision: "SERVED", plan: { status: "DRAFT" } },
            { decision: "SERVED", plan: { status: "DRAFT" } },
            { decision: "DEFERRED", plan: { status: "DRAFT" } },
          ],
        },
        { id: "PLN2", status: "SUPERSEDED", allocatorVersion: null, trips: [], assignments: [] },
      ] as never);
      const server = await serverFor();

      const response = await server.inject({ method: "GET", url: "/v1/plans?date=2026-10-03&depotCode=Kandy" });

      expect(response.statusCode).toBe(200);
      expect(vi.mocked(prisma.plan.findMany).mock.calls[0]![0]!.where).toEqual({
        planningDay: { depotCode: "Peliyagoda", date: DAY },
      });
      expect(response.json()).toEqual([
        { planId: "PLN1", status: "DRAFT", stats: { orders: 3, served: 2, deferred: 1, tripsBuilt: 2, hash: "a3f9c1e70b4d2856" } },
        { planId: "PLN2", status: "SUPERSEDED", stats: { orders: 0, served: 0, deferred: 0, tripsBuilt: 0, hash: "" } },
      ]);
    });

    it("refuses other roles, and returns nothing for an account with no depot", async () => {
      expect((await (await serverFor(manager)).inject({ method: "GET", url: "/v1/plans" })).statusCode).toBe(403);
      const noDepot = await serverFor({ ...dispatcher, depotCode: null });
      expect((await noDepot.inject({ method: "GET", url: "/v1/plans" })).json()).toEqual([]);
      expect(prisma.plan.findMany).not.toHaveBeenCalled();
    });
  });

  describe("GET /v1/plans/:planId", () => {
    function loaded(over: Record<string, unknown> = {}) {
      return {
        id: "PLN1",
        status: "DRAFT",
        allocatorVersion: "a3f9c1e70b4d2856",
        planningDayId: "PD1",
        objectiveSummary: { served: 1, deferred: 1, trips: 1, meters: [meter] },
        planningDay: planningDay(),
        trips: [
          {
            id: "T1",
            vehicleId: "VEH043",
            tripNo: 1,
            brand: "Fresh",
            districtName: "Colombo",
            wave: "PREDAWN",
            status: "PLANNED",
            plannedDepartAt: "03:30",
            plannedMinutes: 212,
            sumWeightKg: 3210.5,
            sumVolumeM3: 16.8,
          },
        ],
        assignments: [{ decision: "SERVED" }, { decision: "DEFERRED" }],
        ...over,
      };
    }

    it("answers 404 for a plan at another depot, the same as one that does not exist", async () => {
      vi.mocked(loadPlan).mockResolvedValueOnce(loaded({ planningDay: planningDay({ depotCode: "Kandy" }) }) as never);
      vi.mocked(loadPlan).mockResolvedValueOnce(null);
      const server = await serverFor();

      const other = await server.inject({ method: "GET", url: "/v1/plans/PLN1" });
      const missing = await server.inject({ method: "GET", url: "/v1/plans/NOPE" });

      expect(other.statusCode).toBe(404);
      expect(missing.statusCode).toBe(404);
      expect(other.json()).toEqual(missing.json());
      expect(describeDeferrals).not.toHaveBeenCalled();
    });

    it("returns the board: stats from assignments, the day, trips, and the meters the allocator stored", async () => {
      const plan = loaded();
      vi.mocked(loadPlan).mockResolvedValue(plan as never);
      vi.mocked(describeDeferrals).mockResolvedValue([{ assignmentId: "A2", orderId: "O2", orderRef: "ORD-2" }] as never);
      const server = await serverFor();

      const response = await server.inject({ method: "GET", url: "/v1/plans/PLN1" });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body).toMatchObject({
        planId: "PLN1",
        date: "2026-10-03",
        status: "DRAFT",
        stats: { orders: 2, served: 1, deferred: 1, tripsBuilt: 1, hash: "a3f9c1e70b4d2856" },
        meters: [meter],
        deferrals: [{ assignmentId: "A2", orderId: "O2", orderRef: "ORD-2" }],
      });
      expect(body.trips[0]).toMatchObject({ id: "T1", plannedDepartAt: "03:30", plannedMinutes: 212 });
      expect(describeDeferrals).toHaveBeenCalledWith(plan);
    });

    it.each([
      ["no objective summary at all", null],
      ["a summary from before meters were kept", { served: 1 }],
      ["a summary whose meters are not a list", { meters: "none" }],
    ])("returns an empty meter list, not an error, for %s", async (_name, objectiveSummary) => {
      vi.mocked(loadPlan).mockResolvedValue(loaded({ objectiveSummary }) as never);
      vi.mocked(describeDeferrals).mockResolvedValue([] as never);
      const server = await serverFor();

      const response = await server.inject({ method: "GET", url: "/v1/plans/PLN1" });

      expect(response.statusCode).toBe(200);
      expect(response.json().meters).toEqual([]);
    });

    it("leaves the optional trip figures out when the allocator did not set them", async () => {
      const bare = {
        id: "T2", vehicleId: "VEH044", tripNo: 2, brand: "Tech", districtName: "Kandy", wave: "DAYTIME", status: "PLANNED",
        plannedDepartAt: null, plannedMinutes: null, sumWeightKg: null, sumVolumeM3: null,
      };
      vi.mocked(loadPlan).mockResolvedValue(loaded({ trips: [bare] }) as never);
      vi.mocked(describeDeferrals).mockResolvedValue([] as never);
      const server = await serverFor();

      const trip = (await server.inject({ method: "GET", url: "/v1/plans/PLN1" })).json().trips[0];

      expect(trip).not.toHaveProperty("plannedDepartAt");
      expect(trip).not.toHaveProperty("sumWeightKg");
    });
  });

  describe("POST /v1/plans", () => {
    const body = { date: "2026-10-03", depotCode: "Peliyagoda" };
    const output = { stats: { orders: 85, served: 78, deferred: 7, tripsBuilt: 14, hash: "a3f9c1e70b4d2856" } };

    const post = (server: TestServer, payload: unknown = body) =>
      server.inject({ method: "POST", url: "/v1/plans", payload: payload as never });

    beforeEach(() => {
      vi.mocked(prisma.planningDay.findUnique).mockResolvedValue(planningDay({ status: "CLOSED" }) as never);
      vi.mocked(runAutoPlan).mockResolvedValue({ planId: "PLN1", output } as never);
    });

    it("refuses to run the allocator for another depot", async () => {
      const server = await serverFor();

      const response = await post(server, { ...body, depotCode: "Kandy" });

      expect(response.statusCode).toBe(403);
      expect(runAutoPlan).not.toHaveBeenCalled();
    });

    it("refuses other roles, and a dispatcher with no depot", async () => {
      expect((await post(await serverFor(manager))).statusCode).toBe(403);
      expect((await post(await serverFor({ ...dispatcher, depotCode: null }))).statusCode).toBe(403);
      expect(runAutoPlan).not.toHaveBeenCalled();
    });

    it("refuses an undeclared field and a date that is not on the calendar", async () => {
      const server = await serverFor();

      expect((await post(server, { ...body, force: true })).statusCode).toBe(422);
      expect((await post(server, { ...body, date: "2026-02-30" })).statusCode).toBe(422);
      expect(runAutoPlan).not.toHaveBeenCalled();
    });

    it("answers 409 NON_OPERATING_DAY for a day the depot does not run, before anything else is read", async () => {
      vi.mocked(isOperatingDay).mockResolvedValue(false);
      const server = await serverFor();

      const response = await post(server);

      expect(response.statusCode).toBe(409);
      expect(response.json().error.code).toBe("NON_OPERATING_DAY");
      expect(isOperatingDay).toHaveBeenCalledWith(new Date("2026-10-03T00:00:00.000Z"));
      expect(prisma.planningDay.findUnique).not.toHaveBeenCalled();
      expect(runAutoPlan).not.toHaveBeenCalled();
    });

    it("answers 404 NO_PLANNING_DAY when the depot has no day for that date", async () => {
      vi.mocked(prisma.planningDay.findUnique).mockResolvedValue(null);
      vi.mocked(runAutoPlan).mockResolvedValue(null);
      const server = await serverFor();

      const response = await post(server);

      expect(response.statusCode).toBe(404);
      expect(response.json().error.code).toBe("NO_PLANNING_DAY");
      expect(auditRows()).toHaveLength(0);
    });

    it("will not build a plan while the queue is still open", async () => {
      vi.mocked(prisma.planningDay.findUnique).mockResolvedValue(planningDay({ status: "OPEN" }) as never);
      const server = await serverFor();

      const response = await post(server);

      // The contract says the day must be CLOSED or PLANNING, and the desk maps this 409 to "close the queue first".
      expect(response.statusCode).toBe(409);
      expect(response.json().error.code).toBe("QUEUE_OPEN");
      expect(runAutoPlan).not.toHaveBeenCalled();
    });

    it("will not re-run the allocator over a day that is already published", async () => {
      // Re-running would put a second DRAFT beside the live PUBLISHED plan, flip
      // the day back to PLANNING, and let the second one be published over
      // vehicles that are already loading.
      vi.mocked(prisma.planningDay.findUnique).mockResolvedValue(planningDay({ status: "PUBLISHED" }) as never);
      const server = await serverFor();

      const response = await post(server);

      expect(response.statusCode).toBe(409);
      expect(response.json().error.code).toBe("ALREADY_PUBLISHED");
      expect(runAutoPlan).not.toHaveBeenCalled();
    });

    it.each(["CLOSED", "PLANNING"])("runs the allocator for a %s day and returns a draft with its stats", async (status) => {
      vi.mocked(prisma.planningDay.findUnique).mockResolvedValue(planningDay({ status }) as never);
      const server = await serverFor();

      const response = await post(server);

      expect(response.statusCode).toBe(201);
      expect(response.json()).toEqual({ planId: "PLN1", status: "DRAFT", stats: output.stats });
      expect(runAutoPlan).toHaveBeenCalledWith(DAY, "Peliyagoda", "USR001");
    });

    it("records who generated the plan and what it came to", async () => {
      const server = await serverFor();

      await post(server);

      expect(auditRows()).toEqual([
        expect.objectContaining({
          actorUserId: "USR001",
          actorRole: "DISPATCHER",
          action: "plan.generate",
          entityType: "Plan",
          entityId: "PLN1",
          after: { date: "2026-10-03", depotCode: "Peliyagoda", served: 78, deferred: 7 },
        }),
      ]);
    });
  });

  describe("POST /v1/planning-days/:planningDayId/closure", () => {
    const close = (server: TestServer, id = "PD1") =>
      server.inject({ method: "POST", url: `/v1/planning-days/${id}/closure` });

    it("looks the day up in the caller's own depot, so another depot's day is a 404", async () => {
      vi.mocked(prisma.planningDay.findFirst).mockResolvedValue(null);
      const server = await serverFor();

      const response = await close(server, "PD-KANDY");

      expect(response.statusCode).toBe(404);
      expect(vi.mocked(prisma.planningDay.findFirst).mock.calls[0]![0]!.where).toEqual({
        id: "PD-KANDY",
        depotCode: "Peliyagoda",
      });
      expect(prisma.planningDay.update).not.toHaveBeenCalled();
    });

    it("is the dispatcher's alone", async () => {
      expect((await close(await serverFor(manager))).statusCode).toBe(403);
      expect((await close(await serverFor(loader))).statusCode).toBe(403);
      expect(prisma.planningDay.findFirst).not.toHaveBeenCalled();
    });

    it("closes an open day, snapshotting how many orders were in the queue, and records the decision", async () => {
      vi.mocked(prisma.planningDay.findFirst).mockResolvedValue(planningDay() as never);
      vi.mocked(prisma.order.count).mockResolvedValue(85);
      vi.mocked(prisma.planningDay.update).mockResolvedValue(planningDay({ status: "CLOSED" }) as never);
      vi.mocked(derivePriorityInputs).mockResolvedValue(12);
      const server = await serverFor();

      const response = await close(server);

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ id: "PD1", date: "2026-10-03", depotCode: "Peliyagoda", status: "CLOSED", cutoffAt: "16:00" });
      // The fairness signals are settled for this depot and day, in the transaction that closes it.
      expect(derivePriorityInputs).toHaveBeenCalledWith(prisma, DAY, "Peliyagoda");
      expect(vi.mocked(prisma.$transaction).mock.invocationCallOrder[0]!).toBeLessThan(
        vi.mocked(derivePriorityInputs).mock.invocationCallOrder[0]!,
      );
      expect(vi.mocked(derivePriorityInputs).mock.invocationCallOrder[0]!).toBeLessThan(
        vi.mocked(prisma.planningDay.update).mock.invocationCallOrder[0]!,
      );
      // Cancelled orders are not part of the queue the dispatcher is closing.
      expect(vi.mocked(prisma.order.count).mock.calls[0]![0]!.where).toEqual({
        depotCode: "Peliyagoda",
        requestedDate: DAY,
        status: { notIn: ["CANCELLED"] },
      });
      const update = vi.mocked(prisma.planningDay.update).mock.calls[0]![0]!;
      expect(update.where).toEqual({ id: "PD1" });
      expect(update.data).toMatchObject({
        status: "CLOSED",
        closedByUserId: "USR001",
        closedAt: expect.any(Date),
        queueSnapshot: { ordersAtClose: 85, closedAt: expect.any(String) },
      });
      expect(auditRows()).toEqual([
        expect.objectContaining({
          actorUserId: "USR001",
          action: "queue.close",
          entityType: "PlanningDay",
          entityId: "PD1",
          before: { status: "OPEN" },
          after: { status: "CLOSED", ordersAtClose: 85, prioritised: 12 },
        }),
      ]);
    });

    it.each(["CLOSED", "PLANNING", "PUBLISHED"])(
      "answers a day that is already %s with its current state, changing and recording nothing",
      async (status) => {
        vi.mocked(prisma.planningDay.findFirst).mockResolvedValue(planningDay({ status }) as never);
        const server = await serverFor();

        const response = await close(server);

        expect(response.statusCode).toBe(200);
        expect(response.json().status).toBe(status);
        // Nothing was closed now, so nothing is re-derived.
        expect(derivePriorityInputs).not.toHaveBeenCalled();
        expect(prisma.planningDay.update).not.toHaveBeenCalled();
        expect(prisma.order.count).not.toHaveBeenCalled();
        expect(auditRows()).toHaveLength(0);
      },
    );
  });

  describe("GET /v1/plans/:planId/validation", () => {
    const plan = { id: "PLN1", planningDay: planningDay() };
    const snapshot = { depot: "Peliyagoda" };
    const violation = (severity: "error" | "warning") => ({ code: "SOME_RULE", severity, message: "m", tripId: null, orderRef: null });

    beforeEach(() => {
      vi.mocked(loadPlan).mockResolvedValue(plan as never);
      vi.mocked(loadDayContext).mockResolvedValue({ planningDay: planningDay() } as never);
      vi.mocked(snapshotFromPlan).mockResolvedValue(snapshot as never);
    });

    it("answers 404 for another depot's plan before touching the day context", async () => {
      vi.mocked(loadPlan).mockResolvedValue({ ...plan, planningDay: planningDay({ depotCode: "Kandy" }) } as never);
      const server = await serverFor();

      const response = await server.inject({ method: "GET", url: "/v1/plans/PLN1/validation" });

      expect(response.statusCode).toBe(404);
      expect(loadDayContext).not.toHaveBeenCalled();
    });

    it("answers 404 NO_PLANNING_DAY when the day has gone", async () => {
      vi.mocked(loadDayContext).mockResolvedValue(null);
      const server = await serverFor();

      const response = await server.inject({ method: "GET", url: "/v1/plans/PLN1/validation" });

      expect(response.statusCode).toBe(404);
      expect(response.json().error.code).toBe("NO_PLANNING_DAY");
    });

    it("validates at the draft stage by default and blocks only on an error", async () => {
      vi.mocked(validatePlan).mockReturnValue([violation("warning")] as never);
      const server = await serverFor();

      const response = await server.inject({ method: "GET", url: "/v1/plans/PLN1/validation" });

      expect(response.statusCode).toBe(200);
      expect(validatePlan).toHaveBeenCalledWith(snapshot, { stage: "draft" });
      expect(loadDayContext).toHaveBeenCalledWith(DAY, "Peliyagoda");
      expect(response.json()).toMatchObject({ stage: "draft", blocking: false });
      expect(response.json().violations).toHaveLength(1);
    });

    it("blocks when any violation is an error, at the stage asked for", async () => {
      vi.mocked(validatePlan).mockReturnValue([violation("warning"), violation("error")] as never);
      const server = await serverFor();

      const response = await server.inject({ method: "GET", url: "/v1/plans/PLN1/validation?stage=publish" });

      expect(validatePlan).toHaveBeenCalledWith(snapshot, { stage: "publish" });
      expect(response.json()).toMatchObject({ stage: "publish", blocking: true });
    });

    it("refuses a stage that is not draft or publish", async () => {
      const server = await serverFor();

      const response = await server.inject({ method: "GET", url: "/v1/plans/PLN1/validation?stage=final" });

      expect(response.statusCode).toBe(422);
      expect(validatePlan).not.toHaveBeenCalled();
    });
  });

  describe("GET /v1/plans/:planId/deferrals/:assignmentId/alternatives", () => {
    const plan = { id: "PLN1", planningDay: planningDay() };
    const alternatives = {
      lane: { brand: "Fresh", districtName: "Puttalam", resource: "refrigerated vehicle", competing: 2 },
      items: [
        { orderRef: "ORD-2", outletId: "OUT074", outletName: null, isThisOrder: true, decision: "DEFERRED", rank: 3, impact: "lowest", why: "no priority flags" },
      ],
    };

    it("answers 404 for another depot's plan", async () => {
      vi.mocked(loadPlan).mockResolvedValue({ ...plan, planningDay: planningDay({ depotCode: "Kandy" }) } as never);
      const server = await serverFor();

      const response = await server.inject({ method: "GET", url: "/v1/plans/PLN1/deferrals/A2/alternatives" });

      expect(response.statusCode).toBe(404);
      expect(laneAlternatives).not.toHaveBeenCalled();
    });

    it("answers 404 when the assignment is not a deferral on this plan", async () => {
      vi.mocked(loadPlan).mockResolvedValue(plan as never);
      vi.mocked(laneAlternatives).mockResolvedValue(null);
      const server = await serverFor();

      const response = await server.inject({ method: "GET", url: "/v1/plans/PLN1/deferrals/A9/alternatives" });

      expect(response.statusCode).toBe(404);
      expect(laneAlternatives).toHaveBeenCalledWith(plan, "A9");
    });

    it("returns the lane's competitors", async () => {
      vi.mocked(loadPlan).mockResolvedValue(plan as never);
      vi.mocked(laneAlternatives).mockResolvedValue(alternatives as never);
      const server = await serverFor();

      const response = await server.inject({ method: "GET", url: "/v1/plans/PLN1/deferrals/A2/alternatives" });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual(alternatives);
    });
  });

  describe("PUT /v1/plans/:planId/deferrals", () => {
    const put = (server: TestServer, decisions: unknown, id = "PLN1") =>
      server.inject({ method: "PUT", url: `/v1/plans/${id}/deferrals`, payload: { decisions } as never });

    beforeEach(() => {
      vi.mocked(prisma.plan.findFirst).mockResolvedValue({ id: "PLN1", status: "DRAFT" } as never);
      vi.mocked(prisma.assignment.findMany).mockResolvedValue([
        { id: "A2", orderId: "O2" },
        { id: "A3", orderId: "O3" },
      ] as never);
      vi.mocked(prisma.assignment.updateMany).mockResolvedValue({ count: 1 } as never);
    });

    it("finds the plan in the caller's own depot, so another depot's plan is a 404", async () => {
      vi.mocked(prisma.plan.findFirst).mockResolvedValue(null);
      const server = await serverFor();

      const response = await put(server, [{ assignmentId: "A2", reasonCode: "REEFER_FULL" }], "PLN-KANDY");

      expect(response.statusCode).toBe(404);
      expect(vi.mocked(prisma.plan.findFirst).mock.calls[0]![0]!.where).toEqual({
        id: "PLN-KANDY",
        planningDay: { depotCode: "Peliyagoda" },
      });
      expect(prisma.assignment.updateMany).not.toHaveBeenCalled();
    });

    it("is the dispatcher's alone", async () => {
      expect((await put(await serverFor(manager), [{ assignmentId: "A2", reasonCode: "REEFER_FULL" }])).statusCode).toBe(403);
      expect(prisma.plan.findFirst).not.toHaveBeenCalled();
    });

    it.each(["PUBLISHED", "SUPERSEDED"])("will not change reasons on a %s plan", async (status) => {
      vi.mocked(prisma.plan.findFirst).mockResolvedValue({ id: "PLN1", status } as never);
      const server = await serverFor();

      const response = await put(server, [{ assignmentId: "A2", reasonCode: "REEFER_FULL" }]);

      expect(response.statusCode).toBe(422);
      expect(response.json().error.code).toBe("NOT_DRAFT");
      expect(prisma.assignment.updateMany).not.toHaveBeenCalled();
      expect(auditRows()).toHaveLength(0);
    });

    it("updates only DEFERRED assignments of this plan, and confirms only what it updated", async () => {
      // A2 is a deferral here; A9 is served, or belongs to another plan.
      vi.mocked(prisma.assignment.updateMany).mockImplementation((async ({ where }: { where: { id: string } }) => ({
        count: where.id === "A9" ? 0 : 1,
      })) as never);
      vi.mocked(prisma.assignment.findMany).mockResolvedValue([{ id: "A2", orderId: "O2" }] as never);
      const server = await serverFor();

      const response = await put(server, [
        { assignmentId: "A2", reasonCode: "REEFER_FULL" },
        { assignmentId: "A9", reasonCode: "NO_VAN" },
      ]);

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ confirmed: 1 });
      for (const call of vi.mocked(prisma.assignment.updateMany).mock.calls) {
        expect(call[0]!.where).toMatchObject({ planId: "PLN1", decision: "DEFERRED" });
      }
      expect(vi.mocked(prisma.assignment.findMany).mock.calls[0]![0]!.where).toEqual({
        planId: "PLN1",
        decision: "DEFERRED",
        id: { in: ["A2", "A9"] },
      });
      // The refused one leaves no trace in the decision log.
      expect(auditRows().map((r) => r.entityId)).toEqual(["O2"]);
    });

    it("writes the reason and a trimmed, capped note, and records one decision per confirmed deferral", async () => {
      const server = await serverFor();
      const long = "x".repeat(600);

      const response = await put(server, [
        { assignmentId: "A2", reasonCode: "REEFER_FULL", note: `  ${long}  ` },
        { assignmentId: "A3", reasonCode: "ORDER_TOO_LARGE", note: "   " },
      ]);

      expect(response.json()).toEqual({ confirmed: 2 });
      const [first, second] = vi.mocked(prisma.assignment.updateMany).mock.calls.map((c) => c[0]!);
      expect(first!.where).toEqual({ id: "A2", planId: "PLN1", decision: "DEFERRED" });
      expect(first!.data).toEqual({ reasonCode: "REEFER_FULL", note: "x".repeat(500) });
      expect(second!.data).toEqual({ reasonCode: "ORDER_TOO_LARGE", note: null });
      expect(auditRows()).toEqual([
        expect.objectContaining({
          actorUserId: "USR001",
          actorRole: "DISPATCHER",
          action: "deferral.confirm",
          entityType: "Order",
          entityId: "O2",
          reasonCode: "REEFER_FULL",
          note: "x".repeat(500),
          after: { planId: "PLN1" },
        }),
        expect.objectContaining({ action: "deferral.confirm", entityId: "O3", reasonCode: "ORDER_TOO_LARGE" }),
      ]);
      expect(auditRows()[1]!.note).toBeUndefined();
    });

    it("refuses a reason that is not in the deferral vocabulary, because reasons are codes and never free text", async () => {
      const server = await serverFor();

      const response = await put(server, [
        { assignmentId: "A2", reasonCode: "REEFER_FULL" },
        { assignmentId: "A3", reasonCode: "because I said so" },
      ]);

      expect(response.statusCode).toBe(422);
      expect(response.json().error.code).toBe("VALIDATION_FAILED");
      expect(response.json().error.details).toMatchObject({ reasonCode: "because I said so" });
      // All or nothing: the valid decision beside it is not applied either.
      expect(prisma.assignment.updateMany).not.toHaveBeenCalled();
      expect(auditRows()).toHaveLength(0);
    });

    it("accepts every code in the vocabulary", async () => {
      const { DEFERRAL_REASONS } = await import("@katapatha/core/domain/reasons");
      const server = await serverFor();

      for (const { code } of DEFERRAL_REASONS) {
        const response = await put(server, [{ assignmentId: "A2", reasonCode: code }]);
        expect(response.statusCode, code).toBe(200);
      }
    });

    it("writes nothing when no decision was confirmed", async () => {
      vi.mocked(prisma.assignment.updateMany).mockResolvedValue({ count: 0 } as never);
      vi.mocked(prisma.assignment.findMany).mockResolvedValue([] as never);
      const server = await serverFor();

      const response = await put(server, [{ assignmentId: "A9", reasonCode: "NO_VAN" }]);

      expect(response.json()).toEqual({ confirmed: 0 });
      expect(prisma.auditEvent.createMany).not.toHaveBeenCalled();
    });

    it("refuses an empty list, an empty reason, and an undeclared field", async () => {
      const server = await serverFor();

      expect((await put(server, [])).statusCode).toBe(422);
      expect((await put(server, [{ assignmentId: "A2", reasonCode: "" }])).statusCode).toBe(422);
      expect((await put(server, [{ assignmentId: "A2", reasonCode: "NO_VAN", orderId: "O1" }])).statusCode).toBe(422);
      expect(prisma.plan.findFirst).not.toHaveBeenCalled();
    });
  });

  describe("POST /v1/plans/:planId/publication", () => {
    const served = {
      id: "A1",
      orderId: "O1",
      decision: "SERVED",
      reasonCode: null,
      note: null,
      explanation: null,
      order: { ref: "ORD-1", outletId: "OUT001", windowOpen: "06:00", windowClose: "09:00" },
    };
    const deferred = {
      id: "A2",
      orderId: "O2",
      decision: "DEFERRED",
      reasonCode: "REEFER_FULL",
      note: "reefers committed",
      explanation: { reasonCode: "NO_REEFER_AVAILABLE", permanent: false },
      order: { ref: "ORD-2", outletId: "OUT002", windowOpen: "06:00", windowClose: "09:00" },
    };
    const permanent = {
      id: "A3",
      orderId: "O3",
      decision: "DEFERRED",
      reasonCode: "ORDER_TOO_LARGE",
      note: null,
      explanation: { reasonCode: "ORDER_EXCEEDS_FLEET_CAPACITY", permanent: true },
      order: { ref: "ORD-3", outletId: "OUT003", windowOpen: "05:30", windowClose: "08:00" },
    };

    function draft(assignments: unknown[], over: Record<string, unknown> = {}) {
      return { id: "PLN1", status: "DRAFT", planningDayId: "PD1", planningDay: planningDay({ status: "PLANNING" }), assignments, ...over };
    }

    const publish = (server: TestServer, id = "PLN1") =>
      server.inject({ method: "POST", url: `/v1/plans/${id}/publication` });

    beforeEach(() => {
      vi.mocked(prisma.plan.findFirst).mockResolvedValue(draft([served, deferred, permanent]) as never);
      vi.mocked(prisma.plan.updateMany).mockResolvedValue({ count: 1 } as never);
      vi.mocked(prisma.plan.findUnique).mockResolvedValue({
        id: "PLN1",
        status: "PUBLISHED",
        allocatorVersion: "a3f9c1e70b4d2856",
        trips: [{ id: "T1" }],
        assignments: [
          { decision: "SERVED", plan: { status: "PUBLISHED" } },
          { decision: "DEFERRED", plan: { status: "PUBLISHED" } },
          { decision: "DEFERRED", plan: { status: "PUBLISHED" } },
        ],
      } as never);
    });

    function expectNothingWritten() {
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(prisma.plan.updateMany).not.toHaveBeenCalled();
      expect(prisma.order.updateMany).not.toHaveBeenCalled();
      expect(prisma.notification.create).not.toHaveBeenCalled();
      expect(prisma.auditEvent.createMany).not.toHaveBeenCalled();
    }

    it("is the dispatcher's alone", async () => {
      expect((await publish(await serverFor(manager))).statusCode).toBe(403);
      expect((await publish(await serverFor(loader))).statusCode).toBe(403);
      expect(prisma.plan.findFirst).not.toHaveBeenCalled();
    });

    it("looks the plan up in the caller's own depot, and answers 409 PLAN_MISSING for another depot's", async () => {
      vi.mocked(prisma.plan.findFirst).mockResolvedValue(null);
      const server = await serverFor();

      const response = await publish(server, "PLN-KANDY");

      expect(response.statusCode).toBe(409);
      expect(response.json().error.code).toBe("PLAN_MISSING");
      expect(vi.mocked(prisma.plan.findFirst).mock.calls[0]![0]!.where).toEqual({
        id: "PLN-KANDY",
        planningDay: { depotCode: "Peliyagoda" },
      });
      expectNothingWritten();
    });

    it.each(["PUBLISHED", "SUPERSEDED"])("answers 409 ALREADY_PUBLISHED for a %s plan and writes nothing", async (status) => {
      vi.mocked(prisma.plan.findFirst).mockResolvedValue(draft([served], { status }) as never);
      const server = await serverFor();

      const response = await publish(server);

      expect(response.statusCode).toBe(409);
      expect(response.json().error.code).toBe("ALREADY_PUBLISHED");
      expectNothingWritten();
    });

    it("answers 422 DEFERRALS_UNCONFIRMED while any deferral lacks a reason, counting them", async () => {
      const bare = (id: string) => ({ ...deferred, id, orderId: `O-${id}`, reasonCode: null });
      const server = await serverFor();

      vi.mocked(prisma.plan.findFirst).mockResolvedValueOnce(draft([served, bare("A7")]) as never);
      const one = await publish(server);
      vi.mocked(prisma.plan.findFirst).mockResolvedValueOnce(draft([served, bare("A7"), bare("A8")]) as never);
      const two = await publish(server);

      expect(one.statusCode).toBe(422);
      expect(one.json().error).toMatchObject({ code: "DEFERRALS_UNCONFIRMED", message: "1 deferral still lacks a reason code." });
      expect(two.json().error.message).toBe("2 deferrals still lack a reason code.");
      expectNothingWritten();
    });

    it("claims the plan inside the transaction, gated on it still being a DRAFT", async () => {
      const server = await serverFor();

      const response = await publish(server);

      expect(response.statusCode).toBe(201);
      expect(response.json()).toEqual({
        planId: "PLN1",
        status: "PUBLISHED",
        stats: { orders: 3, served: 1, deferred: 2, tripsBuilt: 1, hash: "a3f9c1e70b4d2856" },
      });
      const claim = vi.mocked(prisma.plan.updateMany).mock.calls[0]![0]!;
      expect(claim.where).toEqual({ id: "PLN1", status: "DRAFT" });
      expect(claim.data).toMatchObject({ status: "PUBLISHED", publishedByUserId: "USR001", publishedAt: expect.any(Date) });
      // The claim is a call on the transaction's client, not a top-level write.
      expect(vi.mocked(prisma.$transaction).mock.invocationCallOrder[0]!).toBeLessThan(
        vi.mocked(prisma.plan.updateMany).mock.invocationCallOrder[0]!,
      );
    });

    it("spends the plan's fuel inside the same transaction as the claim", async () => {
      const server = await serverFor();

      await publish(server);

      expect(commitPlanFuel).toHaveBeenCalledWith(prisma, "PLN1", DAY);
      expect(vi.mocked(prisma.$transaction).mock.invocationCallOrder[0]!).toBeLessThan(
        vi.mocked(commitPlanFuel).mock.invocationCallOrder[0]!,
      );
    });

    it("publishes nothing, and answers an error, when the fuel cannot be recorded", async () => {
      vi.mocked(commitPlanFuel).mockRejectedValue(new Error("ledger down"));
      const server = await serverFor();

      const response = await publish(server);

      expect(response.statusCode).toBeGreaterThanOrEqual(500);
      // The throw happens inside the transaction, so it rolls everything back.
      expect(prisma.notification.create).not.toHaveBeenCalled();
      expect(prisma.auditEvent.createMany).not.toHaveBeenCalled();
    });

    it("moves the planning day to PUBLISHED, served orders to PLANNED, and deferred orders to DEFERRED", async () => {
      const server = await serverFor();

      await publish(server);

      expect(vi.mocked(prisma.planningDay.update).mock.calls[0]![0]).toEqual({
        where: { id: "PD1" },
        data: { status: "PUBLISHED" },
      });
      const updates = vi.mocked(prisma.order.updateMany).mock.calls.map((c) => c[0]);
      expect(updates).toEqual([
        { where: { id: { in: ["O1"] } }, data: { status: "PLANNED" } },
        { where: { id: { in: ["O2", "O3"] } }, data: { status: "DEFERRED" } },
      ]);
    });

    it("queues the deferred orders that tomorrow can fix for the next run, and not the permanent one", async () => {
      vi.mocked(rollDeferredOrders).mockResolvedValue(["ORD-004500"]);
      const server = await serverFor();

      await publish(server);

      expect(rollDeferredOrders).toHaveBeenCalledTimes(1);
      expect(rollDeferredOrders).toHaveBeenCalledWith(prisma, {
        planId: "PLN1",
        orderIds: ["O2"],
        forDate: "2026-10-05",
        userId: "USR001",
      });
    });

    it("rolls nothing over when every deferral is permanent", async () => {
      vi.mocked(prisma.plan.findFirst).mockResolvedValue(draft([served, permanent]) as never);
      const server = await serverFor();

      await publish(server);

      expect(vi.mocked(rollDeferredOrders).mock.calls[0]![1].orderIds).toEqual([]);
    });

    it("rolls nothing over when nothing was deferred", async () => {
      vi.mocked(prisma.plan.findFirst).mockResolvedValue(draft([served]) as never);
      const server = await serverFor();

      await publish(server);

      expect(rollDeferredOrders).not.toHaveBeenCalled();
    });

    it("records a Deferral per deferred order: the next run for a temporary cause, none for a permanent one", async () => {
      const server = await serverFor();

      await publish(server);

      const calls = vi.mocked(prisma.deferral.upsert).mock.calls.map((c) => c[0]!);
      expect(calls).toHaveLength(2);
      expect(calls[0]).toMatchObject({
        where: { planId_orderId: { planId: "PLN1", orderId: "O2" } },
        create: {
          planId: "PLN1",
          orderId: "O2",
          reasonCode: "REEFER_FULL",
          note: "reefers committed",
          rolledToDate: new Date("2026-10-05T00:00:00.000Z"),
          decidedByUserId: "USR001",
          storeNotifiedAt: expect.any(Date),
        },
        update: { reasonCode: "REEFER_FULL", rolledToDate: new Date("2026-10-05T00:00:00.000Z"), storeNotifiedAt: expect.any(Date) },
      });
      // Tomorrow will not fix a permanent cause, so there is no day to roll to.
      expect(calls[1]).toMatchObject({
        create: { orderId: "O3", reasonCode: "ORDER_TOO_LARGE", rolledToDate: null },
        update: { rolledToDate: null },
      });
    });

    it("tells each deferred outlet, in words that match whether the order moves or cannot be delivered", async () => {
      const server = await serverFor();

      await publish(server);

      const notifications = vi.mocked(prisma.notification.create).mock.calls.map((c) => c[0]!.data);
      expect(notifications).toEqual([
        {
          outletId: "OUT002",
          kind: "deferred",
          title: "Order ORD-2 moves to Mon 5 Oct",
          body: "Your order ORD-2 moves to Mon 5 Oct, 06:00–09:00. Reason: refrigerated capacity full. It will be planned first on that run.",
          payload: { orderId: "O2", planId: "PLN1", rolledToDate: "2026-10-05" },
        },
        {
          outletId: "OUT003",
          kind: "deferred",
          title: "Order ORD-3 could not be delivered",
          body: "Your order ORD-3 could not be delivered today. Reason: order too large for any vehicle. Please place it again as smaller orders.",
          // Same answer as the Deferral row: no day to move to.
          payload: { orderId: "O3", planId: "PLN1", rolledToDate: null },
        },
      ]);
    });

    it("does not promise a next run on a permanent deferral whose reason is not size", async () => {
      vi.mocked(prisma.plan.findFirst).mockResolvedValue(
        draft([{ ...permanent, reasonCode: "NO_VAN" }]) as never,
      );
      const server = await serverFor();

      await publish(server);

      const body = vi.mocked(prisma.notification.create).mock.calls[0]![0]!.data.body;
      expect(body).toBe(
        "Your order ORD-3 could not be delivered today. Reason: no van available. Your dispatcher will contact you about what happens next.",
      );
    });

    it("leaves orders alone and notifies nobody when nothing was deferred", async () => {
      vi.mocked(prisma.plan.findFirst).mockResolvedValue(draft([served]) as never);
      const server = await serverFor();

      await publish(server);

      expect(prisma.order.updateMany).toHaveBeenCalledTimes(1);
      expect(prisma.deferral.upsert).not.toHaveBeenCalled();
      expect(prisma.notification.create).not.toHaveBeenCalled();
    });

    it("writes the plan's audit row and one per order, with the deferral's reason, after the transaction commits", async () => {
      const server = await serverFor();

      await publish(server);

      expect(auditRows()).toEqual([
        expect.objectContaining({
          actorUserId: "USR001",
          actorRole: "DISPATCHER",
          action: "plan.publish",
          entityType: "Plan",
          entityId: "PLN1",
          after: { date: "2026-10-03" },
        }),
        expect.objectContaining({ action: "order.plan", entityType: "Order", entityId: "O1", after: { planId: "PLN1" } }),
        expect.objectContaining({ action: "order.defer", entityId: "O2", reasonCode: "REEFER_FULL", note: "reefers committed" }),
        expect.objectContaining({ action: "order.defer", entityId: "O3", reasonCode: "ORDER_TOO_LARGE" }),
      ]);
      // A served order carries no reason, even if the column holds one.
      expect(auditRows()[1]!.reasonCode).toBeUndefined();
      expect(vi.mocked(prisma.$transaction).mock.invocationCallOrder[0]!).toBeLessThan(
        vi.mocked(prisma.auditEvent.createMany).mock.invocationCallOrder[0]!,
      );
    });

    it("loses the race cleanly: 409 RACE_LOST, and no flips, notifications or audit rows", async () => {
      // Another publish claimed the plan between the read and the claim.
      vi.mocked(prisma.plan.updateMany).mockResolvedValue({ count: 0 } as never);
      const server = await serverFor();

      const response = await publish(server);

      expect(response.statusCode).toBe(409);
      expect(response.json().error.code).toBe("RACE_LOST");
      expect(prisma.planningDay.update).not.toHaveBeenCalled();
      expect(prisma.order.updateMany).not.toHaveBeenCalled();
      expect(prisma.deferral.upsert).not.toHaveBeenCalled();
      expect(prisma.notification.create).not.toHaveBeenCalled();
      expect(prisma.auditEvent.createMany).not.toHaveBeenCalled();
      expect(prisma.plan.findUnique).not.toHaveBeenCalled();
    });

    it("lets a failure partway through surface as an error with no audit rows, since the transaction rolls back", async () => {
      vi.mocked(prisma.notification.create).mockRejectedValue(new Error("db went away"));
      const server = await serverFor();

      const response = await publish(server);

      expect(response.statusCode).toBe(500);
      expect(response.json().error.code).toBe("INTERNAL");
      // A decision-log row for a publish that rolled back would record something that did not happen.
      expect(prisma.auditEvent.createMany).not.toHaveBeenCalled();
    });

    it("works out the move-to day before opening the transaction, from the planning day's date", async () => {
      const server = await serverFor();

      await publish(server);

      expect(nextRunDate).toHaveBeenCalledWith(DAY);
      expect(vi.mocked(nextRunDate).mock.invocationCallOrder[0]!).toBeLessThan(
        vi.mocked(prisma.$transaction).mock.invocationCallOrder[0]!,
      );
    });
  });
});
