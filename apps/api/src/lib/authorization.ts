

import { AuthError, type SessionUser } from "./auth";
import { prisma } from "./db";

function deny(): never {
  throw new AuthError("You do not have access to this record", 403);
}

function requireDepot(user: SessionUser): string {
  if (!user.depotCode) return deny();
  return user.depotCode;
}

export async function requireStoreDeferral(user: SessionUser, deferralId: string) {
  if (!user.outletId) return deny();
  const deferral = await prisma.deferral.findFirst({
    where: { id: deferralId, order: { outletId: user.outletId } },
    include: { order: true },
  });
  if (!deferral) return deny();
  return deferral;
}

export async function requireLoaderTrip(user: SessionUser, tripId: string) {
  const depotCode = requireDepot(user);
  const trip = await prisma.trip.findFirst({
    where: {
      id: tripId,
      plan: { status: "PUBLISHED", planningDay: { depotCode } },
    },
    include: { plan: { include: { planningDay: true } } },
  });
  if (!trip) return deny();
  return trip;
}

export async function requireOrderOnTrip(
  user: SessionUser,
  tripId: string,
  orderId: string,
) {
  await requireLoaderTrip(user, tripId);
  const link = await prisma.tripStopOrder.findFirst({
    where: { orderId, tripStop: { tripId } },
    include: { order: true },
  });
  if (!link) return deny();
  return link.order;
}

export async function requireDriverVehicle(user: SessionUser, vehicleId: string) {
  const depotCode = requireDepot(user);
  const trip = await prisma.trip.findFirst({
    where: {
      vehicleId,
      plan: { status: "PUBLISHED", planningDay: { depotCode } },
    },
    select: { id: true },
  });
  if (!trip) return deny();
}

export async function requireDriverStop(user: SessionUser, stopId: string) {
  if (!user.defaultVehicleId) return deny();
  const depotCode = requireDepot(user);
  const stop = await prisma.tripStop.findFirst({
    where: {
      id: stopId,
      trip: {
        vehicleId: user.defaultVehicleId,
        plan: { status: "PUBLISHED", planningDay: { depotCode } },
      },
    },
    include: {
      trip: { include: { plan: { include: { planningDay: true } } } },
    },
  });
  if (!stop) return deny();
  return stop;
}

export async function requireDispatcherPlan(user: SessionUser, planId: string) {
  const depotCode = requireDepot(user);
  const plan = await prisma.plan.findFirst({
    where: { id: planId, planningDay: { depotCode } },
    include: { planningDay: true },
  });
  if (!plan) return deny();
  return plan;
}

export async function requireDispatcherPlanningDay(user: SessionUser, planningDayId: string) {
  const depotCode = requireDepot(user);
  const day = await prisma.planningDay.findFirst({
    where: { id: planningDayId, depotCode },
  });
  if (!day) return deny();
  return day;
}

export async function requireDispatcherVehicle(user: SessionUser, vehicleId: string) {
  const depotCode = requireDepot(user);
  const vehicle = await prisma.vehicle.findFirst({
    where: { id: vehicleId, depotCode },
  });
  if (!vehicle) return deny();
  return vehicle;
}

export async function requireDispatcherShortfall(user: SessionUser, shortfallId: string) {
  const depotCode = requireDepot(user);
  const shortfall = await prisma.shortfall.findFirst({
    where: { id: shortfallId, trip: { plan: { planningDay: { depotCode } } } },
    include: { order: true, trip: true },
  });
  if (!shortfall) return deny();
  return shortfall;
}

export async function requireDispatcherProblem(user: SessionUser, problemId: string) {
  const depotCode = requireDepot(user);
  const problem = await prisma.problem.findUnique({
    where: { id: problemId },
    include: {
      trip: { include: { plan: { include: { planningDay: true } } } },
      order: true,
    },
  });
  const belongsToDepot =
    problem?.trip?.plan.planningDay.depotCode === depotCode ||
    problem?.order?.depotCode === depotCode;
  let raisedByDepot = false;
  if (problem?.raisedByUserId && !belongsToDepot) {
    const raiser = await prisma.user.findUnique({
      where: { id: problem.raisedByUserId },
      select: { depotCode: true },
    });
    raisedByDepot = raiser?.depotCode === depotCode;
  }
  if (!problem || (!belongsToDepot && !raisedByDepot)) return deny();
  return problem;
}
