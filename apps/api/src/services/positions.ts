import { prisma } from "../lib/db";

/**
 * Where a vehicle was last reported to be, and how old that report is.
 *
 * Everything here is derived from `VehiclePing` rows — whatever the driver's
 * phone managed to send. The product may claim exactly that, with its age
 * (DOMAIN.md, "What the product may claim, and how"): not continuous tracking,
 * not a live feed. Age is measured from `recordedAt`, when the fix was taken,
 * never from `receivedAt`, so a report that sat in an outbox for twenty
 * minutes shows as twenty minutes old.
 */

/**
 * After this long without a report a vehicle is in "Lamp Mode": the map shows
 * its last reliable position, labelled with its age, and its ETA is an
 * estimate. Ten minutes is a judgement — long enough that a tunnel or a dead
 * spot does not flap, short enough that the dispatcher is not steering by a
 * position that has stopped being true.
 */
export const LAMP_AFTER_MINUTES = 10;

export interface VehiclePosition {
  vehicleId: string;
  tripId: string | null;
  lat: number;
  lng: number;
  accuracyM: number | null;
  recordedAt: Date;
  /** Whole seconds since the fix was taken. Never negative: a phone clock running ahead reads as 0. */
  ageSeconds: number;
  /** True once the report is older than LAMP_AFTER_MINUTES. */
  lamp: boolean;
}

export function ageSecondsOf(recordedAt: Date, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - recordedAt.getTime()) / 1000));
}

export function isLamp(ageSeconds: number): boolean {
  return ageSeconds > LAMP_AFTER_MINUTES * 60;
}

/** The most recent report for each vehicle that has made one. */
export async function latestPositions(
  vehicleIds: string[],
  now: Date = new Date(),
): Promise<Map<string, VehiclePosition>> {
  if (vehicleIds.length === 0) return new Map();
  const rows = await prisma.vehiclePing.findMany({
    where: { vehicleId: { in: vehicleIds } },
    orderBy: [{ vehicleId: "asc" }, { recordedAt: "desc" }],
    distinct: ["vehicleId"],
  });
  return new Map(
    rows.map((row) => {
      const ageSeconds = ageSecondsOf(row.recordedAt, now);
      return [
        row.vehicleId,
        {
          vehicleId: row.vehicleId,
          tripId: row.tripId,
          lat: row.lat,
          lng: row.lng,
          accuracyM: row.accuracyM,
          recordedAt: row.recordedAt,
          ageSeconds,
          lamp: isLamp(ageSeconds),
        },
      ];
    }),
  );
}

const COLOMBO = "Asia/Colombo";

/** Minutes past midnight, Colombo wall clock, for an instant. */
export function colomboMinutes(at: Date): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: COLOMBO,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return get("hour") * 60 + get("minute");
}

export function clockMinutes(clock: string): number {
  const [h, m] = clock.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

export function clockOf(minutes: number): string {
  const wrapped = ((Math.round(minutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(wrapped / 60)).padStart(2, "0")}:${String(wrapped % 60).padStart(2, "0")}`;
}

export interface StopForLateness {
  seq: number;
  plannedArrivalAt: string;
  arrivedAt: Date | null;
  status: string;
}

/**
 * How many minutes behind plan a trip is running, or 0 when on time or ahead.
 *
 * The estimate is the slip at the last stop the driver actually arrived at:
 * the freshest evidence of how the day is going, and one the driver
 * recorded rather than one inferred from position. A trip that has not reached
 * its first stop has no evidence yet, so it is not called late.
 *
 * Plans never cross midnight (the predawn wave starts after 00:00), so plain
 * minutes-of-day arithmetic is safe here.
 */
export function lateMinutes(stops: StopForLateness[]): number {
  const arrived = stops
    .filter((s) => s.arrivedAt)
    .sort((a, b) => b.seq - a.seq)[0];
  if (!arrived?.arrivedAt) return 0;
  const slip = colomboMinutes(arrived.arrivedAt) - clockMinutes(arrived.plannedArrivalAt);
  return Math.max(0, slip);
}

/** Planned arrival at the next undelivered stop, pushed back by the current slip. */
export function estimatedArrival(plannedArrivalAt: string, lateBy: number): string {
  return clockOf(clockMinutes(plannedArrivalAt) + lateBy);
}
