import type { components } from "@katapatha/contracts/types";
import type { SqlDriver } from "../db/driver";
import type { StopStatus } from "../driver/stop-state";
import type { CachedItem } from "../driver/order-items";

export type { CachedItem };

/**
 * Reads and writes the cached run.
 *
 * This cache is what lets a driver work with no signal: the run is fetched once
 * and every screen reads it from here, never from the network. It holds server
 * truth only -- `stop.server_status` is the server's status, and a pending local
 * action is folded over it at read time by src/outbox/projection.ts rather than
 * written into it. See the note at the top of src/db/migrations.ts.
 *
 * Nothing here selects signature_data or photo_data. Those live on outbox rows,
 * are read once at drain time, and are nulled on confirmation.
 */

export type Run = components["schemas"]["Run"];
export type ApiStop = components["schemas"]["Stop"];

/** A stop as the cache stores it: flat, with its trip's identity alongside. */
export type CachedStop = {
  id: string;
  tripId: string;
  tripNo: number;
  wave: string;
  date: string;
  seq: number;
  outletId: string;
  outletName: string | null;
  serverStatus: StopStatus;
  plannedArrivalAt: string | null;
  windowOpen: string | null;
  windowClose: string | null;
  accessNote: string | null;
  orders: CachedOrder[];
};

export type CachedOrder = {
  orderId: string;
  orderRef: string;
  expectedUnits: number;
  /** What the store ordered; null when the cached run predates the column. */
  orderedUnits?: number | null;
  /**
   * What the order contains, in the server's order. Read-only context: empty for
   * an order placed as units only, and for a run cached before the column.
   */
  items?: CachedItem[];
};

export type CachedRun = {
  date: string;
  vehicleId: string;
  fetchedAt: string;
  stops: CachedStop[];
};

type StopRow = {
  id: string;
  trip_id: string;
  trip_no: number;
  wave: string;
  date: string;
  seq: number;
  outlet_id: string;
  outlet_name: string | null;
  server_status: StopStatus;
  planned_arrival_at: string | null;
  window_open: string | null;
  window_close: string | null;
  access_note: string | null;
};

type OrderRow = {
  stop_id: string;
  order_id: string;
  order_ref: string;
  expected_units: number;
  ordered_units: number | null;
};

type ItemRow = {
  stop_id: string;
  order_id: string;
  sku: string;
  name: string;
  quantity: number;
  unit_label: string;
};

type RunRow = { date: string; vehicle_id: string; fetched_at: string };

/**
 * Replaces the cached run for its date, in one transaction.
 *
 * Replace rather than merge: the server's run is the whole truth for that day,
 * and a stop removed from the plan (reassigned to another vehicle, say) must
 * disappear here too. Deleting the run row cascades to trips, stops and orders.
 *
 * Outbox rows are untouched -- they are the driver's work, not the server's, and
 * a re-bootstrap must never discard a queued event.
 */
export async function replaceRun(
  sql: SqlDriver,
  run: Run,
  fetchedAt: string,
): Promise<void> {
  await sql.tx(async (tx) => {
    await tx.run("DELETE FROM run WHERE date = ?", [run.date]);
    await tx.run("INSERT INTO run (date, vehicle_id, fetched_at) VALUES (?, ?, ?)", [
      run.date,
      run.vehicleId,
      fetchedAt,
    ]);

    for (const trip of run.trips) {
      await tx.run(
        "INSERT INTO trip (trip_id, date, trip_no, wave) VALUES (?, ?, ?, ?)",
        [trip.tripId, run.date, trip.tripNo, trip.wave],
      );

      for (const stop of trip.stops) {
        await tx.run(
          `INSERT INTO stop
             (id, trip_id, date, seq, outlet_id, outlet_name, server_status,
              planned_arrival_at, window_open, window_close, access_note)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            stop.id,
            trip.tripId,
            run.date,
            stop.seq,
            stop.outletId,
            stop.outletName ?? null,
            stop.status,
            stop.plannedArrivalAt ?? null,
            stop.windowOpen ?? null,
            stop.windowClose ?? null,
            stop.accessNote ?? null,
          ],
        );

        for (const order of stop.orders ?? []) {
          await tx.run(
            `INSERT INTO stop_order (stop_id, order_id, order_ref, expected_units, ordered_units)
             VALUES (?, ?, ?, ?, ?)`,
            [
              stop.id,
              order.orderId,
              order.orderRef,
              order.expectedUnits,
              order.orderedUnits ?? null,
            ],
          );

          for (const [seq, item] of (order.items ?? []).entries()) {
            await tx.run(
              `INSERT INTO stop_order_item
                 (stop_id, order_id, seq, sku, name, quantity, unit_label)
               VALUES (?, ?, ?, ?, ?, ?, ?)`,
              [stop.id, order.orderId, seq, item.sku, item.name, item.quantity, item.unitLabel],
            );
          }
        }
      }
    }
  });
}

/**
 * Reads the cached run for a date, or null if the device has never fetched it.
 *
 * Stops come back flattened across trips and ordered by trip then sequence,
 * which is the order the driver drives and the order the run list renders. The
 * web console flattens the same way.
 */
export async function readRun(
  sql: SqlDriver,
  date: string,
): Promise<CachedRun | null> {
  const run = await sql.first<RunRow>(
    "SELECT date, vehicle_id, fetched_at FROM run WHERE date = ?",
    [date],
  );
  if (!run) return null;

  const stopRows = await sql.all<StopRow>(
    `SELECT s.id, s.trip_id, t.trip_no, t.wave, s.date, s.seq, s.outlet_id,
            s.outlet_name, s.server_status, s.planned_arrival_at,
            s.window_open, s.window_close, s.access_note
       FROM stop s
       JOIN trip t ON t.trip_id = s.trip_id
      WHERE s.date = ?
      ORDER BY t.trip_no ASC, s.seq ASC`,
    [date],
  );

  const orderRows = await sql.all<OrderRow>(
    `SELECT o.stop_id, o.order_id, o.order_ref, o.expected_units, o.ordered_units
       FROM stop_order o
       JOIN stop s ON s.id = o.stop_id
      WHERE s.date = ?
      ORDER BY o.order_ref ASC`,
    [date],
  );

  const itemRows = await sql.all<ItemRow>(
    `SELECT i.stop_id, i.order_id, i.sku, i.name, i.quantity, i.unit_label
       FROM stop_order_item i
       JOIN stop s ON s.id = i.stop_id
      WHERE s.date = ?
      ORDER BY i.seq ASC`,
    [date],
  );
  const itemsByOrder = groupItems(itemRows);

  const ordersByStop = new Map<string, CachedOrder[]>();
  for (const row of orderRows) {
    const list = ordersByStop.get(row.stop_id) ?? [];
    list.push({
      orderId: row.order_id,
      orderRef: row.order_ref,
      expectedUnits: row.expected_units,
      orderedUnits: row.ordered_units,
      items: itemsByOrder.get(itemKey(row.stop_id, row.order_id)) ?? [],
    });
    ordersByStop.set(row.stop_id, list);
  }

  return {
    date: run.date,
    vehicleId: run.vehicle_id,
    fetchedAt: run.fetched_at,
    stops: stopRows.map((row) => toCachedStop(row, ordersByStop.get(row.id) ?? [])),
  };
}

/** One stop by id, for the stop detail screen. */
export async function readStop(
  sql: SqlDriver,
  stopId: string,
): Promise<CachedStop | null> {
  const row = await sql.first<StopRow>(
    `SELECT s.id, s.trip_id, t.trip_no, t.wave, s.date, s.seq, s.outlet_id,
            s.outlet_name, s.server_status, s.planned_arrival_at,
            s.window_open, s.window_close, s.access_note
       FROM stop s
       JOIN trip t ON t.trip_id = s.trip_id
      WHERE s.id = ?`,
    [stopId],
  );
  if (!row) return null;

  const orders = await sql.all<OrderRow>(
    `SELECT stop_id, order_id, order_ref, expected_units, ordered_units
       FROM stop_order WHERE stop_id = ? ORDER BY order_ref ASC`,
    [stopId],
  );

  const itemRows = await sql.all<ItemRow>(
    `SELECT stop_id, order_id, sku, name, quantity, unit_label
       FROM stop_order_item WHERE stop_id = ? ORDER BY seq ASC`,
    [stopId],
  );
  const itemsByOrder = groupItems(itemRows);

  return toCachedStop(
    row,
    orders.map((order) => ({
      orderId: order.order_id,
      orderRef: order.order_ref,
      expectedUnits: order.expected_units,
      orderedUnits: order.ordered_units,
      items: itemsByOrder.get(itemKey(order.stop_id, order.order_id)) ?? [],
    })),
  );
}

const itemKey = (stopId: string, orderId: string) => `${stopId}\u0000${orderId}`;

/** Item rows (already in seq order) grouped by their order. */
function groupItems(rows: readonly ItemRow[]): Map<string, CachedItem[]> {
  const byOrder = new Map<string, CachedItem[]>();
  for (const row of rows) {
    const key = itemKey(row.stop_id, row.order_id);
    const list = byOrder.get(key) ?? [];
    list.push({
      sku: row.sku,
      name: row.name,
      quantity: row.quantity,
      unitLabel: row.unit_label,
    });
    byOrder.set(key, list);
  }
  return byOrder;
}

function toCachedStop(row: StopRow, orders: CachedOrder[]): CachedStop {
  return {
    id: row.id,
    tripId: row.trip_id,
    tripNo: row.trip_no,
    wave: row.wave,
    date: row.date,
    seq: row.seq,
    outletId: row.outlet_id,
    outletName: row.outlet_name,
    serverStatus: row.server_status,
    plannedArrivalAt: row.planned_arrival_at,
    windowOpen: row.window_open,
    windowClose: row.window_close,
    accessNote: row.access_note,
    orders,
  };
}

/** Replaces one vocabulary, preserving the server's ordering. */
export async function replaceVocabulary(
  sql: SqlDriver,
  kind: string,
  codes: string[],
): Promise<void> {
  await sql.tx(async (tx) => {
    await tx.run("DELETE FROM vocabulary WHERE kind = ?", [kind]);
    for (const [position, code] of codes.entries()) {
      await tx.run(
        "INSERT INTO vocabulary (kind, code, position) VALUES (?, ?, ?)",
        [kind, code, position],
      );
    }
  });
}

/**
 * Reads a cached vocabulary. An empty array means the device has never seen the
 * server's list, and the caller must fall back to src/driver/reasons.ts AND say
 * so on screen -- the web console shows a banner for exactly this.
 */
export async function readVocabulary(
  sql: SqlDriver,
  kind: string,
): Promise<string[]> {
  const rows = await sql.all<{ code: string }>(
    "SELECT code FROM vocabulary WHERE kind = ? ORDER BY position ASC",
    [kind],
  );
  return rows.map((row) => row.code);
}
