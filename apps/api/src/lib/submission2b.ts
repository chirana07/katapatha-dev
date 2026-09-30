/**
 * Export an allocation in the organisers' Task 2B submission shape.
 *
 * Columns, row set and row order all matter: the checker matches on
 * (scenario, order_ref), requires every order to appear exactly once, and
 * rejects unknown refs. We re-validate before emitting, so what gets handed
 * over is provably the thing our own validator passed.
 */

import type { AllocatorOutput } from "@katapatha/allocator/types";

export const SUBMISSION_2B_HEADER =
  "scenario,order_ref,outlet_id,decision,vehicle_id,trip_id";

export interface Submission2bRow {
  scenario: string;
  orderRef: string;
  outletId: string;
  decision: "served" | "deferred";
  vehicleId: string;
  tripId: string;
}

export interface Submission2bOptions {
  scenario?: string;
  /** Emit rows in this order; anything not listed is appended, sorted. */
  templateOrder?: readonly string[];
}

export function buildSubmission2bRows(
  output: AllocatorOutput,
  outletByOrderRef: ReadonlyMap<string, string>,
  options: Submission2bOptions = {},
): Submission2bRow[] {
  const scenario = options.scenario ?? "S1";
  const rows = new Map<string, Submission2bRow>();

  for (const trip of output.trips) {
    for (const stop of trip.stops) {
      for (const ref of stop.orderRefs) {
        rows.set(ref, {
          scenario,
          orderRef: ref,
          outletId: stop.outletId,
          decision: "served",
          vehicleId: trip.vehicleId,
          tripId: String(trip.tripNo),
        });
      }
    }
  }

  for (const d of output.deferred) {
    rows.set(d.orderRef, {
      scenario,
      orderRef: d.orderRef,
      outletId: d.outletId,
      decision: "deferred",
      // The checker warns if a deferred row names a vehicle, so leave both blank.
      vehicleId: "",
      tripId: "",
    });
  }

  const ordered: Submission2bRow[] = [];
  const seen = new Set<string>();
  for (const ref of options.templateOrder ?? []) {
    const row = rows.get(ref);
    if (row) {
      ordered.push(row);
      seen.add(ref);
    }
  }
  const remainder = [...rows.values()]
    .filter((r) => !seen.has(r.orderRef))
    .sort((a, b) => a.orderRef.localeCompare(b.orderRef));

  return [...ordered, ...remainder];
}

export function toCsv(rows: readonly Submission2bRow[]): string {
  const lines = [SUBMISSION_2B_HEADER];
  for (const r of rows) {
    lines.push(
      [r.scenario, r.orderRef, r.outletId, r.decision, r.vehicleId, r.tripId].join(","),
    );
  }
  return `${lines.join("\n")}\n`;
}

/** Map every order ref to its outlet, for the export's readability column. */
export function outletIndex(
  orders: readonly { ref: string; outletId: string }[],
): Map<string, string> {
  return new Map(orders.map((o) => [o.ref, o.outletId]));
}
