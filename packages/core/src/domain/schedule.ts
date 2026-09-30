/**
 * Turning a trip into clock times.
 *
 * This is a DIFFERENT calculation from `tripMinutes`, and the difference
 * matters. `tripMinutes` is the budget metric the organisers check: outbound
 * travel, inter-stop travel, handling, and no waiting. This module produces
 * the actual wall-clock schedule, which DOES include waiting, because a
 * vehicle that reaches an outlet before its window opens sits there.
 *
 * The distinction is the same one the Datathon's label construction makes:
 * service time starts at `max(arrival, window_open)`, and the wait before it
 * is not handling time.
 */

import { addMin, laterOf, toMin } from "./time";
import { lookupAllowance, type AllowanceTable } from "./tripTime";
import type { Brand, ClockTime, DistrictTravel, DockType, OutletRef } from "./types";

export interface ScheduleStopInput {
  outletId: string;
  /** One dock entry per ORDER at this stop — handling is charged per order. */
  docks: DockType[];
}

export interface ScheduledStop {
  outletId: string;
  arrival: ClockTime;
  /** When unloading actually begins: the later of arrival and window open. */
  serviceStart: ClockTime;
  leave: ClockTime;
  /** Minutes spent waiting for the window to open. Zero when not early. */
  waitMin: number;
  /** Positive when `arrival` is after the effective window close. */
  lateByMin: number;
  windowOpen: ClockTime;
  windowClose: ClockTime;
  isMallWindow: boolean;
}

/**
 * The window a stop must actually be served in. Mall outlets are governed by
 * the mall's fixed access window when one is recorded; everything else uses
 * the outlet's own requested window.
 */
export function effectiveWindow(outlet: OutletRef): {
  open: ClockTime;
  close: ClockTime;
  isMallWindow: boolean;
} {
  if (outlet.mallWindowOpen && outlet.mallWindowClose) {
    return {
      open: outlet.mallWindowOpen,
      close: outlet.mallWindowClose,
      isMallWindow: true,
    };
  }
  return { open: outlet.windowOpen, close: outlet.windowClose, isMallWindow: false };
}

/**
 * Walk a trip's stops forward from a departure time.
 *
 * Stops are taken in the order given — this function does not reorder them.
 */
export function computeStopSchedule(
  departAt: ClockTime,
  travel: DistrictTravel,
  brand: Brand,
  stops: readonly ScheduleStopInput[],
  outlets: ReadonlyMap<string, OutletRef>,
  allowance: AllowanceTable,
): ScheduledStop[] {
  const out: ScheduledStop[] = [];
  let cursor = addMin(departAt, travel.depotToDistrictFreeflowMin);

  for (let i = 0; i < stops.length; i++) {
    const stop = stops[i];
    const outlet = outlets.get(stop.outletId);
    if (!outlet) throw new Error(`Unknown outlet in schedule: ${stop.outletId}`);

    const win = effectiveWindow(outlet);
    const arrival = cursor;
    const serviceStart = laterOf(arrival, win.open);
    const waitMin = Math.max(0, toMin(serviceStart) - toMin(arrival));
    const handling = stop.docks.reduce(
      (sum, dock) => sum + lookupAllowance(allowance, brand, dock),
      0,
    );
    const leave = addMin(serviceStart, handling);
    const lateByMin = Math.max(0, toMin(arrival) - toMin(win.close));

    out.push({
      outletId: stop.outletId,
      arrival,
      serviceStart,
      leave,
      waitMin,
      lateByMin,
      windowOpen: win.open,
      windowClose: win.close,
      isMallWindow: win.isMallWindow,
    });

    if (i < stops.length - 1) {
      cursor = addMin(leave, travel.interStopFreeflowMin);
    }
  }

  return out;
}

/**
 * The latest departure at which every stop is still reached before its window
 * closes, or `null` when no departure works.
 *
 * Departing as late as possible is what a dispatcher actually wants: it keeps
 * chilled goods in the depot's cold room rather than idling at a closed
 * outlet, and it leaves slack earlier in the wave for another trip.
 */
export function latestFeasibleDeparture(
  travel: DistrictTravel,
  brand: Brand,
  stops: readonly ScheduleStopInput[],
  outlets: ReadonlyMap<string, OutletRef>,
  allowance: AllowanceTable,
  earliest: ClockTime,
  latest: ClockTime,
): ClockTime | null {
  const lo = toMin(earliest);
  const hi = toMin(latest);
  if (stops.length === 0 || lo > hi) return null;

  const feasible = (departMin: number): boolean => {
    const sched = computeStopSchedule(
      addMin("00:00", departMin),
      travel,
      brand,
      stops,
      outlets,
      allowance,
    );
    return sched.every((s) => s.lateByMin === 0);
  };

  // Feasibility is monotonic in departure time — leaving later never makes a
  // stop earlier — so the latest feasible departure is a clean binary search.
  if (!feasible(lo)) return null;

  let best = lo;
  let low = lo;
  let high = hi;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    if (feasible(mid)) {
      best = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return addMin("00:00", best);
}
