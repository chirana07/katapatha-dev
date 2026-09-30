

import { prisma } from "../lib/db";

/**
 * What a store manager needs to know.
 *
 * The brief is specific about it: an expected arrival time so receiving staff
 * can be rostered, clear notice when an order is deferred, and a way to
 * confirm what actually turned up.
 */

export type StoreOrderState =
  | "queued"
  | "planned"
  | "on_the_way"
  | "delivered"
  | "deferred"
  | "cancelled";

export interface StoreOrderView {
  id: string;
  ref: string;
  brand: "Fresh" | "Style" | "Tech";
  tempRequirement: "chilled" | "ambient";
  units: number;
  volumeM3: number;
  weightKg: number;
  requestedDate: string;
  state: StoreOrderState;
  /** The planned arrival, when the order is on a published trip. */
  etaAt: string | null;
  vehicleId: string | null;
  stopsBefore: number | null;
  tripStopId: string | null;
  deliveredUnits: number | null;
  receiptConfirmed: boolean;
  deferral: { reasonCode: string; rolledToDate: string | null; acknowledged: boolean } | null;
}

function stateOf(
  status: string,
  hasPublishedTrip: boolean,
  departed: boolean,
): StoreOrderState {
  if (status === "DEFERRED") return "deferred";
  if (status === "CANCELLED") return "cancelled";
  if (status === "DELIVERED" || status === "PART_DELIVERED") return "delivered";
  if (departed) return "on_the_way";
  if (hasPublishedTrip) return "planned";
  return "queued";
}

export async function loadStoreOrders(
  outletId: string,
  limit = 40,
): Promise<StoreOrderView[]> {
  const orders = await prisma.order.findMany({
    where: { outletId },
    orderBy: [{ requestedDate: "desc" }, { ref: "asc" }],
    take: limit,
    include: {
      receipt: true,
      deferrals: { orderBy: { decidedAt: "desc" }, take: 1 },
      assignments: {
        include: {
          plan: { select: { status: true } },
          tripStop: {
            include: {
              trip: { select: { id: true, vehicleId: true, status: true } },
              stopEvents: true,
            },
          },
        },
      },
      stopEvents: true,
    },
  });

  const views: StoreOrderView[] = [];

  for (const order of orders) {
    const assignment = order.assignments.find((a) => a.plan.status === "PUBLISHED");
    const stop = assignment?.tripStop ?? null;
    const trip = stop?.trip ?? null;
    const departed = trip?.status === "DEPARTED" || trip?.status === "COMPLETED";

    // How many stops the vehicle still has before this one — the honest answer
    // to "how long have I got?" when there is no live position to work from.
    let stopsBefore: number | null = null;
    if (stop && trip) {
      stopsBefore = await prisma.tripStop.count({
        where: { tripId: trip.id, seq: { lt: stop.seq }, status: { not: "DONE" } },
      });
    }

    const deliveredEvent = order.stopEvents.find(
      (e) => e.type === "DELIVERED" || e.type === "PART_DELIVERED",
    );
    const deferral = order.deferrals[0] ?? null;

    views.push({
      id: order.id,
      ref: order.ref,
      brand: order.brand,
      tempRequirement: order.tempRequirement,
      units: order.units,
      volumeM3: order.volumeM3,
      weightKg: order.weightKg,
      requestedDate: order.requestedDate.toISOString().slice(0, 10),
      state: stateOf(order.status, Boolean(stop), departed),
      etaAt: stop?.plannedArrivalAt ?? null,
      vehicleId: trip?.vehicleId ?? null,
      stopsBefore,
      tripStopId: stop?.id ?? null,
      deliveredUnits: deliveredEvent?.deliveredUnits ?? null,
      receiptConfirmed: Boolean(order.receipt),
      deferral: deferral
        ? {
            reasonCode: deferral.reasonCode,
            rolledToDate: deferral.rolledToDate?.toISOString().slice(0, 10) ?? null,
            acknowledged: Boolean(deferral.acknowledgedAt),
          }
        : null,
    });
  }

  return views;
}

/**
 * Per-unit averages from this outlet's own history, used to estimate the size
 * of a new order. Better than asking a store manager for cubic metres, and
 * honest about being an estimate.
 */
export async function unitSizeFor(
  outletId: string,
  temp: "chilled" | "ambient",
): Promise<{ kgPerUnit: number; m3PerUnit: number; sample: number }> {
  const rows = await prisma.order.findMany({
    where: { outletId, tempRequirement: temp },
    select: { units: true, weightKg: true, volumeM3: true },
    take: 60,
    orderBy: { requestedDate: "desc" },
  });

  const usable = rows.filter((r) => r.units > 0);
  if (usable.length === 0) return { kgPerUnit: 8, m3PerUnit: 0.045, sample: 0 };

  const kg = usable.reduce((n, r) => n + r.weightKg / r.units, 0) / usable.length;
  const m3 = usable.reduce((n, r) => n + r.volumeM3 / r.units, 0) / usable.length;
  return { kgPerUnit: kg, m3PerUnit: m3, sample: usable.length };
}

/** The next day this outlet's depot actually operates. */
export async function nextOperatingDate(after: Date): Promise<Date | null> {
  const row = await prisma.calendarDay.findFirst({
    where: { date: { gt: after }, isOperating: true },
    orderBy: { date: "asc" },
    select: { date: true },
  });
  return row?.date ?? null;
}

/* ---------------------------------------------------------------------------
   The incoming delivery, in the detail a receiving dock actually needs.

   `loadStoreOrders` answers "what is coming?". This answers the follow-up a
   store manager asks the moment they see it: where is the vehicle now, how far
   through the run is it, and how long have I got? Every field below is read
   from the published plan or from what the driver has recorded — nothing here
   is a live GPS position, and the UI says so rather than implying one.
   --------------------------------------------------------------------------- */

export interface DeliveryStep {
  key: string;
  label: string;
  /** The time or count under the label. Null when there is nothing honest to say. */
  detail: string | null;
  state: "done" | "current" | "todo";
}

export interface IncomingDelivery {
  orderId: string;
  ref: string;
  brand: "Fresh" | "Style" | "Tech";
  tempRequirement: "chilled" | "ambient";
  units: number;
  etaAt: string | null;
  vehicleId: string;
  districtName: string;
  depotCode: string;
  stopsBefore: number;
  /** Planned depot-to-district leg, from the district travel table. */
  legMinutes: number;
  /** Minutes from now until the planned arrival, when that is a sane number. */
  minutesAway: number | null;
  departed: boolean;
  steps: DeliveryStep[];
}

/** Device-free clock, matching the convention the driver's events are written in. */
function hhmm(at: Date): string {
  return at.toISOString().slice(11, 16);
}

/**
 * Minutes from now until an "HH:MM" planned arrival.
 *
 * Returns null unless the answer is both positive and within four hours — past
 * that the number is almost certainly an artefact of a simulated day rather
 * than a useful "how long have I got?", and a wrong countdown is worse than
 * none.
 */
function minutesUntil(clock: string | null): number | null {
  if (!clock) return null;
  const [h, m] = clock.split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  const now = new Date();
  const delta = h * 60 + m - (now.getUTCHours() * 60 + now.getUTCMinutes());
  return delta > 0 && delta <= 240 ? delta : null;
}

export async function loadIncomingDelivery(
  view: StoreOrderView,
): Promise<IncomingDelivery | null> {
  if (!view.tripStopId) return null;

  const stop = await prisma.tripStop.findUnique({
    where: { id: view.tripStopId },
    include: {
      trip: true,
      outlet: { include: { district: true } },
    },
  });
  if (!stop) return null;

  const departedAt = stop.trip.departedAt;
  const departed = Boolean(departedAt);
  const stopsBefore = view.stopsBefore ?? 0;

  // Which step is in progress. Everything before it is done, everything after
  // it is still to come — so the rail never claims more than has happened.
  let stage: number;
  if (stop.status === "DONE") stage = 4;
  else if (stop.arrivedAt) stage = 3;
  else if (departed && stopsBefore === 0) stage = 2;
  else if (departed) stage = 1;
  else stage = 0;

  const labels: { key: string; label: string; detail: string | null }[] = [
    {
      // The planned departure, not the recorded one. Every other time on this
      // rail — the ETA, the receiving window — is dataset wall-clock, and a
      // real timestamp dropped in beside them reads as a contradiction rather
      // than as extra precision. The actual times live on the order page.
      key: "dispatched",
      label: "Dispatched",
      detail: stop.trip.plannedDepartAt,
    },
    {
      key: "en_route",
      label: "En route",
      detail:
        stopsBefore > 0
          ? `${stopsBefore} ${stopsBefore === 1 ? "stop" : "stops"} ahead`
          : departed
            ? "clear run"
            : null,
    },
    { key: "next_stop", label: "Next stop", detail: stop.outletId },
    {
      key: "arriving",
      label: "Arriving soon",
      // Planned throughout, for the same reason as `dispatched` above. The
      // step going `current` is what says the vehicle is actually here.
      detail: view.etaAt ? `~${view.etaAt}` : null,
    },
    {
      key: "delivered",
      label: "Delivered",
      detail: stop.leftAt ? hhmm(stop.leftAt) : null,
    },
  ];

  return {
    orderId: view.id,
    ref: view.ref,
    brand: view.brand,
    tempRequirement: view.tempRequirement,
    units: view.units,
    etaAt: view.etaAt,
    vehicleId: stop.trip.vehicleId,
    districtName: stop.outlet.districtName,
    depotCode: stop.outlet.depotCode,
    stopsBefore,
    legMinutes: stop.outlet.district.depotToDistrictFreeflowMin,
    minutesAway: departed ? minutesUntil(view.etaAt) : null,
    departed,
    steps: labels.map((s, i) => ({
      ...s,
      state: i < stage ? "done" : i === stage ? "current" : "todo",
    })),
  };
}

/**
 * How a vehicle actually gets into this outlet, in words.
 *
 * The datasets carry `dock_type` and `parking_constraint` as codes. A store
 * manager already knows their own loading bay; what this is for is the panel
 * reading the same as the constraint the allocator enforced, so the two can
 * never quietly disagree.
 */
export function accessNoteFor(outlet: {
  dockType: string;
  parkingConstraint: string;
}): string {
  const parts: string[] = [];

  if (outlet.dockType === "rear_dock") parts.push("Use the rear dock.");
  else if (outlet.dockType === "mall_bay") parts.push("Deliveries come through the mall loading bay.");
  else parts.push("Kerbside delivery at the shopfront.");

  if (outlet.parkingConstraint === "van_only") parts.push("Vans only — no truck access.");
  else if (outlet.parkingConstraint === "mall_dock") parts.push("Security check at the gate.");

  return parts.join(" ");
}

/** "Dry groceries" reads better on a dock than "ambient". */
export function goodsLabel(temp: "chilled" | "ambient"): string {
  return temp === "chilled" ? "Chilled goods" : "Dry groceries";
}
